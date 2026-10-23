/**
 * Archive manifests
 *
 * A manifest line records what a published zip contains: each entry in
 * archive order with the SHA-256 and size of its content, the checksum of the
 * zip, and a content digest that does not depend on the entry order. With it,
 * the proxy can check a zip that it rebuilt from source and put its entries
 * in the published order.
 *
 * Manifests are JSONL files next to the index, at
 * `manifests/user/<owner>/<pkg>.manifest`, one line per version. moon reads
 * only `user/<owner>/<pkg>.index`, so it does not see them.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import fs from "../utils/fs.ts";
import logger from "../utils/logger.ts";
import { type ZipEntryDigest, zipEntryDigests } from "../utils/zip.ts";

/** One manifest line: the content of one published zip */
export interface ArchiveManifest {
  /** Module name, for example `moonbitlang/x` */
  name: string;
  version: string;
  /** SHA-256 of the zip, the same as the checksum in the index */
  checksum: string;
  /** SHA-256 of the `<path>\t<sha256>\n` lines of the entries, sorted by path */
  content_digest: string;
  /** The entries in archive order */
  entries: ZipEntryDigest[];
}

const MANIFEST_DIR = "manifests";

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The content identity of a set of entries, independent of their order */
export function contentDigest(entries: ZipEntryDigest[]): string {
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
  return sha256Hex(sorted.map((e) => `${e.path}\t${e.sha256}\n`).join(""));
}

/** Make the manifest of a zip */
export function createManifest(name: string, version: string, zip: Uint8Array): ArchiveManifest {
  const entries = zipEntryDigests(zip);
  return {
    name,
    version,
    checksum: sha256Hex(zip),
    content_digest: contentDigest(entries),
    entries,
  };
}

/** One JSON line, without the line end */
export function formatManifestLine(manifest: ArchiveManifest): string {
  const { name, version, checksum, content_digest, entries } = manifest;
  return JSON.stringify({ name, version, checksum, content_digest, entries });
}

/** Read the lines of a manifest file; lines that are not manifests are skipped */
export function parseManifestFile(text: string): ArchiveManifest[] {
  const manifests: ArchiveManifest[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line) as ArchiveManifest;
      if (typeof value.version === "string" && Array.isArray(value.entries)) {
        manifests.push(value);
      }
    } catch {
      logger.debug(`Skipping a manifest line that is not JSON: ${line.slice(0, 80)}`);
    }
  }
  return manifests;
}

/** The manifest file of a package below an index directory */
export function manifestFilePath(indexDir: string, owner: string, pkg: string): string {
  return join(indexDir, MANIFEST_DIR, "user", owner, `${pkg}.manifest`);
}

/** Find the manifest line of a version in an index directory */
export async function readManifest(
  indexDir: string,
  owner: string,
  pkg: string,
  version: string,
): Promise<ArchiveManifest | null> {
  const path = manifestFilePath(indexDir, owner, pkg);
  if (!existsSync(path)) return null;
  const manifests = parseManifestFile(await readFile(path, "utf8"));
  return manifests.find((m) => m.version === version) ?? null;
}

/**
 * Compare the entries of a zip with a manifest. Returns one line per
 * problem: a missing entry, an extra entry, or an entry with other content.
 * The order of the entries does not count; a rebuild is reordered anyway.
 */
export function compareWithManifest(
  manifest: ArchiveManifest,
  entries: ZipEntryDigest[],
): string[] {
  const expected = new Map(manifest.entries.map((e) => [e.path, e]));
  const actual = new Map(entries.map((e) => [e.path, e]));
  const problems: string[] = [];
  for (const [path, want] of expected) {
    const got = actual.get(path);
    if (!got) {
      problems.push(`missing: ${path}`);
    } else if (got.sha256 !== want.sha256 || got.size !== want.size) {
      problems.push(
        `content differs: ${path} (published ${want.sha256.slice(0, 12)}, ${want.size} bytes; ` +
          `rebuilt ${got.sha256.slice(0, 12)}, ${got.size} bytes)`,
      );
    }
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) problems.push(`extra: ${path}`);
  }
  return problems;
}

// -----------------------------------------------------------------------------
// manifest build

export interface BuildManifestsOptions {
  /** Index directory with `user/<owner>/<pkg>.index` files */
  indexDir: string;
  /** Glob patterns of packages (`owner/name`); all packages when empty */
  packages?: string[];
  /** Largest number of new lines to add in this run */
  limit?: number;
  /** Number of downloads at the same time (default 4) */
  concurrency?: number;
  /** Get the published zip of a version */
  download(owner: string, name: string, version: string): Promise<Uint8Array>;
}

export interface BuildManifestsResult {
  /** New lines written */
  added: number;
  /** Versions that already had a line */
  existing: number;
  /** Versions that failed (download error or checksum mismatch) */
  failed: number;
  /** Versions without a line that this run did not try, because of the limit */
  remaining: number;
}

interface IndexVersion {
  version: string;
  checksum: string;
}

/**
 * Add the missing manifest lines for the versions of an index directory.
 * Each zip must match the index checksum. The file of a package is written
 * after each new line, in the order of the index, so a stopped run loses no
 * work and a second run adds only what is missing.
 */
export async function buildManifests(
  options: BuildManifestsOptions,
): Promise<BuildManifestsResult> {
  const { indexDir, download } = options;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const patterns = (options.packages ?? []).map(globToRegExp);
  const result: BuildManifestsResult = { added: 0, existing: 0, failed: 0, remaining: 0 };

  interface Job {
    owner: string;
    pkg: string;
    entry: IndexVersion;
  }
  const jobs: Job[] = [];
  const packages = new Map<string, { order: string[]; lines: Map<string, ArchiveManifest> }>();

  for (const { owner, pkg, indexPath } of await listIndexFiles(indexDir)) {
    if (patterns.length > 0 && !patterns.some((p) => p.test(`${owner}/${pkg}`))) continue;
    const versions = parseIndexVersions(await readFile(indexPath, "utf8"));
    const path = manifestFilePath(indexDir, owner, pkg);
    const existing = existsSync(path) ? parseManifestFile(await readFile(path, "utf8")) : [];
    const lines = new Map(existing.map((m) => [m.version, m]));
    packages.set(`${owner}/${pkg}`, { order: versions.map((v) => v.version), lines });
    for (const entry of versions) {
      if (lines.has(entry.version)) {
        result.existing++;
      } else {
        jobs.push({ owner, pkg, entry });
      }
    }
  }

  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const todo = jobs.slice(0, limit);
  result.remaining = jobs.length - todo.length;

  // Writes of one package file are serialized
  const writes = new Map<string, Promise<void>>();
  const write = (owner: string, pkg: string): Promise<void> => {
    const key = `${owner}/${pkg}`;
    const next = (writes.get(key) ?? Promise.resolve()).then(async () => {
      const state = packages.get(key);
      if (!state) return;
      const ordered = state.order
        .map((version) => state.lines.get(version))
        .filter((m): m is ArchiveManifest => m !== undefined);
      // Lines for versions that the index no longer has stay at the end
      for (const [version, manifest] of state.lines) {
        if (!state.order.includes(version)) ordered.push(manifest);
      }
      const text = ordered.map((m) => `${formatManifestLine(m)}\n`).join("");
      await fs.writeFileAtomic(
        manifestFilePath(indexDir, owner, pkg),
        new TextEncoder().encode(text),
      );
    });
    writes.set(key, next);
    return next;
  };

  let index = 0;
  const worker = async () => {
    while (index < todo.length) {
      const job = todo[index++];
      const id = `${job.owner}/${job.pkg}@${job.entry.version}`;
      try {
        const zip = await download(job.owner, job.pkg, job.entry.version);
        const manifest = createManifest(`${job.owner}/${job.pkg}`, job.entry.version, zip);
        if (manifest.checksum !== job.entry.checksum.toLowerCase()) {
          throw new Error(
            `checksum mismatch: index has ${job.entry.checksum}, zip is ${manifest.checksum}`,
          );
        }
        packages.get(`${job.owner}/${job.pkg}`)?.lines.set(job.entry.version, manifest);
        await write(job.owner, job.pkg);
        result.added++;
        logger.info(`Manifest added for ${id} (${manifest.entries.length} entries)`);
      } catch (err) {
        result.failed++;
        logger.warn(`No manifest for ${id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return result;
}

/** List `user/<owner>/<pkg>.index` files of an index directory */
async function listIndexFiles(
  indexDir: string,
): Promise<{ owner: string; pkg: string; indexPath: string }[]> {
  const userDir = join(indexDir, "user");
  if (!fs.isDirectory(userDir)) return [];
  const files: { owner: string; pkg: string; indexPath: string }[] = [];
  for (const owner of (await readdir(userDir)).sort()) {
    const ownerDir = join(userDir, owner);
    if (owner.startsWith(".") || !fs.isDirectory(ownerDir)) continue;
    for (const file of (await readdir(ownerDir)).sort()) {
      if (!file.endsWith(".index")) continue;
      files.push({ owner, pkg: file.slice(0, -".index".length), indexPath: join(ownerDir, file) });
    }
  }
  return files;
}

/** The versions and checksums of an index file, in file order */
function parseIndexVersions(text: string): IndexVersion[] {
  const versions: IndexVersion[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line) as { version?: unknown; checksum?: unknown };
      if (typeof entry.version !== "string" || typeof entry.checksum !== "string") continue;
      if (seen.has(entry.version)) continue;
      seen.add(entry.version);
      versions.push({ version: entry.version, checksum: entry.checksum });
    } catch {
      // Not a version line
    }
  }
  return versions;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
