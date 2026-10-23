/**
 * Registry HTTP server
 *
 * Serves package downloads and git index via Dumb HTTP protocol.
 */

import { UPSTREAM } from "../config/defaults.ts";
import { ProxyError } from "../core/proxy.ts";
import type { Registry } from "../core/registry.ts";
import logger from "../utils/logger.ts";
import { compose, cors, errorHandler, requestLogger } from "./middleware.ts";
import createGitRoutes from "./routes/git.ts";
import createPackageRoutes from "./routes/packages.ts";
import createPrebuildRoutes, { PREBUILD_PREFIXES } from "./routes/prebuild.ts";

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
  const prebuildRoutes = createPrebuildRoutes(registry);

  /** Serve the cached symbols.zip of proxy mode */
  async function serveSymbols(): Promise<Response> {
    try {
      const path = await registry.proxy.getSymbols();
      return new Response(Bun.file(path), {
        headers: { "Content-Type": "application/zip", "Cache-Control": "no-cache" },
      });
    } catch (err) {
      logger.error(`Proxy fetch of symbols.zip failed: ${err}`);
      const status = err instanceof ProxyError ? err.status : 502;
      return new Response(status === 404 ? "Not found" : "Bad gateway", { status });
    }
  }

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
            prebuild: "/prebuild/{username}/{package}@{version}/{path}/{file}.wasm",
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
      if (registry.proxy.enabled) {
        return serveSymbols();
      }
      const source = registry.sourceManager.getDefaultSource();
      if (source?.enabled && source.type === "mooncakes") {
        return new Response(null, { status: 302, headers: { Location: UPSTREAM.SYMBOLS_URL } });
      }
      return new Response("Not found", { status: 404 });
    }

    // Git index routes
    if (pathname.startsWith("/git/index")) {
      // moon keeps the index it clones, so do not hand out an empty one
      if (registry.proxy.enabled && !registry.proxy.indexReady) {
        return new Response("Proxy index is not ready yet, try again soon\n", {
          status: 503,
          headers: { "Retry-After": "10", "Content-Type": "text/plain" },
        });
      }
      const response = await gitRoutes(request, pathname);
      if (response) return response;
    }

    // Package routes
    if (pathname.startsWith("/user/")) {
      const response = await packageRoutes(request, pathname);
      if (response) return response;
    }

    // Prebuilt wasm routes
    if (PREBUILD_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      const response = await prebuildRoutes(request, pathname);
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
        fetch(request, server) {
          // A fallback build can take minutes; Bun closes idle connections after 10 s
          if (registry.proxy.enabled && registry.proxy.fallbacks.anyEnabled) {
            const path = new URL(request.url).pathname;
            if (path.startsWith("/user/") || PREBUILD_PREFIXES.some((p) => path.startsWith(p))) {
              server.timeout(request, 0);
            }
          }
          return handler(request);
        },
      });

      logger.success(`Server listening on http://${host}:${port}`);
      logger.info(`Git index: http://${host}:${port}/git/index`);
      logger.info(`Packages: http://${host}:${port}/user/{user}/{pkg}/{version}.zip`);
      if (registry.proxy.enabled) {
        const source = registry.sourceManager.getDefaultSource();
        logger.info(`Proxy mode: caching files from source '${source?.name ?? "none"}'`);
        // Fallback builds get their dependencies through this server
        registry.proxy.fallbacks.selfUrl = `http://127.0.0.1:${server.port}`;
        const fallback = registry.proxy.fallbacks.config;
        if (registry.proxy.fallbacks.anyEnabled) {
          const on = [
            fallback.github && "GitHub rebuild",
            fallback.build_wasm && "local wasm build",
          ];
          logger.info(
            `Proxy fallbacks: ${on.filter(Boolean).join(", ")} (toolchain ${fallback.toolchain})`,
          );
          void registry.proxy.fallbacks.ready();
        }
      }
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
