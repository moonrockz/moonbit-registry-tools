/**
 * Prebuilt wasm assets: request paths and executable packages
 *
 * moon (`moonx`, `moon runwasm`) downloads the prebuilt wasm of an executable
 * package from `<download>/prebuild/<owner>/<name>@<version>[/<package path>]/<last segment>.wasm`
 * and checks it against the same URL with `.sha256` appended. Legacy clients
 * use `<registry>/assets/...` with the same layout.
 */

import { listZipEntries, readZipEntry } from "../utils/zip.ts";

/** One prebuilt wasm file of a package version */
export interface PrebuildAsset {
  owner: string;
  name: string;
  version: string;
  /** Package path inside the module, empty for the module root package */
  packagePath: string[];
  /** File name of the wasm, for example `moonfmt.wasm` */
  file: string;
}

export type AssetPathResult =
  | { kind: "asset"; asset: PrebuildAsset; checksum: boolean }
  | { kind: "invalid" }
  | { kind: "none" };

/**
 * Parse the part of a request path after `/prebuild/` or `/assets/`.
 * Each segment is decoded on its own, so an encoded `/` cannot add a segment.
 */
export function parseAssetPath(rawRest: string): AssetPathResult {
  const segments: string[] = [];
  for (const raw of rawRest.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return { kind: "invalid" };
    }
    if (segment === "" || segment === "." || segment === ".." || /[/\\\0]/.test(segment)) {
      return { kind: "invalid" };
    }
    segments.push(segment);
  }

  if (segments.length < 3) return { kind: "none" };
  const last = segments[segments.length - 1];
  const checksum = last.endsWith(".wasm.sha256");
  if (!checksum && !last.endsWith(".wasm")) return { kind: "none" };

  const [owner, nameVersion] = segments;
  const at = nameVersion.lastIndexOf("@");
  const name = nameVersion.slice(0, at);
  const version = nameVersion.slice(at + 1);
  if (at < 0 || name === "" || version === "" || owner.includes("@")) {
    return { kind: "invalid" };
  }

  return {
    kind: "asset",
    checksum,
    asset: {
      owner,
      name,
      version,
      packagePath: segments.slice(2, -1),
      file: checksum ? last.slice(0, -".sha256".length) : last,
    },
  };
}

/** The wasm file name moon asks for: the last segment of the package path */
export function wasmArtifactName(moduleName: string, packagePath: string[]): string {
  const stem = packagePath.length > 0 ? packagePath[packagePath.length - 1] : moduleName;
  return `${stem}.wasm`;
}

const EXECUTABLE_PATTERNS = [
  /"is[-_]main"\s*:\s*true/,
  /pkgtype\s*\(\s*kind\s*:\s*"executable"/,
  /"pkgtype"\s*:\s*\{\s*"kind"\s*:\s*"executable"/,
];

/**
 * Find the executable packages in a module archive. Returns package paths
 * relative to the module source directory (empty for the root package).
 */
export function findExecutablePackages(archive: Uint8Array): string[][] {
  const entries = listZipEntries(archive);
  const decoder = new TextDecoder();
  const read = (name: string): string | null => {
    const entry = entries.find((e) => e.name === name);
    return entry ? decoder.decode(readZipEntry(archive, entry)) : null;
  };

  const moduleFile = read("moon.mod.json") ?? read("moon.mod") ?? "";
  const sourceMatch = moduleFile.match(/"?source"?\s*[:=]\s*"([^"]*)"/);
  const sourceDir = (sourceMatch?.[1] ?? "").replace(/^\.\/?/, "").replace(/\/+$/, "");
  const prefix = sourceDir === "" ? "" : `${sourceDir}/`;

  const packages: string[][] = [];
  for (const entry of entries) {
    const match = entry.name.match(/^(?:(.*)\/)?moon\.pkg(?:\.json)?$/);
    if (!match) continue;
    const dir = match[1] ?? "";
    const inSource = prefix === "" || dir === sourceDir || `${dir}/`.startsWith(prefix);
    if (!inSource) continue;
    const content = decoder.decode(readZipEntry(archive, entry));
    if (!EXECUTABLE_PATTERNS.some((pattern) => pattern.test(content))) continue;

    const relDir = dir === sourceDir ? "" : dir.slice(prefix.length);
    const packagePath = relDir === "" ? [] : relDir.split("/");
    if (!packages.some((p) => p.join("/") === packagePath.join("/"))) {
      packages.push(packagePath);
    }
  }
  return packages;
}
