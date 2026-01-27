/**
 * Logging utility for the MoonBit Registry CLI
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";
let quietMode = false;

/** Set the logging level */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Enable quiet mode (suppresses info and warn) */
export function setQuiet(quiet: boolean): void {
  quietMode = quiet;
}

/** Check if a level should be logged */
function shouldLog(level: LogLevel): boolean {
  if (quietMode && (level === "info" || level === "warn")) {
    return false;
  }
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

/** Format a log message with timestamp */
function formatMessage(level: LogLevel, message: string): string {
  const prefix = {
    debug: "\x1b[90m[DEBUG]\x1b[0m",
    info: "\x1b[34m[INFO]\x1b[0m",
    warn: "\x1b[33m[WARN]\x1b[0m",
    error: "\x1b[31m[ERROR]\x1b[0m",
  };
  return `${prefix[level]} ${message}`;
}

/** Log a debug message */
export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog("debug")) {
    console.log(formatMessage("debug", message), ...args);
  }
}

/** Log an info message */
export function info(message: string, ...args: unknown[]): void {
  if (shouldLog("info")) {
    console.log(formatMessage("info", message), ...args);
  }
}

/** Log a warning message */
export function warn(message: string, ...args: unknown[]): void {
  if (shouldLog("warn")) {
    console.warn(formatMessage("warn", message), ...args);
  }
}

/** Log an error message */
export function error(message: string, ...args: unknown[]): void {
  if (shouldLog("error")) {
    console.error(formatMessage("error", message), ...args);
  }
}

/** Log a success message (always shown unless quiet) */
export function success(message: string, ...args: unknown[]): void {
  if (!quietMode) {
    console.log(`\x1b[32m✓\x1b[0m ${message}`, ...args);
  }
}

/** Log a progress message (same line update) */
export function progress(message: string): void {
  if (!quietMode) {
    process.stdout.write(`\r\x1b[K${message}`);
  }
}

/** Clear the progress line */
export function clearProgress(): void {
  if (!quietMode) {
    process.stdout.write("\r\x1b[K");
  }
}

/** Create a scoped logger */
export function createLogger(scope: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => debug(`[${scope}] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => info(`[${scope}] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => warn(`[${scope}] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => error(`[${scope}] ${msg}`, ...args),
    success: (msg: string, ...args: unknown[]) => success(`[${scope}] ${msg}`, ...args),
  };
}

export const logger = {
  debug,
  info,
  warn,
  error,
  success,
  progress,
  clearProgress,
  setLevel: setLogLevel,
  setQuiet,
  create: createLogger,
};

export default logger;
