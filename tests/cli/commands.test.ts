/**
 * Tests for CLI commands
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

describe("CLI Commands", () => {
  let tempDir: string;
  const cliPath = join(import.meta.dir, "../../src/index.ts");

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-cli-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("moonbit-registry --help", () => {
    it("should show help message", async () => {
      const result = await $`bun ${cliPath} --help`.text();

      expect(result).toContain("moonbit-registry");
      expect(result).toContain("init");
      expect(result).toContain("mirror");
      expect(result).toContain("serve");
      expect(result).toContain("config");
      expect(result).toContain("sync");
      expect(result).toContain("update");
    });
  });

  describe("proxy options", () => {
    it("should offer --proxy on serve and --proxy and --prebuild on mirror", async () => {
      const serveHelp = await $`bun ${cliPath} serve --help`.text();
      expect(serveHelp).toContain("--proxy");

      const mirrorHelp = await $`bun ${cliPath} mirror --help`.text();
      expect(mirrorHelp).toContain("--proxy");
      expect(mirrorHelp).toContain("--prebuild");
    });
  });

  describe("moonbit-registry --version", () => {
    it("should show version", async () => {
      const result = await $`bun ${cliPath} --version`.text();

      expect(result.trim()).toBe("0.1.0");
    });
  });

  describe("moonbit-registry init", () => {
    it("should initialize a new registry", async () => {
      const registryDir = join(tempDir, "my-registry");

      await $`bun ${cliPath} init ${registryDir}`.quiet();

      // Check config file was created
      expect(existsSync(join(registryDir, "registry.toml"))).toBe(true);

      // Check data directories were created
      expect(existsSync(join(registryDir, "data", "index", ".git"))).toBe(true);
    });

    it("should accept --name option", async () => {
      const registryDir = join(tempDir, "named-registry");

      await $`bun ${cliPath} init ${registryDir} --name my-custom-name`.quiet();

      const configContent = await readFile(join(registryDir, "registry.toml"), "utf-8");
      expect(configContent).toContain('name = "my-custom-name"');
    });
  });

  describe("moonbit-registry config", () => {
    it("should show all config when no args", async () => {
      const registryDir = join(tempDir, "config-test");
      await $`bun ${cliPath} init ${registryDir}`.quiet();

      const result = await $`bun ${cliPath} config -d ${registryDir}`.text();

      expect(result).toContain("[registry]");
      expect(result).toContain("[server]");
      expect(result).toContain("port");
    });

    it("should show specific config value", async () => {
      const registryDir = join(tempDir, "config-test2");
      await $`bun ${cliPath} init ${registryDir}`.quiet();

      const result = await $`bun ${cliPath} config server.port -d ${registryDir}`.text();

      expect(result).toContain("server.port = 8080");
    });

    it("should set config value", async () => {
      const registryDir = join(tempDir, "config-test3");
      await $`bun ${cliPath} init ${registryDir}`.quiet();

      await $`bun ${cliPath} config server.port 9000 -d ${registryDir}`.quiet();

      const configContent = await readFile(join(registryDir, "registry.toml"), "utf-8");
      expect(configContent).toContain("port = 9000");
    });
  });

  describe("moonbit-registry update", () => {
    it("should show help for update command", async () => {
      const result = await $`bun ${cliPath} update --help`.text();

      expect(result).toContain("Update local moon package index");
      expect(result).toContain("--registry");
      expect(result).toContain("--mooncakes");
    });

    it("should error when no registry URL and no config", async () => {
      const result = await $`bun ${cliPath} update -d ${tempDir}`.quiet().nothrow();

      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("No registry URL specified");
    });

    it("should use base_url from registry config", async () => {
      const registryDir = join(tempDir, "update-test");
      await $`bun ${cliPath} init ${registryDir}`.quiet();
      await $`bun ${cliPath} config server.base_url http://localhost:9999 -d ${registryDir}`.quiet();

      // This will fail because server isn't running, but we can check the URL was picked up
      const result = await $`bun ${cliPath} update -d ${registryDir}`.quiet().nothrow();

      // Either moon is not installed or server not running - both are expected
      const output = result.stdout.toString() + result.stderr.toString();
      expect(
        output.includes("http://localhost:9999") || output.includes("moon CLI not found"),
      ).toBe(true);
    });

    it("should use mooncakes.io when --mooncakes flag is set", async () => {
      const result = await $`bun ${cliPath} update --mooncakes`.quiet().nothrow();

      // Either succeeds or fails (if moon not installed), but should use mooncakes.io URL
      const output = result.stdout.toString() + result.stderr.toString();
      expect(output.includes("https://mooncakes.io") || output.includes("moon CLI not found")).toBe(
        true,
      );
    });
  });

  describe("manifest", () => {
    const fixtures = join(import.meta.dir, "..", "fixtures", "zips");

    it("should print the manifest line of a zip", async () => {
      const zip = join(fixtures, "tiny-published.zip");
      const line = JSON.parse(await $`bun ${cliPath} manifest ${zip}`.text());
      expect(line.checksum).toBe(
        "b108889bdf53eafd4ebda4825571b304199c318f36c442caa9fa63b666daf94d",
      );
      expect(line.entries[0].path).toBe("README.md");
      expect(typeof line.content_digest).toBe("string");
    });

    it("should build missing manifest lines for an index directory", async () => {
      const zip = new Uint8Array(await readFile(join(fixtures, "tiny-published.zip")));
      const checksum = new Bun.CryptoHasher("sha256").update(zip).digest("hex");
      const server = Bun.serve({
        port: 0,
        fetch: (request) =>
          new URL(request.url).pathname === "/user/alice/tiny/0.1.0.zip"
            ? new Response(zip)
            : new Response("Not found", { status: 404 }),
      });
      try {
        const index = join(tempDir, "index");
        await $`mkdir -p ${join(index, "user", "alice")}`;
        await Bun.write(
          join(index, "user", "alice", "tiny.index"),
          `${JSON.stringify({ name: "alice/tiny", version: "0.1.0", checksum, deps: {} })}\n`,
        );
        const url = `http://localhost:${server.port}`;
        const first = await $`bun ${cliPath} manifest build --index ${index} --download-url ${url}`
          .nothrow()
          .quiet();
        expect(first.exitCode).toBe(0);
        expect(first.stdout.toString()).toContain("1 added");
        const path = join(index, "manifests", "user", "alice", "tiny.manifest");
        const lines = (await readFile(path, "utf8")).trim().split("\n");
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]).checksum).toBe(checksum);

        const second = await $`bun ${cliPath} manifest build --index ${index} --download-url ${url}`
          .nothrow()
          .quiet();
        expect(second.stdout.toString()).toContain("0 added, 1 already present");
      } finally {
        server.stop(true);
      }
    });
  });
});
