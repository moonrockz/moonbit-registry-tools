/**
 * Default configuration values
 */

import type { MirrorSource } from "../core/types.ts";

export { DEFAULT_CONFIG } from "../core/types.ts";

/** Default config file name */
export const CONFIG_FILE_NAME = "registry.toml";

/** Default data directory structure */
export const DATA_DIRS = {
  INDEX: "index",
  PACKAGES: "packages",
} as const;

/** Default upstream URLs */
export const UPSTREAM = {
  URL: "https://mooncakes.io",
  INDEX_URL: "https://mooncakes.io/git/index",
} as const;

/** Default server settings */
export const SERVER = {
  HOST: "0.0.0.0",
  PORT: 8080,
} as const;

/** Predefined source templates for easy setup */
export const PREDEFINED_SOURCES: Record<string, Omit<MirrorSource, "name">> = {
  mooncakes: {
    type: "mooncakes",
    url: "https://mooncakes.io",
    index_url: "https://mooncakes.io/git/index",
    index_type: "git",
    package_url_pattern: "${url}/user/${username}/${name}/${version}.zip",
    enabled: true,
    priority: 100,
  },
  "moonbit-registry": {
    type: "moonbit-registry",
    url: "",
    index_url: "",
    index_type: "git",
    package_url_pattern: "${url}/user/${username}/${name}/${version}.zip",
    enabled: true,
    priority: 50,
  },
};
