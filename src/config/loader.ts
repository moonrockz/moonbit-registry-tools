/**
 * Configuration loader (TOML parsing)
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as toml from "toml";
import type { RegistryConfig } from "../core/types.ts";
import { DEFAULT_CONFIG } from "../core/types.ts";
import fs from "../utils/fs.ts";
import logger from "../utils/logger.ts";
import { validateConfig, ConfigValidationError } from "./schema.ts";
import { CONFIG_FILE_NAME } from "./defaults.ts";

/** Find the config file by searching up the directory tree */
export function findConfigFile(startDir?: string): string | null {
  let dir = startDir ? resolve(startDir) : process.cwd();

  while (true) {
    const configPath = join(dir, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      return configPath;
    }

    const parent = resolve(dir, "..");
    if (parent === dir) {
      // Reached root
      return null;
    }
    dir = parent;
  }
}

/** Load configuration from a file */
export async function loadConfig(configPath?: string): Promise<RegistryConfig> {
  // If no path provided, search for config file
  const path = configPath ?? findConfigFile();

  if (!path || !existsSync(path)) {
    logger.debug("No config file found, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  logger.debug(`Loading config from ${path}`);

  try {
    const content = await fs.readText(path);
    const parsed = toml.parse(content);
    return validateConfig(parsed);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      throw err;
    }
    throw new Error(`Failed to parse config file: ${err}`);
  }
}

/** Save configuration to a file */
export async function saveConfig(config: RegistryConfig, configPath: string): Promise<void> {
  const content = generateToml(config);
  await fs.writeText(configPath, content);
  logger.debug(`Saved config to ${configPath}`);
}

/** Generate TOML content from config object */
function generateToml(config: RegistryConfig): string {
  const lines: string[] = [];

  lines.push("[registry]");
  lines.push(`name = "${config.registry.name}"`);
  lines.push(`data_dir = "${config.registry.data_dir}"`);
  lines.push("");

  lines.push("[upstream]");
  lines.push(`enabled = ${config.upstream.enabled}`);
  lines.push(`url = "${config.upstream.url}"`);
  lines.push(`index_url = "${config.upstream.index_url}"`);
  lines.push("");

  lines.push("[mirror]");
  lines.push(`auto_sync = ${config.mirror.auto_sync}`);
  lines.push(`sync_interval = "${config.mirror.sync_interval}"`);
  lines.push(`packages = [${config.mirror.packages.map((p) => `"${p}"`).join(", ")}]`);
  lines.push("");

  lines.push("[server]");
  lines.push(`host = "${config.server.host}"`);
  lines.push(`port = ${config.server.port}`);
  lines.push(`base_url = "${config.server.base_url}"`);
  lines.push("");

  lines.push("[git]");
  lines.push(`remote_url = "${config.git.remote_url}"`);
  lines.push(`branch = "${config.git.branch}"`);
  lines.push(`auto_push = ${config.git.auto_push}`);

  return lines.join("\n") + "\n";
}

/** Create a default config file */
export async function createDefaultConfig(dir: string): Promise<string> {
  const configPath = join(dir, CONFIG_FILE_NAME);
  await saveConfig(DEFAULT_CONFIG, configPath);
  return configPath;
}

/** Get a config value by path (e.g., "server.port") */
export function getConfigValue(config: RegistryConfig, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/** Set a config value by path (e.g., "server.port") */
export function setConfigValue(config: RegistryConfig, path: string, value: unknown): void {
  const parts = path.split(".");
  const lastPart = parts.pop();

  if (!lastPart) {
    throw new Error("Invalid config path");
  }

  let current: unknown = config;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      throw new Error(`Invalid config path: ${path}`);
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === null || typeof current !== "object") {
    throw new Error(`Invalid config path: ${path}`);
  }

  (current as Record<string, unknown>)[lastPart] = value;
}

export const configLoader = {
  find: findConfigFile,
  load: loadConfig,
  save: saveConfig,
  createDefault: createDefaultConfig,
  getValue: getConfigValue,
  setValue: setConfigValue,
};

export default configLoader;
