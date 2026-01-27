/**
 * config command - View or modify configuration
 */

import type { Command } from "commander";
import configLoader from "../../config/loader.ts";
import logger from "../../utils/logger.ts";
import { handleError, resolvePath } from "../utils.ts";

interface ConfigCommandOptions {
  dir?: string;
}

export function registerConfigCommand(program: Command): void {
  program
    .command("config [key] [value]")
    .description("View or modify configuration")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(
      async (key: string | undefined, value: string | undefined, options: ConfigCommandOptions) => {
        try {
          const registryPath = resolvePath(options.dir ?? ".");
          const configPath = `${registryPath}/registry.toml`;
          const config = await configLoader.load(configPath);

          // No arguments - show all config
          if (!key) {
            console.log("Current configuration:\n");
            printConfigSection("registry", config.registry);
            printConfigSection("upstream", config.upstream);
            printConfigSection("mirror", config.mirror);
            printConfigSection("server", config.server);
            printConfigSection("git", config.git);
            return;
          }

          // Key only - show value
          if (!value) {
            const currentValue = configLoader.getValue(config, key);
            if (currentValue === undefined) {
              console.error(`Unknown configuration key: ${key}`);
              process.exit(1);
            }
            console.log(`${key} = ${formatValue(currentValue)}`);
            return;
          }

          // Key and value - set value
          const parsedValue = parseValue(value);
          configLoader.setValue(config, key, parsedValue);
          await configLoader.save(config, configPath);
          logger.success(`Set ${key} = ${formatValue(parsedValue)}`);
        } catch (error) {
          handleError(error);
        }
      },
    );
}

function printConfigSection(name: string, section: Record<string, unknown>): void {
  console.log(`[${name}]`);
  for (const [key, value] of Object.entries(section)) {
    console.log(`  ${key} = ${formatValue(value)}`);
  }
  console.log();
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatValue(v)).join(", ")}]`;
  }
  return String(value);
}

function parseValue(value: string): unknown {
  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  const num = Number(value);
  if (!Number.isNaN(num)) return num;

  // Array (simple comma-separated)
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    if (!inner) return [];
    return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
  }

  // String (remove quotes if present)
  return value.replace(/^["']|["']$/g, "");
}

export default registerConfigCommand;
