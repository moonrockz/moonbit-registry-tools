/**
 * sync command - Sync local registry with remote git
 */

import type { Command } from "commander";
import { Registry } from "../../core/registry.ts";
import { resolvePath, handleError } from "../utils.ts";
import logger from "../../utils/logger.ts";

interface SyncCommandOptions {
  push?: boolean;
  pull?: boolean;
  dir?: string;
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Sync local registry with remote git repository")
    .option("--push", "Push local index to remote")
    .option("--pull", "Pull updates from remote")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (options: SyncCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        if (!registry.config.git.remote_url) {
          console.error("Error: No remote URL configured.");
          console.error("Set it with: moonbit-registry config git.remote_url <url>");
          process.exit(1);
        }

        // Default to pull if no option specified
        if (!options.push && !options.pull) {
          options.pull = true;
        }

        if (options.push && options.pull) {
          // Pull then push
          logger.info("Pulling from remote...");
          await registry.sync("pull");
          logger.info("Pushing to remote...");
          await registry.sync("push");
          logger.success("Sync complete (pull + push)");
        } else if (options.push) {
          logger.info("Pushing to remote...");
          await registry.sync("push");
          logger.success("Push complete");
        } else {
          logger.info("Pulling from remote...");
          await registry.sync("pull");
          logger.success("Pull complete");
        }
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerSyncCommand;
