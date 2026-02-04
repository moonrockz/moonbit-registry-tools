/**
 * Package storage and caching
 *
 * Handles downloading, storing, and verifying packages.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIRS } from "../config/defaults.ts";
import crypto from "../utils/crypto.ts";
import fs from "../utils/fs.ts";
import logger from "../utils/logger.ts";
import type { SourceManager } from "./source-manager.ts";
import type { MirrorSource, PackageVersionId, RegistryConfig } from "./types.ts";

export class PackageStore {
  private packagesDir: string;
  private config: RegistryConfig;
  private sourceManager: SourceManager | null;

  constructor(config: RegistryConfig, sourceManager?: SourceManager) {
    this.config = config;
    this.sourceManager = sourceManager ?? null;
    this.packagesDir = join(config.registry.data_dir, DATA_DIRS.PACKAGES);
  }

  /** Get the path to the packages directory */
  get path(): string {
    return this.packagesDir;
  }

  /** Initialize the package store */
  async init(): Promise<void> {
    await fs.ensureDir(this.packagesDir);
  }

  /** Get path to a package file */
  getPackagePath(username: string, name: string, version: string): string {
    return join(this.packagesDir, username, name, `${version}.zip`);
  }

  /** Check if a package version exists locally */
  hasPackage(username: string, name: string, version: string): boolean {
    return existsSync(this.getPackagePath(username, name, version));
  }

  /** Download a package from upstream (or specified source) */
  async downloadPackage(
    username: string,
    name: string,
    version: string,
    expectedChecksum?: string,
    sourceName?: string,
  ): Promise<string> {
    const packagePath = this.getPackagePath(username, name, version);

    // Already exists
    if (existsSync(packagePath)) {
      if (expectedChecksum) {
        const valid = await crypto.verifyChecksum(packagePath, expectedChecksum);
        if (valid) {
          logger.debug(`Package ${username}/${name}@${version} already cached`);
          return packagePath;
        }
        logger.warn(`Checksum mismatch for cached ${username}/${name}@${version}, re-downloading`);
        await fs.remove(packagePath);
      } else {
        return packagePath;
      }
    }

    // Get source and build URL
    const source = this.getSourceForDownload(sourceName);
    const url = this.buildPackageUrl(source, username, name, version);
    const fetchOptions = this.getFetchOptionsForSource(source);

    logger.info(`Downloading ${username}/${name}@${version} from ${source.name}`);

    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`Failed to download package: ${response.status} ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    await fs.ensureDir(join(this.packagesDir, username, name));
    await Bun.write(packagePath, data);

    // Verify checksum
    if (expectedChecksum) {
      const valid = await crypto.verifyChecksum(packagePath, expectedChecksum);
      if (!valid) {
        await fs.remove(packagePath);
        throw new Error(`Checksum verification failed for ${username}/${name}@${version}`);
      }
    }

    logger.debug(`Downloaded ${username}/${name}@${version}`);
    return packagePath;
  }

  /** Download package with fallback through all enabled sources */
  async downloadPackageWithFallback(
    username: string,
    name: string,
    version: string,
    expectedChecksum?: string,
  ): Promise<string> {
    // Check cache first
    const packagePath = this.getPackagePath(username, name, version);
    if (existsSync(packagePath)) {
      if (!expectedChecksum) {
        return packagePath;
      }
      const valid = await crypto.verifyChecksum(packagePath, expectedChecksum);
      if (valid) {
        logger.debug(`Package ${username}/${name}@${version} already cached`);
        return packagePath;
      }
      await fs.remove(packagePath);
    }

    // Try each enabled source in priority order
    if (this.sourceManager) {
      const sources = this.sourceManager.listEnabledSources();

      for (const source of sources) {
        try {
          return await this.downloadPackage(username, name, version, expectedChecksum, source.name);
        } catch (err) {
          logger.debug(`Failed to download from ${source.name}: ${err}`);
        }
      }

      throw new Error(`Package ${username}/${name}@${version} not found in any source`);
    }

    // Fall back to default source
    return this.downloadPackage(username, name, version, expectedChecksum);
  }

  /** Get source for download operation */
  private getSourceForDownload(sourceName?: string): MirrorSource {
    if (this.sourceManager) {
      const source = this.sourceManager.getSource(sourceName);
      if (source) {
        return source;
      }
      throw new Error(`Source '${sourceName ?? "default"}' not found`);
    }

    // Fall back to legacy upstream config
    if (!this.config.upstream) {
      throw new Error("No upstream configured");
    }

    return {
      name: "upstream",
      type: "mooncakes",
      url: this.config.upstream.url,
      index_url: this.config.upstream.index_url,
      index_type: "git",
      package_url_pattern: "https://download.mooncakes.io/user/${username}/${name}/${version}.zip",
      enabled: this.config.upstream.enabled,
    };
  }

  /** Build package URL for a source */
  private buildPackageUrl(
    source: MirrorSource,
    username: string,
    name: string,
    version: string,
  ): string {
    if (this.sourceManager) {
      return this.sourceManager.buildPackageUrl(source, username, name, version);
    }

    // Fall back to default pattern
    const pattern = source.package_url_pattern ?? "https://download.mooncakes.io/user/${username}/${name}/${version}.zip";
    return pattern
      .replace(/\$\{url\}/g, source.url)
      .replace(/\$\{username\}/g, username)
      .replace(/\$\{name\}/g, name)
      .replace(/\$\{version\}/g, version);
  }

  /** Get fetch options for a source */
  private getFetchOptionsForSource(source: MirrorSource): RequestInit {
    if (this.sourceManager) {
      return this.sourceManager.getFetchOptions(source);
    }
    return {};
  }

  /** Get the upstream URL for a package (legacy method) */
  getUpstreamUrl(username: string, name: string, version: string): string {
    const source = this.getSourceForDownload();
    return this.buildPackageUrl(source, username, name, version);
  }

  /** List all cached packages */
  async listCached(): Promise<PackageVersionId[]> {
    const packages: PackageVersionId[] = [];

    const users = await fs.listDir(this.packagesDir);
    for (const user of users) {
      const userDir = join(this.packagesDir, user);
      if (!fs.isDirectory(userDir)) continue;

      const pkgs = await fs.listDir(userDir);
      for (const pkg of pkgs) {
        const pkgDir = join(userDir, pkg);
        if (!fs.isDirectory(pkgDir)) continue;

        const files = await fs.listDir(pkgDir);
        for (const file of files) {
          if (file.endsWith(".zip")) {
            const version = file.slice(0, -4); // Remove .zip
            packages.push({ username: user, name: pkg, version });
          }
        }
      }
    }

    return packages;
  }

  /** Get total cache size in bytes */
  async getCacheSize(): Promise<number> {
    let total = 0;
    const files = await fs.listFilesRecursive(this.packagesDir, /\.zip$/);
    for (const file of files) {
      total += await fs.fileSize(file);
    }
    return total;
  }

  /** Remove a specific package version */
  async removePackage(username: string, name: string, version: string): Promise<void> {
    const path = this.getPackagePath(username, name, version);
    if (existsSync(path)) {
      await fs.remove(path);
      logger.debug(`Removed ${username}/${name}@${version}`);
    }
  }

  /** Clear all cached packages */
  async clearCache(): Promise<void> {
    await fs.remove(this.packagesDir);
    await fs.ensureDir(this.packagesDir);
    logger.info("Cleared package cache");
  }

  /** Serve a package file (returns the file path if exists) */
  getPackageFile(username: string, name: string, version: string): string | null {
    const path = this.getPackagePath(username, name, version);
    return existsSync(path) ? path : null;
  }
}

export default PackageStore;
