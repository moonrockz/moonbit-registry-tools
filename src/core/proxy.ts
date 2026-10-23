/**
 * Caching proxy mode
 *
 * The served index is a full copy of the index of the default source. Zips,
 * prebuilt wasm and symbols.zip are fetched from the source on the first
 * request, verified, cached, and served from the cache after that.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIRS } from "../config/defaults.ts";
import { resolveProxyConfig } from "../config/schema.ts";
import { parseDuration } from "../utils/duration.ts";
import fs from "../utils/fs.ts";
import logger from "../utils/logger.ts";
import { FallbackUnavailable, ProxyFallbacks } from "./fallback.ts";
import { type PrebuildAsset, findExecutablePackages, wasmArtifactName } from "./prebuild.ts";
import type { Registry } from "./registry.ts";
import type { MirrorSource, ProxyConfig } from "./types.ts";

/** Upper limit for one upstream download, so a hung upstream cannot block clients */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** A failed proxy fetch, with the HTTP status to send to the client */
export class ProxyError extends Error {
  constructor(
    message: string,
    public status: 404 | 502,
  ) {
    super(message);
    this.name = "ProxyError";
  }
}

export interface PrebuildPaths {
  wasm: string;
  checksum: string;
  /** True for a wasm that this proxy built, not one from upstream */
  builtLocally?: boolean;
}

export class ProxyCache {
  private registry: Registry;
  private inflight = new Map<string, Promise<unknown>>();
  private refreshing: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private indexRefreshed = false;
  /** Cached zips whose bytes matched this index checksum in this process */
  private verifiedZips = new Map<string, string>();
  /** Opt-in fallbacks for files that upstream cannot send */
  public fallbacks: ProxyFallbacks;

  constructor(registry: Registry) {
    this.registry = registry;
    this.fallbacks = new ProxyFallbacks(registry);
  }

  /** The proxy settings, with defaults */
  get config(): ProxyConfig {
    return resolveProxyConfig(this.registry.config);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Where the cached symbols.zip is */
  get symbolsPath(): string {
    return join(this.registry.config.registry.data_dir, DATA_DIRS.SYMBOLS, "symbols.zip");
  }

  /** Where a cached prebuilt wasm and its .sha256 are */
  prebuildPaths(asset: PrebuildAsset): PrebuildPaths {
    const wasm = join(
      this.registry.config.registry.data_dir,
      DATA_DIRS.PREBUILD,
      asset.owner,
      `${asset.name}@${asset.version}`,
      ...asset.packagePath,
      asset.file,
    );
    return { wasm, checksum: `${wasm}.sha256` };
  }

  /** Where a locally built wasm and its .sha256 are, apart from upstream files */
  localPrebuildPaths(asset: PrebuildAsset): PrebuildPaths {
    const wasm = join(
      this.registry.config.registry.data_dir,
      DATA_DIRS.PREBUILD_LOCAL,
      asset.owner,
      `${asset.name}@${asset.version}`,
      ...asset.packagePath,
      asset.file,
    );
    return { wasm, checksum: `${wasm}.sha256`, builtLocally: true };
  }

  /** The cached files of a prebuild: upstream first, then a local build; null on a miss */
  findCachedPrebuild(asset: PrebuildAsset): PrebuildPaths | null {
    const cached = (paths: PrebuildPaths) => existsSync(paths.wasm) && existsSync(paths.checksum);
    const upstream = this.prebuildPaths(asset);
    if (cached(upstream)) return upstream;
    const local = this.localPrebuildPaths(asset);
    if (this.fallbacks.buildWasmEnabled && cached(local)) return local;
    return null;
  }

  /** Get the source to fetch from (the default source unless named) */
  private source(name?: string): MirrorSource {
    const source = this.registry.sourceManager.getSource(name);
    if (!source) {
      throw new ProxyError(`Source '${name ?? "default"}' is not configured`, 502);
    }
    if (!source.enabled) {
      throw new ProxyError(`Source '${source.name}' is disabled`, 502);
    }
    return source;
  }

  // ---------------------------------------------------------------------------
  // Index

  /**
   * Whether the served index has content: a commit with files from an earlier
   * run (any index layout), or a refresh in this process. Before that, a
   * clone gets an empty index.
   */
  get indexReady(): boolean {
    if (!this.indexRefreshed && hasCommittedFiles(this.registry.indexManager.path)) {
      this.indexRefreshed = true;
    }
    return this.indexRefreshed;
  }

  /**
   * Copy the full index of the default source into the served index and
   * commit it on main. Concurrent calls share one refresh. On failure the
   * served index stays as it was; returns false and logs a warning.
   */
  refreshIndex(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefreshIndex().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefreshIndex(): Promise<boolean> {
    try {
      const source = this.source();
      const indexManager = this.registry.indexManager;
      await indexManager.init();
      const commit = await indexManager.fetchSourceIndex(source.name);
      const changed = await indexManager.mirrorSourceIndex(source.name);
      if (changed > 0) {
        await indexManager.commit(`Proxy index of ${source.name} at ${commit.slice(0, 12)}`);
        logger.info(`Proxy index updated from ${source.name} (${changed} files changed)`);
      } else {
        logger.debug(`Proxy index of ${source.name} is up to date`);
      }
      await indexManager.updateServerInfo();
      this.indexRefreshed = true;
      return true;
    } catch (err) {
      logger.warn(`Proxy index refresh failed, serving the last index: ${errorMessage(err)}`);
      return false;
    }
  }

  /**
   * Refresh the index now and then on the configured interval. Returns the
   * first refresh, which the caller does not have to wait for.
   */
  startIndexRefresh(): Promise<boolean> {
    this.stopIndexRefresh();
    const interval = parseDuration(this.config.index_refresh_interval);
    this.timer = setInterval(() => {
      void this.refreshIndex();
    }, interval);
    return this.refreshIndex();
  }

  stopIndexRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Files

  /** Run one fetch per key at a time; later callers share the running one */
  private singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const promise = run().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Download a file from a source; 404 maps to ProxyError 404, other failures to 502 */
  private async download(url: string, source: MirrorSource): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...this.registry.sourceManager.getFetchOptions(source),
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ProxyError(`Request to ${url} failed: ${errorMessage(err)}`, 502);
    }
    if (response.status === 404 || response.status === 410) {
      throw new ProxyError(`Not found upstream: ${url}`, 404);
    }
    if (!response.ok) {
      throw new ProxyError(`Upstream returned ${response.status} for ${url}`, 502);
    }
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      throw new ProxyError(`Reading ${url} failed: ${errorMessage(err)}`, 502);
    }
  }

  /**
   * Get the path of a cached zip, fetching it on a miss. The zip must match
   * the checksum from the index, or it is not cached (ProxyError 502).
   */
  async getZip(
    owner: string,
    name: string,
    version: string,
    checksum: string,
    sourceName?: string,
  ): Promise<string> {
    const path = this.registry.packageStore.getPackagePath(owner, name, version);
    const expected = checksum.toLowerCase();
    if (this.verifiedZips.get(path) === expected && existsSync(path)) return path;

    return this.singleFlight(path, async () => {
      const id = `${owner}/${name}@${version}`;
      if (existsSync(path)) {
        // Check a cached zip once per process against the current index checksum
        if (sha256Hex(await readFile(path)) === expected) {
          this.verifiedZips.set(path, expected);
          return path;
        }
        logger.warn(`Cached ${id} does not match the index checksum, fetching it again`);
        await rm(path, { force: true });
      }
      const source = this.source(sourceName);
      const url = this.registry.sourceManager.buildPackageUrl(source, owner, name, version);
      logger.info(`Proxy miss: fetching ${id} from ${source.name}`);

      let data: Uint8Array;
      let origin = source.name;
      try {
        data = await this.download(url, source);
      } catch (err) {
        if (!this.fallbacks.githubEnabled) throw err;
        const rebuilt = await this.rebuildFromGitHub(id, err, () =>
          this.fallbacks.rebuildZip(owner, name, version, checksum, source.name),
        );
        data = rebuilt.zip;
        origin = `GitHub ${rebuilt.repository.owner}/${rebuilt.repository.repo} tag ${rebuilt.tag}`;
      }
      const actual = sha256Hex(data);
      if (actual !== expected) {
        throw new ProxyError(
          `Checksum mismatch for ${id}: index has ${checksum}, upstream sent ${actual}`,
          502,
        );
      }
      await fs.writeFileAtomic(path, data);
      this.verifiedZips.set(path, expected);
      logger.info(`Proxy cached ${id} (${data.length} bytes, from ${origin})`);
      return path;
    });
  }

  /**
   * Run the GitHub fallback after a failed download. When the fallback cannot
   * run, the download error stays; when it ran and was refused, the result
   * is 502 and the log says why.
   */
  private async rebuildFromGitHub<T>(id: string, downloadError: unknown, run: () => Promise<T>) {
    logger.warn(
      `Upstream cannot send ${id} (${errorMessage(downloadError)}), trying a GitHub rebuild`,
    );
    try {
      const result = await run();
      logger.info(`GitHub rebuild of ${id}: checksum matches the index, serving the rebuild`);
      return result;
    } catch (err) {
      if (err instanceof FallbackUnavailable) {
        logger.warn(`No GitHub rebuild of ${id}: ${err.message}`);
        throw downloadError;
      }
      logger.error(`GitHub rebuild of ${id} refused, not serving it: ${errorMessage(err)}`);
      throw new ProxyError(
        `${errorMessage(downloadError)}; GitHub rebuild refused: ${errorMessage(err)}`,
        502,
      );
    }
  }

  /**
   * Get the cached prebuilt wasm and .sha256 of an asset, fetching both on a
   * miss. The wasm must match the upstream .sha256, or nothing is cached.
   * When upstream has no file or cannot be reached and `build_wasm` is on,
   * the wasm is built locally from the checked source zip.
   */
  async getPrebuild(asset: PrebuildAsset, sourceName?: string): Promise<PrebuildPaths> {
    const found = this.findCachedPrebuild(asset);
    if (found) return found;
    const paths = this.prebuildPaths(asset);

    return this.singleFlight(paths.wasm, async () => {
      const again = this.findCachedPrebuild(asset);
      if (again) return again;
      const source = this.source(sourceName);
      const sm = this.registry.sourceManager;
      const { owner, name, version, packagePath, file } = asset;
      const wasmUrl = sm.buildPrebuildUrl(source, owner, name, version, packagePath, file);
      const id = `${owner}/${name}@${version}/${[...packagePath, file].join("/")}`;
      logger.info(`Proxy miss: fetching prebuild ${id} from ${source.name}`);

      // moon fetches the checksum first, then the wasm; do the same
      let checksumBytes: Uint8Array;
      let wasm: Uint8Array;
      try {
        checksumBytes = await this.download(`${wasmUrl}.sha256`, source);
        wasm = parseSha256(checksumBytes) ? await this.download(wasmUrl, source) : new Uint8Array();
      } catch (err) {
        if (!(err instanceof ProxyError) || !this.fallbacks.buildWasmEnabled) throw err;
        return this.buildPrebuild(asset, id, err, source.name);
      }
      const expected = parseSha256(checksumBytes);
      if (!expected) {
        throw new ProxyError(`Invalid SHA-256 file for prebuild ${id}`, 502);
      }
      const actual = sha256Hex(wasm);
      if (actual !== expected) {
        throw new ProxyError(
          `Checksum mismatch for prebuild ${id}: .sha256 has ${expected}, wasm is ${actual}`,
          502,
        );
      }

      // The .sha256 goes last: both files exist only when both are complete
      await fs.writeFileAtomic(paths.wasm, wasm);
      await fs.writeFileAtomic(paths.checksum, checksumBytes);
      logger.info(`Proxy cached prebuild ${id} (${wasm.length} bytes)`);
      return paths;
    });
  }

  /**
   * Build a prebuild locally from the source zip (cached, upstream or GitHub
   * rebuild, always checked against the index). Only executable packages of
   * the zip are built. Keeps the download error when the build cannot run.
   */
  private async buildPrebuild(
    asset: PrebuildAsset,
    id: string,
    downloadError: ProxyError,
    sourceName: string,
  ): Promise<PrebuildPaths> {
    const { owner, name, version, packagePath, file } = asset;
    logger.warn(`Upstream has no prebuild ${id} (${downloadError.message}), trying a local build`);
    if (!(await this.fallbacks.ready())) throw downloadError;
    const line = await this.registry.indexManager.getIndexLine(owner, name, version, sourceName);
    if (typeof line?.checksum !== "string") throw downloadError;

    const zipPath = await this.getZip(owner, name, version, line.checksum, sourceName);
    const zip = new Uint8Array(await readFile(zipPath));
    const executables = findExecutablePackages(zip);
    const isExecutable = executables.some((p) => p.join("/") === packagePath.join("/"));
    if (!isExecutable || wasmArtifactName(name, packagePath) !== file) {
      logger.warn(`Not building ${id}: it is not an executable package of the module`);
      throw new ProxyError(`No prebuild ${id}`, 404);
    }

    let built: { wasm: Uint8Array; toolchain: string };
    try {
      built = await this.fallbacks.buildWasm(
        asset,
        zip,
        typeof line.created_at === "string" ? line.created_at : undefined,
      );
    } catch (err) {
      logger.error(`Local build of prebuild ${id} failed: ${errorMessage(err)}`);
      throw new ProxyError(
        `${downloadError.message}; local build failed: ${errorMessage(err)}`,
        502,
      );
    }

    const local = this.localPrebuildPaths(asset);
    const digest = sha256Hex(built.wasm);
    await fs.writeFileAtomic(local.wasm, built.wasm);
    await fs.writeFileAtomic(local.checksum, new TextEncoder().encode(`${digest}  ${file}\n`));
    logger.info(
      `Proxy built prebuild ${id} locally with toolchain ${built.toolchain} ` +
        `(${built.wasm.length} bytes, sha256 ${digest}); it is served as built locally`,
    );
    return local;
  }

  /**
   * Get the cached symbols.zip. A copy older than `symbols_max_age` is fetched
   * again; when that fails, the old copy is served.
   */
  async getSymbols(): Promise<string> {
    const path = this.symbolsPath;
    const maxAge = parseDuration(this.config.symbols_max_age);
    const fresh = async () => existsSync(path) && Date.now() - (await stat(path)).mtimeMs < maxAge;
    if (await fresh()) return path;

    return this.singleFlight(path, async () => {
      if (await fresh()) return path;
      try {
        const source = this.source();
        const url = this.registry.sourceManager.getSymbolsUrl(source);
        logger.info(`Proxy miss: fetching symbols.zip from ${source.name}`);
        await fs.writeFileAtomic(path, await this.download(url, source));
        return path;
      } catch (err) {
        if (existsSync(path)) {
          logger.warn(`Serving stale symbols.zip: ${errorMessage(err)}`);
          return path;
        }
        throw err;
      }
    });
  }

  /**
   * Fetch the prebuilt wasm of every executable package in a cached zip.
   * Packages without a prebuild upstream are skipped quietly.
   * Returns the number of prebuilds now in the cache.
   */
  async prefetchPrebuilds(
    owner: string,
    name: string,
    version: string,
    sourceName?: string,
  ): Promise<number> {
    const zipPath = this.registry.packageStore.getPackagePath(owner, name, version);
    if (!existsSync(zipPath)) return 0;

    let packages: string[][];
    try {
      packages = findExecutablePackages(await readFile(zipPath));
    } catch (err) {
      logger.warn(`Cannot read ${owner}/${name}@${version} to find executables: ${err}`);
      return 0;
    }

    let fetched = 0;
    for (const packagePath of packages) {
      const asset = {
        owner,
        name,
        version,
        packagePath,
        file: wasmArtifactName(name, packagePath),
      };
      try {
        await this.getPrebuild(asset, sourceName);
        fetched++;
      } catch (err) {
        if (err instanceof ProxyError && err.status === 404) {
          logger.debug(`No prebuild upstream: ${err.message}`);
        } else {
          logger.warn(`Failed to fetch prebuild: ${errorMessage(err)}`);
        }
      }
    }
    return fetched;
  }
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Read the digest of a `.sha256` file (`<hex>  <file name>`), as moon does */
function parseSha256(data: Uint8Array): string | null {
  const digest = new TextDecoder().decode(data).trim().split(/\s+/)[0] ?? "";
  return /^[0-9a-fA-F]{64}$/.test(digest) ? digest.toLowerCase() : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Whether a git repository has a HEAD commit with at least one file */
function hasCommittedFiles(dir: string): boolean {
  const result = Bun.spawnSync(["git", "ls-tree", "--name-only", "HEAD"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 && result.stdout.toString().trim() !== "";
}

export default ProxyCache;
