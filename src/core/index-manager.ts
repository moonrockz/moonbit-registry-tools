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
import type { SourceManager } from "./source-manager.ts";
import type { MirrorSource, PackageEntry, PackageMetadata, RegistryConfig } from "./types.ts";
import { parsePackageId } from "./types.ts";

export class IndexManager {
  private indexDir: string;
  private config: RegistryConfig;
  private sourceManager: SourceManager | null;

  constructor(config: RegistryConfig, sourceManager?: SourceManager) {
    this.config = config;
    this.sourceManager = sourceManager ?? null;
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

  /** Clone the upstream index (legacy method, uses default source) */
  async cloneUpstream(): Promise<void> {
    await this.syncSourceIndex();
  }

  /** Pull updates from upstream (legacy method, uses default source) */
  async pullUpstream(): Promise<void> {
    await this.syncSourceIndex();
  }

  /** Get the path for a specific source's index */
  getSourceIndexPath(sourceName?: string): string {
    if (!sourceName) {
      return this.indexDir;
    }
    return join(this.indexDir, "sources", sourceName);
  }

  /** Sync index from a specific source */
  async syncSourceIndex(sourceName?: string): Promise<void> {
    const source = this.getSourceForSync(sourceName);
    const indexPath = sourceName ? this.getSourceIndexPath(sourceName) : this.indexDir;

    if (source.index_type === "git") {
      await this.syncGitIndex(source, indexPath);
    } else {
      await this.syncHttpIndex(source, indexPath);
    }
  }

  /** Get source for sync operation */
  private getSourceForSync(sourceName?: string): MirrorSource {
    // Try to use SourceManager if available
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
      enabled: this.config.upstream.enabled,
    };
  }

  /** Sync a git-based index */
  private async syncGitIndex(source: MirrorSource, indexPath: string): Promise<void> {
    if (existsSync(indexPath)) {
      logger.debug(`Index directory for '${source.name}' exists, pulling updates`);
      const result = await git.pull(indexPath);
      if (!result.success) {
        logger.warn(`Failed to pull updates for '${source.name}': ${result.stderr}`);
      }
      return;
    }

    logger.info(`Cloning index from ${source.name} (${source.index_url})`);
    await git.clone(source.index_url, indexPath, this.config.git.branch);
  }

  /** Sync an HTTP-based index (placeholder for future implementation) */
  private async syncHttpIndex(source: MirrorSource, indexPath: string): Promise<void> {
    // HTTP index sync would fetch package list from an API
    // This is a placeholder for future implementation
    logger.warn(`HTTP index sync for '${source.name}' is not yet implemented`);
    await fs.ensureDir(indexPath);
  }

  /** Get package from a specific source's index */
  async getPackageFromSource(
    username: string,
    packageName: string,
    sourceName?: string,
  ): Promise<PackageMetadata | null> {
    const indexPath = this.getSourceIndexPath(sourceName);
    const pkgIndexPath = join(indexPath, username, packageName);

    if (!existsSync(pkgIndexPath)) {
      return null;
    }

    try {
      const entries = await fs.readJsonl<PackageEntry>(pkgIndexPath);
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
      logger.error(
        `Failed to read package index for ${username}/${packageName} from source: ${err}`,
      );
      return null;
    }
  }

  /** List packages from a specific source's index */
  async listPackagesFromSource(sourceName?: string): Promise<string[]> {
    const indexPath = this.getSourceIndexPath(sourceName);
    return this.listPackagesInDir(indexPath);
  }

  /** List packages matching a pattern from a specific source */
  async listPackagesMatchingFromSource(pattern: string, sourceName?: string): Promise<string[]> {
    const allPackages = await this.listPackagesFromSource(sourceName);
    return allPackages.filter((pkg) => matchGlob(pkg, pattern));
  }

  /** List packages in a directory */
  private async listPackagesInDir(dir: string): Promise<string[]> {
    const packages: string[] = [];

    if (!existsSync(dir)) {
      return packages;
    }

    const users = await fs.listDir(dir);
    for (const user of users) {
      if (user.startsWith(".") || user === "sources") continue;

      const userDir = join(dir, user);
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
