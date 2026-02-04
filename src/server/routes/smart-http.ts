/**
 * Smart HTTP Protocol handlers (git-upload-pack only - read operations)
 *
 * Implements Git Smart HTTP protocol by delegating to git-http-backend CGI.
 */

import type { SmartHttpConfig } from "../../core/types.ts";
import { findGitHttpBackend, invokeCgi } from "../../utils/git-http-backend.ts";
import logger from "../../utils/logger.ts";

/** Content types for Smart HTTP protocol */
const CONTENT_TYPES = {
  infoRefsAdvertisement: "application/x-git-upload-pack-advertisement",
  uploadPackRequest: "application/x-git-upload-pack-request",
  uploadPackResult: "application/x-git-upload-pack-result",
} as const;

/** Smart HTTP handler options */
export interface SmartHttpOptions {
  config: SmartHttpConfig;
  indexDir: string;
}

/** Smart HTTP route handler result */
export interface SmartHttpHandlers {
  /** Whether Smart HTTP is available */
  available: boolean;
  /** Handle info/refs request with service parameter */
  handleInfoRefs: (request: Request, service: string) => Promise<Response>;
  /** Handle git-upload-pack POST request */
  handleUploadPack: (request: Request) => Promise<Response>;
}

/**
 * Create Smart HTTP route handlers
 * @param options Handler options
 * @returns Smart HTTP handlers or null if not available
 */
export function createSmartHttpHandlers(options: SmartHttpOptions): SmartHttpHandlers {
  const { config, indexDir } = options;

  // Find git-http-backend binary
  const backendPath = findGitHttpBackend(config.git_http_backend_path);

  if (!backendPath) {
    logger.warn("Smart HTTP disabled: git-http-backend not found");
    return createDisabledHandlers();
  }

  if (!config.enabled) {
    logger.debug("Smart HTTP disabled by configuration");
    return createDisabledHandlers();
  }

  logger.info(`Smart HTTP enabled with backend: ${backendPath}`);

  /**
   * Handle info/refs request with service parameter
   * GET /git/index/info/refs?service=git-upload-pack
   */
  async function handleInfoRefs(_request: Request, service: string): Promise<Response> {
    // Only support git-upload-pack (read operations)
    if (service === "git-receive-pack") {
      return new Response("Write operations not supported", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (service !== "git-upload-pack") {
      return new Response(`Unknown service: ${service}`, {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });
    }

    try {
      const response = await invokeCgi(backendPath, indexDir, {
        method: "GET",
        pathInfo: "/info/refs",
        queryString: `service=${service}`,
      });

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": CONTENT_TYPES.infoRefsAdvertisement,
          "Cache-Control": "no-cache",
          ...response.headers,
        },
      });
    } catch (err) {
      logger.error(`Smart HTTP info/refs error: ${err}`);
      return new Response("Internal server error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  /**
   * Handle git-upload-pack POST request
   * POST /git/index/git-upload-pack
   */
  async function handleUploadPack(request: Request): Promise<Response> {
    // Validate content type
    const contentType = request.headers.get("Content-Type");
    if (contentType !== CONTENT_TYPES.uploadPackRequest) {
      return new Response("Invalid Content-Type", {
        status: 415,
        headers: { "Content-Type": "text/plain" },
      });
    }

    try {
      const response = await invokeCgi(backendPath, indexDir, {
        method: "POST",
        pathInfo: "/git-upload-pack",
        contentType: CONTENT_TYPES.uploadPackRequest,
        body: request.body,
      });

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": CONTENT_TYPES.uploadPackResult,
          "Cache-Control": "no-cache",
          ...response.headers,
        },
      });
    } catch (err) {
      logger.error(`Smart HTTP git-upload-pack error: ${err}`);
      return new Response("Internal server error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  return {
    available: true,
    handleInfoRefs,
    handleUploadPack,
  };
}

/**
 * Create disabled Smart HTTP handlers that return 501
 */
function createDisabledHandlers(): SmartHttpHandlers {
  const notImplemented = () =>
    Promise.resolve(
      new Response("Smart HTTP not implemented", {
        status: 501,
        headers: { "Content-Type": "text/plain" },
      }),
    );

  return {
    available: false,
    handleInfoRefs: notImplemented,
    handleUploadPack: notImplemented,
  };
}

export default { createSmartHttpHandlers };
