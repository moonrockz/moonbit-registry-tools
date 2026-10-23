/**
 * Tests for Registry.mirror against a local fake upstream
 *
 * The fake upstream copies the layout of mooncakes.io: a git index with
 * `user/<owner>/<pkg>.index` JSONL files and package zips at
 * `/user/<owner>/<pkg>/<version>.zip`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { $ } from "bun";
import { Registry } from "../../src/core/registry.ts";
import { sha256 } from "../../src/utils/crypto.ts";

const BASE_ZIPS: Record<string, string> = {
  "alice/app/1.0.0": "app 1.0.0",
  "alice/app/1.1.0": "app 1.1.0 (yanked)",
  "bob/dep/0.1.0": "dep 0.1.0",
};

describe("Registry.mirror", () => {
  let ZIPS: Record<string, string>;
  let tempDir: string;
  let upstreamIndex: string;
  let server: Server<undefined>;
  let appIndex: string;
  let depIndex: string;

  beforeEach(async () => {
    ZIPS = { ...BASE_ZIPS };
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-mirror-test-"));
    upstreamIndex = join(tempDir, "upstream-index");

    server = Bun.serve({
      port: 0,
      fetch(request) {
        const match = new URL(request.url).pathname.match(/^\/user\/(.+)\.zip$/);
        const body = match ? ZIPS[match[1]] : undefined;
        return body ? new Response(body) : new Response("Not found", { status: 404 });
      },
    });

    // Index lines keep the extra fields that mooncakes.io writes today.
    appIndex = [
      {
        name: "alice/app",
        version: "1.0.0",
        checksum: sha256(ZIPS["alice/app/1.0.0"]),
        deps: { "bob/dep": "0.1.0" },
        yanked: false,
        yanked_reason: null,
        created_at: "2026-01-01T00:00:00+00:00",
        "preferred-target": "js",
      },
      {
        name: "alice/app",
        version: "1.1.0",
        checksum: sha256(ZIPS["alice/app/1.1.0"]),
        deps: { "bob/dep": "0.1.0" },
        yanked: true,
        yanked_reason: "Use alice/app2 instead.",
        created_at: "2026-02-01T00:00:00+00:00",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n")
      .concat("\n");
    depIndex = `${JSON.stringify({
      name: "bob/dep",
      version: "0.1.0",
      checksum: sha256(ZIPS["bob/dep/0.1.0"]),
    })}\n`;

    await mkdir(join(upstreamIndex, "user", "alice"), { recursive: true });
    await mkdir(join(upstreamIndex, "user", "bob"), { recursive: true });
    await writeFile(join(upstreamIndex, "user", "alice", "app.index"), appIndex);
    await writeFile(join(upstreamIndex, "user", "bob", "dep.index"), depIndex);
    await $`git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm init`
      .cwd(upstreamIndex)
      .quiet();
  });

  afterEach(async () => {
    server.stop(true);
    await rm(tempDir, { recursive: true, force: true });
  });

  async function initRegistry(): Promise<Registry> {
    const registry = await Registry.init(join(tempDir, "registry"));
    registry.addSource({
      name: "fake",
      type: "custom",
      url: `http://localhost:${server.port}`,
      index_url: upstreamIndex,
      index_type: "git",
      package_url_pattern: "${url}/user/${username}/${name}/${version}.zip",
      enabled: true,
    });
    registry.setDefaultSource("fake");
    return registry;
  }

  const options = { patterns: ["alice/app"], full: false, strict: false, quiet: true };

  it("should publish mirrored packages in the moon index layout", async () => {
    const registry = await initRegistry();
    await registry.mirror(options);

    const indexDir = registry.indexManager.path;
    const appPath = join(indexDir, "user", "alice", "app.index");
    const depPath = join(indexDir, "user", "bob", "dep.index");

    // moon reads `user/<owner>/<pkg>.index`; keep every upstream field
    expect(await readFile(appPath, "utf-8")).toBe(appIndex);
    expect(await readFile(depPath, "utf-8")).toBe(depIndex);
  });

  it("should commit the published index so git clients can fetch it", async () => {
    const registry = await initRegistry();
    await registry.mirror(options);

    const indexDir = registry.indexManager.path;
    const files = await $`git ls-files`.cwd(indexDir).text();
    expect(files.split("\n")).toContain("user/alice/app.index");
    expect(files).not.toContain("sources/");

    const status = await $`git status --porcelain`.cwd(indexDir).text();
    expect(status.trim()).toBe("");

    // Dumb HTTP clients need the server info files
    expect(existsSync(join(indexDir, ".git", "info", "refs"))).toBe(true);
  });

  it("should download yanked versions because moon can still select them", async () => {
    const registry = await initRegistry();
    await registry.mirror(options);

    expect(registry.packageStore.hasPackage("alice", "app", "1.0.0")).toBe(true);
    expect(registry.packageStore.hasPackage("alice", "app", "1.1.0")).toBe(true);
    expect(registry.packageStore.hasPackage("bob", "dep", "0.1.0")).toBe(true);
  });

  it("should read published packages back from the served index", async () => {
    const registry = await initRegistry();
    await registry.mirror(options);

    const metadata = await registry.getPackage("alice", "app");
    expect(metadata?.versions.map((v) => v.version)).toEqual(["1.0.0", "1.1.0"]);
    expect(await registry.listPackages()).toEqual(["alice/app", "bob/dep"]);
  });

  it("should pick up new upstream versions on the next mirror", async () => {
    const registry = await initRegistry();
    await registry.mirror(options);

    ZIPS["alice/app/1.2.0"] = "app 1.2.0";
    const newLine = `${JSON.stringify({
      name: "alice/app",
      version: "1.2.0",
      checksum: sha256(ZIPS["alice/app/1.2.0"]),
    })}\n`;
    await writeFile(join(upstreamIndex, "user", "alice", "app.index"), appIndex + newLine);
    await $`git -c user.name=t -c user.email=t@t commit -qam release`.cwd(upstreamIndex).quiet();

    await registry.mirror(options);

    expect(registry.packageStore.hasPackage("alice", "app", "1.2.0")).toBe(true);
    const published = await readFile(
      join(registry.indexManager.path, "user", "alice", "app.index"),
      "utf-8",
    );
    expect(published).toBe(appIndex + newLine);
  });

  it("should not publish versions whose archives failed to download", async () => {
    const registry = await initRegistry();
    await registry.mirror(options);

    // The new version is in the upstream index, but its zip is missing
    const newLine = `${JSON.stringify({
      name: "alice/app",
      version: "1.2.0",
      checksum: sha256("app 1.2.0"),
    })}\n`;
    await writeFile(join(upstreamIndex, "user", "alice", "app.index"), appIndex + newLine);
    await $`git -c user.name=t -c user.email=t@t commit -qam release`.cwd(upstreamIndex).quiet();

    await registry.mirror(options);

    expect(registry.packageStore.hasPackage("alice", "app", "1.2.0")).toBe(false);
    const published = await readFile(
      join(registry.indexManager.path, "user", "alice", "app.index"),
      "utf-8",
    );
    expect(published).toBe(appIndex);
  });

  it("should not create a commit when nothing changed", async () => {
    const registry = await initRegistry();
    await registry.mirror(options);
    const indexDir = registry.indexManager.path;
    const before = await $`git rev-list --count HEAD`.cwd(indexDir).text();

    await registry.mirror(options);

    const after = await $`git rev-list --count HEAD`.cwd(indexDir).text();
    expect(after).toBe(before);
  });
});
