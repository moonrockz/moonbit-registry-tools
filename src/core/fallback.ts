/**
 * Opt-in proxy fallbacks, for files that upstream cannot send
 *
 * - GitHub: rebuild a zip from the tag of its repository with `moon package`
 *   and the toolchain of its publish time. The rebuild is served only when it
 *   is byte-identical to the published zip (see github-rebuild.ts).
 * - Local wasm build: build the prebuilt wasm of an executable package from
 *   the checked source zip. This file is not byte-identical to an upstream
 *   prebuild; it is trusted because the proxy built it from checked sources.
 *
 * All fallbacks are off by default ([proxy.fallback]).
 *
 * Builds get their dependencies from this proxy, so a build can wait for
 * another fallback (a dependency zip that needs a GitHub rebuild). No lock is
 * held while a child runs that can call back into the proxy: each version is
 * rebuilt once (single flight in the proxy), zip rebuilds do not queue, and
 * wasm builds have slots of their own, which only wasm builds take.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { resolveFallbackConfig } from "../config/schema.ts";
import logger from "../utils/logger.ts";
import { listZipEntries, readZipEntry } from "../utils/zip.ts";
import { findBuildHooks } from "./build-hooks.ts";
import { RebuildError, type RebuildResult, rebuildFromGitHub } from "./github-rebuild.ts";
import { type ArchiveManifest, parseManifestFile, readManifest } from "./manifest.ts";
import type { PrebuildAsset } from "./prebuild.ts";
import type { Registry } from "./registry.ts";
import { type FetchFn, Toolchains, lastLines } from "./toolchain.ts";
import type { ProxyFallbackConfig } from "./types.ts";

/** A fallback that cannot run for this file (no manifest, no repository, ...) */
export class FallbackUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FallbackUnavailable";
  }
}

/** A locally built wasm, with the toolchain that built it */
export interface LocalWasm {
  wasm: Uint8Array;
  toolchain: string;
}

/** Directory of fallback work files below `data_dir` */
const FALLBACK_DIR = "fallback";

/** Local wasm builds at the same time; each one can use all cores */
const WASM_BUILD_SLOTS = 2;

/** At most `size` tasks run at a time; the others wait in order */
class Semaphore {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.size) {
      this.active++;
    } else {
      // A finished task gives its slot to the first waiting task
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export class ProxyFallbacks {
  private registry: Registry;
  private toolchainsInstance: Toolchains | null = null;
  private readiness: Promise<boolean> | null = null;
  private wasmSlots = new Semaphore(WASM_BUILD_SLOTS);

  /** URL of this server, so that builds get their dependencies through the proxy */
  selfUrl: string | null = null;
  /** HTTP client of the fallbacks (tests replace it) */
  fetch: FetchFn = (input, init) => fetch(input, init);

  constructor(registry: Registry) {
    this.registry = registry;
  }

  get config(): ProxyFallbackConfig {
    return resolveFallbackConfig(this.registry.config);
  }

  get githubEnabled(): boolean {
    return this.config.github;
  }

  get buildWasmEnabled(): boolean {
    return this.config.build_wasm;
  }

  get anyEnabled(): boolean {
    return this.githubEnabled || this.buildWasmEnabled;
  }

  get workDir(): string {
    return join(this.registry.config.registry.data_dir, FALLBACK_DIR);
  }

  get toolchains(): Toolchains {
    const { toolchain, moonup } = this.config;
    if (
      !this.toolchainsInstance ||
      this.toolchainsInstance.setting !== toolchain ||
      this.toolchainsInstance.moonup !== moonup
    ) {
      this.toolchainsInstance = new Toolchains({
        setting: toolchain,
        moonup,
        workDir: join(this.workDir, "toolchains"),
        fetch: (input, init) => this.fetch(input, init),
      });
      this.readiness = null;
    }
    return this.toolchainsInstance;
  }

  /** Check once whether builds can run; logs one error when they cannot */
  checkToolchain(): Promise<string | null> {
    return this.toolchains.check();
  }

  ready(): Promise<boolean> {
    if (!this.readiness) {
      this.readiness = this.checkToolchain().then((problem) => {
        if (problem) {
          logger.error(`Proxy fallbacks are off: ${problem}`);
          return false;
        }
        return true;
      });
    }
    return this.readiness;
  }

  /**
   * Options of a run: its own MOON_HOME, and the index and dependencies
   * through this proxy, when it serves
   */
  private runOptions(home: string): { home: string; registry: string | null } {
    return { home, registry: this.selfUrl };
  }

  /** A new directory below the fallback work directory */
  private tempPath(prefix: string): string {
    return join(
      this.workDir,
      "tmp",
      `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
  }

  /** Log the pre-build and postadd hooks of a module, which the build ignores */
  private async logHooks(id: string, moduleDir: string): Promise<void> {
    const hooks = await findBuildHooks(moduleDir);
    if (hooks.length === 0) return;
    logger.warn(
      `${id} declares hooks that the build ignores (MOON_IGNORE_PREBUILD, MOON_IGNORE_POSTADD): ` +
        `${hooks.join(", ")}. A package that needs its pre-build output can fail to build.`,
    );
  }

  /**
   * Fetch the registry index into the run MOON_HOME: moon resolves
   * dependencies only from a local index and does not fetch one by itself.
   * A failure is logged; the build then fails if it needs a dependency.
   */
  private async updateRegistry(toolchain: string, cwd: string, home: string): Promise<void> {
    const result = await this.toolchains.run(toolchain, ["update"], cwd, this.runOptions(home));
    if (result.exitCode !== 0) {
      logger.warn(
        `moon update with toolchain ${toolchain} failed: ${lastLines(`${result.stdout}\n${result.stderr}`, 3)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Manifests

  /**
   * The manifest line of a version: from the served index, the index of the
   * source, or `manifest_url`.
   */
  async findManifest(
    owner: string,
    name: string,
    version: string,
    sourceName?: string,
  ): Promise<ArchiveManifest | null> {
    const indexManager = this.registry.indexManager;
    const dirs = [indexManager.path];
    const source = this.registry.sourceManager.getSource(sourceName);
    if (source) dirs.push(indexManager.getSourceIndexPath(source.name));
    for (const dir of dirs) {
      const manifest = await readManifest(dir, owner, name, version);
      if (manifest) return manifest;
    }

    const base = this.config.manifest_url;
    if (!base) return null;
    const url = `${base.replace(/\/+$/, "")}/user/${encodeURIComponent(owner)}/${encodeURIComponent(name)}.manifest`;
    try {
      const response = await this.fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        logger.debug(`No manifest at ${url}: ${response.status}`);
        return null;
      }
      return parseManifestFile(await response.text()).find((m) => m.version === version) ?? null;
    } catch (err) {
      logger.warn(`Cannot get manifest ${url}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub rebuild

  /**
   * Rebuild a zip from GitHub. Throws FallbackUnavailable when the rebuild
   * cannot run (fallbacks not ready, no index line, no manifest), and
   * RebuildError when it ran and was refused.
   */
  async rebuildZip(
    owner: string,
    name: string,
    version: string,
    checksum: string,
    sourceName?: string,
  ): Promise<RebuildResult> {
    const id = `${owner}/${name}@${version}`;
    if (!(await this.ready()))
      throw new FallbackUnavailable("the build toolchain is not available");
    const line = await this.registry.indexManager.getIndexLine(owner, name, version, sourceName);
    if (!line) throw new FallbackUnavailable(`${id} is not in the index`);
    const manifest = await this.findManifest(owner, name, version, sourceName);
    if (!manifest) {
      throw new FallbackUnavailable(
        `there is no manifest line for ${id}, so a rebuild cannot be checked`,
      );
    }

    return rebuildFromGitHub(
      {
        owner,
        name,
        version,
        checksum,
        repository: line.repository,
        createdAt: typeof line.created_at === "string" ? line.created_at : undefined,
        manifest,
      },
      {
        fetch: (input, init) => this.fetch(input, init),
        githubApi: this.config.github_api,
        token: process.env.GITHUB_TOKEN,
        tempRoot: join(this.workDir, "tmp"),
        packageModule: (dir, createdAt) => this.packageModule(dir, createdAt),
        log: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
      },
    );
  }

  /** Run `moon package` with the toolchain of the publish time; returns the zip */
  async packageModule(moduleDir: string, createdAt: string | undefined): Promise<Uint8Array> {
    const toolchains = this.toolchains;
    const toolchain = await toolchains.prepare(createdAt);
    logger.info(`Running moon package with toolchain ${toolchain}`);
    const home = this.tempPath("home");
    try {
      await this.updateRegistry(toolchain, moduleDir, home);
      const result = await toolchains.run(toolchain, ["package"], moduleDir, this.runOptions(home));
      if (result.exitCode !== 0) {
        throw new RebuildError(
          `moon package with toolchain ${toolchain} failed: ${lastLines(`${result.stdout}\n${result.stderr}`)}`,
        );
      }
      // moon writes _build/publish; older moon wrote target/publish
      for (const dir of ["_build", "target"]) {
        const publish = join(moduleDir, dir, "publish");
        if (!existsSync(publish)) continue;
        const zip = (await readdir(publish)).find((file) => file.endsWith(".zip"));
        if (zip) return new Uint8Array(await readFile(join(publish, zip)));
      }
      throw new RebuildError(`moon package with toolchain ${toolchain} wrote no zip`);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Local wasm build

  /**
   * Build the wasm of an executable package from a source zip, with the
   * toolchain of the publish time. At most WASM_BUILD_SLOTS builds run at a
   * time. A build waits only for zips (never for another wasm build), and zip
   * fallbacks take no slot, so a build that needs a rebuilt dependency
   * cannot deadlock.
   */
  buildWasm(
    asset: PrebuildAsset,
    zip: Uint8Array,
    createdAt: string | undefined,
  ): Promise<LocalWasm> {
    return this.wasmSlots.run(() => this.runWasmBuild(asset, zip, createdAt));
  }

  /** Run one wasm build (buildWasm limits how many run) */
  async runWasmBuild(
    asset: PrebuildAsset,
    zip: Uint8Array,
    createdAt: string | undefined,
  ): Promise<LocalWasm> {
    const toolchains = this.toolchains;
    const toolchain = await toolchains.prepare(createdAt);

    const work = this.tempPath("wasm");
    const home = join(work, "moon-home");
    try {
      const moduleDir = join(work, "module");
      await unpackZip(zip, moduleDir);
      await this.logHooks(`${asset.owner}/${asset.name}@${asset.version}`, moduleDir);
      const sourceDir = await readSourceDir(moduleDir);
      const packageDir = [sourceDir, ...asset.packagePath].filter((s) => s !== "").join("/");
      const args = [
        "build",
        "--target",
        WASM_TARGET,
        "--release",
        packageDir === "" ? "." : packageDir,
      ];
      logger.info(
        `Building ${asset.owner}/${asset.name}@${asset.version}/${asset.packagePath.join("/")} ` +
          `with toolchain ${toolchain}: moon ${args.join(" ")}`,
      );
      await this.updateRegistry(toolchain, moduleDir, home);
      const result = await toolchains.run(toolchain, args, moduleDir, this.runOptions(home));
      if (result.exitCode !== 0) {
        throw new Error(
          `moon ${args.join(" ")} with toolchain ${toolchain} failed: ${lastLines(`${result.stdout}\n${result.stderr}`)}`,
        );
      }
      const raw = await findBuildOutput(moduleDir, asset);
      if (!raw) throw new Error(`The build wrote no ${asset.file}`);
      const output = await this.optimize(toolchain, raw, moduleDir);
      const wasm = new Uint8Array(await readFile(output));
      if (
        wasm.length < 8 ||
        wasm[0] !== 0 ||
        wasm[1] !== 0x61 ||
        wasm[2] !== 0x73 ||
        wasm[3] !== 0x6d
      ) {
        throw new Error(`${output} is not a wasm module`);
      }
      return { wasm, toolchain };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Run `moon-wasm-opt -O --all-features`, as the upstream prebuild pipeline
   * does for newer versions. Returns the raw file when the toolchain has no
   * moon-wasm-opt or when it fails.
   */
  private async optimize(toolchain: string, wasm: string, cwd: string): Promise<string> {
    const out = `${wasm}.opt.wasm`;
    const args = ["-O", "--all-features", wasm, "-o", out];
    const result = await this.toolchains.runTool(toolchain, "moon-wasm-opt", args, cwd);
    if (!result) return wasm;
    if (result.exitCode !== 0 || !existsSync(out)) {
      logger.warn(`moon-wasm-opt failed, serving the raw build: ${lastLines(result.stderr, 3)}`);
      return wasm;
    }
    return out;
  }
}

/**
 * moonx runs prebuilt wasm with moonrun. Upstream prebuilds are linear
 * memory wasm (`--target wasm`), built in release mode.
 */
const WASM_TARGET = "wasm";

/** Write the entries of a zip below a directory; refuses paths that leave it */
export async function unpackZip(zip: Uint8Array, dir: string): Promise<void> {
  const root = normalize(dir);
  for (const entry of listZipEntries(zip)) {
    if (entry.name.endsWith("/")) continue;
    const target = normalize(join(root, entry.name));
    if (!target.startsWith(root + sep) || entry.name.includes("\\")) {
      throw new Error(`Zip entry ${entry.name} is outside the module`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, readZipEntry(zip, entry));
  }
}

/** The `source` directory of a module (empty for the module root) */
async function readSourceDir(moduleDir: string): Promise<string> {
  for (const file of ["moon.mod.json", "moon.mod"]) {
    const path = join(moduleDir, file);
    if (!existsSync(path)) continue;
    const text = await readFile(path, "utf8");
    const match = text.match(/"?source"?\s*[:=]\s*"([^"]*)"/);
    return (match?.[1] ?? "").replace(/^\.\/?/, "").replace(/\/+$/, "");
  }
  return "";
}

/** Find the wasm that a release build wrote for a package */
async function findBuildOutput(moduleDir: string, asset: PrebuildAsset): Promise<string | null> {
  const suffix = [...asset.packagePath, asset.file].join("/");
  for (const top of ["_build", "target"]) {
    const base = join(moduleDir, top);
    if (!existsSync(base)) continue;
    const found = await findFile(base, (path) => {
      const unix = path.split(sep).join("/");
      return unix.includes(`/${WASM_TARGET}/release/`) && unix.endsWith(`/${suffix}`);
    });
    if (found) return found;
  }
  return null;
}

async function findFile(dir: string, match: (path: string) => boolean): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(path, match);
      if (found) return found;
    } else if (entry.isFile() && match(path)) {
      return path;
    }
  }
  return null;
}

export default ProxyFallbacks;
