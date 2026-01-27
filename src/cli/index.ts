/**
 * CLI setup with Commander
 */

import { Command } from "commander";
import { setLogLevel, setQuiet } from "../utils/logger.ts";
import { registerConfigCommand } from "./commands/config.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerMirrorCommand } from "./commands/mirror.ts";
import { registerServeCommand } from "./commands/serve.ts";
import { registerSourceCommand } from "./commands/source.ts";
import { registerSyncCommand } from "./commands/sync.ts";

export function createCli(): Command {
  const program = new Command();

  program
    .name("moonbit-registry")
    .description("CLI tool for managing MoonBit registries")
    .version("0.1.0")
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
  registerServeCommand(program);
  registerConfigCommand(program);
  registerSourceCommand(program);
  registerSyncCommand(program);

  return program;
}

export default createCli;
