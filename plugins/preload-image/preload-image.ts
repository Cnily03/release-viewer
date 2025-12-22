import fs from "node:fs";
import { CACHE_DIR } from "./constants";

const cacheMap = new Map<string, string>();

function collectFilename(filename: string) {
  if (filename.includes(".")) {
    const parts = filename.split(".");
    return {
      name: parts.slice(0, -1).join("."),
      ext: parts.pop() || "",
    };
  } else {
    return {
      name: filename,
      ext: "",
    };
  }
}

async function urlhash(buffer: Buffer<ArrayBuffer>) {
  const hash = await crypto.subtle.digest("SHA-1", buffer);
  const arraybuffer = new Uint8Array(hash);
  const uint8 = arraybuffer.slice(0, 8);
  const urlsafe = btoa(String.fromCharCode(...uint8))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return urlsafe;
}

export async function downloadAndCacheImage(src: string) {
  if (cacheMap.has(src)) {
    return cacheMap.get(src)!;
  }
  const response = await fetch(src);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const u = new URL(src);
  const filename = u.pathname.split("/").pop()!;
  const { name, ext } = collectFilename(filename);
  const hash = await urlhash(buffer);
  const newFilename = ext ? `${name}.${hash}.${ext}` : `${name}.${hash}.png`;
  const savePath = `${CACHE_DIR}/${newFilename}`;
  if (!fs.existsSync(savePath)) {
    fs.writeFileSync(savePath, buffer);
  }
  const finalSrc = `${import.meta.env.BASE_URL.replace(/\/+$/g, "")}/_image/${newFilename}`;
  cacheMap.set(src, finalSrc);
  return finalSrc;
}
