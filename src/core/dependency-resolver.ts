/**
 * Dependency resolver for package mirroring
 *
 * Handles glob pattern matching and transitive dependency resolution.
 */

import logger from "../utils/logger.ts";
import type IndexManager from "./index-manager.ts";
import type PackageStore from "./package-store.ts";
import type { DependencyResolution, MirrorOptions, PackageMetadata } from "./types.ts";
import { parsePackageId } from "./types.ts";

export class DependencyResolver {
  private indexManager: IndexManager;
  private packageStore: PackageStore;

  constructor(indexManager: IndexManager, packageStore: PackageStore) {
    this.indexManager = indexManager;
    this.packageStore = packageStore;
  }

  /**
   * Resolve packages to mirror based on patterns and options
   */
  async resolve(options: MirrorOptions, sourceName?: string): Promise<DependencyResolution> {
    const result: DependencyResolution = {
      packages: new Set(),
      skipped: new Map(),
      cached: new Set(),
    };

    // Get all packages matching patterns
    const matchedPackages = await this.matchPatterns(options.patterns, options.full, sourceName);

    for (const pkgName of matchedPackages) {
      result.packages.add(pkgName);
    }

    // If not strict mode, resolve transitive dependencies
    if (!options.strict) {
      await this.resolveTransitiveDeps(result, options.patterns, sourceName);
    }

    // Check which packages are already cached
    for (const pkgName of result.packages) {
      if (await this.isPackageCached(pkgName, sourceName)) {
        result.cached.add(pkgName);
      }
    }

    return result;
  }

  /** Match packages against glob patterns */
  private async matchPatterns(
    patterns: string[],
    full: boolean,
    sourceName?: string,
  ): Promise<string[]> {
    if (full) {
      return sourceName
        ? this.indexManager.listPackagesFromSource(sourceName)
        : this.indexManager.listPackages();
    }

    const matched = new Set<string>();

    for (const pattern of patterns) {
      const packages = sourceName
        ? await this.indexManager.listPackagesMatchingFromSource(pattern, sourceName)
        : await this.indexManager.listPackagesMatching(pattern);
      for (const pkg of packages) {
        matched.add(pkg);
      }
    }

    return Array.from(matched);
  }

  /** Resolve transitive dependencies for matched packages */
  private async resolveTransitiveDeps(
    result: DependencyResolution,
    originalPatterns: string[],
    sourceName?: string,
  ): Promise<void> {
    const toProcess = new Set(result.packages);
    const processed = new Set<string>();

    while (toProcess.size > 0) {
      const pkgName = toProcess.values().next().value as string;
      toProcess.delete(pkgName);

      if (processed.has(pkgName)) continue;
      processed.add(pkgName);

      const pkgId = parsePackageId(pkgName);
      if (!pkgId) continue;

      const metadata = sourceName
        ? await this.indexManager.getPackageFromSource(pkgId.username, pkgId.name, sourceName)
        : await this.indexManager.getPackage(pkgId.username, pkgId.name);
      if (!metadata) continue;

      // Get deps from latest non-yanked version
      const latestVersion = this.getLatestVersion(metadata);
      if (!latestVersion) continue;

      for (const depName of Object.keys(latestVersion.deps)) {
        if (result.packages.has(depName)) continue;

        // Check if dep matches original patterns
        const matchesPattern = originalPatterns.some((p) => matchGlob(depName, p));

        if (matchesPattern) {
          result.packages.add(depName);
          toProcess.add(depName);
        } else {
          // Track skipped dependency
          if (!result.skipped.has(depName)) {
            result.skipped.set(depName, []);
          }
          result.skipped.get(depName)?.push(pkgName);
        }
      }
    }
  }

  /** Get the latest non-yanked version */
  private getLatestVersion(metadata: PackageMetadata) {
    const versions = metadata.versions.filter((v) => !v.yanked);
    if (versions.length === 0) return null;

    // Sort by version (semver-like comparison)
    versions.sort((a, b) => compareVersions(b.version, a.version));
    return versions[0];
  }

  /** Check if any version of a package is cached */
  private async isPackageCached(pkgName: string, sourceName?: string): Promise<boolean> {
    const pkgId = parsePackageId(pkgName);
    if (!pkgId) return false;

    const metadata = sourceName
      ? await this.indexManager.getPackageFromSource(pkgId.username, pkgId.name, sourceName)
      : await this.indexManager.getPackage(pkgId.username, pkgId.name);
    if (!metadata) return false;

    // Check if any version is cached
    for (const version of metadata.versions) {
      if (this.packageStore.hasPackage(pkgId.username, pkgId.name, version.version)) {
        return true;
      }
    }

    return false;
  }

  /** Log warnings for skipped dependencies */
  logSkippedWarnings(result: DependencyResolution, quiet: boolean): void {
    if (quiet) return;

    for (const [dep, requiredBy] of result.skipped) {
      // Don't warn if the dependency is already cached
      if (result.cached.has(dep)) continue;

      logger.warn(
        `Dependency '${dep}' required by [${requiredBy.join(", ")}] is not included in mirror patterns and not cached`,
      );
    }
  }
}

/** Simple glob pattern matching */
function matchGlob(str: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

/** Compare two version strings (simple semver-like comparison) */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const partsB = b.split(".").map((p) => Number.parseInt(p, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }

  return 0;
}

export default DependencyResolver;
