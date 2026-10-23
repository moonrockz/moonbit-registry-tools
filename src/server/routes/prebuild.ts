/**
 * Prebuilt wasm endpoint handlers
 *
 * `/prebuild/<owner>/<name>@<version>[/<package path>]/<file>.wasm[.sha256]`
 * and the legacy `/assets/...` form. Proxy mode fetches a missing asset from
 * the default source; mirror mode serves only assets that are cached.
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { parseAssetPath } from "../../core/prebuild.ts";
import { ProxyError } from "../../core/proxy.ts";
import type { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";

export const PREBUILD_PREFIXES = ["/prebuild/", "/assets/"] as const;

export function createPrebuildRoutes(registry: Registry) {
  async function serve(path: string, contentType: string): Promise<Response> {
    const stats = await stat(path);
    return new Response(Bun.file(path), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": stats.size.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  return async function handlePrebuildRequest(
    _request: Request,
    rawPathname: string,
  ): Promise<Response | null> {
    const prefix = PREBUILD_PREFIXES.find((p) => rawPathname.startsWith(p));
    if (!prefix) return null;

    const parsed = parseAssetPath(rawPathname.slice(prefix.length));
    if (parsed.kind === "invalid") {
      return new Response("Bad request", { status: 400 });
    }
    if (parsed.kind === "none") {
      return new Response("Not found", { status: 404 });
    }

    const { asset, checksum } = parsed;
    let paths = registry.proxy.prebuildPaths(asset);
    const cached = existsSync(paths.wasm) && existsSync(paths.checksum);

    if (!cached) {
      if (!registry.proxy.enabled) {
        return new Response("Not found", { status: 404 });
      }
      // Ask upstream only for versions that the served index lists
      const metadata = await registry.getPackage(asset.owner, asset.name);
      if (!metadata?.versions.some((v) => v.version === asset.version)) {
        return new Response("Not found", { status: 404 });
      }
      try {
        paths = await registry.proxy.getPrebuild(asset);
      } catch (err) {
        const status = err instanceof ProxyError ? err.status : 502;
        if (status === 404) {
          logger.debug(`No prebuild upstream: ${err}`);
        } else {
          logger.error(`Proxy fetch of prebuild failed: ${err}`);
        }
        return new Response(status === 404 ? "Not found" : "Bad gateway", { status });
      }
    }

    return checksum
      ? serve(paths.checksum, "text/plain; charset=utf-8")
      : serve(paths.wasm, "application/wasm");
  };
}

export default createPrebuildRoutes;
