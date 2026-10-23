/**
 * Tests for server routes
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import pkg from "../../package.json" with { type: "json" };
import { Registry } from "../../src/core/registry.ts";
import createServer from "../../src/server/index.ts";

describe("Server Routes", () => {
  let tempDir: string;
  let registry: Registry;
  let handler: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-server-test-"));
    registry = await Registry.init(tempDir);
    const server = createServer(registry, { port: 0 });
    handler = server.handler;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("GET /", () => {
    it("should return API info", async () => {
      const request = new Request("http://localhost/");
      const response = await handler(request);

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.name).toBe("local-registry");
      expect(body.version).toBe(pkg.version);
      expect(body.endpoints).toBeDefined();
    });
  });

  describe("GET /health", () => {
    it("should return OK", async () => {
      const request = new Request("http://localhost/health");
      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    });
  });

  describe("GET /git/index", () => {
    it("should return index info", async () => {
      const request = new Request("http://localhost/git/index");
      const response = await handler(request);

      expect(response.status).toBe(200);
    });
  });

  describe("GET /user/:username/:package", () => {
    it("should return 404 for non-existent package", async () => {
      const request = new Request("http://localhost/user/test/nonexistent");
      const response = await handler(request);

      expect(response.status).toBe(404);
    });
  });

  describe("GET /user/:username/:package/:version.zip", () => {
    it("should return 404 for non-existent package version", async () => {
      const request = new Request("http://localhost/user/test/pkg/1.0.0.zip");
      const response = await handler(request);

      expect(response.status).toBe(404);
    });

    it("should serve cached package", async () => {
      // Create a fake cached package
      const pkgPath = registry.packageStore.getPackagePath("test", "pkg", "1.0.0");
      await Bun.write(pkgPath, "fake zip content");

      const request = new Request("http://localhost/user/test/pkg/1.0.0.zip");
      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/zip");
    });

    it("should serve the percent-encoded path that moon requests", async () => {
      // moon with MOONCAKES_REGISTRY requests `/user/<owner>%2F<pkg>%2F<version>.zip`
      const pkgPath = registry.packageStore.getPackagePath("test", "pkg", "1.0.0");
      await Bun.write(pkgPath, "fake zip content");

      const request = new Request("http://localhost/user/test%2Fpkg%2F1.0.0.zip");
      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("fake zip content");
    });

    it("should not serve files outside the package store", async () => {
      // The decoded path `/user/../../secret.zip` points two levels above the store
      await Bun.write(join(registry.packageStore.path, "..", "..", "secret.zip"), "secret");

      const request = new Request("http://localhost/user/..%2F..%2Fsecret.zip");
      const response = await handler(request);

      expect(response.status).toBe(400);
    });
  });

  describe("GET /symbols.zip", () => {
    it("should redirect to the upstream symbols for a mooncakes source", async () => {
      // moon with MOONCAKES_REGISTRY fetches `<registry>/symbols.zip` on update
      const response = await handler(new Request("http://localhost/symbols.zip"));

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://download.mooncakes.io/symbols.zip");
    });

    it("should return 404 when the default source is not mooncakes", async () => {
      registry.addSource({
        name: "private",
        type: "moonbit-registry",
        url: "http://private.example",
        index_url: "http://private.example/git/index",
        index_type: "git",
        enabled: true,
      });
      registry.setDefaultSource("private");
      const privateHandler = createServer(registry, { port: 0 }).handler;

      const response = await privateHandler(new Request("http://localhost/symbols.zip"));

      expect(response.status).toBe(404);
    });
  });

  describe("CORS", () => {
    it("should handle OPTIONS preflight request", async () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
      });
      const response = await handler(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should add CORS headers to responses", async () => {
      const request = new Request("http://localhost/health");
      const response = await handler(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("Smart HTTP Protocol", () => {
    it("should serve the dumb info/refs file when smart HTTP is disabled", async () => {
      registry.config.server.smart_http = { enabled: false };
      const dumbHandler = createServer(registry, { port: 0 }).handler;
      await Bun.write(join(registry.indexManager.path, "README"), "index\n");
      await $`git add . && git commit -qm init && git update-server-info`
        .cwd(registry.indexManager.path)
        .quiet();

      const request = new Request("http://localhost/git/index/info/refs?service=git-upload-pack");
      const response = await dumbHandler(request);

      // A plain text reply lets git fall back to the dumb protocol, a 501 stops it
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("refs/heads/main");
    });

    it("should return 501 for git-upload-pack POST when smart HTTP disabled", async () => {
      registry.config.server.smart_http = { enabled: false };
      const dumbHandler = createServer(registry, { port: 0 }).handler;
      const request = new Request("http://localhost/git/index/git-upload-pack", {
        method: "POST",
        headers: { "Content-Type": "application/x-git-upload-pack-request" },
      });
      const response = await dumbHandler(request);

      expect(response.status).toBe(501);
      expect(await response.text()).toContain("not implemented");
    });
  });
});
