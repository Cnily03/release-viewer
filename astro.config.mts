// @ts-check

import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import icon from "astro-icon";
import * as dotenv from "dotenv";
import preloadImage from "./plugins/preload-image";
import { parseBuildArgs } from "./src/arguments";

const unique = (arr: string[]) => [...new Set(arr)];

dotenv.config({
  path: unique([".env", ".env.local", `.env${process.env.NODE_ENV ? `.${process.env.NODE_ENV}` : ""}`]),
  override: true,
  quiet: true,
});

const buildArgs = parseBuildArgs();

// https://astro.build/config
export default defineConfig({
  integrations: [icon(), preloadImage()],

  trailingSlash: "always",
  base: buildArgs.buildBase || process.env.APP_BUILD_BASE || "/",
  outDir: buildArgs.outDir || process.env.APP_BUILD_OUTDIR || "./dist",

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
  },
});
