/**
 * Tests for toolchain selection and the moonup wrapper
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ToolchainRelease,
  Toolchains,
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

describe.skipIf(process.platform === "win32")("Toolchains", () => {
  let dir: string;
  let moonup: string;
  let log: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "toolchain-test-"));
    log = join(dir, "moonup.log");
    moonup = join(dir, "moonup");
    // A fake moonup: logs its arguments and environment, installs empty toolchains
    await writeFile(
      moonup,
      [
        "#!/bin/sh",
        `echo "$* MOON_HOME=$MOON_HOME MOONUP_HOME=$MOONUP_HOME" >> "${log}"`,
        'if [ "$1" = install ]; then mkdir -p "$MOONUP_HOME/toolchains/$2/bin"; fi',
        'if [ "$1" = run ]; then echo "ran $4 with $2"; echo "PATH=$PATH"; echo "REG=$MOONCAKES_REGISTRY"; cat "$MOON_HOME/config.json" 2>/dev/null || true; fi',
        "",
      ].join("\n"),
    );
    await chmod(moonup, 0o755);
    await writeFile(join(dir, "moonup-shim"), "");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const fetchReleases = (async (url: string | URL | Request) => {
    const href = url.toString();
    if (href.endsWith("/channel-latest.json")) {
      return Response.json({
        releases: [{ version: "0.6.34+e16ca94e6", targets: [moonupTarget()] }],
      });
    }
    if (href.includes("/releases")) {
      return Response.json([
        { tag_name: "v0.6.34+e16ca94e6", published_at: "2025-12-08T16:16:44Z" },
      ]);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

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
    const version = await toolchains.resolve("2025-12-10T10:41:31Z");
    expect(version).toBe("0.6.34+e16ca94e6");
    await toolchains.ensure(version);
    await toolchains.ensure(version);
    const result = await toolchains.run(version, ["package"], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ran package with 0.6.34+e16ca94e6");

    const lines = (await readFile(log, "utf8")).trim().split("\n");
    expect(lines.filter((l) => l.startsWith("install"))).toHaveLength(1);
    expect(lines[0]).toContain(`MOON_HOME=${join(dir, "moon-home")}`);
    expect(lines[0]).toContain(`MOONUP_HOME=${join(dir, "moonup-home")}`);
    expect(lines[1]).toStartWith("run 0.6.34+e16ca94e6 moon package");
  });

  it("should put the toolchain first on PATH and point moon at the registry", async () => {
    const toolchains = new Toolchains({ setting: "0.6.34+e16ca94e6", moonup, workDir: dir });
    const withRegistry = await toolchains.run("0.6.34+e16ca94e6", ["build"], dir, {
      registry: "http://127.0.0.1:8080/",
    });
    const bin = join(dir, "moonup-home", "toolchains", "0.6.34+e16ca94e6", "bin");
    expect(withRegistry.stdout).toContain(`PATH=${bin}:${join(bin, "internal")}:`);
    expect(withRegistry.stdout).toContain("REG=http://127.0.0.1:8080/");
    // The "registry" form of config.json, which old and new moon read
    const config = JSON.parse(await readFile(join(dir, "moon-home", "config.json"), "utf8"));
    expect(config).toEqual({
      registry: "http://127.0.0.1:8080",
      index: "http://127.0.0.1:8080/git/index",
      symbols: "http://127.0.0.1:8080/symbols.zip",
    });

    const without = await toolchains.run("0.6.34+e16ca94e6", ["build"], dir);
    expect(without.stdout).toContain("REG=\n");
    expect(await Bun.file(join(dir, "moon-home", "config.json")).exists()).toBe(false);
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
