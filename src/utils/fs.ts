/**
 * File system utilities
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/** Ensure a directory exists, creating it if necessary */
export async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/** Ensure a directory exists (sync version) */
export function ensureDirSync(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Read a file as text */
export async function readText(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

/** Write text to a file */
export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf-8");
}

/** Read a JSON file */
export async function readJson<T>(path: string): Promise<T> {
  const content = await readText(path);
  return JSON.parse(content) as T;
}

/** Write a JSON file */
export async function writeJson(path: string, data: unknown, pretty = true): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await writeText(path, content);
}

/** Read JSONL file (one JSON object per line) */
export async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readText(path);
  const lines = content.split("\n").filter((line) => line.trim());
  return lines.map((line) => JSON.parse(line) as T);
}

/** Write JSONL file */
export async function writeJsonl(path: string, items: unknown[]): Promise<void> {
  const content = items.map((item) => JSON.stringify(item)).join("\n");
  await writeText(path, `${content}\n`);
}

/** Append to a JSONL file */
export async function appendJsonl(path: string, item: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const line = `${JSON.stringify(item)}\n`;
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  await Bun.write(path, existing + line);
}

/** Check if a file exists */
export function exists(path: string): boolean {
  return existsSync(path);
}

/** Check if a path is a directory */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Check if a path is a file */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Remove a file or directory */
export async function remove(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** Copy a file */
export async function copy(src: string, dest: string): Promise<void> {
  await ensureDir(dirname(dest));
  await copyFile(src, dest);
}

/** List files in a directory */
export async function listDir(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return readdir(dir);
}

/** List files recursively */
export async function listFilesRecursive(dir: string, pattern?: RegExp): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (!pattern || pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  if (existsSync(dir)) {
    await walk(dir);
  }
  return results;
}

/** Get file size */
export async function fileSize(path: string): Promise<number> {
  const stats = await stat(path);
  return stats.size;
}

/** Resolve and normalize a path */
export function resolvePath(...paths: string[]): string {
  return resolve(...paths);
}

/** Get relative path */
export function relativePath(from: string, to: string): string {
  return relative(from, to);
}

export const fs = {
  ensureDir,
  ensureDirSync,
  readText,
  writeText,
  readJson,
  writeJson,
  readJsonl,
  writeJsonl,
  appendJsonl,
  exists,
  isDirectory,
  isFile,
  remove,
  copy,
  listDir,
  listFilesRecursive,
  fileSize,
  resolve: resolvePath,
  relative: relativePath,
};

export default fs;
