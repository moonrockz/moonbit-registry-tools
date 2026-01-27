/**
 * init command - Initialize a new local registry
 */

import type { Command } from "commander";
import { Registry } from "../../core/registry.ts";
import logger from "../../utils/logger.ts";
import { handleError, resolvePath } from "../utils.ts";

export function registerInitCommand(program: Command): void {
  program
    .command("init [path]")
    .description("Initialize a new local registry")
    .option("-n, --name <name>", "Registry name")
    .action(async (path: string | undefined, options: { name?: string }) => {
      try {
        const registryPath = resolvePath(path ?? ".");
        const name = options.name;

        logger.info(`Initializing registry at ${registryPath}`);

        const registry = await Registry.init(registryPath, name);

        console.log("\nRegistry initialized successfully!");
        console.log(`\nConfiguration: ${registryPath}/registry.toml`);
        console.log(`Data directory: ${registry.config.registry.data_dir}`);
        console.log("\nNext steps:");
        console.log("  1. Edit registry.toml to customize settings");
        console.log("  2. Mirror packages: moonbit-registry mirror 'moonbitlang/*'");
        console.log("  3. Start server: moonbit-registry serve");
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerInitCommand;
