/**
 * Core type definitions for the MoonBit Registry
 */

/** Package version entry in the index */
export interface PackageVersion {
  version: string;
  checksum: string;
  deps: Record<string, string>;
  yanked?: boolean;
}

/** Package entry in the index JSONL file */
export interface PackageEntry {
  name: string;
  version: string;
  checksum: string;
  deps: Record<string, string>;
  yanked?: boolean;
}

/** Full package metadata */
export interface PackageMetadata {
  username: string;
  name: string;
  versions: PackageVersion[];
}

/** Registry configuration */
export interface RegistryConfig {
  registry: {
    name: string;
    data_dir: string;
  };
  upstream: {
    enabled: boolean;
    url: string;
    index_url: string;
  };
  mirror: {
    auto_sync: boolean;
    sync_interval: string;
    packages: string[];
  };
  server: {
    host: string;
    port: number;
    base_url: string;
  };
  git: {
    remote_url: string;
    branch: string;
    auto_push: boolean;
  };
}

/** Default configuration values */
export const DEFAULT_CONFIG: RegistryConfig = {
  registry: {
    name: "local-registry",
    data_dir: "./data",
  },
  upstream: {
    enabled: true,
    url: "https://mooncakes.io",
    index_url: "https://mooncakes.io/git/index",
  },
  mirror: {
    auto_sync: false,
    sync_interval: "1h",
    packages: [],
  },
  server: {
    host: "0.0.0.0",
    port: 8080,
    base_url: "http://localhost:8080",
  },
  git: {
    remote_url: "",
    branch: "main",
    auto_push: false,
  },
};

/** Mirror options for the mirror command */
export interface MirrorOptions {
  patterns: string[];
  full: boolean;
  strict: boolean;
  quiet: boolean;
}

/** Result of dependency resolution */
export interface DependencyResolution {
  /** Packages to mirror (matching patterns + deps) */
  packages: Set<string>;
  /** Dependencies that were skipped (not matching patterns) */
  skipped: Map<string, string[]>;
  /** Packages that are already cached */
  cached: Set<string>;
}

/** Package identifier (username/name) */
export interface PackageId {
  username: string;
  name: string;
}

/** Parse a package identifier string */
export function parsePackageId(id: string): PackageId | null {
  const parts = id.split("/");
  if (parts.length !== 2) return null;
  const [username, name] = parts;
  if (!username || !name) return null;
  return { username, name };
}

/** Format a package identifier */
export function formatPackageId(id: PackageId): string {
  return `${id.username}/${id.name}`;
}

/** Version specifier (for dependencies) */
export type VersionSpec = string;

/** Full package version identifier */
export interface PackageVersionId extends PackageId {
  version: string;
}

/** Format a package version identifier */
export function formatPackageVersionId(id: PackageVersionId): string {
  return `${id.username}/${id.name}@${id.version}`;
}
