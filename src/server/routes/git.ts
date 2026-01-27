/**
 * Git index endpoint handlers (Dumb HTTP protocol)
 *
 * Serves the git index as static files for dumb HTTP clients.
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";

export function createGitRoutes(registry: Registry) {
  const indexDir = registry.indexManager.path;

  /** Handle git info/refs request */
  async function handleInfoRefs(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const service = url.searchParams.get("service");

    if (service) {
      // Smart HTTP request - not supported yet
      return new Response("Smart HTTP not implemented", { status: 501 });
    }

    // Dumb HTTP: serve info/refs file
    const refsPath = join(indexDir, ".git", "info", "refs");
    return serveFile(refsPath, "text/plain");
  }

  /** Handle HEAD request */
  async function handleHead(): Promise<Response> {
    const headPath = join(indexDir, ".git", "HEAD");
    return serveFile(headPath, "text/plain");
  }

  /** Handle objects request (loose objects or packs) */
  async function handleObjects(path: string): Promise<Response> {
    const objectPath = join(indexDir, ".git", "objects", path);
    return serveFile(objectPath, "application/x-git-loose-object");
  }

  /** Handle refs request */
  async function handleRefs(path: string): Promise<Response> {
    const refPath = join(indexDir, ".git", "refs", path);
    return serveFile(refPath, "text/plain");
  }

  /** Handle pack files */
  async function handlePack(filename: string): Promise<Response> {
    const packPath = join(indexDir, ".git", "objects", "pack", filename);

    if (filename.endsWith(".pack")) {
      return serveFile(packPath, "application/x-git-packed-objects");
    }
    if (filename.endsWith(".idx")) {
      return serveFile(packPath, "application/x-git-packed-objects-toc");
    }

    return notFound();
  }

  /** Serve a static file */
  async function serveFile(path: string, contentType: string): Promise<Response> {
    if (!existsSync(path)) {
      logger.debug(`File not found: ${path}`);
      return notFound();
    }

    try {
      const file = Bun.file(path);
      const stats = await stat(path);

      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": stats.size.toString(),
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      logger.error(`Failed to serve file ${path}: ${err}`);
      return new Response("Internal server error", { status: 500 });
    }
  }

  function notFound(): Response {
    return new Response("Not found", { status: 404 });
  }

  /** Main router for git endpoints */
  return async function handleGitRequest(
    request: Request,
    pathname: string,
  ): Promise<Response | null> {
    // Remove /git/index prefix
    const gitPath = pathname.replace(/^\/git\/index\/?/, "");

    if (!gitPath || gitPath === "") {
      // Root of git repo - serve a simple info page
      return new Response("MoonBit Registry Git Index\n", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Route based on path
    if (gitPath === "info/refs") {
      return handleInfoRefs(request);
    }

    if (gitPath === "HEAD") {
      return handleHead();
    }

    if (gitPath.startsWith("objects/pack/")) {
      const filename = gitPath.replace("objects/pack/", "");
      return handlePack(filename);
    }

    if (gitPath.startsWith("objects/")) {
      const objPath = gitPath.replace("objects/", "");
      return handleObjects(objPath);
    }

    if (gitPath.startsWith("refs/")) {
      const refPath = gitPath.replace("refs/", "");
      return handleRefs(refPath);
    }

    // Try to serve as a generic file in .git
    const fullPath = join(indexDir, ".git", gitPath);
    if (existsSync(fullPath)) {
      return serveFile(fullPath, "application/octet-stream");
    }

    return null; // Not handled
  };
}

export default createGitRoutes;
