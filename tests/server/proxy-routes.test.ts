/**
 * Tests for the fetch-on-miss routes of proxy mode
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Registry } from "../../src/core/registry.ts";
import createServer from "../../src/server/index.ts";
import { sha256 } from "../../src/utils/crypto.ts";
import {
  type FakeDownloadHost,
  createGitIndex,
  indexFile,
  startFakeDownloadHost,
} from "../helpers/fake-upstream.ts";

const APP_ZIP = "app 1.0.0 zip";
const WASM = "prebuilt wasm";
const WASM_SHA = `${sha256(WASM)}  fmt.wasm\n`;
const PREBUILD = "/prebuild/alice/app@1.0.0/cmd/fmt/fmt.wasm";

describe("Proxy routes", () => {
  let tempDir: string;
  let host: FakeDownloadHost;
  let registry: Registry;
  let handler: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-proxy-routes-"));
    host = startFakeDownloadHost();
    host.files.set("/user/alice/app/1.0.0.zip", APP_ZIP);
    host.files.set("/user/alice/app/1.1.0.zip", "tampered zip");
    host.files.set(PREBUILD, WASM);
    host.files.set(`${PREBUILD}.sha256`, WASM_SHA);
    host.files.set("/prebuild/alice/app@1.0.0/app.wasm", WASM);
    host.files.set("/prebuild/alice/app@1.0.0/app.wasm.sha256", `${sha256(WASM)}  app.wasm\n`);
    host.files.set("/prebuild/alice/app@1.0.0/bad/bad.wasm", "not the wasm");
    host.files.set("/prebuild/alice/app@1.0.0/bad/bad.wasm.sha256", WASM_SHA);
    host.files.set("/symbols.zip", "symbols v1");

    const upstreamIndex = join(tempDir, "upstream-index");
    await createGitIndex(upstreamIndex, {
      "user/alice/app.index": indexFile([
        { name: "alice/app", version: "1.0.0", checksum: sha256(APP_ZIP), deps: {} },
        { name: "alice/app", version: "1.1.0", checksum: sha256("the real zip"), deps: {} },
        { name: "alice/app", version: "1.2.0", checksum: sha256("gone"), deps: {} },
      ]),
    });

    registry = await Registry.init(join(tempDir, "registry"));
    registry.addSource({
      name: "fake",
      type: "custom",
      url: host.url,
      index_url: upstreamIndex,
      index_type: "git",
      download_url: host.url,
      symbols_url: `${host.url}/symbols.zip`,
      enabled: true,
    });
    registry.setDefaultSource("fake");
    registry.config.proxy = { enabled: true, index_refresh_interval: "10m", symbols_max_age: "1d" };
    await registry.proxy.refreshIndex();
    handler = createServer(registry, { port: 0 }).handler;
  });

  afterEach(async () => {
    host.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  const get = (path: string) => handler(new Request(`http://localhost${path}`));

  describe("zips", () => {
    it("should fetch a missing zip, verify it, cache it and serve it offline", async () => {
      const response = await get("/user/alice/app/1.0.0.zip");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(APP_ZIP);
      expect(registry.packageStore.hasPackage("alice", "app", "1.0.0")).toBe(true);

      host.stop();
      const offline = await get("/user/alice/app/1.0.0.zip");
      expect(offline.status).toBe(200);
      expect(await offline.text()).toBe(APP_ZIP);
      expect(host.hitCount("/user/alice/app/1.0.0.zip")).toBe(1);
    });

    it("should fetch again a cached zip that does not match the index checksum", async () => {
      // For example a corrupted file, or a file cached before proxy mode checked it
      const path = registry.packageStore.getPackagePath("alice", "app", "1.0.0");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "corrupted bytes");

      const response = await get("/user/alice/app/1.0.0.zip");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(APP_ZIP);
      expect(host.hitCount("/user/alice/app/1.0.0.zip")).toBe(1);
      expect(await readFile(path, "utf-8")).toBe(APP_ZIP);
    });

    it("should serve the legacy encoded zip path", async () => {
      const response = await get("/user/alice%2Fapp%2F1.0.0.zip");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(APP_ZIP);
    });

    it("should return 502 and not cache a zip whose checksum does not match", async () => {
      const response = await get("/user/alice/app/1.1.0.zip");
      expect(response.status).toBe(502);
      expect(registry.packageStore.hasPackage("alice", "app", "1.1.0")).toBe(false);
    });

    it("should return 404 when upstream has no zip", async () => {
      const response = await get("/user/alice/app/1.2.0.zip");
      expect(response.status).toBe(404);
    });

    it("should not ask upstream for a version that is not in the index", async () => {
      const response = await get("/user/alice/app/9.9.9.zip");
      expect(response.status).toBe(404);
      expect(host.hitCount("/user/alice/app/9.9.9.zip")).toBe(0);
    });

    it("should share one upstream download between concurrent requests", async () => {
      host.delayMs = 100;
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => get("/user/alice/app/1.0.0.zip")),
      );
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(APP_ZIP);
      }
      expect(host.hitCount("/user/alice/app/1.0.0.zip")).toBe(1);
    });
  });

  describe("prebuilt wasm", () => {
    it("should serve the upstream .sha256 bytes and cache the verified wasm", async () => {
      const checksum = await get(`${PREBUILD}.sha256`);
      expect(checksum.status).toBe(200);
      expect(await checksum.text()).toBe(WASM_SHA);

      const wasm = await get(PREBUILD);
      expect(wasm.status).toBe(200);
      expect(await wasm.text()).toBe(WASM);
      expect(host.hitCount(PREBUILD)).toBe(1);
      expect(host.hitCount(`${PREBUILD}.sha256`)).toBe(1);

      host.stop();
      expect(await (await get(PREBUILD)).text()).toBe(WASM);
      expect(await (await get(`${PREBUILD}.sha256`)).text()).toBe(WASM_SHA);
    });

    it("should serve a prebuild of the module root package", async () => {
      const response = await get("/prebuild/alice/app@1.0.0/app.wasm");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(WASM);
    });

    it("should serve the legacy /assets path from the same cache", async () => {
      const response = await get("/assets/alice/app@1.0.0/cmd/fmt/fmt.wasm.sha256");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(WASM_SHA);
      expect(await (await get(PREBUILD)).text()).toBe(WASM);
      expect(host.hitCount(PREBUILD)).toBe(1);
    });

    it("should return 502 and cache nothing when the wasm does not match its .sha256", async () => {
      const response = await get("/prebuild/alice/app@1.0.0/bad/bad.wasm");
      expect(response.status).toBe(502);
      const paths = registry.proxy.prebuildPaths({
        owner: "alice",
        name: "app",
        version: "1.0.0",
        packagePath: ["bad"],
        file: "bad.wasm",
      });
      expect(existsSync(paths.wasm)).toBe(false);
      expect(existsSync(paths.checksum)).toBe(false);
      expect((await get("/prebuild/alice/app@1.0.0/bad/bad.wasm.sha256")).status).toBe(502);
    });

    it("should return 404 when upstream has no prebuild", async () => {
      const response = await get("/prebuild/alice/app@1.0.0/cmd/none/none.wasm.sha256");
      expect(response.status).toBe(404);
    });

    it("should return 404 for a version that is not in the index", async () => {
      const response = await get("/prebuild/alice/app@9.9.9/app.wasm");
      expect(response.status).toBe(404);
      expect(host.hitCount("/prebuild/alice/app@9.9.9/app.wasm.sha256")).toBe(0);
    });

    it("should share one upstream download between concurrent requests", async () => {
      host.delayMs = 50;
      const responses = await Promise.all([
        get(PREBUILD),
        get(`${PREBUILD}.sha256`),
        get(PREBUILD),
        get("/assets/alice/app@1.0.0/cmd/fmt/fmt.wasm"),
      ]);
      for (const response of responses) expect(response.status).toBe(200);
      expect(host.hitCount(PREBUILD)).toBe(1);
      expect(host.hitCount(`${PREBUILD}.sha256`)).toBe(1);
    });

    it("should reject bad asset paths", async () => {
      const bad = [
        "/prebuild/alice/app@1.0.0/cmd%2Ffmt/fmt.wasm",
        "/prebuild/alice/app@1.0.0/..%2F..%2Fx/x.wasm",
        "/prebuild/alice%2Fapp@1.0.0/app.wasm",
        "/prebuild/alice/app@1.0.0/cmd/%2E%2E%5C/x.wasm",
        "/prebuild/alice/app@1.0.0/cmd//fmt.wasm",
        "/prebuild/alice/app/app.wasm",
        "/prebuild/alice/@1.0.0/app.wasm",
        "/assets/alice/app@1.0.0/a%2Fb/b.wasm",
      ];
      for (const path of bad) {
        const response = await get(path);
        expect({ path, status: response.status }).toEqual({ path, status: 400 });
      }
      expect([...host.hits.keys()]).toEqual([]);
    });

    it("should not serve other files under /prebuild", async () => {
      expect((await get("/prebuild/alice/app@1.0.0/app.zip")).status).toBe(404);
      expect((await get("/prebuild/alice/app@1.0.0")).status).toBe(404);
    });
  });

  describe("symbols", () => {
    it("should cache symbols.zip and serve it until it expires", async () => {
      expect(await (await get("/symbols.zip")).text()).toBe("symbols v1");
      host.files.set("/symbols.zip", "symbols v2");
      expect(await (await get("/symbols.zip")).text()).toBe("symbols v1");
      expect(host.hitCount("/symbols.zip")).toBe(1);

      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await utimes(registry.proxy.symbolsPath, old, old);
      expect(await (await get("/symbols.zip")).text()).toBe("symbols v2");
      expect(host.hitCount("/symbols.zip")).toBe(2);
    });

    it("should serve the stale copy when upstream fails", async () => {
      await get("/symbols.zip");
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await utimes(registry.proxy.symbolsPath, old, old);
      host.failing = true;

      const response = await get("/symbols.zip");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("symbols v1");
      expect(await readFile(registry.proxy.symbolsPath, "utf-8")).toBe("symbols v1");
    });

    it("should return 502 when upstream fails and nothing is cached", async () => {
      host.failing = true;
      expect((await get("/symbols.zip")).status).toBe(502);
    });
  });

  describe("mirror mode", () => {
    it("should keep the redirect for symbols and not fetch prebuilds", async () => {
      registry.config.proxy = {
        enabled: false,
        index_refresh_interval: "10m",
        symbols_max_age: "1d",
      };
      const mirrorHandler = createServer(registry, { port: 0 }).handler;

      expect((await mirrorHandler(new Request(`http://localhost${PREBUILD}`))).status).toBe(404);
      expect(host.hitCount(PREBUILD)).toBe(0);
      expect(host.hitCount("/symbols.zip")).toBe(0);
    });
  });

  describe("index readiness", () => {
    const refs = "/git/index/info/refs?service=git-upload-pack";

    it("should answer 503 for the git index until the first refresh ends", async () => {
      // A client that clones during the first refresh must not get an empty index
      const fresh = await Registry.init(join(tempDir, "fresh"));
      const source = registry.sourceManager.getSource("fake");
      if (!source) throw new Error("fake source is missing");
      fresh.addSource({ ...source });
      fresh.setDefaultSource("fake");
      fresh.config.proxy = { enabled: true, index_refresh_interval: "10m", symbols_max_age: "1d" };
      const freshHandler = createServer(fresh, { port: 0 }).handler;

      const before = await freshHandler(new Request(`http://localhost${refs}`));
      expect(before.status).toBe(503);
      expect(before.headers.get("Retry-After")).not.toBeNull();

      await fresh.proxy.refreshIndex();
      const after = await freshHandler(new Request(`http://localhost${refs}`));
      expect(after.status).toBe(200);
    });

    it("should serve a committed index in the legacy layout before the refresh", async () => {
      // IndexManager also reads `{owner}/{package}` files, without the user/ directory
      const legacy = await Registry.init(join(tempDir, "legacy"));
      const indexDir = legacy.indexManager.path;
      await mkdir(join(indexDir, "alice"), { recursive: true });
      await writeFile(
        join(indexDir, "alice", "app"),
        indexFile([{ name: "alice/app", version: "1.0.0", checksum: sha256(APP_ZIP), deps: {} }]),
      );
      await legacy.indexManager.commit("legacy index");

      const restarted = await Registry.load(legacy.rootDir);
      restarted.config.proxy = {
        enabled: true,
        index_refresh_interval: "10m",
        symbols_max_age: "1d",
      };
      const restartedHandler = createServer(restarted, { port: 0 }).handler;

      const response = await restartedHandler(new Request(`http://localhost${refs}`));
      expect(response.status).toBe(200);
    });

    it("should serve the index of an earlier run before the refresh", async () => {
      const restarted = await Registry.load(registry.rootDir);
      restarted.config.proxy = {
        enabled: true,
        index_refresh_interval: "10m",
        symbols_max_age: "1d",
      };
      const restartedHandler = createServer(restarted, { port: 0 }).handler;

      const response = await restartedHandler(new Request(`http://localhost${refs}`));
      expect(response.status).toBe(200);
    });
  });
});
