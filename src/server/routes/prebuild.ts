/**
 * Prebuilt wasm endpoint handlers
 *
 * `/prebuild/<owner>/<name>@<version>[/<package path>]/<file>.wasm[.sha256]`
 * and the legacy `/assets/...` form. Proxy mode fetches a missing asset from
 * the default source; mirror mode serves only assets that are cached.
 */

import { stat } from "node:fs/promises";
import { parseAssetPath } from "../../core/prebuild.ts";
import { ProxyError } from "../../core/proxy.ts";
import type { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";

export const PREBUILD_PREFIXES = ["/prebuild/", "/assets/"] as const;

export function createPrebuildRoutes(registry: Registry) {
  async function serve(
    path: string,
    contentType: string,
    builtLocally: boolean,
  ): Promise<Response> {
    const stats = await stat(path);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": stats.size.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    // A wasm that this proxy built is not the upstream file; say so
    if (builtLocally) headers["X-Registry-Built-Locally"] = "true";
    return new Response(Bun.file(path), { headers });
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
    let paths = registry.proxy.findCachedPrebuild(asset);

    if (!paths) {
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

    const builtLocally = paths.builtLocally === true;
    return checksum
      ? serve(paths.checksum, "text/plain; charset=utf-8", builtLocally)
      : serve(paths.wasm, "application/wasm", builtLocally);
  };
}

export default createPrebuildRoutes;
