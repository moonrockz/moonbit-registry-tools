/**
 * serve command - Start the registry server
 */

import type { Command } from "commander";
import { Registry } from "../../core/registry.ts";
import createServer from "../../server/index.ts";
import { resolvePath, handleError } from "../utils.ts";
import logger from "../../utils/logger.ts";

interface ServeCommandOptions {
  port?: string;
  host?: string;
  dir?: string;
}

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the registry server")
    .option("-p, --port <port>", "Port to listen on")
    .option("-h, --host <host>", "Host to bind to")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (options: ServeCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        const serverOptions = {
          port: options.port ? Number.parseInt(options.port, 10) : undefined,
          host: options.host,
        };

        const server = createServer(registry, serverOptions);

        // Handle shutdown
        process.on("SIGINT", () => {
          logger.info("Shutting down server...");
          process.exit(0);
        });

        process.on("SIGTERM", () => {
          logger.info("Shutting down server...");
          process.exit(0);
        });

        server.start();

        // Keep process running
        logger.info("Press Ctrl+C to stop the server");
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerServeCommand;
