/**
 * Tests for PackageStore class
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import PackageStore from "../../src/core/package-store.ts";
import type { RegistryConfig } from "../../src/core/types.ts";
import { DEFAULT_CONFIG } from "../../src/core/types.ts";

describe("PackageStore", () => {
  let tempDir: string;
  let config: RegistryConfig;
  let packageStore: PackageStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-store-test-"));
    config = {
      ...DEFAULT_CONFIG,
      registry: {
        ...DEFAULT_CONFIG.registry,
        data_dir: tempDir,
      },
    };
    packageStore = new PackageStore(config);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("init", () => {
    it("should create packages directory", async () => {
      await packageStore.init();

      expect(existsSync(packageStore.path)).toBe(true);
    });
  });

  describe("getPackagePath", () => {
    it("should return correct path for package", () => {
      const path = packageStore.getPackagePath("moonbitlang", "core", "1.0.0");

      expect(path).toBe(join(packageStore.path, "moonbitlang", "core", "1.0.0.zip"));
    });
  });

  describe("hasPackage", () => {
    it("should return false for non-existent package", () => {
      const exists = packageStore.hasPackage("moonbitlang", "core", "1.0.0");

      expect(exists).toBe(false);
    });

    it("should return true for existing package", async () => {
      await packageStore.init();

      // Create a fake package file
      const pkgPath = packageStore.getPackagePath("test", "pkg", "1.0.0");
      await Bun.write(pkgPath, "fake zip content");

      const exists = packageStore.hasPackage("test", "pkg", "1.0.0");

      expect(exists).toBe(true);
    });
  });

  describe("getUpstreamUrl", () => {
    it("should return correct upstream URL", () => {
      const url = packageStore.getUpstreamUrl("moonbitlang", "core", "1.0.0");

      expect(url).toBe("https://mooncakes.io/user/moonbitlang/core/1.0.0.zip");
    });
  });

  describe("listCached", () => {
    it("should return empty array for new store", async () => {
      await packageStore.init();

      const cached = await packageStore.listCached();

      expect(cached).toEqual([]);
    });

    it("should list cached packages", async () => {
      await packageStore.init();

      // Create some fake package files
      await Bun.write(packageStore.getPackagePath("user1", "pkg1", "1.0.0"), "content");
      await Bun.write(packageStore.getPackagePath("user1", "pkg1", "2.0.0"), "content");
      await Bun.write(packageStore.getPackagePath("user2", "pkg2", "1.0.0"), "content");

      const cached = await packageStore.listCached();

      expect(cached).toHaveLength(3);
      expect(cached).toContainEqual({ username: "user1", name: "pkg1", version: "1.0.0" });
      expect(cached).toContainEqual({ username: "user1", name: "pkg1", version: "2.0.0" });
      expect(cached).toContainEqual({ username: "user2", name: "pkg2", version: "1.0.0" });
    });
  });

  describe("getCacheSize", () => {
    it("should return 0 for empty cache", async () => {
      await packageStore.init();

      const size = await packageStore.getCacheSize();

      expect(size).toBe(0);
    });

    it("should return total size of cached packages", async () => {
      await packageStore.init();

      const content1 = "a".repeat(100);
      const content2 = "b".repeat(200);

      await Bun.write(packageStore.getPackagePath("user", "pkg1", "1.0.0"), content1);
      await Bun.write(packageStore.getPackagePath("user", "pkg2", "1.0.0"), content2);

      const size = await packageStore.getCacheSize();

      expect(size).toBe(300);
    });
  });
});
