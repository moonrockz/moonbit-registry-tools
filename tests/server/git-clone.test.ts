/**
 * Tests that a real git client can fetch the served index
 *
 * moon clones the registry index with `git clone --depth 1 --single-branch
 * --no-tags` and updates it with `git fetch --depth=1`. Shallow fetches need
 * the smart HTTP protocol.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { $ } from "bun";
import { Registry } from "../../src/core/registry.ts";
import createServer from "../../src/server/index.ts";
import { findGitHttpBackend } from "../../src/utils/git-http-backend.ts";

const backendAvailable = findGitHttpBackend() !== null;

describe("Git index over HTTP", () => {
  let tempDir: string;
  let registry: Registry;
  let server: Server<undefined>;
  let indexUrl: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-git-clone-test-"));
    registry = await Registry.init(join(tempDir, "registry"));

    const indexDir = registry.indexManager.path;
    await mkdir(join(indexDir, "user", "alice"), { recursive: true });
    await Bun.write(
      join(indexDir, "user", "alice", "app.index"),
      '{"name":"alice/app","version":"1.0.0","checksum":"00"}\n',
    );
    await registry.indexManager.commit("add alice/app");

    server = Bun.serve({ port: 0, fetch: createServer(registry, { port: 0 }).handler });
    indexUrl = `http://localhost:${server.port}/git/index`;
  });

  afterEach(async () => {
    server.stop(true);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should enable smart HTTP by default", () => {
    expect(registry.config.server.smart_http?.enabled).toBe(true);
  });

  it.skipIf(!backendAvailable)("should advertise exactly one smart HTTP content type", async () => {
    const response = await fetch(`${indexUrl}/info/refs?service=git-upload-pack`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/x-git-upload-pack-advertisement",
    );
  });

  it.skipIf(!backendAvailable)(
    "should support the shallow clone and fetch that moon runs",
    async () => {
      const clone = join(tempDir, "clone");
      await $`git clone --depth 1 --single-branch --no-tags ${indexUrl} ${clone}`.quiet();
      expect(await Bun.file(join(clone, "user", "alice", "app.index")).exists()).toBe(true);

      await $`git fetch --depth=1 --no-tags --no-recurse-submodules origin +refs/heads/main:refs/remotes/origin/main`
        .cwd(clone)
        .quiet();
    },
  );
});
