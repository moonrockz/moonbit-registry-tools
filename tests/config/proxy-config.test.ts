/**
 * Tests for the proxy configuration and the source download URLs
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREDEFINED_SOURCES } from "../../src/config/defaults.ts";
import { loadConfig, saveConfig } from "../../src/config/loader.ts";
import {
  ConfigValidationError,
  resolveFallbackConfig,
  validateConfig,
} from "../../src/config/schema.ts";
import { SourceManager } from "../../src/core/source-manager.ts";
import type { MirrorSource } from "../../src/core/types.ts";

describe("proxy configuration", () => {
  it("should be off by default with a 10 minute refresh and a 1 day symbols age", () => {
    const config = validateConfig({});
    expect(config.proxy).toEqual({
      enabled: false,
      index_refresh_interval: "10m",
      symbols_max_age: "1d",
    });
  });

  it("should read the [proxy] section", () => {
    const config = validateConfig({ proxy: { enabled: true, index_refresh_interval: "30s" } });
    expect(config.proxy).toEqual({
      enabled: true,
      index_refresh_interval: "30s",
      symbols_max_age: "1d",
    });
  });

  it("should reject a bad duration", () => {
    expect(() => validateConfig({ proxy: { index_refresh_interval: "soon" } })).toThrow(
      ConfigValidationError,
    );
  });

  it("should have all fallbacks off by default", () => {
    const config = validateConfig({});
    expect(config.proxy?.fallback).toBeUndefined();
    expect(resolveFallbackConfig(config)).toEqual({
      github: false,
      build_wasm: false,
      toolchain: "auto",
      moonup: "moonup",
      github_api: "https://api.github.com",
    });
  });

  it("should read the [proxy.fallback] section", () => {
    const config = validateConfig({
      proxy: {
        enabled: true,
        fallback: {
          github: true,
          build_wasm: true,
          toolchain: "0.6.34+e16ca94e6",
          moonup: "/opt/moonup/bin/moonup",
          manifest_url: "https://example.com/manifests",
        },
      },
    });
    expect(resolveFallbackConfig(config)).toEqual({
      github: true,
      build_wasm: true,
      toolchain: "0.6.34+e16ca94e6",
      moonup: "/opt/moonup/bin/moonup",
      manifest_url: "https://example.com/manifests",
      github_api: "https://api.github.com",
    });
    expect(config.proxy?.index_refresh_interval).toBe("10m");
  });

  it("should reject a bad fallback toolchain or flag", () => {
    expect(() => validateConfig({ proxy: { fallback: { toolchain: "newest" } } })).toThrow(
      ConfigValidationError,
    );
    expect(() => validateConfig({ proxy: { fallback: { github: "yes" } } })).toThrow(
      ConfigValidationError,
    );
    for (const toolchain of [
      "auto",
      "current",
      "0.1.20251202+abc",
      "v0.10.15",
      "nightly-2026-06-17",
    ]) {
      expect(() => validateConfig({ proxy: { fallback: { toolchain } } })).not.toThrow();
    }
  });

  it("should keep download_url and symbols_url of a source", () => {
    const config = validateConfig({
      sources: [
        {
          name: "m",
          url: "https://mooncakes.io",
          index_url: "https://example.com/index.git",
          download_url: "https://download.example.com",
          symbols_url: "https://download.example.com/symbols.zip",
        },
      ],
    });
    expect(config.sources?.[0].download_url).toBe("https://download.example.com");
    expect(config.sources?.[0].symbols_url).toBe("https://download.example.com/symbols.zip");
  });

  describe("save and load", () => {
    let tempDir: string;
    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "moonbit-proxy-config-"));
    });
    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should write the proxy section and the source URLs", async () => {
      const config = validateConfig({
        proxy: { enabled: true, index_refresh_interval: "5m" },
        sources: [
          {
            name: "moonrockz",
            url: "https://mooncakes.io",
            index_url: "https://github.com/moonrockz/mooncakes-index.git",
            download_url: "https://download.mooncakes.io",
            symbols_url: "https://download.mooncakes.io/symbols.zip",
          },
        ],
      });
      const path = join(tempDir, "registry.toml");
      await saveConfig(config, path);
      const loaded = await loadConfig(path);

      expect(loaded.proxy).toEqual(config.proxy);
      expect(loaded.proxy?.fallback).toBeUndefined();
      expect(loaded.sources?.[0].download_url).toBe("https://download.mooncakes.io");
      expect(loaded.sources?.[0].symbols_url).toBe("https://download.mooncakes.io/symbols.zip");
    });
  });
});

describe("fallback configuration on disk", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-fallback-config-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should write and read back the [proxy.fallback] section", async () => {
    const config = validateConfig({
      proxy: {
        enabled: true,
        fallback: { github: true, toolchain: "current", manifest_url: "https://m.example.com" },
      },
    });
    const path = join(tempDir, "registry.toml");
    await saveConfig(config, path);
    expect(await Bun.file(path).text()).toContain("[proxy.fallback]");
    const loaded = await loadConfig(path);
    expect(loaded.proxy).toEqual(config.proxy);
    expect(resolveFallbackConfig(loaded).github).toBe(true);
  });
});

describe("source download URLs", () => {
  const manager = new SourceManager(validateConfig({}));
  const source = (fields: Partial<MirrorSource>): MirrorSource => ({
    name: "s",
    type: "custom",
    url: "https://registry.example.com",
    index_url: "https://registry.example.com/git/index",
    index_type: "git",
    enabled: true,
    ...fields,
  });

  it("should build zip URLs from download_url with encoded segments", () => {
    const s = source({ download_url: "https://dl.example.com/" });
    expect(manager.buildPackageUrl(s, "alice", "app", "1.0.0+build")).toBe(
      "https://dl.example.com/user/alice/app/1.0.0%2Bbuild.zip",
    );
  });

  it("should prefer package_url_pattern for zips", () => {
    const s = source({
      download_url: "https://dl.example.com",
      package_url_pattern: "${url}/files/${username}/${name}/${version}.zip",
    });
    expect(manager.buildPackageUrl(s, "alice", "app", "1.0.0")).toBe(
      "https://registry.example.com/files/alice/app/1.0.0.zip",
    );
  });

  it("should keep download.mooncakes.io as the zip default", () => {
    expect(manager.buildPackageUrl(source({}), "alice", "app", "1.0.0")).toBe(
      "https://download.mooncakes.io/user/alice/app/1.0.0.zip",
    );
  });

  it("should build prebuild URLs from the download base", () => {
    const mooncakes = { name: "mooncakes", ...PREDEFINED_SOURCES.mooncakes };
    expect(
      manager.buildPrebuildUrl(
        mooncakes,
        "moonbitlang",
        "parser",
        "0.3.3",
        ["cmd", "moonfmt"],
        "moonfmt.wasm",
      ),
    ).toBe(
      "https://download.mooncakes.io/prebuild/moonbitlang/parser@0.3.3/cmd/moonfmt/moonfmt.wasm",
    );
    // A chained proxy serves prebuilds below its own URL
    const chained = source({ type: "moonbit-registry" });
    expect(manager.buildPrebuildUrl(chained, "alice", "app", "1.0.0", [], "app.wasm")).toBe(
      "https://registry.example.com/prebuild/alice/app@1.0.0/app.wasm",
    );
  });

  it("should pick the symbols URL", () => {
    const mooncakes = { name: "mooncakes", ...PREDEFINED_SOURCES.mooncakes };
    expect(manager.getSymbolsUrl(mooncakes)).toBe("https://download.mooncakes.io/symbols.zip");
    expect(manager.getSymbolsUrl(source({ type: "moonbit-registry" }))).toBe(
      "https://registry.example.com/symbols.zip",
    );
    expect(manager.getSymbolsUrl(source({ symbols_url: "https://s.example.com/x.zip" }))).toBe(
      "https://s.example.com/x.zip",
    );
  });

  it("should have a preset for the moonrockz index mirror", () => {
    const preset = PREDEFINED_SOURCES.moonrockz;
    expect(preset.index_url).toBe("https://github.com/moonrockz/mooncakes-index.git");
    expect(preset.download_url).toBe("https://download.mooncakes.io");
  });
});

describe("default_source in the saved config", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "moonbit-default-source-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should load back as the default source", async () => {
    const source = { url: "https://mooncakes.io", index_url: "https://mooncakes.io/git/index" };
    const config = validateConfig({
      sources: [
        { name: "first", ...source },
        { name: "second", ...source },
      ],
      default_source: "second",
    });
    const path = join(tempDir, "registry.toml");
    await saveConfig(config, path);

    const loaded = await loadConfig(path);
    expect(loaded.default_source).toBe("second");
    expect(new SourceManager(loaded).getDefaultSourceName()).toBe("second");
  });
});
