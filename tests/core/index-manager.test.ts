/**
 * Tests for IndexManager class
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import IndexManager from "../../src/core/index-manager.ts";
import type { RegistryConfig } from "../../src/core/types.ts";
import { DEFAULT_CONFIG } from "../../src/core/types.ts";

describe("IndexManager", () => {
  let tempDir: string;
  let config: RegistryConfig;
  let indexManager: IndexManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-index-test-"));
    config = {
      ...DEFAULT_CONFIG,
      registry: {
        ...DEFAULT_CONFIG.registry,
        data_dir: tempDir,
      },
    };
    indexManager = new IndexManager(config);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("init", () => {
    it("should initialize index directory", async () => {
      await indexManager.init();

      const gitDir = join(indexManager.path, ".git");
      expect(existsSync(gitDir)).toBe(true);
    });
  });

  describe("listPackages", () => {
    it("should return empty array for new index", async () => {
      await indexManager.init();

      const packages = await indexManager.listPackages();

      expect(packages).toEqual([]);
    });
  });

  describe("listPackagesMatching", () => {
    it("should match glob patterns", async () => {
      await indexManager.init();

      // Create some test package files
      const testDir = join(indexManager.path, "testuser");
      await Bun.write(join(testDir, "pkg-one"), '{"name":"testuser/pkg-one","version":"1.0.0"}\n');
      await Bun.write(join(testDir, "pkg-two"), '{"name":"testuser/pkg-two","version":"1.0.0"}\n');
      await Bun.write(join(testDir, "other"), '{"name":"testuser/other","version":"1.0.0"}\n');

      const matched = await indexManager.listPackagesMatching("testuser/pkg-*");

      expect(matched).toContain("testuser/pkg-one");
      expect(matched).toContain("testuser/pkg-two");
      expect(matched).not.toContain("testuser/other");
    });
  });

  describe("getPackageIndexPath", () => {
    it("should return correct path", () => {
      const path = indexManager.getPackageIndexPath("moonbitlang", "core");

      expect(path).toBe(join(indexManager.path, "moonbitlang", "core"));
    });
  });
});
