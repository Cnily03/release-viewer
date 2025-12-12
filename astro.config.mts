// @ts-check

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import icon from "astro-icon";
import * as dotenv from "dotenv";

const unique = (arr: string[]) => [...new Set(arr)];

dotenv.config({
  path: unique([".env", ".env.local", `.env${process.env.NODE_ENV ? `.${process.env.NODE_ENV}` : ""}`]),
  override: true,
  quiet: true,
});

// https://astro.build/config
export default defineConfig({
  integrations: [icon()],

  trailingSlash: "never",
  base: process.env.APP_BUILD_BASE || "/",

  vite: {
    plugins: [tailwindcss()],
  },
});
