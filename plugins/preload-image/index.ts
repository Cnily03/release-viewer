import fs from "node:fs/promises";
import path from "node:path";
import type { AstroIntegration } from "astro";
import { CACHE_DIR } from "./utils.js";
import { fileURLToPath } from "node:url";

const PKG_NAME = "astro-image-preload";
const EXPORT_DIR = "_image/";

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
      "astro:build:setup": async () => {
        if (await fs.statfs(CACHE_DIR).catch(() => false)) {
          await fs.rm(CACHE_DIR, { recursive: true, force: true });
        }
        console.log(`[${PKG_NAME}] Creating cache directory at ${CACHE_DIR}`);
        await fs.mkdir(CACHE_DIR, { recursive: true });
      },
      "astro:build:generated": async ({ dir }) => {
        const exportDir = path.resolve(fileURLToPath(dir), EXPORT_DIR);
        const files = await fs.readdir(path.resolve(CACHE_DIR));
        if (files.length) {
          await fs.mkdir(exportDir, { recursive: true });
          await awaitBatchPromises(files, 10, async (file) => {
            return fs.copyFile(path.join(CACHE_DIR, file), path.join(exportDir, file));
          });
        }
      },
      "astro:build:done": async () => {
        if (await fs.statfs(CACHE_DIR).catch(() => false)) {
          await fs.rm(CACHE_DIR, { recursive: true, force: true });
        }
      },
    },
  };
}
