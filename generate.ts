#!/usr/bin/env -S bun
/** biome-ignore-all lint/suspicious/noExplicitAny: type is too complex */

import fs from "node:fs";
import path from "node:path";
import type { Config, Release } from "@/config";

declare global {
  interface String {
    replaceLast(searchValue: RegExp | string, replaceValue: string): string;
  }
}

String.prototype.replaceLast = function (searchValue: RegExp | string, replaceValue: string) {
  const str = this.toString();
  const lastIndex =
    searchValue instanceof RegExp ? str.lastIndexOf(str.match(searchValue)?.[0] || "") : str.lastIndexOf(searchValue);
  if (lastIndex === -1) return str;

  return (
    str.substring(0, lastIndex) +
    replaceValue +
    str.substring(
      lastIndex + (searchValue instanceof RegExp ? str.match(searchValue)?.[0].length || 0 : searchValue.length)
    )
  );
};

class Logger {
  static ANSI_DIM = "\x1b[2m";
  static ANSI_BOLD = "\x1b[1m";
  static ANSI_RESET = "\x1b[0m";
  static ANSI_MAGENTA = "\x1b[35m";
  static ANSI_CYAN = "\x1b[36m";
  static ANSI_BLUE = "\x1b[34m";
  static ANSI_GREEN = "\x1b[32m";
  static ANSI_YELLOW = "\x1b[33m";
  static ANSI_RED = "\x1b[31m";
  private pipe_stderr = false;

  constructor(pipe_stderr: boolean = false) {
    this.pipe_stderr = pipe_stderr;
  }

  setPipeStderr(pipe: boolean) {
    this.pipe_stderr = pipe;
  }

  stdout(message: string, ...optionalParams: any[]) {
    if (this.pipe_stderr) {
      process.stderr.write([message, ...optionalParams].join(" "));
    } else {
      process.stdout.write([message, ...optionalParams].join(" "));
    }
    return this;
  }

  stderr(message: string, ...optionalParams: any[]) {
    process.stderr.write([message, ...optionalParams].join(" "));
    return this;
  }

  stdoutln(message: string, ...optionalParams: any[]) {
    if (this.pipe_stderr) {
      console.error(message, ...optionalParams);
    } else {
      console.log(message, ...optionalParams);
    }
    return this;
  }

  stderrln(message: string, ...optionalParams: any[]) {
    console.error(message, ...optionalParams);
    return this;
  }

  private datePrefix() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const str = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return `\x1b[0;2m${str}\x1b[0m`;
  }
  prevLine(n: number = 1, stderr = false) {
    if (stderr) {
      return this.stderr(`\x1b[${n}A`);
    }
    return this.stdout(`\x1b[${n}A`);
  }
  clearLine(stderr = false) {
    if (stderr) {
      return this.stderr("\x1b[2K");
    }
    return this.stdout("\x1b[2K");
  }
  info(message: string, ...optionalParams: any[]) {
    return this.stdoutln(`${this.datePrefix()} \x1b[34mINFO   \x1b[0m ${message}`, ...optionalParams);
  }
  success(message: string, ...optionalParams: any[]) {
    return this.stdoutln(`${this.datePrefix()} \x1b[32mSUCCESS\x1b[0m ${message}`, ...optionalParams);
  }
  warn(message: string, ...optionalParams: any[]) {
    return this.stdoutln(`${this.datePrefix()} \x1b[33mWARN   \x1b[0m ${message}`, ...optionalParams);
  }
  error(message: string, ...optionalParams: any[]) {
    return this.stderrln(`${this.datePrefix()} \x1b[31mERROR \x1b[0m  ${message}`, ...optionalParams);
  }
  debug(message: string, ...optionalParams: any[]) {
    return this.stdoutln(`${this.datePrefix()} \x1b[35mDEBUG \x1b[0m  ${message}`, ...optionalParams);
  }
  log(message: string, ...optionalParams: any[]) {
    return this.stdoutln(message, ...optionalParams);
  }
}

const logger = new Logger();

class ApiFetcher {
  headers: Record<string, string>;

  constructor(repo: string, token?: string) {
    this.headers = {
      "X-App-Repo": repo,
      "User-Agent": `Release-Viewer-Generator (${process.platform})`,
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  fetch(url: string, options?: RequestInit) {
    return fetch(url, {
      headers: this.headers,
      ...options,
    });
  }
}

function usage() {
  console.log("Usage: ./generate.ts <repo_fullname> [...options]");
  console.log("Options:");
  console.log("  -h, --help                        Show this help message");
  console.log("  -o, --output <file>               Output file");
  console.log("  --token <token>                   GitHub API token (or set GITHUB_TOKEN env variable)");
  console.log("  --reduce <major[,minor[,patch]]>  Reduce releases to at most major/minor/patch releases");
  console.log("  --ignore-empty-assets             Ignore releases with no assets");
}

function parseArgs() {
  // bun run generate.ts <repo_fullname>
  const args = process.argv.slice(2);
  let repoFullname = "";
  let outputFile = "";
  let token = process.env.GITHUB_TOKEN || "";
  const reduceArgs: (number | undefined)[] = [];
  let ignoreEmptyAssets = false;
  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) continue;
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      case "--output":
      case "-o": {
        const next = args.shift();
        if (!next) {
          console.error(
            `${Logger.ANSI_RED}Error:${Logger.ANSI_RESET} missing <file> argument for ${arg}, running with --help for help.`
          );
          process.exit(1);
        }
        outputFile = next || outputFile;
        break;
      }
      case "--token": {
        const next = args.shift();
        if (!next) {
          console.error(
            `${Logger.ANSI_RED}Error:${Logger.ANSI_RESET} missing <token> argument for ${arg}, running with --help for help.`
          );
          process.exit(1);
        }
        token = next || token;
        break;
      }
      case "--reduce": {
        const next = args.shift();
        if (!next) {
          console.error(
            `${Logger.ANSI_RED}Error:${Logger.ANSI_RESET} missing argument for ${arg}, running with --help for help.`
          );
          process.exit(1);
        }
        const parts = next.split(",");
        if (parts.length >= 1 && parts.every((n) => n === "*" || /^\d+$/.test(n))) {
          for (const p of parts) {
            reduceArgs.push(p === "*" ? undefined : parseInt(p, 10));
          }
        } else {
          console.error(
            `${Logger.ANSI_RED}Error:${Logger.ANSI_RESET} invalid argument for ${arg}, running with --help for help.`
          );
          process.exit(1);
        }
        break;
      }
      case "--ignore-empty-assets":
        ignoreEmptyAssets = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(
            `${Logger.ANSI_RED}Error:${Logger.ANSI_RESET} unknown option: ${arg}, running with --help for help.`
          );
          process.exit(1);
          break;
        }
        if (!repoFullname) {
          repoFullname = arg;
        } else {
          console.error(
            `${Logger.ANSI_RED}Error:${Logger.ANSI_RESET} multiple <repo_fullname> arguments provided: ${repoFullname} and ${arg}`
          );
          process.exit(1);
          break;
        }
        break;
    }
  }
  // check required args
  if (!repoFullname) {
    console.error(
      `${Logger.ANSI_RED}Error:${Logger.ANSI_RESET} missing <repo_fullname> argument, running with --help for help.`
    );
    process.exit(1);
  }
  return { repoFullname, outputFile, token, ignoreEmptyAssets, reduceArgs };
}

function reduceReleaseTags(tags: Set<string>, maxEachMajor?: number, maxEachMinor?: number, maxEachPatch?: number) {
  if (!maxEachMajor && !maxEachMinor && !maxEachPatch) {
    return tags;
  }
  logger.info("Reducing releases...");
  // major -> (minor -> [releases])
  const vmap: Map<string, Map<string, string[]>> = new Map();
  for (const tag of tags) {
    const match = tag.match(/^v?(\d+)(\.(\d+))?/);
    if (match) {
      const major = match[1]!;
      const minor = match[3] || "0";
      if (!vmap.has(major)) {
        // no create major if exceeds
        if (maxEachMajor !== undefined && vmap.size >= maxEachMajor) continue;
        vmap.set(major, new Map());
      }
      const minorMap = vmap.get(major)!;
      if (!minorMap.has(minor)) {
        // no create minor if exceeds
        if (maxEachMinor !== undefined && minorMap.size >= maxEachMinor) continue;
        minorMap.set(minor, []);
      }
      const arr = minorMap.get(minor)!;
      // no add patch if exceeds
      if (maxEachPatch !== undefined && arr.length >= maxEachPatch) continue;
      minorMap.get(minor)!.push(tag);
    }
  }
  const count = { major: 0, minor: 0, patch: 0 };
  const tagSet = new Set<string>();
  for (const [_, minorMap] of vmap) {
    count.major += 1;
    for (const [_, tags] of minorMap) {
      count.minor += 1;
      for (const tag of tags) {
        count.patch += 1;
        tagSet.add(tag);
      }
    }
  }
  logger
    .prevLine()
    .clearLine()
    .success(
      "Reduction completed, reserved " +
        [
          ["major", count.major],
          ["minor", count.minor],
          ["patch", count.patch],
        ]
          .map(([cname, cvalue]) => `${Logger.ANSI_CYAN}${cname}=${Logger.ANSI_GREEN}${cvalue}${Logger.ANSI_RESET}`)
          .join(", ") +
        "."
    );
  return tagSet;
}

function createTagRedirect(tags: Set<string>, maxDeep = 2) {
  type VMAP = Map<string, string[] | VMAP>;
  const redirects: Record<string, string> = {};
  function createVMap(tt: string[] | Set<string>, prefix: string = "") {
    const v = new Map<string, string[]>();
    for (const t of tt) {
      const match = t.slice(prefix.length).match(/((^|\.)v?(\d+[^.]*))(\.\d+[^.]*)?/);
      if (match) {
        const m = match[1]!;
        if (!v.has(m)) v.set(m, [t]);
        else v.get(m)!.push(t);
      }
    }
    return v;
  }
  function recursiveCreate(tt: string[] | Set<string>, depth: number, prefix: string = "") {
    const v: VMAP = createVMap(tt, prefix);
    if (depth >= maxDeep) return v;
    for (const [k, vtags] of v) {
      if (Array.isArray(vtags)) {
        v.set(k, recursiveCreate(vtags, depth + 1, prefix + k));
      }
    }
    return v;
  }
  const vmap: VMAP = recursiveCreate(tags, 1);
  // dfs
  function dfs(v: VMAP, curPrefix: string = "") {
    let gFristTag = "";
    for (const [k, vtags] of v) {
      let firstTag = "";
      let count = 0;
      if (Array.isArray(vtags)) {
        count += vtags.length;
        if (vtags.length) firstTag = vtags[0]!;
      } else {
        firstTag = dfs(vtags, curPrefix + k);
        count += 1;
      }
      // create redirect if more than 1 tag
      if (count > 1 && firstTag) {
        if (!tags.has(curPrefix + k)) {
          redirects[curPrefix + k] = firstTag;
          logger.info(
            ` - Created redirect:`,
            `${Logger.ANSI_CYAN}${curPrefix + k}${Logger.ANSI_RESET} -> ${Logger.ANSI_CYAN}${firstTag}${Logger.ANSI_RESET}`
          );
        }
      }
      if (!gFristTag && firstTag) gFristTag = firstTag;
    }
    return gFristTag;
  }
  dfs(vmap);
  return redirects;
}

interface GenerateOptions {
  token?: string;
  ignoreEmptyAssets?: boolean;
  reduceArgs?: (number | undefined)[];
}

async function generate(repoFullname: string, options: Partial<GenerateOptions> = {}) {
  const opts: GenerateOptions = Object.assign({}, options);
  const api = new ApiFetcher(repoFullname, opts.token);
  const API_URL = {
    repo: `https://api.github.com/repos/${repoFullname}`,
    releases: `https://api.github.com/repos/${repoFullname}/releases`,
    tags: `https://api.github.com/repos/${repoFullname}/tags`,
  };
  // repo data
  logger.info("Fetching repository data...");
  const repoResponse = await api.fetch(API_URL.repo);
  if (!repoResponse.ok) {
    const errMsg = await repoResponse.text().catch(() => "");
    logger.error(
      `Failed to fetch repository data for ${repoFullname}:`,
      `${Logger.ANSI_BOLD}${repoResponse.status} ${repoResponse.statusText}${Logger.ANSI_RESET}:`,
      errMsg
        ? `\n${JSON.stringify(JSON.parse(errMsg), null, 2)
            .split("\n")
            .map((l) => `${" ".repeat(28)}${l}`)
            .join("\n")}`
        : ""
    );
    process.exit(1);
  }
  logger.prevLine().clearLine().success("Fetched repository data.");
  const repoData = await repoResponse.json();

  let page = 1;

  const tagSet = new Set<string>();

  // releases data
  const releasesData: any[] = [];
  logger.info("Fetching releases data...");
  while (true) {
    logger
      .prevLine()
      .clearLine()
      .info(`Fetching releases data... ${Logger.ANSI_MAGENTA}${Logger.ANSI_DIM}PAGE ${page}${Logger.ANSI_RESET}`);
    const releasesResponse = await api.fetch(`${API_URL.releases}?page=${page}`);
    if (!releasesResponse.ok) {
      const errMsg = await releasesResponse.text().catch(() => "");
      logger.error(
        `Failed to fetch releases data for ${repoFullname}:`,
        `${Logger.ANSI_BOLD}${releasesResponse.status} ${releasesResponse.statusText}${Logger.ANSI_RESET}:`,
        errMsg
          ? `\n${JSON.stringify(JSON.parse(errMsg), null, 2)
              .split("\n")
              .map((l) => `${" ".repeat(28)}${l}`)
              .join("\n")}`
          : ""
      );
      process.exit(1);
    }
    const releasesPageData = await releasesResponse.json();
    if (releasesPageData.length === 0) {
      break;
    }
    releasesData.push(...releasesPageData);
    releasesPageData.forEach((release: any) => {
      tagSet.add(release.tag_name);
    });
    page += 1;
  }
  logger
    .prevLine()
    .clearLine()
    .success(`Fetched releases data, total ${Logger.ANSI_GREEN}${releasesData.length} releases${Logger.ANSI_RESET}.`);

  // tags data
  const tagsData: any[] = [];
  page = 1;
  if (releasesData.length > 0) {
    logger.info("Fetching tags data...");
    while (true) {
      logger
        .prevLine()
        .clearLine()
        .info(`Fetching tags data... ${Logger.ANSI_MAGENTA}${Logger.ANSI_DIM}PAGE ${page}${Logger.ANSI_RESET}`);
      const tagsResponse = await api.fetch(`${API_URL.tags}?page=${page}`);
      if (!tagsResponse.ok) {
        const errMsg = await tagsResponse.text().catch(() => "");
        logger.error(
          `Failed to fetch tags data for ${repoFullname}:`,
          `${Logger.ANSI_BOLD}${tagsResponse.status} ${tagsResponse.statusText}${Logger.ANSI_RESET}:`,
          errMsg
            ? `\n${JSON.stringify(JSON.parse(errMsg), null, 2)
                .split("\n")
                .map((l) => `${" ".repeat(28)}${l}`)
                .join("\n")}`
            : ""
        );
        process.exit(1);
      }
      const tagsPageData = await tagsResponse.json();
      if (tagsPageData.length === 0) {
        break;
      }
      // only keep tags that are in releases
      for (const tag of tagsPageData) {
        if (tagSet.has(tag.name)) {
          tagsData.push(tag);
          tagSet.delete(tag.name);
        }
      }
      page += 1;
      if (tagSet.size === 0) {
        break;
      }
    }
    logger.prevLine().clearLine().success(`Fetched tags data.`);
  } else {
    logger.success(`No releases to fetch tags for, skipping.`);
  }
  if (tagSet.size > 0) {
    logger.warn(
      `Some tags in releases are not found in tags API: ${Array.from(tagSet)
        .map((tag) => `${Logger.ANSI_CYAN}${tag}${Logger.ANSI_RESET}`)
        .join(", ")}`
    );
    logger.warn(`These tags will be removed from releases.`);
    for (const tag of tagSet) {
      releasesData.forEach((release: any, index: number) => {
        if (release.tag_name === tag) {
          releasesData.splice(index, 1);
        }
      });
    }
  }
  logger.info(`Generating config.json...`);
  const config: Config = {
    name: repoData.name,
    description: repoData.description,
    repo_fullname: repoData.full_name,
    repo_url: repoData.html_url,
    avatar_url: repoData.owner.avatar_url,
    labels: repoData.topics,
    license: repoData.license ? repoData.license.name : "",
    index_tags: [],
    redirect: {},
    releases: [],
  };

  if (releasesData.length === 0) {
    logger.warn(`No releases found for ${Logger.ANSI_CYAN}${repoFullname}${Logger.ANSI_RESET}, aborting.`);
    return config;
  }

  const latestTag = releasesData[0].tag_name;

  let tagNames = new Set<string>(releasesData.map((r) => r.tag_name));
  // reduce releases if needed
  if (opts.reduceArgs && opts.reduceArgs.length > 0) {
    tagNames = reduceReleaseTags(tagNames, opts.reduceArgs[0], opts.reduceArgs[1], opts.reduceArgs[2]);
  }

  const tagMap: Map<string, any> = new Map();
  for (const tag of tagsData) {
    tagMap.set(tag.name, tag);
  }

  // compile releases data
  logger.info(`Compiling releases data...`);
  for (const release of releasesData) {
    // filter by reduced tags
    if (!tagNames.has(release.tag_name)) continue;
    // compile assets
    const assets = [];
    for (const asset of release.assets) {
      assets.push({
        name: asset.name,
        size: asset.size,
        digest: asset.digest,
        download_url: asset.browser_download_url,
        // created_at: asset.created_at,
        updated_at: asset.updated_at,
      });
    }
    // compile release
    const labels = [];
    if (latestTag === release.tag_name) {
      labels.push("Latest");
    }
    if (release.prerelease) {
      labels.push("Pre-release");
    }
    if (release.draft) {
      labels.push("Draft");
    }
    const oneRelease: Release = {
      name: release.name,
      tag: {
        name: release.tag_name,
        tree_url: `${repoData.html_url}/tree/${release.tag_name}`,
      },
      labels: labels,
      // created_at: release.created_at,
      // updated_at: release.published_at,
      published_at: release.published_at,
      detail_url: release.html_url,
      author: {
        name:
          release.author.type.toLowerCase() === "bot"
            ? release.author.login.replace(/\[bot\]$/i, "")
            : release.author.login,
        url: release.author.html_url,
        avatar_url: release.author.avatar_url,
      },
      commit: {
        sha: tagMap.get(release.tag_name).commit.sha,
        url: tagMap
          .get(release.tag_name)
          .commit.url.replace("api.github.com/repos", "github.com")
          .replaceLast("/commits/", "/commit/"),
      },
      assets: assets,
      tar_url: `${tagMap.get(release.tag_name).tarball_url.replace("api.github.com/repos", "github.com").replaceLast("/tarball/", "/archive/")}.tar.gz`,
      zip_url: `${tagMap.get(release.tag_name).zipball_url.replace("api.github.com/repos", "github.com").replaceLast("/zipball/", "/archive/")}.zip`,
      body: release.body,
    };
    logger.info(
      ` - Compiled release with ${assets.length > 0 ? Logger.ANSI_GREEN : Logger.ANSI_YELLOW}${assets.length} assets${Logger.ANSI_RESET}:`,
      `${Logger.ANSI_CYAN}${release.name}   ${Logger.ANSI_DIM}${release.tag_name}${Logger.ANSI_RESET}`
    );
    if (opts.ignoreEmptyAssets && assets.length === 0) {
      logger.info(`   ${Logger.ANSI_YELLOW}* Skipped due to empty assets${Logger.ANSI_RESET}`);
    } else {
      config.releases.push(oneRelease);
    }
  }
  logger.success(`Compiled ${Logger.ANSI_GREEN}${config.releases.length} releases${Logger.ANSI_RESET}.`);

  const indexTags = new Set<string>();

  // create redirects
  const releaseTags = new Set(config.releases.map((r) => r.tag.name));
  logger.info(`Creating redirects...`);
  // latest redirect;
  if (releaseTags.has(latestTag)) {
    config.redirect.latest = latestTag;
    indexTags.add(latestTag);
    logger.info(
      ` - Created redirect:`,
      `${Logger.ANSI_CYAN}latest${Logger.ANSI_RESET} -> ${Logger.ANSI_CYAN}${latestTag}${Logger.ANSI_RESET}`
    );
  }
  // version redirects
  const tagRedirect = createTagRedirect(releaseTags, 2);
  // set redirects
  for (const [version, tagName] of Object.entries(tagRedirect)) {
    config.redirect[version] = tagName;
    indexTags.add(tagName);
  }
  logger.success(`Created ${Logger.ANSI_GREEN}${Object.keys(config.redirect).length} redirects${Logger.ANSI_RESET}.`);

  // set index tags
  config.index_tags = Array.from(indexTags);
  logger.success(`Set ${Logger.ANSI_GREEN}${config.index_tags.length} index tags${Logger.ANSI_RESET}:`);
  for (const tag of config.index_tags) {
    logger.info(` - ${Logger.ANSI_CYAN}${tag}${Logger.ANSI_RESET}`);
  }

  return config;
}

async function main() {
  const args = parseArgs();
  if (args.outputFile) logger.setPipeStderr(true);
  const outputFilePath = args.outputFile ? path.resolve(args.outputFile) : null;
  logger.info(
    `${Logger.ANSI_BLUE}Repository:${Logger.ANSI_RESET}`,
    `${Logger.ANSI_CYAN}${args.repoFullname}${Logger.ANSI_RESET}`
  );
  if (outputFilePath)
    logger.info(
      `${Logger.ANSI_BLUE}Output file:${Logger.ANSI_RESET}`,
      `${Logger.ANSI_CYAN}${outputFilePath}${Logger.ANSI_RESET}`
    );
  // generate
  logger.info("Starting generation...");
  const resultConfig = await generate(args.repoFullname, {
    token: args.token,
    ignoreEmptyAssets: args.ignoreEmptyAssets,
    reduceArgs: args.reduceArgs,
  });
  logger.success("Generation completed.");
  // write to file
  logger.info("Writing to file...");
  if (args.outputFile) {
    fs.writeFileSync(args.outputFile, JSON.stringify(resultConfig, null, 2));
    logger.success(`Saved at ${Logger.ANSI_BLUE}${outputFilePath}${Logger.ANSI_RESET}`);
    return;
  } else {
    logger.success("No output file specified, printing to stdout.");
    logger.setPipeStderr(false);
    logger.stdoutln(JSON.stringify(resultConfig, null, 2));
  }
}

if (import.meta.main) {
  main();
}
