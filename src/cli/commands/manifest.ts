/**
 * manifest command - Archive manifests for the checked GitHub fallback
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import { buildManifests, createManifest, formatManifestLine } from "../../core/manifest.ts";
import { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";
import { listZipEntries, readZipEntry } from "../../utils/zip.ts";
import { handleError, resolvePath } from "../utils.ts";

interface BuildOptions {
  index: string;
  packages?: string[];
  limit?: string;
  concurrency?: string;
  dir?: string;
  downloadUrl?: string;
}

/** Read the module name and version of a zip from its moon.mod.json or moon.mod */
function readModuleInfo(zip: Uint8Array): { name: string; version: string } {
  const entries = listZipEntries(zip);
  const decoder = new TextDecoder();
  for (const file of ["moon.mod.json", "moon.mod"]) {
    const entry = entries.find((e) => e.name === file);
    if (!entry) continue;
    const text = decoder.decode(readZipEntry(zip, entry));
    const field = (key: string) => text.match(new RegExp(`"?${key}"?\\s*[:=]\\s*"([^"]*)"`))?.[1];
    return { name: field("name") ?? "", version: field("version") ?? "" };
  }
  return { name: "", version: "" };
}

function parseCount(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${option} must be a whole number of 1 or more`);
  }
  return count;
}

export function registerManifestCommand(program: Command): void {
  const manifest = program
    .command("manifest")
    .description("Print the manifest line of a zip, or build manifests for an index")
    .argument("[zip]", "Zip file of a package version")
    .option("--name <name>", "Module name (default: from moon.mod or moon.mod.json in the zip)")
    .option("--pkg-version <version>", "Version (default: from the zip)")
    .action(
      async (zipPath: string | undefined, options: { name?: string; pkgVersion?: string }) => {
        try {
          if (!zipPath) {
            manifest.help();
          }
          const zip = new Uint8Array(await readFile(resolvePath(zipPath as string)));
          const info = readModuleInfo(zip);
          const name = options.name ?? info.name;
          const version =
            options.pkgVersion ?? (info.version || basename(zipPath as string, ".zip"));
          console.log(formatManifestLine(createManifest(name, version, zip)));
        } catch (error) {
          handleError(error);
        }
      },
    );

  manifest
    .command("build")
    .description(
      "Add the missing manifest lines for the versions of an index (manifests/user/<owner>/<pkg>.manifest)",
    )
    .requiredOption("--index <dir>", "Index directory with user/<owner>/<pkg>.index files")
    .option("--packages <glob...>", "Only packages that match, for example 'moonbitlang/*'")
    .option("--limit <n>", "Add at most n new lines in this run")
    .option("--concurrency <n>", "Downloads at the same time (default 4)")
    .option("-d, --dir <path>", "Registry directory whose default source gives the zips")
    .option("--download-url <url>", "Download zips from <url>/user/<owner>/<pkg>/<version>.zip")
    .action(async (options: BuildOptions) => {
      try {
        const registry = await Registry.load(resolvePath(options.dir ?? "."));
        const source = registry.sourceManager.getSource();
        if (!source && !options.downloadUrl) {
          throw new Error("No default source is configured; use --download-url");
        }
        const sm = registry.sourceManager;
        const download = async (owner: string, name: string, version: string) => {
          const url = options.downloadUrl
            ? `${options.downloadUrl.replace(/\/+$/, "")}/user/${owner}/${name}/${encodeURIComponent(version)}.zip`
            : sm.buildPackageUrl(source as NonNullable<typeof source>, owner, name, version);
          const fetchOptions = source && !options.downloadUrl ? sm.getFetchOptions(source) : {};
          const response = await fetch(url, {
            ...fetchOptions,
            redirect: "follow",
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
          if (!response.ok) throw new Error(`${url} returned ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        };

        const result = await buildManifests({
          indexDir: resolvePath(options.index),
          packages: options.packages,
          limit: parseCount(options.limit, "--limit"),
          concurrency: parseCount(options.concurrency, "--concurrency"),
          download,
        });
        logger.success(
          `Manifests: ${result.added} added, ${result.existing} already present, ` +
            `${result.failed} failed, ${result.remaining} left for a later run`,
        );
        if (result.failed > 0) process.exitCode = 1;
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerManifestCommand;
