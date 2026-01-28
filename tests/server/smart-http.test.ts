/**
 * Tests for Smart HTTP route handlers
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSmartHttpHandlers } from "../../src/server/routes/smart-http.ts";
import { git } from "../../src/utils/git.ts";

describe("Smart HTTP Handlers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "smart-http-test-"));
    // Initialize a git repo for testing
    await git.init(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createSmartHttpHandlers", () => {
    it("should return disabled handlers when smart HTTP is disabled", () => {
      const handlers = createSmartHttpHandlers({
        config: { enabled: false },
        indexDir: tempDir,
      });

      expect(handlers.available).toBe(false);
    });

    it("should return disabled handlers when git-http-backend not found", () => {
      const handlers = createSmartHttpHandlers({
        config: { enabled: true, git_http_backend_path: "/nonexistent/path" },
        indexDir: tempDir,
      });

      expect(handlers.available).toBe(false);
    });
  });

  describe("disabled handlers", () => {
    it("should return 501 for info/refs", async () => {
      const handlers = createSmartHttpHandlers({
        config: { enabled: false },
        indexDir: tempDir,
      });

      const request = new Request("http://localhost/git/index/info/refs?service=git-upload-pack");
      const response = await handlers.handleInfoRefs(request, "git-upload-pack");

      expect(response.status).toBe(501);
      expect(await response.text()).toBe("Smart HTTP not implemented");
    });

    it("should return 501 for git-upload-pack", async () => {
      const handlers = createSmartHttpHandlers({
        config: { enabled: false },
        indexDir: tempDir,
      });

      const request = new Request("http://localhost/git/index/git-upload-pack", {
        method: "POST",
        headers: { "Content-Type": "application/x-git-upload-pack-request" },
      });
      const response = await handlers.handleUploadPack(request);

      expect(response.status).toBe(501);
      expect(await response.text()).toBe("Smart HTTP not implemented");
    });
  });
});
