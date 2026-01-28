import { spawn } from "node:child_process";

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
const lintArgs = ["x", "biome", "check"];
if (extraArgs.includes("--fix")) {
  lintArgs.push("--fix", "--unsafe");
}
const filteredArgs = extraArgs.filter((arg) => arg !== "--fix");
lintArgs.push(".");
lintArgs.push(...filteredArgs);

try {
  await run("bun", lintArgs);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`lint failed: ${message}`);
  process.exit(1);
}
