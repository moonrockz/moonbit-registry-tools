import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

const repoRoot = process.cwd();
const docsDir = join(repoRoot, "docs");

function run(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
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

function resolveWindowsToolchainEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "win32") {
    return {};
  }

  const candidates: string[] = [];
  const msys2Root = process.env.MSYS2_ROOT;
  if (msys2Root) {
    candidates.push(join(msys2Root, "ucrt64", "bin"), join(msys2Root, "mingw64", "bin"));
  }

  candidates.push("C:\\msys64\\ucrt64\\bin", "C:\\msys64\\mingw64\\bin");

  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    console.warn(
      "MSYS2 not found. Native gem builds may fail. Install MSYS2 and set MSYS2_ROOT to its install path.",
    );
    return {};
  }

  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const currentPath = process.env.PATH ?? "";
  if (currentPath.split(pathDelimiter).includes(found)) {
    return {};
  }

  const existingCflags = process.env.CFLAGS ?? "";
  const extraCflags = "-Wno-incompatible-pointer-types -Wno-error=incompatible-pointer-types";
  const nextCflags = existingCflags.includes(extraCflags)
    ? existingCflags
    : `${existingCflags} ${extraCflags}`.trim();

  return {
    PATH: `${found}${pathDelimiter}${currentPath}`,
    CFLAGS: nextCflags,
    CPPFLAGS: nextCflags,
  };
}

const windowsToolchainEnv = resolveWindowsToolchainEnv();

function runBundle(args: string[], cwd: string): Promise<void> {
  return run("ruby", ["-S", "bundle", ...args], cwd, windowsToolchainEnv);
}

async function configureWindowsBundle(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const cflags = "-Wno-incompatible-pointer-types -Wno-error=incompatible-pointer-types";
  const gems = ["bigdecimal", "http_parser.rb", "json", "eventmachine", "wdm"];
  for (const gem of gems) {
    await runBundle(
      ["config", "set", "--local", `build.${gem}`, `--with-cflags=${cflags}`],
      docsDir,
    );
  }
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
const desiredLivereloadPort = parseLivereloadPort(extraArgs) ?? 35729;
const chosenLivereloadPort = hasLivereloadPortFlag
  ? desiredLivereloadPort
  : await findAvailablePort(desiredLivereloadPort);
let enableLivereload =
  process.env.DOCS_LIVERELOAD !== "false" && !extraArgs.includes("--no-livereload");
if (process.platform === "win32" && process.env.DOCS_LIVERELOAD === undefined) {
  enableLivereload = false;
}

const displayPort = chosenPort === 0 ? "auto" : String(chosenPort);
const displayBase = baseUrl.length > 0 ? baseUrl : "/";
console.log(`Starting docs server on ${displayPort} with baseurl ${displayBase}`);

if (!hasLivereloadPortFlag && chosenLivereloadPort === 0) {
  console.warn("No available livereload port found; disabling livereload.");
  enableLivereload = false;
}

const configFiles = ["_config.yml"];
if (existsSync(join(docsDir, "_config_local.yml"))) {
  configFiles.push("_config_local.yml");
}

const serveArgs = ["exec", "jekyll", "serve", "--incremental", "--config", configFiles.join(",")];

if (!hasBaseUrlFlag) {
  serveArgs.push("--baseurl", baseUrl);
}

if (enableLivereload && !hasLivereloadFlag) {
  serveArgs.push("--livereload");
}

if (enableLivereload && !hasLivereloadPortFlag && chosenLivereloadPort !== 0) {
  serveArgs.push("--livereload-port", String(chosenLivereloadPort));
}

if (!hasPortFlag) {
  if (chosenPort === 0) {
    console.warn("No available port found; letting Jekyll choose.");
  } else {
    serveArgs.push("--port", String(chosenPort));
  }
}

serveArgs.push(...extraArgs);

try {
  await configureWindowsBundle();
  await runBundle(["install"], docsDir);
  await runBundle(serveArgs, docsDir);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`docs serve failed: ${message}`);
  process.exit(1);
}
