/**
 * Tests for proxy mode: the full index mirror and prefetch
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Registry } from "../../src/core/registry.ts";
import { sha256 } from "../../src/utils/crypto.ts";
import {
  type FakeDownloadHost,
  commitIndexFiles,
  createGitIndex,
  indexFile,
  makeZip,
  startFakeDownloadHost,
} from "../helpers/fake-upstream.ts";

const TOOL_ZIP = makeZip({
  "moon.mod.json": JSON.stringify({ name: "alice/tool", version: "1.0.0", source: "src" }),
  "src/moon.pkg.json": "{}",
  "src/cmd/run/moon.pkg": 'import {\n  "bob/dep",\n}\n\noptions(\n  "is-main": true,\n)\n',
  "src/cmd/run/main.mbt": "fn main { }",
  "src/cmd/native/moon.pkg.json": JSON.stringify({ "is-main": true }),
  "src/lib/moon.pkg": "",
});
const DEP_ZIP = "dep 0.1.0";
const RUN_WASM = "run wasm bytes";

describe("Proxy mode", () => {
  let tempDir: string;
  let upstreamIndex: string;
  let host: FakeDownloadHost;
  let toolIndex: string;
  let depIndex: string;
  let otherIndex: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-proxy-test-"));
    upstreamIndex = join(tempDir, "upstream-index");
    host = startFakeDownloadHost();

    host.files.set("/user/alice/tool/1.0.0.zip", TOOL_ZIP);
    host.files.set("/user/bob/dep/0.1.0.zip", DEP_ZIP);
    host.files.set("/prebuild/alice/tool@1.0.0/cmd/run/run.wasm", RUN_WASM);
    host.files.set(
      "/prebuild/alice/tool@1.0.0/cmd/run/run.wasm.sha256",
      `${sha256(RUN_WASM)}  run.wasm\n`,
    );

    toolIndex = indexFile([
      {
        name: "alice/tool",
        version: "1.0.0",
        checksum: sha256(Buffer.from(TOOL_ZIP)),
        deps: { "bob/dep": "0.1.0" },
        yanked: false,
        created_at: "2026-01-01T00:00:00+00:00",
      },
    ]);
    depIndex = indexFile([{ name: "bob/dep", version: "0.1.0", checksum: sha256(DEP_ZIP) }]);
    // No zip for this package: proxy mode must publish it anyway
    otherIndex = indexFile([
      { name: "carol/other", version: "2.0.0", checksum: sha256("missing"), deps: {} },
    ]);

    await createGitIndex(upstreamIndex, {
      "user/alice/tool.index": toolIndex,
      "user/bob/dep.index": depIndex,
      "user/carol/other.index": otherIndex,
    });
  });

  afterEach(async () => {
    host.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function initProxyRegistry(): Promise<Registry> {
    const registry = await Registry.init(join(tempDir, "registry"));
    registry.addSource({
      name: "fake",
      type: "custom",
      url: host.url,
      index_url: upstreamIndex,
      index_type: "git",
      download_url: host.url,
      enabled: true,
    });
    registry.setDefaultSource("fake");
    registry.config.proxy = {
      enabled: true,
      index_refresh_interval: "10m",
      symbols_max_age: "1d",
    };
    return registry;
  }

  async function servedFile(registry: Registry, path: string): Promise<string | null> {
    const full = join(registry.indexManager.path, path);
    return existsSync(full) ? readFile(full, "utf-8") : null;
  }

  async function commitCount(registry: Registry): Promise<number> {
    const count = await $`git rev-list --count HEAD`.cwd(registry.indexManager.path).nothrow();
    return count.exitCode === 0 ? Number(count.stdout.toString().trim()) : 0;
  }

  describe("index", () => {
    it("should publish every package and version of the upstream index verbatim", async () => {
      const registry = await initProxyRegistry();

      expect(await registry.proxy.refreshIndex()).toBe(true);

      expect(await servedFile(registry, "user/alice/tool.index")).toBe(toolIndex);
      expect(await servedFile(registry, "user/bob/dep.index")).toBe(depIndex);
      expect(await servedFile(registry, "user/carol/other.index")).toBe(otherIndex);
      // Nothing is downloaded up front
      expect(registry.packageStore.hasPackage("alice", "tool", "1.0.0")).toBe(false);
    });

    it("should commit the index on main with a clean work tree", async () => {
      const registry = await initProxyRegistry();
      await registry.proxy.refreshIndex();

      const indexDir = registry.indexManager.path;
      expect((await $`git rev-parse --abbrev-ref HEAD`.cwd(indexDir).text()).trim()).toBe("main");
      const files = (await $`git ls-files`.cwd(indexDir).text()).trim().split("\n");
      expect(files.sort()).toEqual([
        "user/alice/tool.index",
        "user/bob/dep.index",
        "user/carol/other.index",
      ]);
      expect((await $`git status --porcelain`.cwd(indexDir).text()).trim()).toBe("");
      expect(existsSync(join(indexDir, ".git", "info", "refs"))).toBe(true);
    });

    it("should follow upstream changes and not commit when nothing changed", async () => {
      const registry = await initProxyRegistry();
      await registry.proxy.refreshIndex();
      const first = await commitCount(registry);

      await registry.proxy.refreshIndex();
      expect(await commitCount(registry)).toBe(first);

      const newLine = indexFile([{ name: "alice/tool", version: "1.1.0", checksum: "00" }]);
      await commitIndexFiles(upstreamIndex, { "user/alice/tool.index": toolIndex + newLine }, [
        "user/carol/other.index",
      ]);
      await registry.proxy.refreshIndex();

      expect(await servedFile(registry, "user/alice/tool.index")).toBe(toolIndex + newLine);
      expect(await servedFile(registry, "user/carol/other.index")).toBeNull();
      expect(await commitCount(registry)).toBe(first + 1);
    });

    it("should keep the last index and warn when a refresh fails", async () => {
      const registry = await initProxyRegistry();
      await registry.proxy.refreshIndex();
      const head = await $`git rev-parse HEAD`.cwd(registry.indexManager.path).text();

      const source = registry.sourceManager.getSource("fake");
      if (!source) throw new Error("source missing");
      source.index_url = join(tempDir, "does-not-exist");
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(await registry.proxy.refreshIndex()).toBe(false);
        expect(warn.mock.calls.some((call) => String(call[0]).includes("refresh"))).toBe(true);
      } finally {
        warn.mockRestore();
      }

      expect(await $`git rev-parse HEAD`.cwd(registry.indexManager.path).text()).toBe(head);
      expect(await servedFile(registry, "user/alice/tool.index")).toBe(toolIndex);
    });

    it("should refresh on start without blocking and again on the interval", async () => {
      const registry = await initProxyRegistry();
      if (!registry.config.proxy) throw new Error("proxy config missing");
      registry.config.proxy.index_refresh_interval = "1s";

      const initial = registry.proxy.startIndexRefresh();
      try {
        // The caller gets control back before the clone ends
        expect(await servedFile(registry, "user/alice/tool.index")).toBeNull();
        expect(await initial).toBe(true);
        expect(await servedFile(registry, "user/alice/tool.index")).toBe(toolIndex);

        const newLine = indexFile([{ name: "alice/tool", version: "1.1.0", checksum: "00" }]);
        await commitIndexFiles(upstreamIndex, { "user/alice/tool.index": toolIndex + newLine });
        await Bun.sleep(2500);
        expect(await servedFile(registry, "user/alice/tool.index")).toBe(toolIndex + newLine);
      } finally {
        registry.proxy.stopIndexRefresh();
      }
    });
  });

  describe("prefetch", () => {
    const options = { patterns: ["alice/tool"], full: false, strict: false, quiet: true };

    it("should cache zips with dependencies and keep the full index", async () => {
      const registry = await initProxyRegistry();
      await registry.proxy.refreshIndex();
      const before = await commitCount(registry);

      await registry.mirror(options);

      expect(registry.packageStore.hasPackage("alice", "tool", "1.0.0")).toBe(true);
      expect(registry.packageStore.hasPackage("bob", "dep", "0.1.0")).toBe(true);
      expect(registry.packageStore.hasPackage("carol", "other", "2.0.0")).toBe(false);
      expect(await servedFile(registry, "user/carol/other.index")).toBe(otherIndex);
      expect(await commitCount(registry)).toBe(before);
      // Without --prebuild no wasm is fetched
      expect(host.hitCount("/prebuild/alice/tool@1.0.0/cmd/run/run.wasm.sha256")).toBe(0);
    });

    it("should fetch prebuilt wasm of executable packages with --prebuild", async () => {
      const registry = await initProxyRegistry();
      await registry.proxy.refreshIndex();

      await registry.mirror({ ...options, prebuild: true });

      const asset = registry.proxy.prebuildPaths({
        owner: "alice",
        name: "tool",
        version: "1.0.0",
        packagePath: ["cmd", "run"],
        file: "run.wasm",
      });
      expect(await readFile(asset.wasm, "utf-8")).toBe(RUN_WASM);
      expect(await readFile(asset.checksum, "utf-8")).toBe(`${sha256(RUN_WASM)}  run.wasm\n`);
      // The other executable has no prebuild upstream: a quiet 404
      expect(host.hitCount("/prebuild/alice/tool@1.0.0/cmd/native/native.wasm.sha256")).toBe(1);
      // Libraries are not executables, so nothing is requested for them
      expect(host.hitCount("/prebuild/alice/tool@1.0.0/lib/lib.wasm.sha256")).toBe(0);
      expect(host.hitCount("/prebuild/alice/tool@1.0.0/tool.wasm.sha256")).toBe(0);
    });
  });
});
