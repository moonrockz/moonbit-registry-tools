/**
 * Tests for the opt-in proxy fallbacks: the GitHub rebuild of a zip and the
 * local wasm build. A fake GitHub serves tag tarballs, and fakes take the
 * place of `moon package` and `moon build`, so no test uses the network.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { $ } from "bun";
import type { LocalWasm } from "../../src/core/fallback.ts";
import { createManifest, formatManifestLine } from "../../src/core/manifest.ts";
import type { PrebuildAsset } from "../../src/core/prebuild.ts";
import { Registry } from "../../src/core/registry.ts";
import type { ProxyFallbackConfig } from "../../src/core/types.ts";
import createServer from "../../src/server/index.ts";
import { sha256 } from "../../src/utils/crypto.ts";
import logger from "../../src/utils/logger.ts";
import {
  type FakeDownloadHost,
  createGitIndex,
  indexFile,
  startFakeDownloadHost,
} from "../helpers/fake-upstream.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const LOCAL = new Uint8Array(await readFile(join(FIXTURES, "zips", "tiny-local.zip")));
const PUBLISHED = new Uint8Array(await readFile(join(FIXTURES, "zips", "tiny-published.zip")));
const CHECKSUM = sha256(Buffer.from(PUBLISHED));
const ZIP_PATH = "/user/alice/tiny/0.1.0.zip";
/** A second version, used as a dependency that needs a GitHub rebuild */
const DEP_PATH = "/user/alice/tiny/0.2.0.zip";
const WASM_PATH = "/prebuild/alice/tiny@0.1.0/cmd/hello/hello.wasm";
const BUILT_WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 42]);

interface FakeGitHub {
  server: Server<undefined>;
  url: string;
  /** Tarballs by tag */
  tags: Map<string, Uint8Array>;
  /** Requested tags, in order */
  requests: string[];
}

function startFakeGitHub(): FakeGitHub {
  const gh: FakeGitHub = {
    server: undefined as unknown as Server<undefined>,
    url: "",
    tags: new Map(),
    requests: [],
  };
  gh.server = Bun.serve({
    port: 0,
    fetch(request) {
      const match = new URL(request.url).pathname.match(
        /^\/repos\/alice\/tiny\/tarball\/refs\/tags\/(.+)$/,
      );
      if (!match) return new Response("Not found", { status: 404 });
      const tag = decodeURIComponent(match[1]);
      gh.requests.push(tag);
      const body = gh.tags.get(tag);
      return body ? new Response(body) : new Response("Not found", { status: 404 });
    },
  });
  gh.url = `http://localhost:${gh.server.port}`;
  return gh;
}

/** A GitHub-style tarball: one top directory with the module, maybe in a subdirectory */
async function makeTarball(
  work: string,
  subdir = "",
  change?: (moduleDir: string) => Promise<void>,
): Promise<Uint8Array> {
  const root = join(work, `tarball-${Math.random().toString(36).slice(2)}`);
  const top = join(root, "alice-tiny-0123abc");
  const moduleDir = join(top, subdir);
  await mkdir(moduleDir, { recursive: true });
  await cp(join(FIXTURES, "tiny-module"), moduleDir, { recursive: true });
  if (subdir !== "") {
    // A different module at the top of the repository
    await writeFile(join(top, "moon.mod"), 'name = "alice/tools"\n');
  }
  await change?.(moduleDir);
  const tarPath = join(root, "t.tar.gz");
  await $`tar -czf ${tarPath} -C ${root} alice-tiny-0123abc`.quiet();
  return new Uint8Array(await readFile(tarPath));
}

describe("Proxy fallbacks", () => {
  let tempDir: string;
  let upstreamIndex: string;
  let host: FakeDownloadHost;
  let gh: FakeGitHub;
  let registry: Registry;
  let handler: (request: Request) => Promise<Response>;
  let packaged: string[];
  let built: { asset: PrebuildAsset; zip: Uint8Array; createdAt?: string }[];
  let logs: string[];

  const indexLine = {
    name: "alice/tiny",
    version: "0.1.0",
    checksum: CHECKSUM,
    deps: {},
    created_at: "2025-12-10T10:41:31.083741+00:00",
    repository: "https://github.com/alice/tiny",
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-proxy-fallback-"));
    host = startFakeDownloadHost();
    gh = startFakeGitHub();
    packaged = [];
    built = [];
    logs = [];
    for (const level of ["info", "warn", "error"] as const) {
      spyOn(logger, level).mockImplementation((message: string) => {
        logs.push(`${level}: ${message}`);
      });
    }
    upstreamIndex = join(tempDir, "upstream-index");
  });

  afterEach(async () => {
    host.stop();
    gh.server.stop(true);
    for (const level of ["info", "warn", "error"] as const) {
      (logger[level] as unknown as { mockRestore(): void }).mockRestore();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  /** The same files as 0.1.0, published later */
  const depLine = { ...indexLine, version: "0.2.0", created_at: "2025-12-11T09:00:00+00:00" };

  async function setup(options: {
    fallback?: Partial<ProxyFallbackConfig>;
    manifest?: string | null;
    line?: Record<string, unknown>;
    /** Add version 0.2.0 (depLine) to the index and the manifest */
    withDep?: boolean;
    fakeToolchain?: boolean;
  }): Promise<void> {
    const lines = [options.line ?? indexLine, ...(options.withDep ? [depLine] : [])];
    const files: Record<string, string> = {
      "user/alice/tiny.index": indexFile(lines),
    };
    const manifest =
      options.manifest === undefined
        ? lines
            .map(
              (l) =>
                `${formatManifestLine(createManifest("alice/tiny", String(l.version), PUBLISHED))}\n`,
            )
            .join("")
        : options.manifest;
    if (manifest !== null) files["manifests/user/alice/tiny.manifest"] = manifest;
    await createGitIndex(upstreamIndex, files);

    registry = await Registry.init(join(tempDir, "registry"));
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
      ...(options.fallback
        ? { fallback: { toolchain: "current", github_api: gh.url, ...options.fallback } }
        : {}),
    };
    await registry.proxy.refreshIndex();
    const fallbacks = registry.proxy.fallbacks;
    if (options.fakeToolchain !== false) {
      fallbacks.checkToolchain = async () => null;
    }
    fallbacks.packageModule = async (dir: string) => {
      packaged.push(dir);
      expect(await Bun.file(join(dir, "moon.mod")).text()).toContain('name = "alice/tiny"');
      return LOCAL;
    };
    fallbacks.runWasmBuild = async (asset, zip, createdAt): Promise<LocalWasm> => {
      built.push({ asset, zip, createdAt });
      return { wasm: BUILT_WASM, toolchain: "test-toolchain" };
    };
    handler = createServer(registry, { port: 0 }).handler;
  }

  const get = (path: string) => handler(new Request(`http://localhost${path}`));
  const bytes = async (response: Response) => new Uint8Array(await response.arrayBuffer());
  const logged = (text: string) => logs.some((line) => line.includes(text));
  /** Fail fast on a deadlock instead of waiting for the build timeout */
  const withinSeconds = <T>(seconds: number, promise: Promise<T>): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`deadlock: no answer in ${seconds} s`)), seconds * 1000),
      ),
    ]);

  describe("GitHub rebuild", () => {
    it("should serve a rebuild that is byte-identical to the published zip", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      await setup({ fallback: { github: true } });

      const response = await get(ZIP_PATH);
      expect(response.status).toBe(200);
      expect(Buffer.from(await bytes(response)).equals(Buffer.from(PUBLISHED))).toBe(true);
      expect(packaged).toHaveLength(1);
      expect(logged("checksum matches")).toBe(true);
      expect(logged("from GitHub alice/tiny tag v0.1.0")).toBe(true);

      // Cached: no second rebuild
      const again = await get(ZIP_PATH);
      expect(again.status).toBe(200);
      expect(gh.requests).toEqual(["v0.1.0"]);
      expect(packaged).toHaveLength(1);
    });

    it("should also rebuild when upstream says 404", async () => {
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      await setup({ fallback: { github: true } });
      expect((await get(ZIP_PATH)).status).toBe(200);
    });

    it("should try the tag without v when v<version> does not exist", async () => {
      host.failing = true;
      gh.tags.set("0.1.0", await makeTarball(tempDir));
      await setup({ fallback: { github: true } });
      expect((await get(ZIP_PATH)).status).toBe(200);
      expect(gh.requests).toEqual(["v0.1.0", "0.1.0"]);
    });

    it("should find a module in a subdirectory of the repository", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir, "modules/tiny"));
      await setup({ fallback: { github: true } });
      expect((await get(ZIP_PATH)).status).toBe(200);
      expect(packaged[0]).toEndWith(join("modules", "tiny"));
    });

    it("should send 502 when the repository has no tag for the version", async () => {
      host.failing = true;
      await setup({ fallback: { github: true } });
      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(gh.requests).toEqual(["v0.1.0", "0.1.0"]);
      expect(packaged).toHaveLength(0);
      expect(logged("has no tag v0.1.0 or 0.1.0")).toBe(true);
    });

    it("should refuse a rebuild whose files differ from the manifest, and say which", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      const manifest = createManifest("alice/tiny", "0.1.0", PUBLISHED);
      const readme = manifest.entries.find((e) => e.path === "README.md");
      if (readme) readme.sha256 = sha256("another readme");
      await setup({ fallback: { github: true }, manifest: `${formatManifestLine(manifest)}\n` });

      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(registry.packageStore.hasPackage("alice", "tiny", "0.1.0")).toBe(false);
      expect(logged("refused")).toBe(true);
      expect(logged("content differs: README.md")).toBe(true);
    });

    it("should not run moon on a tag whose files differ from the manifest", async () => {
      host.failing = true;
      gh.tags.set(
        "v0.1.0",
        await makeTarball(tempDir, "", async (dir) => {
          await writeFile(join(dir, "src", "lib", "lib.mbt"), "pub fn changed() -> Int { 1 }\n");
        }),
      );
      await setup({ fallback: { github: true } });

      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(packaged).toHaveLength(0);
      expect(logged("does not have the files of the published alice/tiny@0.1.0")).toBe(true);
      expect(logged("content differs: src/lib/lib.mbt")).toBe(true);
    });

    it("should allow extra files in the tag, since the zip is checked", async () => {
      host.failing = true;
      gh.tags.set(
        "v0.1.0",
        await makeTarball(tempDir, "", async (dir) => {
          await writeFile(join(dir, "NOTES.txt"), "not published\n");
        }),
      );
      await setup({ fallback: { github: true } });
      expect((await get(ZIP_PATH)).status).toBe(200);
      expect(packaged).toHaveLength(1);
    });

    it("should refuse a rebuild whose bytes differ from the checksum", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      // The same files in another order: the reordered zip is not the published zip
      const manifest = createManifest("alice/tiny", "0.1.0", PUBLISHED);
      manifest.entries.reverse();
      await setup({ fallback: { github: true }, manifest: `${formatManifestLine(manifest)}\n` });

      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(registry.packageStore.hasPackage("alice", "tiny", "0.1.0")).toBe(false);
      expect(logged("same files but other zip bytes")).toBe(true);
    });

    it("should not rebuild without a manifest line", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      await setup({ fallback: { github: true }, manifest: null });

      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(gh.requests).toEqual([]);
      expect(logged("no manifest line for alice/tiny@0.1.0")).toBe(true);
    });

    it("should use manifest_url when the index has no manifest", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      const manifests = startFakeDownloadHost();
      try {
        manifests.files.set(
          "/manifests/user/alice/tiny.manifest",
          `${formatManifestLine(createManifest("alice/tiny", "0.1.0", PUBLISHED))}\n`,
        );
        await setup({
          fallback: { github: true, manifest_url: `${manifests.url}/manifests` },
          manifest: null,
        });
        expect((await get(ZIP_PATH)).status).toBe(200);
      } finally {
        manifests.stop();
      }
    });

    it("should not rebuild without a GitHub repository", async () => {
      host.failing = true;
      const { repository: _, ...line } = indexLine;
      await setup({ fallback: { github: true }, line });
      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(gh.requests).toEqual([]);
      expect(logged("has no GitHub repository")).toBe(true);
    });

    it("should be off by default", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      await setup({});
      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(gh.requests).toEqual([]);
    });

    it("should stay off with one clear error when moonup is missing", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      await setup({
        fallback: { github: true, toolchain: "auto", moonup: join(tempDir, "no-moonup") },
        fakeToolchain: false,
      });
      expect((await get(ZIP_PATH)).status).toBe(502);
      expect((await get(ZIP_PATH)).status).toBe(502);
      expect(gh.requests).toEqual([]);
      const errors = logs.filter((l) => l.startsWith("error: Proxy fallbacks are off"));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("moonup is not found");
    });
  });

  describe("local wasm build", () => {
    it("should build a missing prebuild from the source zip and mark it", async () => {
      host.files.set(ZIP_PATH, PUBLISHED);
      await setup({ fallback: { build_wasm: true } });

      const sum = await get(`${WASM_PATH}.sha256`);
      expect(sum.status).toBe(200);
      expect(sum.headers.get("X-Registry-Built-Locally")).toBe("true");
      expect(await sum.text()).toBe(`${sha256(Buffer.from(BUILT_WASM))}  hello.wasm\n`);

      const wasm = await get(WASM_PATH);
      expect(wasm.status).toBe(200);
      expect(wasm.headers.get("X-Registry-Built-Locally")).toBe("true");
      expect(Buffer.from(await bytes(wasm)).equals(Buffer.from(BUILT_WASM))).toBe(true);

      expect(built).toHaveLength(1);
      expect(built[0].asset.packagePath).toEqual(["cmd", "hello"]);
      expect(built[0].createdAt).toBe(indexLine.created_at);
      expect(Buffer.from(built[0].zip).equals(Buffer.from(PUBLISHED))).toBe(true);

      // Kept apart from upstream prebuilds
      const dataDir = registry.config.registry.data_dir;
      expect(
        existsSync(
          join(dataDir, "prebuild-local", "alice", "tiny@0.1.0", "cmd", "hello", "hello.wasm"),
        ),
      ).toBe(true);
      expect(existsSync(join(dataDir, "prebuild", "alice"))).toBe(false);
      expect(logged("built prebuild alice/tiny@0.1.0/cmd/hello/hello.wasm locally")).toBe(true);
    });

    it("should prefer an upstream prebuild and not mark it", async () => {
      host.files.set(ZIP_PATH, PUBLISHED);
      host.files.set(WASM_PATH, "upstream wasm");
      host.files.set(`${WASM_PATH}.sha256`, `${sha256("upstream wasm")}  hello.wasm\n`);
      await setup({ fallback: { build_wasm: true } });

      const wasm = await get(WASM_PATH);
      expect(wasm.status).toBe(200);
      expect(wasm.headers.get("X-Registry-Built-Locally")).toBeNull();
      expect(await wasm.text()).toBe("upstream wasm");
      expect(built).toHaveLength(0);
    });

    it("should build from a GitHub rebuild when upstream cannot be reached", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      await setup({ fallback: { build_wasm: true, github: true } });

      const wasm = await get(WASM_PATH);
      expect(wasm.status).toBe(200);
      expect(wasm.headers.get("X-Registry-Built-Locally")).toBe("true");
      expect(Buffer.from(built[0].zip).equals(Buffer.from(PUBLISHED))).toBe(true);
    });

    it("should not build a package that is not executable", async () => {
      host.files.set(ZIP_PATH, PUBLISHED);
      await setup({ fallback: { build_wasm: true } });
      expect((await get("/prebuild/alice/tiny@0.1.0/lib/lib.wasm")).status).toBe(404);
      expect(built).toHaveLength(0);
    });

    it("should send 502 when the build fails", async () => {
      host.files.set(ZIP_PATH, PUBLISHED);
      await setup({ fallback: { build_wasm: true } });
      registry.proxy.fallbacks.runWasmBuild = async () => {
        throw new Error("moon build failed");
      };
      expect((await get(WASM_PATH)).status).toBe(502);
      expect(logged("Local build of prebuild alice/tiny@0.1.0/cmd/hello/hello.wasm failed")).toBe(
        true,
      );
    });

    it("should be off by default", async () => {
      host.files.set(ZIP_PATH, PUBLISHED);
      await setup({});
      expect((await get(WASM_PATH)).status).toBe(404);
      expect(built).toHaveLength(0);
    });
  });

  describe("nested fallbacks", () => {
    it("should finish a wasm build whose dependency zip needs a GitHub rebuild", async () => {
      // 0.1.0 comes from upstream; 0.2.0 is not there (404) and needs a rebuild
      host.files.set(ZIP_PATH, PUBLISHED);
      gh.tags.set("v0.2.0", await makeTarball(tempDir));
      await setup({ fallback: { build_wasm: true, github: true }, withDep: true });
      // Like moon build: the build asks the proxy for a dependency while it runs
      registry.proxy.fallbacks.runWasmBuild = async (asset, zip, createdAt) => {
        built.push({ asset, zip, createdAt });
        const dep = await get(DEP_PATH);
        expect(dep.status).toBe(200);
        return { wasm: BUILT_WASM, toolchain: "test-toolchain" };
      };

      const wasm = await withinSeconds(5, get(WASM_PATH));
      expect(wasm.status).toBe(200);
      expect(built).toHaveLength(1);
      expect(packaged).toHaveLength(1);
      expect(gh.requests).toEqual(["v0.2.0"]);
    });

    it("should finish two zip rebuilds when one waits on the other", async () => {
      host.failing = true;
      gh.tags.set("v0.1.0", await makeTarball(tempDir));
      gh.tags.set("v0.2.0", await makeTarball(tempDir));
      await setup({ fallback: { github: true }, withDep: true });
      const started: string[] = [];
      // Like moon package: the rebuild of 0.1.0 needs 0.2.0 from the proxy
      registry.proxy.fallbacks.packageModule = async (dir, createdAt) => {
        packaged.push(dir);
        started.push(String(createdAt));
        if (createdAt === indexLine.created_at) {
          const dep = await get(DEP_PATH);
          expect(dep.status).toBe(200);
        }
        return LOCAL;
      };

      const [outer, inner] = await withinSeconds(5, Promise.all([get(ZIP_PATH), get(DEP_PATH)]));
      expect(outer.status).toBe(200);
      expect(inner.status).toBe(200);
      // 0.2.0 is rebuilt once, for both callers
      expect(packaged).toHaveLength(2);
      expect(started.sort()).toEqual([depLine.created_at, indexLine.created_at].sort());
    });
  });
});
