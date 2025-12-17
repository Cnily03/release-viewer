#!/usr/bin/env -S bun
/** biome-ignore-all lint/suspicious/noExplicitAny: type is too complex */
import fs from "node:fs";
import path from "node:path";
import Bun, { $, type SyncSubprocess } from "bun";
import type { Config, Release, ReleaseAsset } from "@/config";

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
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  MAGENTA: "\x1b[35m",
};

const removeAnsi = (str: string) => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: invisible characters
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

const printInfo = (message: string, ...params: any[]) => {
  console.info(`${datePrefix()} ${message}`, ...params);
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

const printError = (message: string) => {
  console.error(`${ANSI.RED}Error:${ANSI.RESET} ${message}`);
};

export interface UrlTemplateContext {
  tag: string;
  name: string;
  release: string;
  url: string;
  [key: string]: string;
}

const genCtx = (release: Release, asset: ReleaseAsset): UrlTemplateContext => {
  return {
    tag: release.tag.name,
    name: asset.name,
    release: release.name,
    url: asset.download_url,
  };
};

interface SyncOptions {
  // <repo_fullname>
  repo: string;
  // -d, --download-dir <directory>
  downloadDir?: string;
  // -t, --url-template <template>
  downloadUrlTmpl?: string;
  // -b, --build-base <base>
  buildBase?: string;
  // --www-root <directory>
  wwwRootDir?: string;
  // -c, --compare <path>
  compareConfigPath?: string;
}

function usage() {
  console.log(
    `
Usage: sync.ts <repo_fullname> [...options] [..generate options]
Options:
  -d, --download-dir <directory>      Directory for download files
  -t, --url-template <template>       Template URL for downloading files (user-facing)
  -b, --build-base <base>             Base URL for building front-end (e.g., /app/)
  --www-root <directory>              Root directory for the front-end website
  --compare [path]                    Compare with former configuration file
`.trim()
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options: SyncOptions = {
    repo: "",
    downloadDir: "",
    downloadUrlTmpl: "",
    buildBase: "",
    wwwRootDir: "",
    compareConfigPath: "",
  };
  const restArgs: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      case "-d":
      case "--download-dir": {
        const next = args.shift();
        if (!next) {
          printError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.downloadDir = next;
        break;
      }
      case "-t":
      case "--url-template": {
        const next = args.shift();
        if (!next) {
          printError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.downloadUrlTmpl = next;
        break;
      }
      case "-b":
      case "--build-base": {
        const next = args.shift();
        if (!next) {
          printError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.buildBase = next;
        break;
      }
      case "--www-root": {
        const next = args.shift();
        if (!next) {
          printError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.wwwRootDir = next;
        break;
      }
      case "-c":
      case "--compare": {
        const next = args.shift();
        if (!next) {
          printError(`Missing argument for ${arg}`);
          usage();
          process.exit(1);
        }
        options.compareConfigPath = next;
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
    printError("Missing required argument: <repo_fullname>");
    usage();
    process.exit(1);
  }

  return { options, restArgs };
}

function render<T extends Record<string, string>>(tmpl: string, vars: T) {
  return tmpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, p1) => {
    if (Object.hasOwn(vars, p1)) {
      return vars[p1]!;
    }
    return match;
  });
}

function panicSubprocess(subprocess: SyncSubprocess) {
  if (subprocess.exitCode) {
    throw new SubprocessError(`Subprocess exited with code ${subprocess.exitCode}`, subprocess.exitCode, null);
  }
  if (subprocess.signalCode) {
    throw new SubprocessError(`Subprocess terminated by signal ${subprocess.signalCode}`, null, subprocess.signalCode);
  }
}

interface NewRecordItem {
  downloadUrl: string;
  userDownloadUrl: string;
  filename: string;
}

type AddRecord = Record<string, NewRecordItem[]>; // tag -> files
type RemoveRecord = Record<string, "*" | string[]>; // tag -> files, * means remove the whole tag directory
type ModifyRecord = Record<string, NewRecordItem[]>; // tag -> files

async function collectDiff(options: SyncOptions, config: Config, compareConfig?: Config | null) {
  const rec = {
    add: {} as AddRecord,
    remove: {} as RemoveRecord,
    modify: {} as ModifyRecord,
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
          const ctx = genCtx(release, asset);
          return {
            downloadUrl: asset.download_url,
            userDownloadUrl: options.downloadUrlTmpl ? render(options.downloadUrlTmpl, ctx) : asset.download_url,
            filename: asset.name,
          };
        });
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
            const ctx = genCtx(release, a);
            rec.add[release.tag.name]!.push({
              downloadUrl: a.download_url,
              userDownloadUrl: options.downloadUrlTmpl ? render(options.downloadUrlTmpl, ctx) : a.download_url,
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
              const ctx = genCtx(release, a);
              rec.modify[release.tag.name]!.push({
                downloadUrl: a.download_url,
                userDownloadUrl: options.downloadUrlTmpl ? render(options.downloadUrlTmpl, ctx) : a.download_url,
                filename: a.name,
              });
            }
          }
        }
      }
    }
  } else {
    printInfo(`No compare configuration provided, ${ANSI.YELLOW}skipping${ANSI.RESET} comparison step.`);
    for (const release of config.releases) {
      rec.add[release.tag.name] = release.assets.map((asset) => {
        const ctx = genCtx(release, asset);
        return {
          downloadUrl: asset.download_url,
          userDownloadUrl: options.downloadUrlTmpl ? render(options.downloadUrlTmpl, ctx) : asset.download_url,
          filename: asset.name,
        };
      });
    }
  }
  return rec;
}

async function buildFrontEnd(configPath: string, outDir: string) {
  printInfo(`Building front-end with config: ${configPath}`);
  printSpliter("-", true);
  await $`pnpm build -- -c ${configPath} -d ${outDir}`;
  printSpliter("-", true);
  return path.resolve(import.meta.dirname, outDir);
}

async function main() {
  const { options, restArgs } = parseArgs();

  const compareFilePath = options.compareConfigPath ? path.resolve(process.cwd(), options.compareConfigPath) : "";
  let compareConfig: Config | null = null;
  if (compareFilePath) {
    if (!fs.existsSync(compareFilePath)) {
      printError(`Compare file does not exist: ${compareFilePath}`);
      process.exit(1);
    }
    const stat = fs.statSync(compareFilePath);
    if (!stat.isFile()) {
      printError(`Compare path is not a file: ${compareFilePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(compareFilePath, "utf-8");
    try {
      compareConfig = JSON.parse(content);
    } catch {
      printError(`Failed to parse JSON from compare file: ${compareFilePath}`);
      process.exit(1);
    }
  }

  // start job
  printInfo(`${ANSI.BLUE}Starting release sync for repo: ${ANSI.MAGENTA}${options.repo}${ANSI.RESET}`);

  // create temp working directory
  const tmpTmpl = `/tmp/release-sync.${options.repo
    .split("/")
    .map((s) => s.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .join(".")}.${process.pid}-XXXXXX`;
  const workDir = (await $`mktemp -d ${tmpTmpl}`.quiet().text()).trim();
  process.on("exit", async (code) => {
    if (code === 130) return;
    if (code !== 0) printInfo(`${ANSI.YELLOW}Cleaning up working directory...${ANSI.RESET}`);
    await $`rm -rf ${workDir}`.quiet();
  });
  process.on("SIGINT", async () => {
    printInfo(`${ANSI.YELLOW}Received SIGINT, cleaning up working directory...${ANSI.RESET}`);
    await $`rm -rf ${workDir}`.quiet();
    process.exit(130);
  });
  printInfo(`${ANSI.CYAN}Working directory:${ANSI.RESET} ${workDir}`);

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
  const diff = await collectDiff(options, config, compareConfig);
  fs.writeFileSync(path.join(workDir, "record.json"), JSON.stringify(diff, null, 2), "utf-8");

  if (
    Object.keys(diff.add).length === 0 &&
    Object.keys(diff.remove).length === 0 &&
    Object.keys(diff.modify).length === 0
  ) {
    printInfo("Everything is up to date.");
  } else {
    // add first, then modify, then move frontend, then remove
    // rsync -ahr --delete -P (archive,human-readable,recursive,delete,partial,progress)
    const tempBuildDir = path.join(workDir, "web-dist");
    await buildFrontEnd(configJsonPath, tempBuildDir);
    // TODO: perform sync actions
  }
}

if (import.meta.main) {
  main().catch((e) => {
    if (e instanceof SubprocessError) {
      printError(e.message);
      process.exit(13);
    } else {
      console.error(e);
      process.exit(2);
    }
  });
}
