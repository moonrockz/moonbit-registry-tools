/**
 * update command - Update local moon package index from private registry
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import type { Command } from "commander";
import { CONFIG_FILE_NAME } from "../../config/defaults.ts";
import { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";
import { handleError, resolvePath } from "../utils.ts";

interface UpdateCommandOptions {
  registry?: string;
  dir?: string;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update local moon package index from private registry")
    .option("-r, --registry <url>", "Registry URL (default: uses server.base_url from config)")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (options: UpdateCommandOptions) => {
      try {
        // Determine registry URL
        let registryUrl = options.registry;

        if (!registryUrl) {
          // Try to load from local registry config
          const registryPath = resolvePath(options.dir ?? ".");
          const configPath = join(registryPath, CONFIG_FILE_NAME);

          if (existsSync(configPath)) {
            const registry = await Registry.load(registryPath);
            registryUrl = registry.config.server.base_url;
            logger.debug(`Using registry URL from config: ${registryUrl}`);
          }
        }

        if (!registryUrl) {
          console.error("Error: No registry URL specified.");
          console.error("");
          console.error("Either:");
          console.error("  1. Run from a registry directory (with registry.toml)");
          console.error("  2. Specify a URL with --registry <url>");
          console.error("");
          console.error("Examples:");
          console.error("  moonbit-registry update");
          console.error("  moonbit-registry update --registry http://localhost:8080");
          process.exit(1);
        }

        // Verify moon is installed
        const moonCheck = await $`moon version`.quiet().nothrow();
        if (moonCheck.exitCode !== 0) {
          console.error("Error: moon CLI not found.");
          console.error("Please install moon from https://www.moonbitlang.com/");
          process.exit(1);
        }

        const moonVersion = moonCheck.stdout.toString().trim();
        logger.debug(`Found moon version: ${moonVersion}`);

        // Run moon update with custom registry
        logger.info(`Updating moon package index from: ${registryUrl}`);

        const result = await $`moon update`
          .env({ ...process.env, MOONCAKES_REGISTRY: registryUrl })
          .nothrow();

        if (result.exitCode !== 0) {
          const stderr = result.stderr.toString().trim();
          if (stderr) {
            console.error(stderr);
          }
          console.error("");
          console.error("Failed to update package index.");
          console.error("Make sure the registry server is running at:", registryUrl);
          process.exit(1);
        }

        const stdout = result.stdout.toString().trim();
        if (stdout) {
          console.log(stdout);
        }

        logger.success("Package index updated successfully");
        logger.info(`Moon will now resolve packages from: ${registryUrl}`);
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerUpdateCommand;
