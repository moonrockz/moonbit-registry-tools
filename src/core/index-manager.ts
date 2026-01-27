/**
 * Git index management for MoonBit Registry
 *
 * Handles cloning, updating, and managing the package index
 * which is a git repository with JSONL files for each package.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIRS } from "../config/defaults.ts";
import fs from "../utils/fs.ts";
import git from "../utils/git.ts";
import logger from "../utils/logger.ts";
import type { PackageEntry, PackageMetadata, RegistryConfig } from "./types.ts";
import { parsePackageId } from "./types.ts";

export class IndexManager {
  private indexDir: string;
  private config: RegistryConfig;

  constructor(config: RegistryConfig) {
    this.config = config;
    this.indexDir = join(config.registry.data_dir, DATA_DIRS.INDEX);
  }

  /** Get the path to the index directory */
  get path(): string {
    return this.indexDir;
  }

  /** Initialize a new index (for local registries) */
  async init(): Promise<void> {
    await fs.ensureDir(this.indexDir);

    if (!(await git.isRepo(this.indexDir))) {
      await git.init(this.indexDir, this.config.git.branch);
      await git.configureUser(this.indexDir, "registry", "registry@local");
      logger.info("Initialized index repository");
    }
  }

  /** Clone the upstream index */
  async cloneUpstream(): Promise<void> {
    if (existsSync(this.indexDir)) {
      logger.debug("Index directory already exists, pulling updates");
      await this.pullUpstream();
      return;
    }

    const indexUrl = this.config.upstream.index_url;
    logger.info(`Cloning upstream index from ${indexUrl}`);
    await git.clone(indexUrl, this.indexDir, this.config.git.branch);
  }

  /** Pull updates from upstream */
  async pullUpstream(): Promise<void> {
    if (!existsSync(this.indexDir)) {
      await this.cloneUpstream();
      return;
    }

    logger.debug("Pulling upstream index updates");
    const result = await git.pull(this.indexDir);
    if (!result.success) {
      logger.warn(`Failed to pull updates: ${result.stderr}`);
    }
  }

  /** Get path to a package's index file */
  getPackageIndexPath(username: string, packageName: string): string {
    return join(this.indexDir, username, packageName);
  }

  /** Read package metadata from index */
  async getPackage(username: string, packageName: string): Promise<PackageMetadata | null> {
    const indexPath = this.getPackageIndexPath(username, packageName);

    if (!existsSync(indexPath)) {
      return null;
    }

    try {
      const entries = await fs.readJsonl<PackageEntry>(indexPath);
      return {
        username,
        name: packageName,
        versions: entries.map((e) => ({
          version: e.version,
          checksum: e.checksum,
          deps: e.deps,
          yanked: e.yanked,
        })),
      };
    } catch (err) {
      logger.error(`Failed to read package index for ${username}/${packageName}: ${err}`);
      return null;
    }
  }

  /** Write a package entry to the index */
  async writePackageEntry(entry: PackageEntry): Promise<void> {
    const pkgId = parsePackageId(entry.name);
    if (!pkgId) {
      throw new Error(`Invalid package name: ${entry.name}`);
    }

    const indexPath = this.getPackageIndexPath(pkgId.username, pkgId.name);
    await fs.ensureDir(join(this.indexDir, pkgId.username));
    await fs.appendJsonl(indexPath, entry);

    logger.debug(`Wrote entry for ${entry.name}@${entry.version}`);
  }

  /** List all packages in the index */
  async listPackages(): Promise<string[]> {
    const packages: string[] = [];

    const users = await fs.listDir(this.indexDir);
    for (const user of users) {
      if (user.startsWith(".")) continue; // Skip .git, etc.

      const userDir = join(this.indexDir, user);
      if (!fs.isDirectory(userDir)) continue;

      const pkgs = await fs.listDir(userDir);
      for (const pkg of pkgs) {
        const pkgPath = join(userDir, pkg);
        if (fs.isFile(pkgPath)) {
          packages.push(`${user}/${pkg}`);
        }
      }
    }

    return packages;
  }

  /** List packages matching a glob pattern */
  async listPackagesMatching(pattern: string): Promise<string[]> {
    const allPackages = await this.listPackages();
    return allPackages.filter((pkg) => matchGlob(pkg, pattern));
  }

  /** Commit changes to the index */
  async commit(message: string): Promise<boolean> {
    if (!(await git.hasChanges(this.indexDir))) {
      logger.debug("No changes to commit");
      return false;
    }

    await git.add(this.indexDir, ["."]);
    const result = await git.commit(this.indexDir, message);

    if (result.success) {
      logger.debug(`Committed: ${message}`);

      if (this.config.git.auto_push && this.config.git.remote_url) {
        await this.push();
      }
    }

    return result.success;
  }

  /** Push index to remote */
  async push(): Promise<boolean> {
    if (!this.config.git.remote_url) {
      logger.warn("No remote URL configured for push");
      return false;
    }

    // Ensure remote is configured
    if (!(await git.hasRemote(this.indexDir, "origin"))) {
      await git.addRemote(this.indexDir, "origin", this.config.git.remote_url);
    } else {
      await git.setRemoteUrl(this.indexDir, "origin", this.config.git.remote_url);
    }

    const result = await git.push(this.indexDir, "origin", this.config.git.branch, true);

    if (result.success) {
      logger.info("Pushed index to remote");
    } else {
      logger.error(`Failed to push: ${result.stderr}`);
    }

    return result.success;
  }

  /** Pull from remote */
  async pull(): Promise<boolean> {
    if (!this.config.git.remote_url) {
      logger.warn("No remote URL configured for pull");
      return false;
    }

    const result = await git.pull(this.indexDir, "origin", this.config.git.branch);
    return result.success;
  }
}

/** Simple glob pattern matching */
function matchGlob(str: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
    .replace(/\*/g, ".*") // * matches anything
    .replace(/\?/g, "."); // ? matches single char

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

export default IndexManager;
