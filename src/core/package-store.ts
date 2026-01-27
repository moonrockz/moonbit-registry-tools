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
import type { PackageVersionId, RegistryConfig } from "./types.ts";

export class PackageStore {
  private packagesDir: string;
  private config: RegistryConfig;

  constructor(config: RegistryConfig) {
    this.config = config;
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

  /** Download a package from upstream */
  async downloadPackage(
    username: string,
    name: string,
    version: string,
    expectedChecksum?: string,
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

    // Download from upstream
    const url = this.getUpstreamUrl(username, name, version);
    logger.info(`Downloading ${username}/${name}@${version}`);

    const response = await fetch(url);
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

  /** Get the upstream URL for a package */
  getUpstreamUrl(username: string, name: string, version: string): string {
    return `${this.config.upstream.url}/user/${username}/${name}/${version}.zip`;
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
