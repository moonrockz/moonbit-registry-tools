/**
 * Tests for Registry class
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../../src/core/registry.ts";

describe("Registry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-registry-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("init", () => {
    it("should initialize a new registry", async () => {
      const registry = await Registry.init(tempDir, "test-registry");

      expect(registry.config.registry.name).toBe("test-registry");
      expect(registry.rootDir).toBe(tempDir);
    });

    it("should create registry.toml config file", async () => {
      await Registry.init(tempDir, "test-registry");

      const configPath = join(tempDir, "registry.toml");
      expect(existsSync(configPath)).toBe(true);
    });

    it("should create data directories", async () => {
      const registry = await Registry.init(tempDir);

      const indexDir = join(registry.config.registry.data_dir, "index");
      const packagesDir = join(registry.config.registry.data_dir, "packages");

      expect(existsSync(indexDir)).toBe(true);
      expect(existsSync(packagesDir)).toBe(true);
      expect(existsSync(join(indexDir, ".git"))).toBe(true);
    });
  });

  describe("load", () => {
    it("should load an existing registry", async () => {
      // First create a registry
      await Registry.init(tempDir, "existing-registry");

      // Then load it
      const loaded = await Registry.load(tempDir);

      expect(loaded.config.registry.name).toBe("existing-registry");
    });

    it("should use defaults if no config file exists", async () => {
      // Create a fresh temp dir for this test to ensure no config exists
      const emptyDir = await mkdtemp(join(tmpdir(), "moonbit-empty-test-"));
      try {
        const loaded = await Registry.load(emptyDir);
        expect(loaded.config.registry.name).toBe("local-registry");
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe("getStats", () => {
    it("should return registry statistics", async () => {
      const registry = await Registry.init(tempDir);

      const stats = await registry.getStats();

      expect(stats.packages).toBe(0);
      expect(stats.cachedVersions).toBe(0);
      expect(stats.cacheSize).toBe(0);
    });
  });
});
