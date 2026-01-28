import { spawn } from "node:child_process";
import net from "node:net";
import { join } from "node:path";
import { existsSync } from "node:fs";

const repoRoot = process.cwd();
const docsDir = join(repoRoot, "docs");

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

function toWslPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) {
    return normalized;
  }
  const drive = match[1].toLowerCase();
  const rest = match[2];
  return `/mnt/${drive}/${rest}`;
}

const extraArgs = process.argv.slice(2);
const hasBaseUrlFlag = extraArgs.includes("--baseurl") || extraArgs.includes("-b");
const hasPortFlag = extraArgs.includes("--port") || extraArgs.includes("-P");
const hasLivereloadFlag = extraArgs.includes("--livereload");
const hasLivereloadPortFlag = extraArgs.includes("--livereload-port");
const baseUrl = process.env.DOCS_BASEURL ?? "";

const desiredPort = parsePort(extraArgs) ?? 4000;
const chosenPort = hasPortFlag ? desiredPort : await findAvailablePort(desiredPort);
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

const portArg = chosenPort === 0 ? "" : ` --port ${chosenPort}`;
const baseUrlArg =
  hasBaseUrlFlag || baseUrl.length === 0 ? "" : ` --baseurl ${baseUrl}`;
const extra = extraArgs.length > 0 ? ` ${extraArgs.join(" ")}` : "";
const livereloadArg =
  enableLivereload && !hasLivereloadFlag ? " --livereload" : "";
const livereloadPortArg =
  enableLivereload && !hasLivereloadPortFlag && chosenLivereloadPort !== 0
    ? ` --livereload-port ${chosenLivereloadPort}`
    : "";

const wslDocsDir = toWslPath(docsDir);
const defaultPath =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.rbenv/bin:$HOME/.rbenv/shims:$HOME/.local/bin";
const pathPrefix = process.env.DOCS_WSL_PATH ?? defaultPath;
const configFiles = ["_config.yml"];
if (existsSync(join(docsDir, "_config_local.yml"))) {
  configFiles.push("_config_local.yml");
}
const configArg = ` --config ${configFiles.join(",")}`;

const command = [
  `export PATH="${pathPrefix}"`,
  "hash -r",
  "if ! command -v bundle >/dev/null 2>&1; then",
  '  echo "Bundler not found in WSL. Install Ruby + Bundler, e.g. sudo apt-get install ruby-full && gem install bundler";',
  "  exit 127",
  "fi",
  `cd ${wslDocsDir}`,
  "bundle config set --local path vendor/bundle",
  "bundle install",
  `bundle exec jekyll serve${livereloadArg}${livereloadPortArg} --incremental${configArg}${baseUrlArg}${portArg}${extra}`,
].join("\n");

if (chosenPort === 0) {
  console.warn("No available port found; letting Jekyll choose.");
}

try {
  await run("wsl.exe", ["--", "bash", "-lc", command]);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`docs wsl serve failed: ${message}`);
  process.exit(1);
}
