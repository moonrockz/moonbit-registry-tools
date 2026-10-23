/**
 * Build hooks of a module: `pre-build` commands of packages and the
 * `scripts.postadd` command of the module
 *
 * Fallback builds turn both off (MOON_IGNORE_PREBUILD, MOON_IGNORE_POSTADD).
 * This scan only finds them, so that the log can say which ones the build
 * ignores.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** Directories that are not part of the module source */
const SKIP_DIRS = new Set([".git", "_build", "target", ".mooncakes", "node_modules"]);

const MANIFEST_FILES = new Set(["moon.mod", "moon.mod.json", "moon.pkg", "moon.pkg.json"]);

/** The JSON key or the moon.pkg / moon.mod option of each hook */
const HOOKS: { name: string; pattern: RegExp }[] = [
  { name: "pre-build", pattern: /["']?pre-build["']?\s*[:=]/ },
  { name: "postadd", pattern: /["']?postadd["']?\s*[:=]/ },
];

/**
 * Find the hooks in the module and package files below a directory.
 * Returns one `<file>: <hook>` line per hook, with `/` in paths.
 */
export async function findBuildHooks(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path);
      } else if (entry.isFile() && MANIFEST_FILES.has(entry.name)) {
        const text = await readFile(path, "utf8");
        const file = relative(dir, path).split(sep).join("/");
        for (const hook of HOOKS) {
          if (hook.pattern.test(text)) found.push(`${file}: ${hook.name}`);
        }
      }
    }
  };
  await walk(dir);
  return found;
}
