/**
 * Fallback builds must not run the hooks of the code they build: a module
 * whose `pre-build` and `postadd` write a marker file (and whose pre-build
 * reads a secret from the environment) is built with the real moon, when it
 * is installed. A control run without MOON_IGNORE_PREBUILD shows that the
 * hook is real.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { findBuildHooks } from "../../src/core/build-hooks.ts";
import { Registry } from "../../src/core/registry.ts";
import logger from "../../src/utils/logger.ts";
import { listZipEntries } from "../../src/utils/zip.ts";

const SECRET = "FALLBACK_HOOK_SECRET";

/** Write a module whose hooks write marker files at absolute paths */
async function writeHookModule(dir: string, markers: { prebuild: string; postadd: string }) {
  await mkdir(join(dir, "cmd", "main"), { recursive: true });
  const quote = (value: string) => JSON.stringify(value);
  await writeFile(
    join(dir, "moon.mod"),
    [
      'name = "alice/hooks"',
      "",
      'version = "0.1.0"',
      "",
      "options(",
      `  scripts: { "postadd": ${quote(`sh -c 'echo postadd > ${markers.postadd}'`)} },`,
      ")",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "cmd", "main", "moon.pkg"),
    [
      "options(",
      '  "is-main": true,',
      '  "pre-build": [',
      "    {",
      '      "input": "input.txt",',
      '      "output": "generated.txt",',
      `      "command": ${quote(`sh -c 'echo "secret=$${SECRET}" > ${markers.prebuild}; cp $input $output'`)},`,
      "    },",
      "  ],",
      ")",
      "",
    ].join("\n"),
  );
  await writeFile(join(dir, "cmd", "main", "input.txt"), "hello\n");
  await writeFile(join(dir, "cmd", "main", "main.mbt"), 'fn main {\n  println("hooks")\n}\n');
}

describe("findBuildHooks", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "build-hooks-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should find pre-build and postadd in moon.mod, moon.pkg and their JSON forms", async () => {
    await writeHookModule(dir, { prebuild: "/x", postadd: "/y" });
    await mkdir(join(dir, "old"), { recursive: true });
    await writeFile(join(dir, "old", "moon.pkg.json"), '{ "pre-build": [] }');
    await writeFile(join(dir, "old", "moon.mod.json"), '{ "scripts": { "postadd": "x" } }');
    // The rule form of moon.pkg, as in moonbitlang/x@0.5.6
    await mkdir(join(dir, "time"), { recursive: true });
    await writeFile(
      join(dir, "time", "moon.pkg"),
      'rule(\n  name: "embed",\n  command: ":embed -i $input -o $output",\n)\n\n' +
        'dev_build(\n  rule: "embed",\n  input: "a.tzif",\n  output: "a_wbtest.mbt",\n)\n',
    );
    // Build output is not source
    await mkdir(join(dir, "_build"), { recursive: true });
    await writeFile(join(dir, "_build", "moon.pkg.json"), '{ "pre-build": [] }');
    expect(await findBuildHooks(dir)).toEqual([
      "cmd/main/moon.pkg: pre-build",
      "moon.mod: postadd",
      "old/moon.mod.json: postadd",
      "old/moon.pkg.json: pre-build",
      "time/moon.pkg: pre-build",
    ]);
  });

  it("should find nothing in a module without hooks", async () => {
    await writeFile(join(dir, "moon.mod"), 'name = "alice/plain"\n');
    await writeFile(join(dir, "moon.pkg"), 'options(\n  "is-main": true,\n)\n');
    expect(await findBuildHooks(dir)).toEqual([]);
  });
});

const userMoon = join(process.env.MOON_HOME ?? join(homedir(), ".moon"), "bin", "moon");
const hasMoon =
  process.platform !== "win32" &&
  existsSync(userMoon) &&
  (await Bun.file(userMoon).text()).includes("MOON_IGNORE_PREBUILD");

describe.skipIf(!hasMoon)("Fallback builds with the real moon", () => {
  let dir: string;
  let markers: { prebuild: string; postadd: string };
  let warnings: string[];
  let saved: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fallback-hooks-"));
    markers = { prebuild: join(dir, "prebuild-marker"), postadd: join(dir, "postadd-marker") };
    saved = process.env[SECRET];
    process.env[SECRET] = "s3cr3t";
    warnings = [];
    spyOn(logger, "warn").mockImplementation((message: string) => {
      warnings.push(message);
    });
    spyOn(logger, "info").mockImplementation(() => {});
  });
  afterEach(async () => {
    (logger.warn as unknown as { mockRestore(): void }).mockRestore();
    (logger.info as unknown as { mockRestore(): void }).mockRestore();
    if (saved === undefined) delete process.env[SECRET];
    else process.env[SECRET] = saved;
    await rm(dir, { recursive: true, force: true });
  });

  async function fallbacks() {
    const registry = await Registry.init(join(dir, "registry"));
    registry.config.proxy = {
      enabled: true,
      index_refresh_interval: "10m",
      symbols_max_age: "1d",
      fallback: { github: true, build_wasm: true, toolchain: "current" },
    };
    const result = registry.proxy.fallbacks;
    // No registry runs here: moon update fails at once, and the module has no dependencies
    result.selfUrl = "http://127.0.0.1:9";
    return result;
  }

  it("control: moon runs the pre-build, with the secret, without MOON_IGNORE_PREBUILD", async () => {
    const module = join(dir, "control");
    await writeHookModule(module, markers);
    const proc = Bun.spawn([userMoon, "check"], {
      cwd: module,
      env: { ...process.env, MOON_HOME: join(dir, "control-home") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
    expect(await Bun.file(markers.prebuild).text()).toBe("secret=s3cr3t\n");
  });

  it("should package and build the module without running its hooks", async () => {
    const module = join(dir, "module");
    await writeHookModule(module, markers);
    const fb = await fallbacks();

    const zip = await fb.packageModule(module, undefined);
    expect(listZipEntries(zip).map((e) => e.name)).toContain("cmd/main/main.mbt");
    expect(existsSync(join(module, "cmd", "main", "generated.txt"))).toBe(false);

    const built = await fb.buildWasm(
      {
        owner: "alice",
        name: "hooks",
        version: "0.1.0",
        packagePath: ["cmd", "main"],
        file: "main.wasm",
      },
      zip,
      undefined,
    );
    expect(Array.from(built.wasm.slice(0, 4))).toEqual([0, 0x61, 0x73, 0x6d]);

    expect(existsSync(markers.prebuild)).toBe(false);
    expect(existsSync(markers.postadd)).toBe(false);
    expect(
      warnings.some(
        (w) =>
          w.includes("alice/hooks@0.1.0 declares hooks that the build ignores") &&
          w.includes("cmd/main/moon.pkg: pre-build") &&
          w.includes("moon.mod: postadd"),
      ),
    ).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("Fallback builds with a fake moon", () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fallback-fake-moon-"));
    for (const name of ["MOON_HOME", "GITHUB_TOKEN", SECRET]) saved[name] = process.env[name];
    process.env.GITHUB_TOKEN = "ghp_secret_for_test";
    process.env[SECRET] = "s3cr3t";
    // The "current" toolchain is $MOON_HOME/bin/moon. This moon saves its
    // environment and, like moon, runs the pre-build unless it is told not to.
    const userHome = join(dir, "user-moon-home");
    process.env.MOON_HOME = userHome;
    await mkdir(join(userHome, "bin"), { recursive: true });
    const moon = join(userHome, "bin", "moon");
    await writeFile(
      moon,
      [
        "#!/bin/sh",
        "# reads MOON_IGNORE_PREBUILD and MOON_IGNORE_POSTADD",
        `env > "${dir}/env-$1.txt"`,
        `if [ -z "$MOON_IGNORE_PREBUILD" ]; then echo "secret=$${SECRET}" > "${dir}/prebuild-marker"; fi`,
        'if [ "$1" = package ]; then mkdir -p _build/publish; echo zip > _build/publish/alice-hooks-0.1.0.zip; fi',
        "",
      ].join("\n"),
    );
    await Bun.spawn(["chmod", "755", moon]).exited;
    spyOn(logger, "warn").mockImplementation(() => {});
    spyOn(logger, "info").mockImplementation(() => {});
  });
  afterEach(async () => {
    (logger.warn as unknown as { mockRestore(): void }).mockRestore();
    (logger.info as unknown as { mockRestore(): void }).mockRestore();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("should give moon the hook switches and none of the proxy's secrets", async () => {
    const module = join(dir, "module");
    await writeHookModule(module, { prebuild: join(dir, "x"), postadd: join(dir, "y") });
    const registry = await Registry.init(join(dir, "registry"));
    registry.config.proxy = {
      enabled: true,
      index_refresh_interval: "10m",
      symbols_max_age: "1d",
      fallback: { github: true, toolchain: "current" },
    };
    const fb = registry.proxy.fallbacks;
    fb.selfUrl = "http://127.0.0.1:9";
    const zip = await fb.packageModule(module, undefined);
    expect(new TextDecoder().decode(zip)).toBe("zip\n");

    expect(existsSync(join(dir, "prebuild-marker"))).toBe(false);
    for (const command of ["update", "package"]) {
      const env = await Bun.file(join(dir, `env-${command}.txt`)).text();
      expect(env).toContain("MOON_IGNORE_PREBUILD=1\n");
      expect(env).toContain("MOON_IGNORE_POSTADD=1\n");
      expect(env).not.toContain("GITHUB_TOKEN");
      expect(env).not.toContain(SECRET);
      expect(env).toContain("MOONCAKES_REGISTRY=http://127.0.0.1:9\n");
    }
  });
});
