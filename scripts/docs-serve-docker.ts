import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

const repoRoot = process.cwd();
const docsDir = join(repoRoot, "docs");

function run(cmd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });
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

function parsePort(args: string[]): number | null {
  const portFlagIndex = args.findIndex((arg) => arg === "--port" || arg === "-P");
  if (portFlagIndex !== -1) {
    const next = args[portFlagIndex + 1];
    if (next) {
      const parsed = Number(next);
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
        return parsed;
      }
    }
  }

  if (process.env.DOCS_PORT) {
    const parsed = Number(process.env.DOCS_PORT);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }

  return null;
}

function parseLivereloadPort(args: string[]): number | null {
  const flagIndex = args.findIndex((arg) => arg === "--livereload-port");
  if (flagIndex !== -1) {
    const next = args[flagIndex + 1];
    if (next) {
      const parsed = Number(next);
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
        return parsed;
      }
    }
  }

  if (process.env.DOCS_LIVERELOAD_PORT) {
    const parsed = Number(process.env.DOCS_LIVERELOAD_PORT);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }

  return null;
}

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(start: number, maxAttempts = 20): Promise<number> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = start + i;
    if (await checkPortAvailable(candidate)) {
      return candidate;
    }
  }
  return 0;
}

const extraArgs = process.argv.slice(2);
const hasBaseUrlFlag = extraArgs.includes("--baseurl") || extraArgs.includes("-b");
const hasPortFlag = extraArgs.includes("--port") || extraArgs.includes("-P");
const hasLivereloadFlag = extraArgs.includes("--livereload");
const hasLivereloadPortFlag = extraArgs.includes("--livereload-port");
const baseUrl = process.env.DOCS_BASEURL ?? "";

const desiredPort = parsePort(extraArgs) ?? 4000;
const chosenPort = hasPortFlag ? desiredPort : await findAvailablePort(desiredPort);
const hostPort = chosenPort === 0 ? desiredPort : chosenPort;
const desiredLivereloadPort = parseLivereloadPort(extraArgs) ?? 35729;
const chosenLivereloadPort = hasLivereloadPortFlag
  ? desiredLivereloadPort
  : await findAvailablePort(desiredLivereloadPort);
let enableLivereload =
  process.env.DOCS_LIVERELOAD !== "false" && !extraArgs.includes("--no-livereload");

if (!hasLivereloadPortFlag && chosenLivereloadPort === 0) {
  console.warn("No available livereload port found; disabling livereload.");
  enableLivereload = false;
}

const configFiles = ["_config.yml"];
if (existsSync(join(docsDir, "_config_local.yml"))) {
  configFiles.push("_config_local.yml");
}

const dockerArgs = ["run", "--rm", "-p", `${hostPort}:4000`];

if (enableLivereload && chosenLivereloadPort !== 0) {
  dockerArgs.push("-p", `${chosenLivereloadPort}:${chosenLivereloadPort}`);
}

dockerArgs.push(
  "-v",
  `${docsDir}:/srv/jekyll`,
  "-v",
  `${docsDir}/.bundle:/usr/local/bundle`,
  "jekyll/jekyll:4.4",
  "jekyll",
  "serve",
  "--incremental",
  "--host",
  "0.0.0.0",
  "--config",
  configFiles.join(","),
  "--port",
  "4000",
);

if (!hasBaseUrlFlag) {
  dockerArgs.push("--baseurl", baseUrl);
}

if (enableLivereload && !hasLivereloadFlag) {
  dockerArgs.push("--livereload");
}

if (enableLivereload && !hasLivereloadPortFlag && chosenLivereloadPort !== 0) {
  dockerArgs.push("--livereload-port", String(chosenLivereloadPort));
}

if (chosenPort === 0) {
  console.warn("No available port found; using default 4000.");
}

if (extraArgs.length > 0) {
  dockerArgs.push("--", ...extraArgs);
}

try {
  await run("docker", ["info"]);
  await run("docker", dockerArgs);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("docker exited with code 1")) {
    console.error(
      "docs docker serve failed: Docker daemon not reachable. Start Docker Desktop and ensure the Linux engine is running.",
    );
  } else {
    console.error(`docs docker serve failed: ${message}`);
  }
  process.exit(1);
}
