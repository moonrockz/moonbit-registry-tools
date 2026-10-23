/**
 * Registry HTTP server
 *
 * Serves package downloads and git index via Dumb HTTP protocol.
 */

import { UPSTREAM } from "../config/defaults.ts";
import type { Registry } from "../core/registry.ts";
import logger from "../utils/logger.ts";
import { compose, cors, errorHandler, requestLogger } from "./middleware.ts";
import createGitRoutes from "./routes/git.ts";
import createPackageRoutes from "./routes/packages.ts";

export interface ServerOptions {
  host?: string;
  port?: number;
}

export function createServer(registry: Registry, options: ServerOptions = {}) {
  const host = options.host ?? registry.config.server.host;
  const port = options.port ?? registry.config.server.port;

  const gitRoutes = createGitRoutes(registry, {
    smartHttp: registry.config.server.smart_http ?? { enabled: true },
  });
  const packageRoutes = createPackageRoutes(registry);

  /** Main request handler */
  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Health check
    if (pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // API info
    if (pathname === "/" || pathname === "/api") {
      return new Response(
        JSON.stringify({
          name: registry.config.registry.name,
          version: "0.1.0",
          endpoints: {
            git: "/git/index",
            packages: "/user/{username}/{package}/{version}.zip",
            health: "/health",
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // moon fetches the symbol database on update; a mirror cannot build it,
    // so send mooncakes clients to the upstream copy
    if (pathname === "/symbols.zip") {
      const source = registry.sourceManager.getDefaultSource();
      if (source?.enabled && source.type === "mooncakes") {
        return new Response(null, { status: 302, headers: { Location: UPSTREAM.SYMBOLS_URL } });
      }
      return new Response("Not found", { status: 404 });
    }

    // Git index routes
    if (pathname.startsWith("/git/index")) {
      const response = await gitRoutes(request, pathname);
      if (response) return response;
    }

    // Package routes
    if (pathname.startsWith("/user/")) {
      const response = await packageRoutes(request, pathname);
      if (response) return response;
    }

    // 404
    return new Response("Not found", { status: 404 });
  }

  // Apply middleware
  const middleware = compose(errorHandler, cors, requestLogger);
  const handler = middleware(handleRequest);

  return {
    start() {
      const server = Bun.serve({
        hostname: host,
        port,
        fetch: handler,
      });

      logger.success(`Server listening on http://${host}:${port}`);
      logger.info(`Git index: http://${host}:${port}/git/index`);
      logger.info(`Packages: http://${host}:${port}/user/{user}/{pkg}/{version}.zip`);
      if (registry.config.git.branch !== "main") {
        logger.warn(
          `Index branch is '${registry.config.git.branch}', but moon only fetches 'main'. Set git.branch = "main".`,
        );
      }

      return server;
    },
    handler,
    host,
    port,
  };
}

export default createServer;
