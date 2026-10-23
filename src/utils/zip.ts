/**
 * Minimal zip reader (stored and deflated entries, no ZIP64), and a rewriter
 * that puts the entries of a zip in a different order
 */

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
  /** General purpose bit flags from the central directory */
  flags: number;
  /** The full central directory record (header, name, extra field, comment) */
  centralRecord: Uint8Array;
}

/** Content identity of one zip entry */
export interface ZipEntryDigest {
  path: string;
  /** SHA-256 of the uncompressed content */
  sha256: string;
  /** Uncompressed size */
  size: number;
}

/** General purpose flag bit 3: sizes and CRC follow the data in a data descriptor */
const FLAG_DATA_DESCRIPTOR = 0x08;

const END_OF_CENTRAL_DIR = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** List the entries of a zip archive */
export function listZipEntries(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = findEndOfCentralDir(data);

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) {
      throw new Error("Bad zip central directory");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    entries.push({
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
      name: decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength)),
      centralRecord: data.subarray(offset, offset + recordLength),
    });
    offset += recordLength;
  }

  return entries;
}

/** Find the end of central directory record */
function findEndOfCentralDir(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIR) return i;
  }
  throw new Error("Not a zip archive");
}

/** The local header and data of an entry, as they are in the archive */
function localRecord(data: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > data.length || view.getUint32(offset, true) !== LOCAL_FILE_HEADER) {
    throw new Error(`Bad zip local header for ${entry.name}`);
  }
  const length =
    30 +
    view.getUint16(offset + 26, true) +
    view.getUint16(offset + 28, true) +
    entry.compressedSize;
  if (offset + length > data.length) {
    throw new Error(`Zip entry ${entry.name} is truncated`);
  }
  return data.subarray(offset, offset + length);
}

/**
 * Write the entries of a zip in the given order. The local headers, data and
 * central directory records are copied byte for byte; only the offsets in the
 * central directory change. `order` must name each entry exactly once.
 * Entries with a data descriptor are refused, because their records do not
 * give the size of the data.
 */
export function reorderZip(data: Uint8Array, order: string[]): Uint8Array {
  const entries = listZipEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const sameSet =
    byName.size === entries.length &&
    order.length === entries.length &&
    new Set(order).size === order.length &&
    order.every((name) => byName.has(name));
  if (!sameSet) {
    throw new Error("The order does not name the same entries as the zip");
  }

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const name of order) {
    const entry = byName.get(name) as ZipEntry;
    if (entry.flags & FLAG_DATA_DESCRIPTOR) {
      throw new Error(`Zip entry ${name} has a data descriptor, which is not supported`);
    }
    const local = localRecord(data, entry);
    const central = new Uint8Array(entry.centralRecord);
    new DataView(central.buffer).setUint32(42, offset, true);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const end = findEndOfCentralDir(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const comment = data.subarray(end + 22, end + 22 + view.getUint16(end + 20, true));
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22 + comment.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, END_OF_CENTRAL_DIR, true);
  ev.setUint16(8, order.length, true);
  ev.setUint16(10, order.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  eocd.set(comment, 22);

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Path, SHA-256 and size of the content of each entry, in archive order */
export function zipEntryDigests(data: Uint8Array): ZipEntryDigest[] {
  return listZipEntries(data).map((entry) => {
    const content = readZipEntry(data, entry);
    return {
      path: entry.name,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: content.length,
    };
  });
}

/** Read the uncompressed content of a zip entry */
export function readZipEntry(data: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER) {
    throw new Error(`Bad zip local header for ${entry.name}`);
  }
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.name}`);
}

export default { listZipEntries, readZipEntry, reorderZip, zipEntryDigests };
