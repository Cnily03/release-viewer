import fs from "node:fs/promises";
import path from "node:path";
import type { AstroIntegration } from "astro";
import { CACHE_DIR, EXPORT_DIR, PKG_NAME } from "./constants";

let outDir: URL;

function joinURL(u: URL, ...paths: string[]) {
  return new URL(path.join(...paths), u);
}

async function awaitBatchPromises<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number, array: T[]) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item, index) => fn(item, i + index, items)));
    results.push(...batchResults);
  }
  return results;
}

export default function preloadImage(): AstroIntegration {
  return {
    name: PKG_NAME,
    hooks: {
      "astro:build:start": async () => {
        await fs.rm(CACHE_DIR, { recursive: true, force: true });
        await fs.mkdir(CACHE_DIR, { recursive: true });
      },
      "astro:config:done": ({ config }) => {
        outDir = config.outDir;
      },
      "astro:build:done": async () => {
        const exportDir = joinURL(outDir, EXPORT_DIR);
        const files = await fs.readdir(CACHE_DIR);
        if (files.length) {
          await fs.mkdir(exportDir, { recursive: true });
          await awaitBatchPromises(files, 10, async (file) => {
            return fs.copyFile(path.join(CACHE_DIR, file), joinURL(exportDir, file));
          });
        }
      },
    },
  };
}
