/**
 * source command - Manage mirror sources
 */

import type { Command } from "commander";
import { PREDEFINED_SOURCES } from "../../config/defaults.ts";
import { Registry } from "../../core/registry.ts";
import type { MirrorSource, SourceType } from "../../core/types.ts";
import logger from "../../utils/logger.ts";
import { handleError, resolvePath } from "../utils.ts";

interface SourceAddOptions {
  dir?: string;
  type?: string;
  url?: string;
  indexUrl?: string;
  indexType?: string;
  pattern?: string;
  priority?: string;
  fromPreset?: string;
}

interface SourceCommandOptions {
  dir?: string;
}

export function registerSourceCommand(program: Command): void {
  const source = program.command("source").description("Manage mirror sources");

  // List sources
  source
    .command("list")
    .description("List configured sources")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (options: SourceCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);
        const sources = registry.listSources();

        if (sources.length === 0) {
          console.log("No sources configured.");
          console.log("");
          console.log("Add a source with:");
          console.log("  moonbit-registry source add mooncakes --from-preset mooncakes");
          return;
        }

        const defaultSource = registry.sourceManager.getDefaultSourceName();

        console.log("Configured sources:");
        console.log("");

        for (const src of sources) {
          const status = src.enabled ? "enabled" : "disabled";
          const isDefault = src.name === defaultSource ? " (default)" : "";
          console.log(`  ${src.name}${isDefault} [${status}]`);
          console.log(`    Type: ${src.type}`);
          console.log(`    URL: ${src.url}`);
          console.log(`    Index: ${src.index_url} (${src.index_type})`);
          if (src.priority !== undefined) {
            console.log(`    Priority: ${src.priority}`);
          }
          if (src.auth && src.auth.type !== "none") {
            console.log(`    Auth: ${src.auth.type}`);
          }
          console.log("");
        }
      } catch (error) {
        handleError(error);
      }
    });

  // Add source
  source
    .command("add <name>")
    .description("Add a new mirror source")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .option("-t, --type <type>", "Source type (mooncakes, moonbit-registry, custom)")
    .option("-u, --url <url>", "Base URL for package downloads")
    .option("-i, --index-url <url>", "Index URL")
    .option("--index-type <type>", "Index type (git, http)", "git")
    .option("--pattern <pattern>", "Package URL pattern")
    .option("--priority <n>", "Priority (lower = higher priority)", "50")
    .option("--from-preset <preset>", "Use predefined source as template (mooncakes)")
    .action(async (name: string, options: SourceAddOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        let newSource: MirrorSource;

        if (options.fromPreset) {
          const preset = PREDEFINED_SOURCES[options.fromPreset];
          if (!preset) {
            console.error(`Unknown preset: ${options.fromPreset}`);
            console.error(`Available presets: ${Object.keys(PREDEFINED_SOURCES).join(", ")}`);
            process.exit(1);
          }
          newSource = {
            ...preset,
            name,
            url: options.url ?? preset.url,
            index_url: options.indexUrl ?? preset.index_url,
          } as MirrorSource;
        } else {
          if (!options.url || !options.indexUrl) {
            console.error("Error: --url and --index-url are required unless using --from-preset");
            console.error("");
            console.error("Examples:");
            console.error("  # Add mooncakes as a source using preset");
            console.error("  moonbit-registry source add mooncakes --from-preset mooncakes");
            console.error("");
            console.error("  # Add a custom source");
            console.error("  moonbit-registry source add myregistry \\");
            console.error("    --url https://registry.example.com \\");
            console.error("    --index-url https://registry.example.com/git/index");
            process.exit(1);
          }

          newSource = {
            name,
            type: (options.type ?? "custom") as SourceType,
            url: options.url,
            index_url: options.indexUrl,
            index_type: (options.indexType ?? "git") as "git" | "http",
            package_url_pattern: options.pattern,
            enabled: true,
            priority: Number.parseInt(options.priority ?? "50", 10),
          };
        }

        registry.addSource(newSource);
        await registry.saveConfig();

        logger.success(`Added source '${name}'`);
      } catch (error) {
        handleError(error);
      }
    });

  // Remove source
  source
    .command("remove <name>")
    .description("Remove a mirror source")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (name: string, options: SourceCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        registry.removeSource(name);
        await registry.saveConfig();

        logger.success(`Removed source '${name}'`);
      } catch (error) {
        handleError(error);
      }
    });

  // Set default source
  source
    .command("default <name>")
    .description("Set the default mirror source")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (name: string, options: SourceCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        registry.setDefaultSource(name);
        await registry.saveConfig();

        logger.success(`Set '${name}' as default source`);
      } catch (error) {
        handleError(error);
      }
    });

  // Enable source
  source
    .command("enable <name>")
    .description("Enable a mirror source")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (name: string, options: SourceCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        registry.setSourceEnabled(name, true);
        await registry.saveConfig();

        logger.success(`Enabled source '${name}'`);
      } catch (error) {
        handleError(error);
      }
    });

  // Disable source
  source
    .command("disable <name>")
    .description("Disable a mirror source")
    .option("-d, --dir <path>", "Registry directory (default: current directory)")
    .action(async (name: string, options: SourceCommandOptions) => {
      try {
        const registryPath = resolvePath(options.dir ?? ".");
        const registry = await Registry.load(registryPath);

        registry.setSourceEnabled(name, false);
        await registry.saveConfig();

        logger.success(`Disabled source '${name}'`);
      } catch (error) {
        handleError(error);
      }
    });
}

export default registerSourceCommand;
