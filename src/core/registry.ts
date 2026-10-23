/**
 * High-level registry operations
 *
 * Coordinates index management, package storage, and dependency resolution.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_FILE_NAME, DATA_DIRS } from "../config/defaults.ts";
import configLoader from "../config/loader.ts";
import fs from "../utils/fs.ts";
import logger from "../utils/logger.ts";
import DependencyResolver from "./dependency-resolver.ts";
import IndexManager from "./index-manager.ts";
import PackageStore from "./package-store.ts";
import { SourceManager } from "./source-manager.ts";
import type { MirrorOptions, MirrorSource, PackageMetadata, RegistryConfig } from "./types.ts";
import { DEFAULT_CONFIG, formatPackageVersionId, parsePackageId } from "./types.ts";

export class Registry {
  public config: RegistryConfig;
  public sourceManager: SourceManager;
  public indexManager: IndexManager;
  public packageStore: PackageStore;
  public dependencyResolver: DependencyResolver;
  public rootDir: string;

  constructor(config: RegistryConfig, rootDir: string) {
    this.config = config;
    this.rootDir = rootDir;
    this.sourceManager = new SourceManager(config);
    this.indexManager = new IndexManager(config, this.sourceManager);
    this.packageStore = new PackageStore(config, this.sourceManager);
    this.dependencyResolver = new DependencyResolver(this.indexManager, this.packageStore);
  }

  /** Rebuild components that hold a source manager after a source change */
  private reloadSources(): void {
    this.sourceManager = new SourceManager(this.config);
    this.indexManager = new IndexManager(this.config, this.sourceManager);
    this.packageStore = new PackageStore(this.config, this.sourceManager);
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
    if (
      !config.registry.data_dir.startsWith("/") &&
      !config.registry.data_dir.match(/^[A-Za-z]:\\/)
    ) {
      config.registry.data_dir = join(rootDir, config.registry.data_dir);
    }

    return new Registry(config, rootDir);
  }

  /** Initialize a new registry */
  static async init(dir: string, name?: string): Promise<Registry> {
    const rootDir = resolve(dir);
    await fs.ensureDir(rootDir);

    // Create config from a deep copy, so changes do not leak into DEFAULT_CONFIG
    const defaults = structuredClone(DEFAULT_CONFIG);
    const config: RegistryConfig = {
      ...defaults,
      registry: {
        ...defaults.registry,
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

  /** Mirror packages from upstream or specified source */
  async mirror(options: MirrorOptions): Promise<void> {
    // Get the source to mirror from
    const source = this.sourceManager.getSource(options.source);
    if (!source) {
      throw new Error(`Source '${options.source ?? "default"}' not found or not configured`);
    }

    if (!source.enabled) {
      throw new Error(`Source '${source.name}' is disabled`);
    }

    // First, ensure we have the source index
    logger.info(`Updating index from source '${source.name}'...`);
    await this.indexManager.syncSourceIndex(source.name);

    // Resolve packages to mirror
    logger.info("Resolving packages to mirror...");
    const resolution = await this.dependencyResolver.resolve(options, source.name);

    // Log warnings for skipped dependencies
    this.dependencyResolver.logSkippedWarnings(resolution, options.quiet);

    // Visit every package, also cached ones: a package with one cached version
    // can have new versions upstream. downloadPackage skips files it already has.
    const toDownload = Array.from(resolution.packages);

    logger.info(
      `Found ${resolution.packages.size} packages to mirror (${resolution.cached.size} already cached)`,
    );

    let downloaded = 0;
    let failed = 0;

    for (const pkgName of toDownload) {
      const pkgId = parsePackageId(pkgName);
      if (!pkgId) continue;

      const metadata = await this.indexManager.getPackageFromSource(
        pkgId.username,
        pkgId.name,
        source.name,
      );
      if (!metadata) {
        logger.warn(`Package ${pkgName} not found in index`);
        failed++;
        continue;
      }

      // Download yanked versions too: moon still selects them (it only warns
      // that they are deprecated), so a mirror without them breaks builds.
      for (const version of metadata.versions) {
        try {
          await this.packageStore.downloadPackage(
            pkgId.username,
            pkgId.name,
            version.version,
            version.checksum,
            source.name,
          );
          downloaded++;
        } catch (err) {
          logger.error(
            `Failed to download ${formatPackageVersionId({ ...pkgId, version: version.version })}: ${err}`,
          );
          failed++;
        }
      }
    }

    // Publish the index entries of every resolved package where moon reads them.
    // Versions whose archive failed to download are left out.
    const published = await this.indexManager.publishFromSource(
      Array.from(resolution.packages),
      source.name,
      (username, name, version) => this.packageStore.hasPackage(username, name, version),
    );
    if (published > 0) {
      await this.indexManager.commit(`Mirror ${published} packages from ${source.name}`);
    }
    await this.indexManager.updateServerInfo();

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

  /** List all configured sources */
  listSources(): MirrorSource[] {
    return this.sourceManager.listSources();
  }

  /** Add a new source to configuration */
  addSource(source: MirrorSource): void {
    // Initialize sources array if needed
    if (!this.config.sources) {
      this.config.sources = [];
    }

    // Check for duplicates
    const existing = this.config.sources.find((s) => s.name === source.name);
    if (existing) {
      throw new Error(`Source '${source.name}' already exists`);
    }

    this.config.sources.push(source);

    this.reloadSources();
  }

  /** Remove a source from configuration */
  removeSource(name: string): void {
    if (!this.config.sources) {
      throw new Error(`Source '${name}' not found`);
    }

    const index = this.config.sources.findIndex((s) => s.name === name);
    if (index === -1) {
      throw new Error(`Source '${name}' not found`);
    }

    this.config.sources.splice(index, 1);

    // Clear default if it was the removed source
    if (this.config.default_source === name) {
      this.config.default_source = undefined;
    }

    this.reloadSources();
  }

  /** Set the default source */
  setDefaultSource(name: string): void {
    const source = this.sourceManager.getSource(name);
    if (!source) {
      throw new Error(`Source '${name}' not found`);
    }
    this.config.default_source = name;
    this.reloadSources();
  }

  /** Enable or disable a source */
  setSourceEnabled(name: string, enabled: boolean): void {
    if (!this.config.sources) {
      throw new Error(`Source '${name}' not found`);
    }

    const source = this.config.sources.find((s) => s.name === name);
    if (!source) {
      throw new Error(`Source '${name}' not found`);
    }

    source.enabled = enabled;

    this.reloadSources();
  }

  /** Save configuration to file */
  async saveConfig(): Promise<void> {
    const configPath = join(this.rootDir, CONFIG_FILE_NAME);
    await configLoader.save(this.config, configPath);
  }
}

export default Registry;
