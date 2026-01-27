/**
 * mirror command - Mirror packages from upstream registry
 */

import type { Command } from "commander";
import { Registry } from "../../core/registry.ts";
import type { MirrorOptions } from "../../core/types.ts";
import { resolvePath, handleError } from "../utils.ts";
import logger, { setQuiet } from "../../utils/logger.ts";

interface MirrorCommandOptions {
  full?: boolean;
  strict?: boolean;
  quiet?: boolean;
  dir?: string;
}

export function registerMirrorCommand(program: Command): void {
  program
    .command("mirror [patterns...]")
    .description("Mirror packages from upstream registry")
    .option("--full", "Mirror entire registry")
    .option("--strict", "Only mirror exact pattern matches (no dependency resolution)")
    .option("-q, --quiet", "Suppress warnings about skipped dependencies")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (patterns: string[], options: MirrorCommandOptions) => {
      try {
        if (options.quiet) {
          setQuiet(true);
        }

        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        if (!options.full && patterns.length === 0) {
          // Check if config has default patterns
          if (registry.config.mirror.packages.length > 0) {
            patterns = registry.config.mirror.packages;
            logger.info(`Using patterns from config: ${patterns.join(", ")}`);
          } else {
            console.error("Error: No patterns specified. Use --full to mirror all packages.");
            console.error("Examples:");
            console.error("  moonbit-registry mirror 'moonbitlang/*'");
            console.error("  moonbit-registry mirror 'company/pkg-*' 'moonbitlang/core'");
            console.error("  moonbit-registry mirror --full");
            process.exit(1);
          }
        }

        const mirrorOptions: MirrorOptions = {
          patterns,
          full: options.full ?? false,
          strict: options.strict ?? false,
          quiet: options.quiet ?? false,
        };

        logger.info(`Mirroring packages${options.full ? " (full)" : ""}`);
        if (!options.full) {
          logger.info(`Patterns: ${patterns.join(", ")}`);
        }
        if (options.strict) {
          logger.info("Strict mode: dependencies will not be automatically included");
        }

        await registry.mirror(mirrorOptions);
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerMirrorCommand;
