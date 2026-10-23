/**
 * CLI setup with Commander
 */

import { Command } from "commander";
import { setLogLevel, setQuiet } from "../utils/logger.ts";
import { VERSION } from "../version.ts";
import { registerConfigCommand } from "./commands/config.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerManifestCommand } from "./commands/manifest.ts";
import { registerMirrorCommand } from "./commands/mirror.ts";
import { registerServeCommand } from "./commands/serve.ts";
import { registerSourceCommand } from "./commands/source.ts";
import { registerSyncCommand } from "./commands/sync.ts";
import { registerUpdateCommand } from "./commands/update.ts";

export function createCli(): Command {
  const program = new Command();

  program
    .name("moonbit-registry")
    .description("CLI tool for managing MoonBit registries")
    .version(VERSION)
    .option("-v, --verbose", "Enable verbose logging")
    .option("-q, --quiet", "Suppress non-essential output")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.verbose) {
        setLogLevel("debug");
      }
      if (opts.quiet) {
        setQuiet(true);
      }
    });

  // Register commands
  registerInitCommand(program);
  registerMirrorCommand(program);
  registerManifestCommand(program);
  registerServeCommand(program);
  registerConfigCommand(program);
  registerSourceCommand(program);
  registerSyncCommand(program);
  registerUpdateCommand(program);

  return program;
}

export default createCli;
