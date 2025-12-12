import fs from "node:fs";

export interface ReleaseAsset {
  name: string;
  size: number;
  digest: string;
  download_url: string;
  updated_at: string;
}

export interface Release {
  name: string;
  tag_name: string;
  labels: string[];
  published_at: string;
  detail_url: string;
  commit: {
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
  repo_url: string;
  redirect: Record<string, string>;
  releases: Release[];
}

const config = JSON.parse(fs.readFileSync("config.json", "utf-8")) as Config;

export default config;
