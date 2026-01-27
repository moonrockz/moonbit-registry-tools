/**
 * Configuration schema and validation
 */

import type { RegistryConfig } from "../core/types.ts";
import { DEFAULT_CONFIG } from "../core/types.ts";

/** Validation error */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public field: string,
  ) {
    super(`Configuration error in '${field}': ${message}`);
    this.name = "ConfigValidationError";
  }
}

/** Validate a string field */
function validateString(value: unknown, field: string, required = false): string {
  if (value === undefined || value === null) {
    if (required) {
      throw new ConfigValidationError("Field is required", field);
    }
    return "";
  }
  if (typeof value !== "string") {
    throw new ConfigValidationError("Must be a string", field);
  }
  return value;
}

/** Validate a number field */
function validateNumber(value: unknown, field: string, min?: number, max?: number): number {
  if (typeof value !== "number") {
    throw new ConfigValidationError("Must be a number", field);
  }
  if (min !== undefined && value < min) {
    throw new ConfigValidationError(`Must be at least ${min}`, field);
  }
  if (max !== undefined && value > max) {
    throw new ConfigValidationError(`Must be at most ${max}`, field);
  }
  return value;
}

/** Validate a boolean field */
function validateBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigValidationError("Must be a boolean", field);
  }
  return value;
}

/** Validate an array of strings */
function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigValidationError("Must be an array", field);
  }
  return value.map((item, i) => {
    if (typeof item !== "string") {
      throw new ConfigValidationError(`Item at index ${i} must be a string`, field);
    }
    return item;
  });
}

/** Deep clone an object */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    result[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return result as T;
}

/** Deep merge two objects (target is deep cloned first to avoid mutation) */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = deepClone(target);
  for (const key in source) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (sourceVal !== undefined) {
      (result as Record<string, unknown>)[key] = sourceVal;
    }
  }
  return result;
}

/** Validate and normalize a registry configuration */
export function validateConfig(raw: unknown): RegistryConfig {
  if (!raw || typeof raw !== "object") {
    throw new ConfigValidationError("Configuration must be an object", "root");
  }

  const config = raw as Record<string, unknown>;

  // Start with defaults
  const result = deepMerge(DEFAULT_CONFIG, {});

  // Validate registry section
  if (config.registry && typeof config.registry === "object") {
    const registry = config.registry as Record<string, unknown>;
    if (registry.name !== undefined) {
      result.registry.name = validateString(registry.name, "registry.name", true);
    }
    if (registry.data_dir !== undefined) {
      result.registry.data_dir = validateString(registry.data_dir, "registry.data_dir", true);
    }
  }

  // Validate upstream section
  if (config.upstream && typeof config.upstream === "object") {
    const upstream = config.upstream as Record<string, unknown>;
    if (upstream.enabled !== undefined) {
      result.upstream.enabled = validateBoolean(upstream.enabled, "upstream.enabled");
    }
    if (upstream.url !== undefined) {
      result.upstream.url = validateString(upstream.url, "upstream.url");
    }
    if (upstream.index_url !== undefined) {
      result.upstream.index_url = validateString(upstream.index_url, "upstream.index_url");
    }
  }

  // Validate mirror section
  if (config.mirror && typeof config.mirror === "object") {
    const mirror = config.mirror as Record<string, unknown>;
    if (mirror.auto_sync !== undefined) {
      result.mirror.auto_sync = validateBoolean(mirror.auto_sync, "mirror.auto_sync");
    }
    if (mirror.sync_interval !== undefined) {
      result.mirror.sync_interval = validateString(mirror.sync_interval, "mirror.sync_interval");
    }
    if (mirror.packages !== undefined) {
      result.mirror.packages = validateStringArray(mirror.packages, "mirror.packages");
    }
  }

  // Validate server section
  if (config.server && typeof config.server === "object") {
    const server = config.server as Record<string, unknown>;
    if (server.host !== undefined) {
      result.server.host = validateString(server.host, "server.host");
    }
    if (server.port !== undefined) {
      result.server.port = validateNumber(server.port, "server.port", 1, 65535);
    }
    if (server.base_url !== undefined) {
      result.server.base_url = validateString(server.base_url, "server.base_url");
    }
  }

  // Validate git section
  if (config.git && typeof config.git === "object") {
    const git = config.git as Record<string, unknown>;
    if (git.remote_url !== undefined) {
      result.git.remote_url = validateString(git.remote_url, "git.remote_url");
    }
    if (git.branch !== undefined) {
      result.git.branch = validateString(git.branch, "git.branch");
    }
    if (git.auto_push !== undefined) {
      result.git.auto_push = validateBoolean(git.auto_push, "git.auto_push");
    }
  }

  return result;
}

export default { validateConfig, ConfigValidationError };
