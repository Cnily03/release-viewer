import fs from "node:fs";
import path from "node:path";

export interface ReleaseAsset {
  name: string;
  size: number;
  digest: string;
  download_url: string;
  updated_at: string;
}

export interface Release {
  name: string;
  tag: {
    name: string;
    tree_url?: string;
  };
  labels: string[];
  published_at: string;
  detail_url: string;
  author?: {
    name: string;
    url: string;
    avatar_url?: string;
  };
  commit?: {
    sha: string;
    url: string;
  };
  assets: ReleaseAsset[];
  tar_url: string;
  zip_url: string;
  body: string;
}

export interface Config {
  name: string;
  description: string;
  repo_fullname: string;
  repo_url: string;
  avatar_url?: string;
  labels: string[];
  license?: string;
  index_tags: string[];
  redirect: Record<string, string>;
  releases: Release[];
}

const filepath = path.resolve((process.argv.length > 3 && process.argv[3]) || "config.json");
const time = new Date().toLocaleTimeString("en-US", { hour12: false });
console.info(`\x1b[2m${time}\x1b[0m \x1b[34m[app]\x1b[0m Loading config from \x1b[34m${filepath}\x1b[0m`);

const config = JSON.parse(fs.readFileSync(filepath, "utf-8")) as Config;

export default config;
