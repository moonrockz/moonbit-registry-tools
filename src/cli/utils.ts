/**
 * CLI utility functions
 */

import { resolve } from "node:path";
import logger from "../utils/logger.ts";

/** Format bytes as human-readable size */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/** Parse a duration string (e.g., "1h", "30m") to milliseconds */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/** Resolve a path relative to cwd */
export function resolvePath(path: string): string {
  return resolve(process.cwd(), path);
}

/** Handle CLI errors gracefully */
export function handleError(error: unknown): never {
  if (error instanceof Error) {
    logger.error(error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
  } else {
    logger.error(String(error));
  }
  process.exit(1);
}

/** Print a table of key-value pairs */
export function printTable(data: Record<string, string | number | boolean>): void {
  const maxKeyLength = Math.max(...Object.keys(data).map((k) => k.length));

  for (const [key, value] of Object.entries(data)) {
    const paddedKey = key.padEnd(maxKeyLength);
    console.log(`  ${paddedKey}  ${value}`);
  }
}

/** Confirm an action with the user */
export async function confirm(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);

  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  try {
    const { value } = await reader.read();
    const input = value ? new TextDecoder().decode(value).trim().toLowerCase() : "";
    return input === "y" || input === "yes";
  } finally {
    reader.releaseLock();
  }
}

export default {
  formatBytes,
  parseDuration,
  resolvePath,
  handleError,
  printTable,
  confirm,
};
