/**
 * Tests for the zip reader and the entry reorder
 *
 * The fixtures come from `moon package` (tiny-local.zip) and from an
 * independent reorder of it (tiny-published.zip), so the published order is
 * different from the order that moon writes.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { sha256 } from "../../src/utils/crypto.ts";
import { listZipEntries, reorderZip, zipEntryDigests } from "../../src/utils/zip.ts";
import { makeZip } from "../helpers/fake-upstream.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const LOCAL = new Uint8Array(await readFile(join(FIXTURES, "zips", "tiny-local.zip")));
const PUBLISHED = new Uint8Array(await readFile(join(FIXTURES, "zips", "tiny-published.zip")));
const PUBLISHED_SHA256 = "b108889bdf53eafd4ebda4825571b304199c318f36c442caa9fa63b666daf94d";

const names = (zip: Uint8Array) => listZipEntries(zip).map((e) => e.name);

describe("reorderZip", () => {
  it("should rebuild the published zip byte for byte from the local zip", () => {
    const rebuilt = reorderZip(LOCAL, names(PUBLISHED));
    expect(sha256(Buffer.from(rebuilt))).toBe(PUBLISHED_SHA256);
    expect(Buffer.from(rebuilt).equals(Buffer.from(PUBLISHED))).toBe(true);
  });

  it("should give the same bytes for the same order", () => {
    const rebuilt = reorderZip(LOCAL, names(LOCAL));
    expect(Buffer.from(rebuilt).equals(Buffer.from(LOCAL))).toBe(true);
  });

  it("should refuse an order with other entries", () => {
    const order = names(PUBLISHED).slice(1);
    expect(() => reorderZip(LOCAL, order)).toThrow(/entries/);
    expect(() => reorderZip(LOCAL, [...names(PUBLISHED), "extra.mbt"])).toThrow(/entries/);
  });

  it("should refuse entries with a data descriptor", () => {
    const zip = makeZip({ "a.txt": "a", "b.txt": "b" });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // Set general purpose flag bit 3 in the central directory record of the first entry
    const centralOffset = view.getUint32(zip.length - 22 + 16, true);
    view.setUint16(centralOffset + 8, 0x08, true);
    expect(() => reorderZip(zip, ["b.txt", "a.txt"])).toThrow(/data descriptor/);
  });

  it("should round-trip a zip from a real moon package", async () => {
    const moon = Bun.which("moon");
    if (!moon) return; // The committed fixtures cover this without moon
    const dir = await mkdtemp(join(tmpdir(), "zip-reorder-moon-"));
    try {
      await $`cp -R ${join(FIXTURES, "tiny-module")}/. ${dir}`.quiet();
      const result = await $`${moon} package`.cwd(dir).quiet().nothrow();
      if (result.exitCode !== 0) return; // A toolchain that cannot package the fixture
      const local = new Uint8Array(
        await readFile(join(dir, "_build", "publish", "alice-tiny-0.1.0.zip")),
      );
      const reversed = reorderZip(local, names(local).reverse());
      expect(names(reversed)).toEqual(names(local).reverse());
      const back = reorderZip(reversed, names(local));
      expect(Buffer.from(back).equals(Buffer.from(local))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("zipEntryDigests", () => {
  it("should list path, sha256 and size of each entry in archive order", () => {
    const zip = makeZip({ "moon.mod": 'name = "a/b"', "src/x.mbt": "fn x {}" });
    expect(zipEntryDigests(zip)).toEqual([
      { path: "moon.mod", sha256: sha256('name = "a/b"'), size: 12 },
      { path: "src/x.mbt", sha256: sha256("fn x {}"), size: 7 },
    ]);
  });

  it("should read deflated entries of a moon package zip", () => {
    const digests = zipEntryDigests(PUBLISHED);
    expect(digests.map((d) => d.path)).toEqual(names(PUBLISHED));
    const readme = digests.find((d) => d.path === "README.md");
    expect(readme).toEqual({ path: "README.md", sha256: sha256("# tiny\n"), size: 7 });
  });
});
