/**
 * High-level registry operations
 *
 * Coordinates index management, package storage, and dependency resolution.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RegistryConfig, MirrorOptions, PackageMetadata } from "./types.ts";
import { DEFAULT_CONFIG, parsePackageId, formatPackageVersionId } from "./types.ts";
import IndexManager from "./index-manager.ts";
import PackageStore from "./package-store.ts";
import DependencyResolver from "./dependency-resolver.ts";
import configLoader from "../config/loader.ts";
import fs from "../utils/fs.ts";
import logger from "../utils/logger.ts";
import { CONFIG_FILE_NAME, DATA_DIRS } from "../config/defaults.ts";

export class Registry {
  public config: RegistryConfig;
  public indexManager: IndexManager;
  public packageStore: PackageStore;
  public dependencyResolver: DependencyResolver;
  public rootDir: string;

  constructor(config: RegistryConfig, rootDir: string) {
    this.config = config;
    this.rootDir = rootDir;
    this.indexManager = new IndexManager(config);
    this.packageStore = new PackageStore(config);
    this.dependencyResolver = new DependencyResolver(this.indexManager, this.packageStore);
  }

  /** Load a registry from a directory */
  static async load(dir?: string): Promise<Registry> {
    const rootDir = dir ? resolve(dir) : process.cwd();
    const configPath = join(rootDir, CONFIG_FILE_NAME);

    let config: RegistryConfig;
    if (existsSync(configPath)) {
      config = await configLoader.load(configPath);
    } else {
      // Deep copy DEFAULT_CONFIG to avoid mutation issues
      config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as RegistryConfig;
    }

    // Make data_dir absolute relative to root
    if (!config.registry.data_dir.startsWith("/") && !config.registry.data_dir.match(/^[A-Za-z]:\\/)) {
      config.registry.data_dir = join(rootDir, config.registry.data_dir);
    }

    return new Registry(config, rootDir);
  }

  /** Initialize a new registry */
  static async init(dir: string, name?: string): Promise<Registry> {
    const rootDir = resolve(dir);
    await fs.ensureDir(rootDir);

    // Create config
    const config: RegistryConfig = {
      ...DEFAULT_CONFIG,
      registry: {
        ...DEFAULT_CONFIG.registry,
        name: name ?? "local-registry",
        data_dir: join(rootDir, "data"),
      },
    };

    // Save config
    const configPath = join(rootDir, CONFIG_FILE_NAME);
    await configLoader.save(config, configPath);

    // Create data directories
    await fs.ensureDir(join(config.registry.data_dir, DATA_DIRS.INDEX));
    await fs.ensureDir(join(config.registry.data_dir, DATA_DIRS.PACKAGES));

    const registry = new Registry(config, rootDir);

    // Initialize index repository
    await registry.indexManager.init();

    logger.success(`Initialized registry at ${rootDir}`);
    return registry;
  }

  /** Mirror packages from upstream */
  async mirror(options: MirrorOptions): Promise<void> {
    if (!this.config.upstream.enabled) {
      throw new Error("Upstream is not enabled in configuration");
    }

    // First, ensure we have the upstream index
    logger.info("Updating upstream index...");
    await this.indexManager.cloneUpstream();

    // Resolve packages to mirror
    logger.info("Resolving packages to mirror...");
    const resolution = await this.dependencyResolver.resolve(options);

    // Log warnings for skipped dependencies
    this.dependencyResolver.logSkippedWarnings(resolution, options.quiet);

    // Download packages
    const toDownload = Array.from(resolution.packages).filter((p) => !resolution.cached.has(p));

    logger.info(`Found ${resolution.packages.size} packages to mirror (${toDownload.length} to download)`);

    let downloaded = 0;
    let failed = 0;

    for (const pkgName of toDownload) {
      const pkgId = parsePackageId(pkgName);
      if (!pkgId) continue;

      const metadata = await this.indexManager.getPackage(pkgId.username, pkgId.name);
      if (!metadata) {
        logger.warn(`Package ${pkgName} not found in index`);
        failed++;
        continue;
      }

      // Download all non-yanked versions
      for (const version of metadata.versions) {
        if (version.yanked) continue;

        try {
          await this.packageStore.downloadPackage(
            pkgId.username,
            pkgId.name,
            version.version,
            version.checksum
          );
          downloaded++;
        } catch (err) {
          logger.error(`Failed to download ${formatPackageVersionId({ ...pkgId, version: version.version })}: ${err}`);
          failed++;
        }
      }
    }

    logger.success(`Mirrored ${downloaded} package versions (${failed} failed)`);
  }

  /** Get package metadata */
  async getPackage(username: string, name: string): Promise<PackageMetadata | null> {
    return this.indexManager.getPackage(username, name);
  }

  /** List all packages */
  async listPackages(): Promise<string[]> {
    return this.indexManager.listPackages();
  }

  /** Sync with remote git repository */
  async sync(mode: "push" | "pull"): Promise<void> {
    if (!this.config.git.remote_url) {
      throw new Error("No remote URL configured");
    }

    if (mode === "push") {
      await this.indexManager.push();
    } else {
      await this.indexManager.pull();
    }
  }

  /** Get registry statistics */
  async getStats(): Promise<{
    packages: number;
    cachedVersions: number;
    cacheSize: number;
  }> {
    const packages = await this.listPackages();
    const cached = await this.packageStore.listCached();
    const cacheSize = await this.packageStore.getCacheSize();

    return {
      packages: packages.length,
      cachedVersions: cached.length,
      cacheSize,
    };
  }
}

export default Registry;
