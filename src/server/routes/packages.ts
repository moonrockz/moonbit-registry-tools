/**
 * Package download endpoint handlers
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { ProxyError } from "../../core/proxy.ts";
import type { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";

export function createPackageRoutes(registry: Registry) {
  /** Handle package download request */
  async function handlePackageDownload(
    username: string,
    packageName: string,
    version: string,
  ): Promise<Response> {
    // Check if package exists locally
    let packagePath = registry.packageStore.getPackageFile(username, packageName, version);

    if (!packagePath && registry.proxy.enabled) {
      // Proxy mode: fetch only versions that the served index lists, and
      // cache them only when they match the index checksum
      const metadata = await registry.getPackage(username, packageName);
      const checksum = metadata?.versions.find((v) => v.version === version)?.checksum;
      if (!checksum) {
        return new Response("Package not found", { status: 404 });
      }
      try {
        packagePath = await registry.proxy.getZip(username, packageName, version, checksum);
      } catch (err) {
        const status = err instanceof ProxyError ? err.status : 502;
        const log = status === 404 ? logger.warn : logger.error;
        log(`Proxy fetch of ${username}/${packageName}@${version} failed: ${err}`);
        return new Response(status === 404 ? "Package not found" : "Bad gateway", { status });
      }
    } else if (!packagePath) {
      // Try to download from the default source if enabled
      if (registry.sourceManager.getDefaultSource()?.enabled) {
        try {
          logger.info(`Fetching ${username}/${packageName}@${version} from upstream`);

          // Get checksum from index
          const metadata = await registry.getPackage(username, packageName);
          const versionInfo = metadata?.versions.find((v) => v.version === version);
          const checksum = versionInfo?.checksum;

          packagePath = await registry.packageStore.downloadPackage(
            username,
            packageName,
            version,
            checksum,
          );
        } catch (err) {
          logger.error(`Failed to fetch package from upstream: ${err}`);
          return new Response("Package not found", { status: 404 });
        }
      } else {
        return new Response("Package not found", { status: 404 });
      }
    }

    if (!packagePath || !existsSync(packagePath)) {
      return new Response("Package not found", { status: 404 });
    }

    try {
      const file = Bun.file(packagePath);
      const stats = await stat(packagePath);

      return new Response(file, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": stats.size.toString(),
          "Content-Disposition": `attachment; filename="${version}.zip"`,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (err) {
      logger.error(`Failed to serve package: ${err}`);
      return new Response("Internal server error", { status: 500 });
    }
  }

  /** Handle package info request (JSON metadata) */
  async function handlePackageInfo(username: string, packageName: string): Promise<Response> {
    const metadata = await registry.getPackage(username, packageName);

    if (!metadata) {
      return new Response("Package not found", { status: 404 });
    }

    return new Response(JSON.stringify(metadata, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  /** Main router for package endpoints */
  return async function handlePackageRequest(
    _request: Request,
    rawPathname: string,
  ): Promise<Response | null> {
    // moon (with MOONCAKES_REGISTRY) encodes the slashes after `/user/`:
    // `/user/<owner>%2F<pkg>%2F<version>.zip`. Decode to one form.
    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    // Decoding can make `..` segments and backslashes; they must not leave the store
    if (pathname.split("/").some((segment) => segment === "." || segment === "..")) {
      return new Response("Bad request", { status: 400 });
    }
    if (pathname.includes("\\")) {
      return new Response("Bad request", { status: 400 });
    }

    // Match /user/{username}/{package}/{version}.zip
    const downloadMatch = pathname.match(/^\/user\/([^/]+)\/([^/]+)\/([^/]+)\.zip$/);
    if (downloadMatch) {
      const [, username, packageName, version] = downloadMatch;
      return handlePackageDownload(username, packageName, version);
    }

    // Match /user/{username}/{package} for package info
    const infoMatch = pathname.match(/^\/user\/([^/]+)\/([^/]+)$/);
    if (infoMatch) {
      const [, username, packageName] = infoMatch;
      return handlePackageInfo(username, packageName);
    }

    return null; // Not handled
  };
}

export default createPackageRoutes;
