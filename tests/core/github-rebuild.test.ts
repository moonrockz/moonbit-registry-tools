/**
 * Tests for the helpers of the GitHub rebuild
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unpackZip } from "../../src/core/fallback.ts";
import {
  findModuleRoot,
  parseGitHubRepository,
  readModuleName,
  tagCandidates,
} from "../../src/core/github-rebuild.ts";
import { makeZip } from "../helpers/fake-upstream.ts";

describe("parseGitHubRepository", () => {
  it("should read the usual forms of a GitHub URL", () => {
    const x = { owner: "moonbitlang", repo: "x" };
    expect(parseGitHubRepository("https://github.com/moonbitlang/x")).toEqual(x);
    expect(parseGitHubRepository("https://github.com/moonbitlang/x/")).toEqual(x);
    expect(parseGitHubRepository("https://github.com/moonbitlang/x.git")).toEqual(x);
    expect(parseGitHubRepository("http://www.github.com/moonbitlang/x")).toEqual(x);
    expect(parseGitHubRepository("git+https://github.com/moonbitlang/x.git")).toEqual(x);
    expect(parseGitHubRepository("git@github.com:moonbitlang/x.git")).toEqual(x);
    expect(parseGitHubRepository("https://github.com/moonbitlang/x/tree/main/sub")).toEqual(x);
  });

  it("should refuse other hosts and values", () => {
    expect(parseGitHubRepository("https://gitlab.com/a/b")).toBeNull();
    expect(parseGitHubRepository("https://github.com/only-owner")).toBeNull();
    expect(parseGitHubRepository("")).toBeNull();
    expect(parseGitHubRepository(undefined)).toBeNull();
    expect(parseGitHubRepository(42)).toBeNull();
  });
});

describe("tagCandidates", () => {
  it("should try v<version> first, then <version>", () => {
    expect(tagCandidates("0.5.6")).toEqual(["v0.5.6", "0.5.6"]);
  });
});

describe("readModuleName", () => {
  it("should read moon.mod.json and moon.mod", () => {
    expect(readModuleName('{"name": "alice/tiny", "version": "0.1.0"}', true)).toBe("alice/tiny");
    expect(readModuleName('name = "alice/tiny"\n\nversion = "0.1.0"\n', false)).toBe("alice/tiny");
    expect(readModuleName("not json", true)).toBeNull();
    expect(readModuleName('version = "0.1.0"', false)).toBeNull();
  });
});

describe("module files on disk", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "github-rebuild-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should find the module root whose name matches", async () => {
    await mkdir(join(dir, "repo-abc", "modules", "tiny"), { recursive: true });
    await mkdir(join(dir, "repo-abc", "_build", "x"), { recursive: true });
    await writeFile(join(dir, "repo-abc", "moon.mod.json"), '{"name": "alice/other"}');
    await writeFile(join(dir, "repo-abc", "_build", "x", "moon.mod"), 'name = "alice/tiny"');
    await writeFile(join(dir, "repo-abc", "modules", "tiny", "moon.mod"), 'name = "alice/tiny"');
    expect(await findModuleRoot(dir, "alice/tiny")).toBe(join(dir, "repo-abc", "modules", "tiny"));
    expect(await findModuleRoot(dir, "alice/other")).toBe(join(dir, "repo-abc"));
    expect(await findModuleRoot(dir, "alice/none")).toBeNull();
  });

  it("should unpack a zip and refuse entries that leave the directory", async () => {
    await unpackZip(makeZip({ "moon.mod": "m", "src/a.mbt": "a" }), join(dir, "ok"));
    expect(await Bun.file(join(dir, "ok", "src", "a.mbt")).text()).toBe("a");
    await expect(unpackZip(makeZip({ "../evil.txt": "x" }), join(dir, "bad"))).rejects.toThrow(
      /outside/,
    );
  });
});
