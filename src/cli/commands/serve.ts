/**
 * serve command - Start the registry server
 */

import type { Command } from "commander";
import { resolveProxyConfig } from "../../config/schema.ts";
import { Registry } from "../../core/registry.ts";
import createServer from "../../server/index.ts";
import logger from "../../utils/logger.ts";
import { handleError, resolvePath } from "../utils.ts";

interface ServeCommandOptions {
  port?: string;
  host?: string;
  dir?: string;
  proxy?: boolean;
}

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the registry server")
    .option("-p, --port <port>", "Port to listen on")
    .option("-h, --host <host>", "Host to bind to")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .option(
      "--proxy",
      "Caching proxy mode: serve the full index of the default source and fetch files on a miss",
    )
    .action(async (options: ServeCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);
        if (options.proxy) {
          registry.config.proxy = { ...resolveProxyConfig(registry.config), enabled: true };
        }

        const serverOptions = {
          port: options.port ? Number.parseInt(options.port, 10) : undefined,
          host: options.host,
        };

        // Registries mirrored by older versions lack the dumb HTTP info files
        await registry.indexManager.updateServerInfo();

        const server = createServer(registry, serverOptions);

        // Handle shutdown
        process.on("SIGINT", () => {
          logger.info("Shutting down server...");
          registry.proxy.stopIndexRefresh();
          process.exit(0);
        });

        process.on("SIGTERM", () => {
          logger.info("Shutting down server...");
          registry.proxy.stopIndexRefresh();
          process.exit(0);
        });

        server.start();

        if (registry.proxy.enabled) {
          // Requests are served from the last index while the refresh runs
          const interval = registry.proxy.config.index_refresh_interval;
          logger.info(`Proxy mode: refreshing the index now and every ${interval}`);
          void registry.proxy.startIndexRefresh().then((ok) => {
            if (ok) logger.success("Proxy index is ready");
          });
        }

        // Keep process running
        logger.info("Press Ctrl+C to stop the server");
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerServeCommand;
