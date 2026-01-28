import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

const extraArgs = process.argv.slice(2);
const repoRoot = resolve(process.cwd());
const tmpDir = join(repoRoot, ".tmp");

const formatArgs = ["x", "biome", "format", "--write", ".", ...extraArgs];

try {
  await run("bun", formatArgs);
  if (existsSync(tmpDir)) {
    await run("bun", [
      "x",
      "biome",
      "check",
      "--formatter-enabled",
      "true",
      "--fix",
      "--unsafe",
      tmpDir,
    ]);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`format failed: ${message}`);
  process.exit(1);
}
