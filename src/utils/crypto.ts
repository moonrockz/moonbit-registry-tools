/**
 * Cryptographic utilities (SHA256 checksums)
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Calculate SHA256 hash of a string */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Calculate SHA256 hash of a file */
export async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** Verify a file's checksum */
export async function verifyChecksum(path: string, expected: string): Promise<boolean> {
  const actual = await sha256File(path);
  return actual.toLowerCase() === expected.toLowerCase();
}

/** Calculate SHA256 hash of a Blob/File */
export async function sha256Blob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return sha256(Buffer.from(buffer));
}

export const crypto = {
  sha256,
  sha256File,
  verifyChecksum,
  sha256Blob,
};

export default crypto;
