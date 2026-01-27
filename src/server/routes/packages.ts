/**
 * Package download endpoint handlers
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";

export function createPackageRoutes(registry: Registry) {
  /** Handle package download request */
  async function handlePackageDownload(
    username: string,
    packageName: string,
    version: string
  ): Promise<Response> {
    // Check if package exists locally
    let packagePath = registry.packageStore.getPackageFile(username, packageName, version);

    if (!packagePath) {
      // Try to download from upstream if enabled
      if (registry.config.upstream.enabled) {
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
            checksum
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
  async function handlePackageInfo(
    username: string,
    packageName: string
  ): Promise<Response> {
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
    pathname: string
  ): Promise<Response | null> {
    // Match /user/{username}/{package}/{version}.zip
    const downloadMatch = pathname.match(
      /^\/user\/([^/]+)\/([^/]+)\/([^/]+)\.zip$/
    );
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
