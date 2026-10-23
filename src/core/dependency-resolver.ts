/**
 * Dependency resolver for package mirroring
 *
 * Handles glob pattern matching and transitive dependency resolution.
 */

import logger from "../utils/logger.ts";
import type IndexManager from "./index-manager.ts";
import type PackageStore from "./package-store.ts";
import type { DependencyResolution, MirrorOptions } from "./types.ts";
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

    // Resolve transitive dependencies; strict mode only records them as skipped
    await this.resolveTransitiveDeps(result, !options.strict, sourceName);

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
    includeDeps: boolean,
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

      // Every version is mirrored (yanked ones too), so follow the deps of all
      const depNames = new Set(metadata.versions.flatMap((v) => Object.keys(v.deps || {})));

      for (const depName of depNames) {
        if (result.packages.has(depName)) continue;

        if (includeDeps) {
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
        `Dependency '${dep}' required by [${requiredBy.join(", ")}] is not mirrored in strict mode and not cached`,
      );
    }
  }
}

export default DependencyResolver;
