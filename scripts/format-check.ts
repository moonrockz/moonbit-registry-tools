import { spawn } from "node:child_process";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

const extraArgs = process.argv.slice(2);
const formatArgs = ["x", "biome", "format", "--check", ".", ...extraArgs];

try {
  await run("bun", formatArgs);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`format check failed: ${message}`);
  process.exit(1);
}
