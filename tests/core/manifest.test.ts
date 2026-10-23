/**
 * Tests for archive manifests: the line format, the content digest and
 * `manifest build`
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManifests,
  compareWithManifest,
  contentDigest,
  createManifest,
  formatManifestLine,
  manifestFilePath,
  parseManifestFile,
  readManifest,
} from "../../src/core/manifest.ts";
import { sha256 } from "../../src/utils/crypto.ts";
import { zipEntryDigests } from "../../src/utils/zip.ts";
import { indexFile, makeZip } from "../helpers/fake-upstream.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "zips");
const LOCAL = new Uint8Array(await readFile(join(FIXTURES, "tiny-local.zip")));
const PUBLISHED = new Uint8Array(await readFile(join(FIXTURES, "tiny-published.zip")));

describe("createManifest", () => {
  it("should list the entries in archive order with the zip checksum", () => {
    const zip = makeZip({ "moon.mod": "m", "src/b.mbt": "b", "src/a.mbt": "a" });
    const manifest = createManifest("alice/app", "1.0.0", zip);
    expect(manifest.name).toBe("alice/app");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.checksum).toBe(sha256(Buffer.from(zip)));
    expect(manifest.entries.map((e) => e.path)).toEqual(["moon.mod", "src/b.mbt", "src/a.mbt"]);
    // content_digest: sha256 of "<path>\t<sha256>\n" lines sorted by path
    const lines = [
      `moon.mod\t${sha256("m")}\n`,
      `src/a.mbt\t${sha256("a")}\n`,
      `src/b.mbt\t${sha256("b")}\n`,
    ];
    expect(manifest.content_digest).toBe(sha256(lines.join("")));
  });

  it("should give the same content digest for the same files in another order", () => {
    const local = createManifest("alice/tiny", "0.1.0", LOCAL);
    const published = createManifest("alice/tiny", "0.1.0", PUBLISHED);
    expect(local.checksum).not.toBe(published.checksum);
    expect(local.content_digest).toBe(published.content_digest);
    expect(local.entries.map((e) => e.path)).not.toEqual(published.entries.map((e) => e.path));
  });

  it("should sort paths by bytes, not by locale", () => {
    const entries = [
      { path: "b", sha256: "2", size: 1 },
      { path: "B", sha256: "1", size: 1 },
      { path: "a", sha256: "3", size: 1 },
    ];
    expect(contentDigest(entries)).toBe(sha256("B\t1\na\t3\nb\t2\n"));
  });

  it("should write one JSON line and read it back", () => {
    const manifest = createManifest("alice/tiny", "0.1.0", PUBLISHED);
    const line = formatManifestLine(manifest);
    expect(line.includes("\n")).toBe(false);
    expect(Object.keys(JSON.parse(line))).toEqual([
      "name",
      "version",
      "checksum",
      "content_digest",
      "entries",
    ]);
    expect(parseManifestFile(`${line}\n\n${line}\n`)).toEqual([manifest, manifest]);
  });
});

describe("compareWithManifest", () => {
  it("should name entries that are missing, extra or changed", () => {
    const manifest = createManifest(
      "a/b",
      "1",
      makeZip({ "moon.mod": "m", "x.mbt": "x", "y.mbt": "y", "gone.mbt": "g" }),
    );
    const local = zipEntryDigests(
      makeZip({ "x.mbt": "x", "moon.mod": "m", "y.mbt": "Y", "new.mbt": "n" }),
    );
    const problems = compareWithManifest(manifest, local);
    expect(problems).toContain("missing: gone.mbt");
    expect(problems).toContain("extra: new.mbt");
    expect(problems.some((p) => p.startsWith("content differs: y.mbt"))).toBe(true);
    expect(problems.length).toBe(3);
  });

  it("should report nothing for the same files", () => {
    const manifest = createManifest("alice/tiny", "0.1.0", PUBLISHED);
    expect(compareWithManifest(manifest, zipEntryDigests(LOCAL))).toEqual([]);
  });
});

describe("manifest files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "manifest-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should keep manifests apart from the index files that moon reads", () => {
    expect(manifestFilePath(dir, "alice", "tiny")).toBe(
      join(dir, "manifests", "user", "alice", "tiny.manifest"),
    );
  });

  it("should find the line of a version", async () => {
    const v1 = createManifest("alice/tiny", "0.1.0", PUBLISHED);
    const v2 = createManifest("alice/tiny", "0.2.0", LOCAL);
    const path = manifestFilePath(dir, "alice", "tiny");
    await mkdir(join(dir, "manifests", "user", "alice"), { recursive: true });
    await writeFile(path, `${formatManifestLine(v1)}\n${formatManifestLine(v2)}\n`);
    expect(await readManifest(dir, "alice", "tiny", "0.2.0")).toEqual(v2);
    expect(await readManifest(dir, "alice", "tiny", "9.9.9")).toBeNull();
    expect(await readManifest(dir, "alice", "none", "0.1.0")).toBeNull();
  });
});

describe("buildManifests", () => {
  let dir: string;
  const zips: Record<string, Uint8Array> = {
    "alice/tiny@0.1.0": makeZip({ "moon.mod": "v1" }),
    "alice/tiny@0.2.0": makeZip({ "moon.mod": "v2" }),
    "alice/tiny@0.3.0": makeZip({ "moon.mod": "v3" }),
    "bob/dep@1.0.0": makeZip({ "moon.mod": "dep" }),
  };
  let downloads: string[];
  const download = async (owner: string, name: string, version: string) => {
    const id = `${owner}/${name}@${version}`;
    downloads.push(id);
    const zip = zips[id];
    if (!zip) throw new Error(`404 ${id}`);
    return zip;
  };
  const entry = (name: string, version: string, checksum?: string) => ({
    name,
    version,
    checksum: checksum ?? sha256(Buffer.from(zips[`${name}@${version}`])),
    deps: {},
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "manifest-build-test-"));
    downloads = [];
    await mkdir(join(dir, "user", "alice"), { recursive: true });
    await mkdir(join(dir, "user", "bob"), { recursive: true });
    await writeFile(
      join(dir, "user", "alice", "tiny.index"),
      indexFile([
        entry("alice/tiny", "0.1.0"),
        entry("alice/tiny", "0.2.0"),
        entry("alice/tiny", "0.3.0"),
      ]),
    );
    await writeFile(join(dir, "user", "bob", "dep.index"), indexFile([entry("bob/dep", "1.0.0")]));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const versionsIn = async (owner: string, pkg: string) =>
    parseManifestFile(await readFile(manifestFilePath(dir, owner, pkg), "utf8")).map(
      (m) => m.version,
    );

  it("should add a line for each version, and nothing on a second run", async () => {
    const first = await buildManifests({ indexDir: dir, download });
    expect(first).toEqual({ added: 4, existing: 0, failed: 0, remaining: 0 });
    expect(await versionsIn("alice", "tiny")).toEqual(["0.1.0", "0.2.0", "0.3.0"]);
    expect(await versionsIn("bob", "dep")).toEqual(["1.0.0"]);
    const line = await readManifest(dir, "alice", "tiny", "0.2.0");
    expect(line?.checksum).toBe(sha256(Buffer.from(zips["alice/tiny@0.2.0"])));

    downloads = [];
    const before = await readFile(manifestFilePath(dir, "alice", "tiny"), "utf8");
    const second = await buildManifests({ indexDir: dir, download });
    expect(second).toEqual({ added: 0, existing: 4, failed: 0, remaining: 0 });
    expect(downloads).toEqual([]);
    expect(await readFile(manifestFilePath(dir, "alice", "tiny"), "utf8")).toBe(before);
  });

  it("should stop after --limit new lines and continue on the next run", async () => {
    const first = await buildManifests({ indexDir: dir, download, limit: 2, concurrency: 1 });
    expect(first.added).toBe(2);
    expect(first.remaining).toBe(2);
    const second = await buildManifests({ indexDir: dir, download, concurrency: 3 });
    expect(second).toEqual({ added: 2, existing: 2, failed: 0, remaining: 0 });
    expect(await versionsIn("alice", "tiny")).toEqual(["0.1.0", "0.2.0", "0.3.0"]);
  });

  it("should keep the index order when a missing version is added later", async () => {
    await buildManifests({ indexDir: dir, download, packages: ["alice/*"] });
    const path = manifestFilePath(dir, "alice", "tiny");
    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    // Remove the middle version, as if it failed before
    await writeFile(path, `${lines[0]}\n${lines[2]}\n`);
    const result = await buildManifests({ indexDir: dir, download, packages: ["alice/*"] });
    expect(result.added).toBe(1);
    expect(await versionsIn("alice", "tiny")).toEqual(["0.1.0", "0.2.0", "0.3.0"]);
  });

  it("should only visit packages that match --packages", async () => {
    const result = await buildManifests({ indexDir: dir, download, packages: ["bob/*"] });
    expect(result.added).toBe(1);
    expect(downloads).toEqual(["bob/dep@1.0.0"]);
  });

  it("should not add a line when the zip does not match the index checksum", async () => {
    await writeFile(
      join(dir, "user", "bob", "dep.index"),
      indexFile([entry("bob/dep", "1.0.0", sha256("other"))]),
    );
    const result = await buildManifests({ indexDir: dir, download, packages: ["bob/dep"] });
    expect(result).toEqual({ added: 0, existing: 0, failed: 1, remaining: 0 });
    expect(await readManifest(dir, "bob", "dep", "1.0.0")).toBeNull();
  });

  it("should count a failed download and continue", async () => {
    await writeFile(
      join(dir, "user", "bob", "dep.index"),
      indexFile([entry("bob/dep", "1.0.0"), { ...entry("bob/dep", "1.0.0"), version: "2.0.0" }]),
    );
    const result = await buildManifests({ indexDir: dir, download, packages: ["bob/dep"] });
    expect(result).toEqual({ added: 1, existing: 0, failed: 1, remaining: 0 });
  });
});
