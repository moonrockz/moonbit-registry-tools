/**
 * Tests for server routes
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
});
