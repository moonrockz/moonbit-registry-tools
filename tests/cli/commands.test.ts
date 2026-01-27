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
});
