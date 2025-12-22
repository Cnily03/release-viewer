#!/usr/bin/env -S bun
/** biome-ignore-all lint/suspicious/noExplicitAny: type is too complex */
import fs from "node:fs";
import path from "node:path";
import Bun, { $, type SyncSubprocess } from "bun";
import type { Config, Release, ReleaseAsset } from "@/config";

const PROGRAM_NAME = "Release-Viewer-Sync";
const PROGRAM_VERSION = "1.0";

class AtomicLock {
  private len: Uint8Array;
  constructor() {
    const buffer = new SharedArrayBuffer(16);
    this.len = new Uint8Array(buffer);
  }
  private waitingResolvers: Array<() => void> = [];
  lock() {
    return new Promise<void>((resolve) => {
      const formerlen = Atomics.add(this.len, 0, 1);
      if (formerlen === 0) {
        resolve();
        Atomics.sub(this.len, 0, 1);
      } else {
        this.waitingResolvers.push(resolve);
      }
    });
  }
  unlock() {
    const nextResolver = this.waitingResolvers.shift();
    if (nextResolver) {
      nextResolver();
      Atomics.sub(this.len, 0, 1);
    }
  }
}

class Mutex {
  private num: number = 0;
  private max: number;
  private waitingLockers: Array<() => void> = [];
  private waitingAllResolvers: Array<() => void> = [];
  private atomicLock: AtomicLock = new AtomicLock();
  constructor(max: number) {
    this.max = max;
  }
  async lock() {
    return new Promise<void>((resolve) => {
      const doLock = () => {
        this.num += 1;
        resolve();
      };
      this.atomicLock.lock().then(() => {
        if (this.num < this.max) {
          doLock();
        } else {
          this.waitingLockers.push(doLock);
        }
        this.atomicLock.unlock();
      });
    });
  }
  async release() {
    await this.atomicLock.lock();
    this.num = Math.max(0, this.num - 1);
    const nextLocker = this.waitingLockers.shift();
    if (nextLocker) {
      nextLocker();
    } else {
      let resolver = this.waitingAllResolvers.shift();
      while (resolver && this.num === 0) {
        resolver();
        resolver = this.waitingAllResolvers.shift();
      }
    }
    this.atomicLock.unlock();
  }
  async waitAll() {
    return new Promise<void>((resolve) => {
      this.atomicLock.lock().then(() => {
        if (this.num === 0) {
          resolve();
        } else {
          this.waitingAllResolvers.push(resolve);
        }
        this.atomicLock.unlock();
      });
    });
  }
}

class SubprocessError extends Error {
  exitCode: number | null;
  signalCode: string | null;

  constructor(message: string, exitCode: number | null, signalCode: string | null) {
    super(message);
    this.exitCode = exitCode;
    this.signalCode = signalCode;
  }
}

const datePrefix = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const str = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  return `\x1b[0;2m${str}\x1b[0m`;
};

const ANSI = {
  RESET: "\x1b[0m",
  DIM: "\x1b[2m",
  BOLD: "\x1b[1m",
  UNBOLD: "\x1b[22m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  MAGENTA: "\x1b[35m",
};

const PADDING = " ".repeat(19);

const removeAnsi = (str: string) => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: invisible characters
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

const printSpliter = (fmt: string = "-", withTime: boolean = false) => {
  const prefix = withTime ? `${datePrefix()} ` : "";
  const delta = withTime ? removeAnsi(prefix).length : 0;
  const col = (process.stdout.columns || 40) - delta;
  let str = fmt.repeat(col / fmt.length);
  const restCol = col % fmt.length;
  if (restCol > 0) {
    str += fmt.slice(0, restCol);
  }
  str = ANSI.DIM + str + ANSI.RESET;
  console.info(`${prefix}${str}`);
};

const printInfo = (message: string, ...params: any[]) => {
  console.info(`${datePrefix()} ${message}`, ...params);
};

const printWarning = (message: string, ...params: any[]) => {
  console.warn(`${datePrefix()} ${ANSI.YELLOW}Warning:${ANSI.RESET} ${message}`, ...params);
};

const printError = (message: string, ...params: any[]) => {
  console.error(`${datePrefix()} ${ANSI.RED}Error:${ANSI.RESET} ${message}`, ...params);
};

const terminateWithError = (message: string, ...params: any[]) => {
  printError(message, ...params);
};

export interface UrlTemplateContext {
  tag: string;
  name: string;
  release: string;
  url: string;
  [key: string]: string;
}

interface SyncOptions {
  // <repo_fullname>
  repo: string;
  // -d, --download-target <directory>
  downloadTarget?: string;
  // -t, --url-template <template>
  downloadUrlTmpl?: string;
  // --fast-fail
  fastFail?: boolean;
  // --fast-sync
  fastSync?: boolean;
  // --concurrency <number>
  concurrency: number;
  // -b, --build-base <base>
  buildBase?: string;
  // --www-root <directory>
  wwwRootDir?: string;
  // -o, --save <path>
  saveConfigPath?: string;
  // -c, --compare <path>
  compareConfigPath?: string;
}

function isLocalFsPath(p: string) {
  return !/^[a-zA-Z0-9._-]+:/.test(p);
}

function isExists(p: string) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function canAccess(p: string) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDir(p: string) {
  try {
    const stat = fs.statSync(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string) {
  try {
    const stat = fs.statSync(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

function assertAccess(path: string, type: "file" | "dir") {
  if (!canAccess(path)) {
    if (!isExists(path)) {
      throw new Error(`${type === "file" ? "File" : "Directory"} does not exist: ${path}`);
    }
    throw new Error(`Permission denied: cannot access path: ${path}`);
  }
  if (!isExists(path)) {
    throw new Error(`${type === "file" ? "File" : "Directory"} does not exist: ${path}`);
  }
  if (type === "file" && !isFile(path)) {
    throw new Error(`Path is not a file: ${path}`);
  }
  if (type === "dir" && !isDir(path)) {
    throw new Error(`Path is not a directory: ${path}`);
  }
}

function usage() {
  console.info(
    `
Usage: sync.ts <repo_fullname> [...options] [..generate options]

Basic Options:
  -h,
  --help                              Show this help message
  -o,
  --save <path>                       Save generated configuration to file
  -c,
  --compare <path>                    Compare with former configuration file

Download Options:
  -d,
  --download-target <directory>       Directory for downloaded files
  -t,
  --url-template <template>           Template URL for downloading files (user-facing)
  --fast-fail                         Fail immediately on download error
  --fast-sync                         Synchronize files to downloaded directory after download immediately
  --concurrency <number>              Number of concurrent downloads (default: 1)

Build Options:
  -b,
  --build-base <base>                 Base URL for building front-end (e.g., /app/)
  --www-root <directory>              Root directory for the front-end website
`.trim()
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options: SyncOptions = {
    repo: "",
    downloadTarget: "",
    downloadUrlTmpl: "",
    fastFail: false,
    fastSync: false,
    concurrency: 1,
    buildBase: "",
    wwwRootDir: "",
    compareConfigPath: "",
  };
  const restArgs: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "-h":
      case "--help": {
        usage();
        process.exit(0);
        break;
      }
      case "-o":
      case "--save": {
        const next = args.shift();
        if (!next) {
          terminateWithError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.saveConfigPath = next;
        break;
      }
      case "-c":
      case "--compare": {
        const next = args.shift();
        if (!next) {
          terminateWithError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.compareConfigPath = next;
        break;
      }
      case "-d":
      case "--download-target": {
        const next = args.shift();
        if (!next) {
          terminateWithError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.downloadTarget = next;
        break;
      }
      case "-t":
      case "--url-template": {
        const next = args.shift();
        if (!next) {
          terminateWithError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.downloadUrlTmpl = next;
        break;
      }
      case "--fast-fail": {
        options.fastFail = true;
        break;
      }
      case "--fast-sync": {
        options.fastSync = true;
        break;
      }
      case "--concurrency": {
        const next = args.shift();
        if (!next) {
          terminateWithError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        const num = Number(next);
        if (Number.isNaN(num) || num <= 0 || !Number.isInteger(num)) {
          terminateWithError(`Invalid concurrency number: ${next}`);
          usage();
          process.exit(1);
        }
        options.concurrency = num;
        break;
      }
      case "-b":
      case "--build-base": {
        const next = args.shift();
        if (!next) {
          terminateWithError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.buildBase = next;
        break;
      }
      case "--www-root": {
        const next = args.shift();
        if (!next) {
          terminateWithError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.wwwRootDir = next;
        break;
      }
      default:
        if (!arg.startsWith("-") && !options.repo) {
          options.repo = arg;
        } else {
          restArgs.push(arg);
        }
        break;
    }
  }

  // check required options
  if (!options.repo) {
    terminateWithError("Missing required argument: <repo_fullname>");
    usage();
    process.exit(1);
  }

  // normalize and check paths
  try {
    if (options.downloadTarget && isLocalFsPath(options.downloadTarget)) {
      options.downloadTarget = path.resolve(process.cwd(), options.downloadTarget);
      assertAccess(options.downloadTarget, "dir");
    }
    if (options.wwwRootDir && isLocalFsPath(options.wwwRootDir)) {
      options.wwwRootDir = path.resolve(process.cwd(), options.wwwRootDir);
      assertAccess(options.wwwRootDir, "dir");
    }
    if (options.compareConfigPath && isLocalFsPath(options.compareConfigPath)) {
      options.compareConfigPath = path.resolve(process.cwd(), options.compareConfigPath);
      //   assertAccess(options.compareConfigPath, "file");
    }
  } catch (e: any) {
    if (e instanceof Error) terminateWithError(e.message);
    process.exit(1);
  }

  return { options, restArgs };
}

const genCtx = (release: Release, asset: ReleaseAsset): UrlTemplateContext => {
  return {
    tag: release.tag.name,
    name: asset.name,
    release: release.name,
    url: asset.download_url,
  };
};

const genArchiveCtx = (release: Release, url: string, fnTmpl: string): UrlTemplateContext => {
  const filename = fnTmpl.replace(/\{\}/g, release.tag.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return {
    tag: release.tag.name,
    name: filename,
    release: release.name,
    url: url,
  };
};

function render<T extends Record<string, string>>(tmpl: string, vars: T) {
  return tmpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, p1) => {
    if (Object.hasOwn(vars, p1)) {
      return vars[p1]!;
    }
    return match;
  });
}

function checkCommandAvailable(cmd: string) {
  try {
    const whichResult = Bun.spawnSync(["which", cmd], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    if (whichResult.exitCode !== 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function panicSubprocess(subprocess: SyncSubprocess) {
  if (subprocess.exitCode) {
    throw new SubprocessError(
      `${ANSI.BOLD}Subprocess exited with code ${subprocess.exitCode}:${ANSI.RESET} ${subprocess.stderr || ""}`,
      subprocess.exitCode,
      null
    );
  }
  if (subprocess.signalCode) {
    throw new SubprocessError(
      `${ANSI.BOLD}Subprocess terminated by signal ${subprocess.signalCode}:${ANSI.RESET} ${subprocess.stderr || ""}`,
      null,
      subprocess.signalCode
    );
  }
}

function ensureCommand(cmd: string | string[], emsg: string = "") {
  const cmds = Array.isArray(cmd) ? cmd : [cmd];
  if (cmds.length === 0) return true;
  const ok = cmds.some((c) => checkCommandAvailable(c));
  if (!ok) {
    if (emsg) {
      terminateWithError(emsg);
    } else if (cmds.length === 1) {
      terminateWithError(`Command is required but not found: ${cmds[0]}`);
    } else {
      terminateWithError(`At least one of the following commands is required but not found: ${cmds.join(", ")}`);
    }
    process.exit(1);
  }
}

async function downloadFile(url: string, destPath: string, retryCount: number = 3): Promise<boolean> {
  // mkdir parent directory
  const parentDir = path.dirname(destPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const UserAgent = `${PROGRAM_NAME}/${PROGRAM_VERSION} (${process.platform})`;

  // curl
  if (checkCommandAvailable("curl")) {
    const so = await $`curl -fsSL --retry ${retryCount} -A ${UserAgent} -o ${destPath} ${url}`.nothrow().quiet();
    if (so.exitCode !== 0) {
      printError(
        `Failed to (curl) download ${ANSI.CYAN}${ANSI.DIM}${url}${ANSI.RESET}: exit code ${so.exitCode}: ${so.stderr?.toString()}`
      );
      return false;
    }
  }
  // wget
  else if (checkCommandAvailable("wget")) {
    const so = await $`wget -q --tries=${retryCount} -U ${UserAgent} -O ${destPath} ${url}`.nothrow().quiet();
    if (so.exitCode !== 0) {
      printError(
        `Failed to (wget) download ${ANSI.CYAN}${ANSI.DIM}${url}${ANSI.RESET}: exit code ${so.exitCode}: ${so.stderr?.toString()}`
      );
      return false;
    }
  }
  // neither
  else {
    printError(`Neither curl nor wget is available for downloading files.`);
    return false;
  }
  return true;
}

interface NewRecordItem {
  downloadUrl: string;
  // userDownloadUrl: string;
  filename: string;
}

type AddRecord = Record<string, NewRecordItem[]>; // tag -> files
type RemoveRecord = Record<string, "*" | string[]>; // tag -> files, * means remove the whole tag directory
type ModifyRecord = Record<string, NewRecordItem[]>; // tag -> files

async function collectDiff(config: Config, compareConfig?: Config | null) {
  const rec = {
    add: {} as AddRecord,
    remove: {} as RemoveRecord,
    modify: {} as ModifyRecord,
    passedModify: {} as ModifyRecord,
  };
  const extMap = {
    zip_url: "zip",
    tar_url: "tar.gz",
  };

  if (compareConfig) {
    printInfo(`Comparing with former configuration...`);
    const formerReleaseMap = new Map<string, Release>();
    for (const release of compareConfig.releases) {
      formerReleaseMap.set(release.tag.name, release);
    }
    const curReleaseMap = new Map<string, Release>();
    for (const release of config.releases) {
      curReleaseMap.set(release.tag.name, release);
    }
    // check for removed releases
    const removedReleases = compareConfig.releases.filter((r) => !curReleaseMap.has(r.tag.name));
    for (const release of removedReleases) {
      rec.remove[release.tag.name] = "*";
      formerReleaseMap.delete(release.tag.name);
    }
    // check for added/modified releases
    for (const release of config.releases) {
      const formerRelease = formerReleaseMap.get(release.tag.name);
      if (!formerRelease) {
        // new release
        const addRec = release.assets.map((asset) => {
          return {
            downloadUrl: asset.download_url,
            filename: asset.name,
          };
        });
        if (release.tar_url) {
          const ctx = genArchiveCtx(release, release.tar_url, `${config.name}-{}.tar.gz`);
          addRec.push({
            downloadUrl: release.tar_url,
            filename: ctx.name,
          });
        }
        if (release.zip_url) {
          const ctx = genArchiveCtx(release, release.zip_url, `${config.name}-{}.zip`);
          addRec.push({
            downloadUrl: release.zip_url,
            filename: ctx.name,
          });
        }
        if (addRec.length > 0) {
          rec.add[release.tag.name] = addRec;
        }
      } else {
        // modify release
        // existing release, compare assets
        const formerMap = new Map<string, ReleaseAsset>();
        for (const a of formerRelease.assets) {
          formerMap.set(a.name, a);
        }
        const curMap = new Map<string, ReleaseAsset>();
        for (const a of release.assets) {
          curMap.set(a.name, a);
        }
        // check for removed assets
        const removedAssets = formerRelease.assets.filter((a) => !curMap.has(a.name));
        if (removedAssets.length > 0) {
          rec.remove[release.tag.name] = removedAssets.map((a) => a.name);
        }
        // check for added/modified assets
        for (const a of release.assets) {
          const formerAsset = formerMap.get(a.name);
          if (!formerAsset) {
            // new asset
            if (!rec.add[release.tag.name]) {
              rec.add[release.tag.name] = [];
            }
            rec.add[release.tag.name]!.push({
              downloadUrl: a.download_url,
              filename: a.name,
            });
          } else {
            // existing asset, check for modification
            const same =
              a.name === formerAsset.name &&
              a.download_url === formerAsset.download_url &&
              a.size === formerAsset.size &&
              a.digest === formerAsset.digest;
            if (!same) {
              if (!rec.modify[release.tag.name]) {
                rec.modify[release.tag.name] = [];
              }
              rec.modify[release.tag.name]!.push({
                downloadUrl: a.download_url,
                filename: a.name,
              });
            } else {
              if (!rec.passedModify[release.tag.name]) {
                rec.passedModify[release.tag.name] = [];
              }
              rec.passedModify[release.tag.name]!.push({
                downloadUrl: a.download_url,
                filename: a.name,
              });
            }
          }
        }
        // source archives
        for (const archiveProp of ["zip_url", "tar_url"] as const) {
          const ctx = genArchiveCtx(release, release[archiveProp], `${config.name}-{}.${extMap[archiveProp]}`);
          const o = {
            downloadUrl: release[archiveProp],
            filename: `archive/${ctx.name}`,
          };
          if (release[archiveProp] !== formerRelease[archiveProp]) {
            if (release[archiveProp] && !formerRelease[archiveProp]) {
              // modify
              if (!rec.modify[release.tag.name]) {
                rec.modify[release.tag.name] = [];
              }
              rec.modify[release.tag.name]!.push(o);
            } else if (!release[archiveProp] && formerRelease[archiveProp]) {
              // remove
              if (!rec.remove[release.tag.name]) {
                rec.remove[release.tag.name] = [];
              }
              const arr = rec.remove[release.tag.name]!;
              if (arr !== "*") arr.push(ctx.name);
            } else {
              // add
              if (!rec.add[release.tag.name]) {
                rec.add[release.tag.name] = [];
              }
              rec.add[release.tag.name]!.push(o);
            }
          } else if (release[archiveProp] && formerRelease[archiveProp]) {
            // same and exists, passedModify
            if (!rec.passedModify[release.tag.name]) {
              rec.passedModify[release.tag.name] = [];
            }
            rec.passedModify[release.tag.name]!.push(o);
          }
        }
      }
    }
  } else {
    printInfo(`No compare configuration provided, ${ANSI.YELLOW}skipping${ANSI.RESET} comparison step.`);
    for (const release of config.releases) {
      rec.add[release.tag.name] = release.assets.map((asset) => {
        return {
          downloadUrl: asset.download_url,
          filename: asset.name,
        };
      });
      for (const archiveProp of ["zip_url", "tar_url"] as const) {
        const ctx = genArchiveCtx(release, release[archiveProp], `${config.name}-{}.${extMap[archiveProp]}`);
        rec.add[release.tag.name]!.push({
          downloadUrl: release[archiveProp],
          filename: `archive/${ctx.name}`,
        });
      }
    }
  }
  return rec;
}

function countDiffFiles(
  diff: { add: AddRecord; remove: RemoveRecord; modify: ModifyRecord; fix: ModifyRecord },
  compareConfig?: Config | null
) {
  let addedCount = 0;
  for (const v of Object.values(diff.add)) {
    addedCount += v.length;
  }
  let removedCount = 0;
  for (const v of Object.values(diff.remove)) {
    if (v === "*") {
      // get former config to count files
      if (compareConfig) {
        const formerRelease = compareConfig.releases.find(
          (r) => r.tag.name === Object.keys(diff.remove).find((k) => diff.remove[k] === v)
        );
        if (formerRelease) {
          removedCount += formerRelease.assets.length;
        }
      }
    } else {
      removedCount += v.length;
    }
  }
  let modifiedCount = 0;
  for (const v of Object.values(diff.modify)) {
    modifiedCount += v.length;
  }
  let fixedCount = 0;
  for (const v of Object.values(diff.fix)) {
    fixedCount += v.length;
  }
  return { add: addedCount, remove: removedCount, modify: modifiedCount, fix: fixedCount };
}

async function createLocalEmptyDownloadTarget(basePath: string, config: Config) {
  for (const release of config.releases) {
    const tagDir = path.join(basePath, release.tag.name);
    fs.mkdirSync(tagDir, { recursive: true });
    for (const asset of release.assets) {
      const filePath = path.join(tagDir, asset.name);
      fs.closeSync(fs.openSync(filePath, "w"));
    }
    if (release.tar_url) {
      const ctx = genArchiveCtx(release, release.tar_url, `${config.name}-{}.tar.gz`);
      fs.mkdirSync(path.join(tagDir, "archive"), { recursive: true });
      const tarPath = path.join(tagDir, `archive/${ctx.name}`);
      fs.closeSync(fs.openSync(tarPath, "w"));
    }
    if (release.zip_url) {
      const ctx = genArchiveCtx(release, release.zip_url, `${config.name}-{}.zip`);
      fs.mkdirSync(path.join(tagDir, "archive"), { recursive: true });
      const zipPath = path.join(tagDir, `archive/${ctx.name}`);
      fs.closeSync(fs.openSync(zipPath, "w"));
    }
  }
}

async function buildFrontEnd(configPath: string, outDir: string) {
  printInfo(`Building front-end with config: ${configPath}`);
  printSpliter("-", true);
  await $`pnpm build -- -c ${configPath} -d ${outDir}`;
  printSpliter("-", true);
  return path.resolve(import.meta.dirname, outDir);
}

async function syncFrontEnd(options: SyncOptions, workDir: string, configJsonPath: string) {
  if (options.wwwRootDir) {
    // before build, we need to apply url template if provided
    const buildConfigPath = path.join(workDir, "config.build.json");
    if (options.downloadUrlTmpl) {
      printInfo(`Applying URL template to configuration...`);
      const configBuild = JSON.parse(fs.readFileSync(configJsonPath, "utf-8")) as Config;
      for (const release of configBuild.releases) {
        for (const asset of release.assets) {
          const ctx = genCtx(release, asset);
          asset.download_url = render(options.downloadUrlTmpl, ctx);
        }
        // tar_url and zip_url
        if (release.tar_url) {
          const ctx = genArchiveCtx(release, release.tar_url, `${configBuild.name}-{}.tar.gz`);
          release.tar_url = render(options.downloadUrlTmpl, ctx);
        }
        if (release.zip_url) {
          const ctx = genArchiveCtx(release, release.zip_url, `${configBuild.name}-{}.zip`);
          release.zip_url = render(options.downloadUrlTmpl, ctx);
        }
      }
      fs.writeFileSync(buildConfigPath, JSON.stringify(configBuild, null, 2), "utf-8");
    } else {
      fs.copyFileSync(configJsonPath, buildConfigPath);
    }
    printInfo(`Building front-end website...`);
    printSpliter("-", true);
    const tempBuildDir = path.join(workDir, "web-dist");
    await buildFrontEnd(buildConfigPath, tempBuildDir);
    printSpliter("-", true);

    // rsync -ahr --delete -P (archive,human-readable,recursive,delete,partial,progress)
    printInfo(`Synchronizing front-end website to: ${ANSI.CYAN}${options.wwwRootDir}${ANSI.RESET}`);
    printSpliter("-", true);
    await $`rsync -ahr --delete -P ${tempBuildDir}/ ${options.wwwRootDir}/`;
    printSpliter("-", true);
  } else {
    printWarning(`No www root directory specified, skipping front-end build and synchronization.`);
  }
}

async function main() {
  const { options, restArgs } = parseArgs();

  // ensure required commands
  ensureCommand("bun", `The ${ANSI.BLUE}bun${ANSI.RESET} command is required.`);
  ensureCommand("rsync", `The ${ANSI.BLUE}rsync${ANSI.RESET} command is required.`);
  if (options.downloadTarget) {
    ensureCommand(
      ["curl", "wget"],
      `Either ${ANSI.BLUE}curl${ANSI.RESET} or ${ANSI.BLUE}wget${ANSI.RESET} command is required for downloading files.`
    );
  }
  if (options.wwwRootDir) {
    ensureCommand("pnpm", `The ${ANSI.BLUE}pnpm${ANSI.RESET} command is required.`);
  }

  // start job
  printInfo(`${ANSI.BLUE}Starting release sync for repo: ${ANSI.MAGENTA}${options.repo}${ANSI.RESET}`);

  // create temp working directory
  const tmpTmpl = `/tmp/release-sync.${options.repo
    .split("/")
    .map((s) => s.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .join(".")}.${process.pid}-XXXXXX`;
  const workDir = (await $`mktemp -d ${tmpTmpl}`.quiet().text()).trim();
  process.on("exit", (code) => {
    if (code === 130) return;
    if (code !== 0) printInfo(`${ANSI.YELLOW}Cleaning up working directory...${ANSI.RESET}`);
    // await $`rm -rf ${workDir}`.quiet();
    Bun.spawnSync(["rm", "-rf", workDir], { stdio: ["ignore", "ignore", "ignore"] });
  });
  process.on("SIGINT", () => {
    printInfo(`${ANSI.YELLOW}Received SIGINT, cleaning up working directory...${ANSI.RESET}`);
    // await $`rm -rf ${workDir}`.quiet();
    Bun.spawnSync(["rm", "-rf", workDir], { stdio: ["ignore", "ignore", "ignore"] });
    process.exit(130);
  });
  printInfo(`${ANSI.CYAN}Working directory:${ANSI.RESET} ${workDir}`);
  const emptyPath = path.join(workDir, "empty");
  fs.closeSync(fs.openSync(emptyPath, "w"));

  // load compare config
  printInfo(`Loading compare configuration...`);
  const compareFilePath = options.compareConfigPath ?? "";
  let compareConfig: Config | null = null;
  if (compareFilePath) {
    const tempCompareFilePath = path.join(workDir, "compare.json");
    const pCheckExists = await $`rsync --dry-run --existing --out-format="%n" ${emptyPath} ${compareFilePath}`
      .nothrow()
      .quiet();
    const remoteExists = pCheckExists.stdout.toString().trim() !== "";
    if (remoteExists) {
      await $`rsync -a ${compareFilePath} ${tempCompareFilePath}`.quiet();
      const content = fs.readFileSync(tempCompareFilePath, "utf-8");
      try {
        compareConfig = JSON.parse(content);
      } catch {
        terminateWithError(`Failed to parse JSON from compare file: ${ANSI.DIM}${compareFilePath}${ANSI.RESET}`);
        process.exit(1);
      }
    } else {
      printWarning(`Compare configuration file does not exist: ${ANSI.DIM}${compareFilePath}${ANSI.RESET}`);
    }
  }

  // generate command
  printInfo(`Generating release data...`);
  printSpliter("-", true);
  const generateBin = path.resolve(import.meta.dirname, "generate.ts");
  const configJsonPath = path.join(workDir, "config.json");
  const commandArgs = [generateBin, options.repo, ...restArgs, "-o", configJsonPath];
  const subprocess = Bun.spawnSync(["bun", "run", ...commandArgs], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  panicSubprocess(subprocess);
  printSpliter("-", true);

  const config: Config = JSON.parse(fs.readFileSync(configJsonPath, "utf-8"));
  // collect compare data
  const rawDiff = await collectDiff(config, compareConfig);
  // fs.writeFileSync(path.join(workDir, "record.json"), JSON.stringify(diff, null, 2), "utf-8");
  const diff = {
    add: rawDiff.add,
    remove: rawDiff.remove,
    modify: rawDiff.modify,
    fix: {} as ModifyRecord,
  };
  // fix missing: add non-existent download file (maybe missing in previous implementation), re-download it
  if (options.downloadTarget) {
    const ignoredFiles: Set<string> = new Set();
    const iterator = function* () {
      for (const [tag, items] of Object.entries(rawDiff.add)) {
        for (const item of items) yield { tag, item };
      }
      for (const [tag, items] of Object.entries(rawDiff.modify)) {
        for (const item of items) yield { tag, item };
      }
    };
    for (const { tag, item } of iterator()) {
      ignoredFiles.add(path.join(tag, item.filename));
    }
    for (const [tag, items] of Object.entries(rawDiff.passedModify)) {
      for (const item of items) {
        const filePath = path.join(options.downloadTarget, tag, item.filename);
        const pRsyncCheckExists = await $`rsync --dry-run --existing --out-format="%n" ${emptyPath} ${filePath}`
          .nothrow()
          .quiet();
        const remoteExists = pRsyncCheckExists.stdout.toString().trim() !== "";
        if (!remoteExists && !ignoredFiles.has(path.join(tag, item.filename))) {
          if (!diff.fix[tag]) diff.fix[tag] = [];
          diff.fix[tag]!.push(item);
        }
      }
    }
  }

  // report diff and sync
  const diffCount = countDiffFiles(diff, compareConfig);
  const needSync = !(diffCount.add === 0 && diffCount.remove === 0 && diffCount.modify === 0 && diffCount.fix === 0);
  if (!needSync) {
    printInfo(`${ANSI.BLUE}${ANSI.BOLD}Everything is up to date.${ANSI.RESET}`);
  } else {
    let msg = [
      `${ANSI.GREEN}${ANSI.BOLD}${diffCount.add}${ANSI.UNBOLD} files to add${ANSI.RESET}`,
      `${ANSI.RED}${ANSI.BOLD}${diffCount.remove}${ANSI.UNBOLD} files to remove${ANSI.RESET}`,
      `${ANSI.YELLOW}${ANSI.BOLD}${diffCount.modify}${ANSI.UNBOLD} files to modify${ANSI.RESET}.`,
    ].join(", ");
    if (diffCount.fix > 0) {
      msg += `\n${PADDING} ${ANSI.MAGENTA}${ANSI.BOLD}${diffCount.fix}${ANSI.UNBOLD} files to fix (missing files)${ANSI.RESET}.`;
    }
    printInfo(msg);
  }
  // perform sync actions
  const needMoveFiles: { type: "add" | "modify" | "fix"; tag: string; item: NewRecordItem; srcPath: string }[] = [];

  if (needSync) {
    const downloadTarget = options.downloadTarget ?? "";
    async function moveDlSingleFile(tag: string, item: NewRecordItem, srcPath: string) {
      if (!downloadTarget) {
        throw new Error(`No download directory specified, cannot move files.`);
      }
      const finalPath = path.join(downloadTarget, tag, item.filename);
      await $`rsync -a --partial --remove-source-files ${srcPath} ${finalPath}`.quiet();
      return finalPath;
    }

    // download
    const tempDownloadDir = path.join(workDir, "downloads");
    fs.mkdirSync(tempDownloadDir, { recursive: true });
    printInfo(`Downloading files to temporary directory: ${tempDownloadDir}`);

    if (downloadTarget) {
      if (diffCount.add + diffCount.modify + diffCount.fix > 0) {
        printInfo(`Downloading ${diffCount.add + diffCount.modify + diffCount.fix} files...`);
        const counter = { success: 0, failed: 0 };
        const iterator = function* () {
          for (const [tag, items] of Object.entries(diff.fix)) {
            for (const item of items) {
              yield { tag, item, mvType: "fix" as const };
            }
          }
          for (const [tag, items] of Object.entries(diff.add)) {
            for (const item of items) {
              yield { tag, item, mvType: "add" as const };
            }
          }
          for (const [tag, items] of Object.entries(diff.modify)) {
            for (const item of items) {
              yield { tag, item, mvType: "modify" as const };
            }
          }
        };
        // download with concurrency
        const mutex = new Mutex(options.concurrency);
        for (const { tag, item, mvType } of iterator()) {
          // until concurrency slot is available
          await mutex.lock();
          // start single download
          const pDlSingle = (async () => {
            const destPath = path.join(tempDownloadDir, mvType, tag, item.filename);
            const filenameFmt = item.filename
              .split("/")
              .map((name) => `${ANSI.BLUE}${name}${ANSI.RESET}`)
              .join(" / ");
            printInfo(
              `${ANSI.BOLD}Downloading file:${ANSI.RESET} ${ANSI.CYAN}${tag}${ANSI.RESET} / ${filenameFmt}` +
                `\n${PADDING} ${ANSI.BOLD}${ANSI.DIM}via ${ANSI.RESET}${ANSI.DIM}${item.downloadUrl}${ANSI.RESET}`
            );
            const success = await downloadFile(item.downloadUrl, destPath, 3);
            if (!success) {
              counter.failed += 1;
              if (options.fastFail) {
                terminateWithError(
                  `Failed when downloading ${ANSI.CYAN}${ANSI.DIM}${item.downloadUrl}${ANSI.RESET}, exiting due to --fast-fail option.`
                );
                process.exit(1);
              }
            }
            if (success) {
              counter.success += 1;
              if (options.fastSync) {
                const finalPath = await moveDlSingleFile(tag, item, destPath);
                if (mvType === "add") {
                  printInfo(
                    `${ANSI.GREEN}${ANSI.BOLD}+${ANSI.UNBOLD} Added file:${ANSI.RESET} ${ANSI.CYAN}${finalPath}${ANSI.RESET}`
                  );
                } else if (mvType === "modify") {
                  printInfo(
                    `${ANSI.YELLOW}${ANSI.BOLD}*${ANSI.UNBOLD} Modified file:${ANSI.RESET} ${ANSI.CYAN}${finalPath}${ANSI.RESET}`
                  );
                } else {
                  printInfo(
                    `${ANSI.MAGENTA}${ANSI.BOLD}+${ANSI.UNBOLD} Re-added missing file: ${ANSI.RESET} ${ANSI.CYAN}${finalPath}${ANSI.RESET}`
                  );
                }
              } else {
                needMoveFiles.push({ type: mvType, tag, item, srcPath: destPath });
              }
            }
            mutex.release();
          })();
          pDlSingle.catch((e) => {
            terminateWithError(`Unexpected error during downloading: ${e.message}`);
            process.exit(1);
          });
        }
        await mutex.waitAll();
        printInfo(
          `Download completed: ${ANSI.GREEN}${counter.success} succeeded${ANSI.RESET}, ${ANSI.RED}${counter.failed} failed${ANSI.RESET}.`
        );
      }
    } else {
      printWarning(`No download directory specified, skipping file downloads.`);
    }

    // NOTE: add first, then modify, then move frontend, then remove

    // (re)add/modify files
    const needMoveCount = {
      add: 0,
      modify: 0,
      fix: 0,
    };
    for (const mv of needMoveFiles) {
      needMoveCount[mv.type] += 1;
    }
    if (needMoveCount.fix) {
      await $`rsync -ahr --partial ${tempDownloadDir}/fix/ ${downloadTarget}/`.quiet();
      printInfo(`${ANSI.MAGENTA}${ANSI.BOLD}+${ANSI.UNBOLD} Re-added ${needMoveCount.fix} missing files.${ANSI.RESET}`);
    }
    if (needMoveCount.add) {
      await $`rsync -ahr --partial ${tempDownloadDir}/add/ ${downloadTarget}/`.quiet();
      printInfo(`${ANSI.GREEN}${ANSI.BOLD}+${ANSI.UNBOLD} Added ${needMoveCount.add} files.${ANSI.RESET}`);
    }
    if (needMoveCount.modify) {
      await $`rsync -ahr --partial ${tempDownloadDir}/modify/ ${downloadTarget}/`.quiet();
      printInfo(`${ANSI.YELLOW}${ANSI.BOLD}*${ANSI.UNBOLD} Modified ${needMoveCount.modify} files.${ANSI.RESET}`);
    }

    // build and move front-end
    await syncFrontEnd(options, workDir, configJsonPath);

    // delete removed files
    if (diffCount.remove > 0) {
      printInfo(`Initializing rsync sender to delete...`);
      const senderPath = path.join(workDir, "rsync-sender-remove");
      fs.mkdirSync(senderPath, { recursive: true });
      createLocalEmptyDownloadTarget(senderPath, config);
      printInfo(`Deleting removed files from download target...`);
      await $`rsync -ar --delete --ignore-existing ${senderPath}/ ${downloadTarget}/`.quiet();
      printInfo(`${ANSI.RED}${ANSI.BOLD}-${ANSI.UNBOLD} Removed ${diffCount.remove} files.${ANSI.RESET}`);
    }
  } else {
    await syncFrontEnd(options, workDir, configJsonPath);
  }

  // save config
  if (options.saveConfigPath) {
    const savePath = options.saveConfigPath;
    printInfo(`Saving generated configuration to: ${ANSI.CYAN}${savePath}${ANSI.RESET}`);
    await $`rsync -a ${configJsonPath} ${savePath}`.quiet();
  }

  printInfo(`${ANSI.GREEN}Done.${ANSI.RESET}`);
}

if (import.meta.main) {
  main().catch((e) => {
    if (e instanceof SubprocessError) {
      terminateWithError(e.message);
      process.exit(13);
    } else {
      console.error(e);
      process.exit(2);
    }
  });
}
