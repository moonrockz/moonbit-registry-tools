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
  /** Prebuilt wasm cached by proxy mode */
  PREBUILD: "prebuild",
  /** Prebuilt wasm that proxy mode built locally (kept apart from upstream files) */
  PREBUILD_LOCAL: "prebuild-local",
  /** symbols.zip cached by proxy mode */
  SYMBOLS: "symbols",
} as const;

/** Default upstream URLs */
export const UPSTREAM = {
  URL: "https://mooncakes.io",
  INDEX_URL: "https://mooncakes.io/git/index",
  /** Base URL of zips and prebuilt wasm */
  DOWNLOAD_URL: "https://download.mooncakes.io",
  /** Registry-wide symbol database that `moon update` fetches */
  SYMBOLS_URL: "https://download.mooncakes.io/symbols.zip",
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
    download_url: "https://download.mooncakes.io",
    symbols_url: "https://download.mooncakes.io/symbols.zip",
    enabled: true,
    priority: 100,
  },
  /** The mooncakes.io index mirrored to GitHub by moonrockz, with downloads from mooncakes.io */
  moonrockz: {
    type: "mooncakes",
    url: "https://mooncakes.io",
    index_url: "https://github.com/moonrockz/mooncakes-index.git",
    index_type: "git",
    download_url: "https://download.mooncakes.io",
    symbols_url: "https://download.mooncakes.io/symbols.zip",
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
