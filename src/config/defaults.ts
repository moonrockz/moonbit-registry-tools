/**
 * Default configuration values
 */

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
