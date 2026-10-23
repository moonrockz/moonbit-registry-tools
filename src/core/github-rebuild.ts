/**
 * Rebuild a published zip from the GitHub tag of its repository
 *
 * `moon package` writes the same entries with the same compressed bytes as
 * the published zip, but in the order of the file system it runs on. The
 * manifest of the published zip gives the order, so the rebuild is put in
 * that order and must then be byte-identical: its SHA-256 must be the
 * checksum in the index. Anything else is refused.
 *
 * moon runs on the tag before the result is checked, so the tag is checked
 * first: each manifest entry must be in the tag tree with the same content,
 * or moon does not run. Other files in the tag are allowed, because the zip
 * that moon writes is checked against the checksum.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import fs from "../utils/fs.ts";
import { reorderZip, zipEntryDigests } from "../utils/zip.ts";
import { findBuildHooks } from "./build-hooks.ts";
import { type ArchiveManifest, compareWithManifest } from "./manifest.ts";
import type { FetchFn } from "./toolchain.ts";

export interface GitHubRepository {
  owner: string;
  repo: string;
}

/** A rebuild that ran and was refused, with the reasons */
export class RebuildError extends Error {
  constructor(
    message: string,
    public problems: string[] = [],
  ) {
    super(problems.length > 0 ? `${message}: ${problems.slice(0, 20).join("; ")}` : message);
    this.name = "RebuildError";
  }
}

export interface RebuildRequest {
  owner: string;
  name: string;
  version: string;
  /** Checksum of the published zip, from the index */
  checksum: string;
  /** `repository` field of the index line */
  repository?: unknown;
  /** `created_at` field of the index line */
  createdAt?: string;
  manifest: ArchiveManifest;
}

export interface RebuildContext {
  fetch: FetchFn;
  /** GitHub API base URL, for example https://api.github.com */
  githubApi: string;
  token?: string;
  /** Parent of the temporary directories */
  tempRoot: string;
  /** Run `moon package` in a module directory and return the zip it wrote */
  packageModule(moduleDir: string, createdAt: string | undefined): Promise<Uint8Array>;
  log?(message: string): void;
  warn?(message: string): void;
}

export interface RebuildResult {
  zip: Uint8Array;
  tag: string;
  repository: GitHubRepository;
  /** Module directory inside the repository, empty for the root */
  moduleDir: string;
}

/** Read a GitHub repository from an index `repository` value */
export function parseGitHubRepository(value: unknown): GitHubRepository | null {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(
      /^(?:git\+)?(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s#?]+)/i,
    );
  if (!match) return null;
  const repo = match[2].replace(/\.git$/i, "");
  if (repo === "" || match[1] === "") return null;
  return { owner: match[1], repo };
}

/** Tag names to try for a version, most common first */
export function tagCandidates(version: string): string[] {
  return [`v${version}`, version];
}

/** The module name in a `moon.mod.json` or `moon.mod` file */
export function readModuleName(text: string, json: boolean): string | null {
  if (json) {
    try {
      const name = (JSON.parse(text) as { name?: unknown }).name;
      return typeof name === "string" ? name : null;
    } catch {
      return null;
    }
  }
  return text.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

const SKIP_DIRS = new Set([".git", "_build", "target", ".mooncakes", "node_modules"]);

/**
 * Find the directory whose `moon.mod` or `moon.mod.json` names the module.
 * The search is breadth first, so the module closest to the top wins.
 */
export async function findModuleRoot(dir: string, moduleName: string): Promise<string | null> {
  let level = [dir];
  for (let depth = 0; depth < 8 && level.length > 0; depth++) {
    const next: string[] = [];
    for (const current of level) {
      const entries = await readdir(current, { withFileTypes: true });
      for (const file of ["moon.mod", "moon.mod.json"]) {
        if (!entries.some((e) => e.isFile() && e.name === file)) continue;
        const name = readModuleName(
          await readFile(join(current, file), "utf8"),
          file.endsWith(".json"),
        );
        if (name === moduleName) return current;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) next.push(join(current, entry.name));
      }
    }
    level = next.sort();
  }
  return null;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Compare a module directory with a manifest before anything runs on it.
 * Each manifest entry must be a regular file with the same size and SHA-256.
 * A link is followed, as moon package does (some repositories link
 * `README.md` to `README.mbt.md`), but it must stay inside `treeRoot`, the
 * unpacked tag. Returns one line per problem; other files in the directory
 * are not problems.
 */
export async function compareTreeWithManifest(
  moduleDir: string,
  manifest: ArchiveManifest,
  treeRoot: string = moduleDir,
): Promise<string[]> {
  const module = await realpath(moduleDir);
  const root = await realpath(treeRoot);
  const problems: string[] = [];
  for (const entry of manifest.entries) {
    if (entry.path.endsWith("/")) continue;
    const parts = entry.path.split("/");
    if (
      entry.path.includes("\\") ||
      parts.some((part) => part === "" || part === "." || part === "..")
    ) {
      problems.push(`unsafe path: ${entry.path}`);
      continue;
    }
    const path = join(module, ...parts);
    let data: Uint8Array;
    try {
      // The file, or a parent directory, can be a link out of the tag
      if (!(await realpath(path)).startsWith(root + sep)) {
        problems.push(`outside the tag: ${entry.path}`);
        continue;
      }
      if (!(await stat(path)).isFile()) {
        problems.push(`not a regular file in the tag: ${entry.path}`);
        continue;
      }
      data = new Uint8Array(await readFile(path));
    } catch {
      problems.push(`missing in the tag: ${entry.path}`);
      continue;
    }
    const digest = sha256Hex(data);
    if (digest !== entry.sha256 || data.length !== entry.size) {
      problems.push(
        `content differs: ${entry.path} (published ${entry.sha256.slice(0, 12)}, ${entry.size} bytes; ` +
          `tag ${digest.slice(0, 12)}, ${data.length} bytes)`,
      );
    }
  }
  return problems;
}

/** Download the tarball of the first tag that exists; null when none does */
async function downloadTagTarball(
  repository: GitHubRepository,
  version: string,
  ctx: RebuildContext,
): Promise<{ tag: string; data: Uint8Array } | null> {
  const api = ctx.githubApi.replace(/\/+$/, "");
  for (const tag of tagCandidates(version)) {
    const url = `${api}/repos/${repository.owner}/${repository.repo}/tarball/refs/tags/${encodeURIComponent(tag)}`;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
    let response: Response;
    try {
      response = await ctx.fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    } catch (err) {
      throw new RebuildError(
        `Download of ${url} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (response.status === 404) continue;
    if (!response.ok) throw new RebuildError(`GitHub returned ${response.status} for ${url}`);
    return { tag, data: new Uint8Array(await response.arrayBuffer()) };
  }
  return null;
}

/**
 * Rebuild a published zip from GitHub. Returns the zip only when it is
 * byte-identical to the published zip; otherwise throws RebuildError with
 * the entries that differ from the manifest.
 */
export async function rebuildFromGitHub(
  request: RebuildRequest,
  ctx: RebuildContext,
): Promise<RebuildResult> {
  const id = `${request.owner}/${request.name}@${request.version}`;
  const expected = request.checksum.toLowerCase();
  if (request.manifest.checksum.toLowerCase() !== expected) {
    throw new RebuildError(
      `The manifest of ${id} is for checksum ${request.manifest.checksum}, the index has ${request.checksum}`,
    );
  }
  const repository = parseGitHubRepository(request.repository);
  if (!repository) {
    throw new RebuildError(`${id} has no GitHub repository in the index`);
  }

  const tarball = await downloadTagTarball(repository, request.version, ctx);
  if (!tarball) {
    throw new RebuildError(
      `${repository.owner}/${repository.repo} has no tag ${tagCandidates(request.version).join(" or ")}`,
    );
  }
  ctx.log?.(
    `GitHub rebuild of ${id}: tag ${tarball.tag} of ${repository.owner}/${repository.repo} (${tarball.data.length} bytes)`,
  );

  await fs.ensureDir(ctx.tempRoot);
  const work = join(
    ctx.tempRoot,
    `rebuild-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    const sourceDir = join(work, "src");
    await fs.ensureDir(sourceDir);
    const tarPath = join(work, "source.tar.gz");
    await Bun.write(tarPath, tarball.data);
    const tar = Bun.spawnSync(["tar", "-xzf", tarPath, "-C", sourceDir], { stderr: "pipe" });
    if (tar.exitCode !== 0) {
      throw new RebuildError(
        `Cannot unpack the tarball of tag ${tarball.tag}: ${tar.stderr.toString()}`,
      );
    }

    const moduleName = `${request.owner}/${request.name}`;
    const root = await findModuleRoot(sourceDir, moduleName);
    if (!root) {
      throw new RebuildError(
        `Tag ${tarball.tag} has no moon.mod or moon.mod.json for ${moduleName}`,
      );
    }
    const relative = root.slice(sourceDir.length).split(/[\\/]/).filter(Boolean).slice(1).join("/");

    const treeProblems = await compareTreeWithManifest(root, request.manifest, sourceDir);
    if (treeProblems.length > 0) {
      throw new RebuildError(
        `Tag ${tarball.tag} does not have the files of the published ${id}, so moon was not run`,
        treeProblems,
      );
    }
    const hooks = await findBuildHooks(root);
    if (hooks.length > 0) {
      (ctx.warn ?? ctx.log)?.(
        `${id} declares hooks that moon package ignores (MOON_IGNORE_PREBUILD, MOON_IGNORE_POSTADD): ${hooks.join(", ")}`,
      );
    }

    const local = await ctx.packageModule(root, request.createdAt);
    const problems = compareWithManifest(request.manifest, zipEntryDigests(local));
    if (problems.length > 0) {
      throw new RebuildError(
        `The rebuild of ${id} has other files than the published zip`,
        problems,
      );
    }
    const zip = reorderZip(
      local,
      request.manifest.entries.map((e) => e.path),
    );
    const actual = sha256Hex(zip);
    if (actual !== expected) {
      throw new RebuildError(
        `The rebuild of ${id} has the same files but other zip bytes (compression or metadata): ` +
          `index has ${expected}, rebuild is ${actual}`,
      );
    }
    return { zip, tag: tarball.tag, repository, moduleDir: relative };
  } finally {
    await fs.remove(work);
  }
}
