/**
 * Tests for toolchain selection and the moonup wrapper
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ToolchainRefused,
  type ToolchainRelease,
  Toolchains,
  childEnvironment,
  mergeReleases,
  moonupTarget,
  selectToolchain,
} from "../../src/core/toolchain.ts";

const RELEASES: ToolchainRelease[] = [
  { version: "0.6.33+b989ba000", date: "2025-12-02T08:17:04Z" },
  { version: "0.6.35+42fc098f3", date: "2025-12-15T16:16:47Z" },
  { version: "0.6.34+e16ca94e6", date: "2025-12-08T16:16:44Z" },
  { version: "0.1.20240704+647946c28", date: "2024-07-10T02:49:43Z" },
];

describe("selectToolchain", () => {
  it("should pick the newest toolchain released before the publish time", () => {
    expect(selectToolchain("2025-12-10T10:41:31.083741+00:00", RELEASES)).toBe("0.6.34+e16ca94e6");
    expect(selectToolchain("2025-12-08T16:16:45Z", RELEASES)).toBe("0.6.34+e16ca94e6");
    expect(selectToolchain("2026-10-20T02:22:42Z", RELEASES)).toBe("0.6.35+42fc098f3");
  });

  it("should not pick a toolchain released at or after the publish time", () => {
    expect(selectToolchain("2025-12-08T16:16:44Z", RELEASES)).toBe("0.6.33+b989ba000");
  });

  it("should give null before the first release or for a bad date", () => {
    expect(selectToolchain("2024-01-01T00:00:00Z", RELEASES)).toBeNull();
    expect(selectToolchain("not a date", RELEASES)).toBeNull();
    expect(selectToolchain("2025-12-10T00:00:00Z", [])).toBeNull();
  });
});

describe("mergeReleases", () => {
  const channel = {
    version: 3,
    releases: [
      {
        version: "0.1.20240704+647946c28",
        targets: ["aarch64-apple-darwin", "x86_64-unknown-linux"],
      },
      { version: "0.1.20240723+155a870f3", targets: ["aarch64-apple-darwin"] },
      { version: "0.6.34+e16ca94e6", targets: ["aarch64-apple-darwin", "x86_64-unknown-linux"] },
      { version: "0.6.35+42fc098f3", targets: ["x86_64-unknown-linux"] },
      { version: "0.6.36+nodate", targets: ["aarch64-apple-darwin"] },
    ],
  };
  const github = [
    { tag_name: "v0.6.34+e16ca94e6", published_at: "2025-12-08T16:16:44Z" },
    { tag_name: "v0.6.35+42fc098f3", published_at: "2025-12-15T16:16:47Z" },
    { tag_name: "v0.1.20240704+647946c28", published_at: "2024-07-10T02:49:43Z" },
  ];

  it("should keep installable versions of the target, with dates", () => {
    expect(mergeReleases(channel, github, "aarch64-apple-darwin")).toEqual([
      { version: "0.1.20240704+647946c28", date: "2024-07-10T02:49:43Z" },
      // No GitHub release: the date comes from the version
      { version: "0.1.20240723+155a870f3", date: "2024-07-23T00:00:00Z" },
      { version: "0.6.34+e16ca94e6", date: "2025-12-08T16:16:44Z" },
    ]);
    expect(mergeReleases(channel, github, "x86_64-unknown-linux").map((r) => r.version)).toEqual([
      "0.1.20240704+647946c28",
      "0.6.34+e16ca94e6",
      "0.6.35+42fc098f3",
    ]);
  });
});

describe("moonupTarget", () => {
  it("should map platforms to moonup targets", () => {
    expect(moonupTarget("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(moonupTarget("darwin", "x64")).toBe("x86_64-apple-darwin");
    expect(moonupTarget("linux", "x64")).toBe("x86_64-unknown-linux");
    expect(moonupTarget("win32", "x64")).toBe("x86_64-pc-windows");
    expect(moonupTarget("freebsd", "x64")).toBeNull();
  });
});

describe("childEnvironment", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/proxy",
    LANG: "C.UTF-8",
    GITHUB_TOKEN: "ghp_secret",
    AWS_SECRET_ACCESS_KEY: "aws_secret",
    MOONUP_TOOLCHAIN_SPEC: "latest",
    MOON_CORE_OVERRIDE: "/elsewhere",
  };

  it("should keep only allowed variables and add the hook switches", () => {
    const env = childEnvironment(
      { path: "/tc/bin:/usr/bin", home: "/work/home", MOON_HOME: "/work/home" },
      source,
      "linux",
    );
    expect(env).toEqual({
      LANG: "C.UTF-8",
      PATH: "/tc/bin:/usr/bin",
      HOME: "/work/home",
      MOON_HOME: "/work/home",
      MOON_IGNORE_PREBUILD: "1",
      MOON_IGNORE_POSTADD: "1",
    });
  });

  it("should keep the Windows basics, in any case, and set USERPROFILE", () => {
    const env = childEnvironment(
      { path: "C:\\tc\\bin", home: "C:\\work\\home" },
      { ...source, SYSTEMROOT: "C:\\Windows", Pathext: ".EXE" },
      "win32",
    );
    expect(env.SystemRoot).toBe("C:\\Windows");
    expect(env.PATHEXT).toBe(".EXE");
    expect(env.USERPROFILE).toBe("C:\\work\\home");
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe.skipIf(process.platform === "win32")("Toolchains", () => {
  let dir: string;
  let moonup: string;
  let log: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "toolchain-test-"));
    log = join(dir, "moonup.log");
    moonup = join(dir, "moonup");
    // A fake moonup: logs its arguments, saves its environment, installs
    // toolchains with a fake moon. A version with "nohooks" in its name gets
    // a moon that does not read MOON_IGNORE_PREBUILD.
    await writeFile(
      moonup,
      [
        "#!/bin/sh",
        `echo "$* MOON_HOME=$MOON_HOME MOONUP_HOME=$MOONUP_HOME" >> "${log}"`,
        `env > "${dir}/env-$1.txt"`,
        'if [ "$1" = install ]; then',
        `  echo "start $2" >> "${dir}/installs.log"; sleep 0.2`,
        '  mkdir -p "$MOONUP_HOME/toolchains/$2/bin"',
        '  case "$2" in',
        '    *nohooks*) echo "#!/bin/sh" > "$MOONUP_HOME/toolchains/$2/bin/moon" ;;',
        '    *) echo "# reads MOON_IGNORE_PREBUILD and MOON_IGNORE_POSTADD" > "$MOONUP_HOME/toolchains/$2/bin/moon" ;;',
        "  esac",
        `  echo "end $2" >> "${dir}/installs.log"`,
        "fi",
        'if [ "$1" = run ]; then echo "ran $4 with $2"; echo "PATH=$PATH"; echo "REG=$MOONCAKES_REGISTRY"; cat "$MOON_HOME/config.json" 2>/dev/null || true; fi',
        "",
      ].join("\n"),
    );
    await chmod(moonup, 0o755);
    await writeFile(join(dir, "moonup-shim"), "");
    for (const name of ["GITHUB_TOKEN", "FALLBACK_TEST_SECRET"]) saved[name] = process.env[name];
    process.env.GITHUB_TOKEN = "ghp_secret_for_test";
    process.env.FALLBACK_TEST_SECRET = "s3cr3t";
  });
  afterEach(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  const releasesFetch = (releases: ToolchainRelease[]) =>
    (async (url: string | URL | Request) => {
      const href = url.toString();
      if (href.endsWith("/channel-latest.json")) {
        return Response.json({
          releases: releases.map((r) => ({ version: r.version, targets: [moonupTarget()] })),
        });
      }
      if (href.includes("/releases")) {
        return Response.json(
          releases.map((r) => ({ tag_name: `v${r.version}`, published_at: r.date })),
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  const fetchReleases = releasesFetch([
    { version: "0.6.34+e16ca94e6", date: "2025-12-08T16:16:44Z" },
  ]);

  /** The environment that the fake moonup saved for a command */
  const savedEnv = async (command: string) => {
    const text = await readFile(join(dir, `env-${command}.txt`), "utf8");
    return new Map(
      text
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  };

  it("should report a missing moonup unless the toolchain is current", async () => {
    const missing = new Toolchains({ setting: "auto", moonup: join(dir, "nope"), workDir: dir });
    expect(await missing.check()).toMatch(/moonup/);
    const current = new Toolchains({ setting: "current", moonup: join(dir, "nope"), workDir: dir });
    if (Bun.which("moon")) expect(await current.check()).toBeNull();
    expect(await new Toolchains({ setting: "auto", moonup, workDir: dir }).check()).toBeNull();
  });

  it("should install the selected toolchain once and run moon with it", async () => {
    const toolchains = new Toolchains({
      setting: "auto",
      moonup,
      workDir: dir,
      fetch: fetchReleases,
    });
    const version = await toolchains.prepare("2025-12-10T10:41:31Z");
    expect(version).toBe("0.6.34+e16ca94e6");
    await toolchains.ensure(version);
    const home = join(dir, "run-home");
    const result = await toolchains.run(version, ["package"], dir, { home });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ran package with 0.6.34+e16ca94e6");

    const lines = (await readFile(log, "utf8")).trim().split("\n");
    expect(lines.filter((l) => l.startsWith("install"))).toHaveLength(1);
    expect(lines[0]).toContain(`MOON_HOME=${join(dir, "moon-home")}`);
    expect(lines[0]).toContain(`MOONUP_HOME=${join(dir, "moonup-home")}`);
    expect(lines[1]).toStartWith("run 0.6.34+e16ca94e6 moon package");
    // Each run has the MOON_HOME that the caller gives
    expect(lines[1]).toContain(`MOON_HOME=${home} `);
  });

  it("should put the toolchain first on PATH and point moon at the registry", async () => {
    const toolchains = new Toolchains({ setting: "0.6.34+e16ca94e6", moonup, workDir: dir });
    const home = join(dir, "run-home");
    const withRegistry = await toolchains.run("0.6.34+e16ca94e6", ["build"], dir, {
      home,
      registry: "http://127.0.0.1:8080/",
    });
    const bin = join(dir, "moonup-home", "toolchains", "0.6.34+e16ca94e6", "bin");
    expect(withRegistry.stdout).toContain(`PATH=${bin}:${join(bin, "internal")}:`);
    expect(withRegistry.stdout).toContain("REG=http://127.0.0.1:8080/");
    // The "registry" form of config.json, which old and new moon read
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    expect(config).toEqual({
      registry: "http://127.0.0.1:8080",
      index: "http://127.0.0.1:8080/git/index",
      symbols: "http://127.0.0.1:8080/symbols.zip",
    });

    const without = await toolchains.run("0.6.34+e16ca94e6", ["build"], dir, { home });
    expect(without.stdout).toContain("REG=\n");
    expect(await Bun.file(join(home, "config.json")).exists()).toBe(false);
  });

  it("should give children the hook switches and none of the proxy's secrets", async () => {
    const toolchains = new Toolchains({ setting: "0.6.34+e16ca94e6", moonup, workDir: dir });
    const version = await toolchains.prepare(undefined);
    const home = join(dir, "run-home");
    await toolchains.run(version, ["build"], dir, { home, registry: "http://127.0.0.1:8080" });
    // A toolchain tool saves its environment too
    const tool = join(toolchains.binDir(version), "moon-wasm-opt");
    await writeFile(tool, `#!/bin/sh\nenv > "${dir}/env-tool.txt"\n`);
    await chmod(tool, 0o755);
    expect((await toolchains.runTool(version, "moon-wasm-opt", [], dir))?.exitCode).toBe(0);

    for (const command of ["install", "run", "tool"]) {
      const env = await savedEnv(command);
      expect(env.get("MOON_IGNORE_PREBUILD")).toBe("1");
      expect(env.get("MOON_IGNORE_POSTADD")).toBe("1");
      expect(env.has("GITHUB_TOKEN")).toBe(false);
      expect(env.has("FALLBACK_TEST_SECRET")).toBe(false);
      expect(env.get("HOME")).toStartWith(dir);
    }
    const run = await savedEnv("run");
    expect(run.get("MOON_HOME")).toBe(home);
    expect(run.get("HOME")).toBe(home);
    expect(run.get("MOONCAKES_REGISTRY")).toBe("http://127.0.0.1:8080");
  });

  it("should refuse a toolchain released before MOON_IGNORE_PREBUILD, without installing it", async () => {
    const fixed = new Toolchains({ setting: "0.1.20250522+2b70d2531", moonup, workDir: dir });
    const refused = fixed.prepare(undefined);
    await expect(refused).rejects.toBeInstanceOf(ToolchainRefused);
    await expect(refused).rejects.toThrow(/2025-05-22, before 2025-05-29.*MOON_IGNORE_PREBUILD/);

    const auto = new Toolchains({
      setting: "auto",
      moonup,
      workDir: join(dir, "auto"),
      fetch: releasesFetch([
        { version: "0.1.20250522+2b70d2531", date: "2025-05-22T16:16:03Z" },
        { version: "0.1.20250529+8a98c8e02", date: "2025-05-29T16:15:45Z" },
        { version: "0.6.20", date: "2025-07-09T08:16:27Z" },
      ]),
    });
    await expect(auto.prepare("2025-05-25T00:00:00Z")).rejects.toThrow(/before 2025-05-29/);
    expect(await Bun.file(log).exists()).toBe(false);

    // The first toolchain with the switch, and a later one without a date in its name
    expect(await auto.prepare("2025-06-01T00:00:00Z")).toBe("0.1.20250529+8a98c8e02");
    expect(await auto.prepare("2025-08-01T00:00:00Z")).toBe("0.6.20");
  });

  it("should refuse a toolchain whose moon does not read MOON_IGNORE_PREBUILD", async () => {
    const toolchains = new Toolchains({ setting: "0.6.99+nohooks", moonup, workDir: dir });
    await expect(toolchains.prepare(undefined)).rejects.toThrow(
      /does not read MOON_IGNORE_PREBUILD/,
    );
  });

  it("should run moonup installs one at a time", async () => {
    const toolchains = new Toolchains({ setting: "auto", moonup, workDir: dir });
    await Promise.all([
      toolchains.ensure("0.6.33+b989ba000"),
      toolchains.ensure("0.6.34+e16ca94e6"),
      toolchains.ensure("0.6.33+b989ba000"),
    ]);
    const events = (await readFile(join(dir, "installs.log"), "utf8")).trim().split("\n");
    expect(events).toEqual([
      "start 0.6.33+b989ba000",
      "end 0.6.33+b989ba000",
      "start 0.6.34+e16ca94e6",
      "end 0.6.34+e16ca94e6",
    ]);
  });

  it("should use a fixed version without the release list", async () => {
    const toolchains = new Toolchains({
      setting: "v0.6.33+b989ba000",
      moonup,
      workDir: dir,
      fetch: (() => {
        throw new Error("no network");
      }) as unknown as typeof fetch,
    });
    expect(await toolchains.resolve("2026-01-01T00:00:00Z")).toBe("0.6.33+b989ba000");
    expect(await toolchains.prepare("2026-01-01T00:00:00Z")).toBe("0.6.33+b989ba000");
  });

  it("should fail when no toolchain is older than the publish time", async () => {
    const toolchains = new Toolchains({
      setting: "auto",
      moonup,
      workDir: dir,
      fetch: fetchReleases,
    });
    await expect(toolchains.resolve("2020-01-01T00:00:00Z")).rejects.toThrow(/No toolchain/);
    await expect(toolchains.resolve(undefined)).rejects.toThrow(/publish time/);
  });
});
