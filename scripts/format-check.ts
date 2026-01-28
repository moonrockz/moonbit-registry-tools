import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
    child.on("error", reject);
  });
}

function hasFiles(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function filterSafeArgs(args: string[]): string[] {
  const safeFlags = new Set([
    "--colors",
    "--use-server",
    "--verbose",
    "--config-path",
    "--max-diagnostics",
    "--skip-errors",
    "--no-errors-on-unmatched",
    "--error-on-warnings",
    "--reporter",
    "--log-level",
    "--log-kind",
    "--diagnostic-level",
  ]);

  const filtered: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const flag = arg.split("=")[0];
    if (safeFlags.has(flag)) {
      filtered.push(arg);
      continue;
    }

    if (safeFlags.has(arg) && i + 1 < args.length) {
      filtered.push(arg, args[i + 1]);
      i += 1;
    }
  }

  return filtered;
}

const extraArgs = process.argv.slice(2);
const repoRoot = resolve(process.cwd());
const tmpDir = join(repoRoot, ".tmp");
const safeArgs = filterSafeArgs(extraArgs);

const formatArgs = [
  "x",
  "biome",
  "check",
  "--formatter-enabled",
  "true",
  "--no-errors-on-unmatched",
  ".",
  ...safeArgs,
];

try {
  const mainCode = await run("bun", formatArgs);
  if (mainCode !== 0) {
    process.exit(mainCode);
  }

  if (existsSync(tmpDir) && hasFiles(tmpDir)) {
    const tmpCode = await run("bun", [
      "x",
      "biome",
      "check",
      "--formatter-enabled",
      "true",
      "--no-errors-on-unmatched",
      tmpDir,
    ]);
    if (tmpCode !== 0) {
      process.exit(tmpCode);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`format check failed: ${message}`);
  process.exit(1);
}
