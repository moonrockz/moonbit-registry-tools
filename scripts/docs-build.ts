import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

const extraArgs = process.argv.slice(2);

const configFiles = ["_config.yml"];
if (existsSync(join(docsDir, "_config_local.yml"))) {
  configFiles.push("_config_local.yml");
}

const buildArgs = ["exec", "jekyll", "build", "--config", configFiles.join(",")];

buildArgs.push(...extraArgs);

try {
  await configureWindowsBundle();
  await runBundle(["install"], docsDir);
  await runBundle(buildArgs, docsDir);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`docs build failed: ${message}`);
  process.exit(1);
}
