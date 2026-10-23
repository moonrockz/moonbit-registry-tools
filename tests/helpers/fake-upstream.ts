/**
 * Local fake upstreams for proxy tests
 *
 * The fake download host copies download.mooncakes.io: every request gets a
 * 302 to a CDN path, and the CDN path serves the file or 404.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Server } from "bun";
import { $ } from "bun";

export interface FakeDownloadHost {
  server: Server<undefined>;
  url: string;
  /** Files by request path, for example `/user/alice/app/1.0.0.zip` */
  files: Map<string, Uint8Array | string>;
  /** Number of CDN requests by request path */
  hits: Map<string, number>;
  /** Delay before the CDN answers, in milliseconds */
  delayMs: number;
  /** When true, every request gets a 503 */
  failing: boolean;
  hitCount(path: string): number;
  stop(): void;
}

export function startFakeDownloadHost(): FakeDownloadHost {
  const host: FakeDownloadHost = {
    // Set below; the fetch handler only runs after Bun.serve returns
    server: undefined as unknown as Server<undefined>,
    url: "",
    files: new Map(),
    hits: new Map(),
    delayMs: 0,
    failing: false,
    hitCount(path: string) {
      return host.hits.get(path) ?? 0;
    },
    stop() {
      host.server.stop(true);
    },
  };

  host.server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (host.failing) {
        return new Response("Service unavailable", { status: 503 });
      }
      if (!path.startsWith("/cdn/")) {
        return new Response(null, { status: 302, headers: { Location: `/cdn${path}` } });
      }
      const original = path.slice("/cdn".length);
      host.hits.set(original, host.hitCount(original) + 1);
      if (host.delayMs > 0) await Bun.sleep(host.delayMs);
      const body = host.files.get(original);
      return body === undefined ? new Response("Not found", { status: 404 }) : new Response(body);
    },
  });
  host.url = `http://localhost:${host.server.port}`;
  return host;
}

/** Create a git index repository with the given files and one commit on main */
export async function createGitIndex(dir: string, files: Record<string, string>): Promise<void> {
  await writeIndexFiles(dir, files);
  await $`git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm init`
    .cwd(dir)
    .quiet();
}

/** Write files into an index repository and commit them */
export async function commitIndexFiles(
  dir: string,
  files: Record<string, string>,
  remove: string[] = [],
): Promise<void> {
  await writeIndexFiles(dir, files);
  for (const path of remove) {
    await $`git rm -q ${path}`.cwd(dir).quiet();
  }
  await $`git add . && git -c user.name=t -c user.email=t@t commit -qm update`.cwd(dir).quiet();
}

async function writeIndexFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

/** Make a JSONL index file from entries */
export function indexFile(entries: Record<string, unknown>[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

/** Make a zip archive with stored (not compressed) entries */
export function makeZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = Bun.hash.crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return Buffer.concat([...locals, ...centrals, end]);
}
