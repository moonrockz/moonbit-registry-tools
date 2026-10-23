/**
 * MoonBit toolchains for proxy fallback builds
 *
 * An old package often builds only with the toolchain of its publish time:
 * newer moon refuses old manifests such as `moon.mod.json`. moonup
 * (https://github.com/chawyehsu/moonup) installs toolchains by version. Its
 * channel file lists the versions without dates; the dates come from the
 * GitHub releases of chawyehsu/moonbit-binaries, which moonup downloads from.
 *
 * `moonup install` writes shims into `$MOON_HOME/bin` and replaces
 * `$MOON_HOME/lib`, so builds use a MOON_HOME of their own below the work
 * directory, never the MOON_HOME of the user.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import fs from "../utils/fs.ts";
import logger from "../utils/logger.ts";

/** The part of `fetch` that the fallbacks use */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One installable toolchain version and its release time */
export interface ToolchainRelease {
  version: string;
  /** ISO 8601 time */
  date: string;
}

export interface ToolchainsOptions {
  /** "auto", "current", or a fixed version */
  setting: string;
  /** Path or command name of moonup */
  moonup: string;
  /** Directory for the build MOON_HOME, MOONUP_HOME and the release list cache */
  workDir: string;
  fetch?: FetchFn;
  /** moonup dist server (default as moonup: MOONUP_DIST_SERVER or https://moonup.csu.moe/v3) */
  distServer?: string;
  /** GitHub API URL of the toolchain releases */
  releasesApi?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_DIST_SERVER = "https://moonup.csu.moe/v3";
const DEFAULT_RELEASES_API = "https://api.github.com/repos/chawyehsu/moonbit-binaries/releases";
const RELEASES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

/** The newest toolchain released before a publish time, or null */
export function selectToolchain(createdAt: string, releases: ToolchainRelease[]): string | null {
  const limit = Date.parse(createdAt);
  if (Number.isNaN(limit)) return null;
  let best: { version: string; time: number } | null = null;
  for (const release of releases) {
    const time = Date.parse(release.date);
    if (Number.isNaN(time) || time >= limit) continue;
    if (!best || time > best.time) best = { version: release.version, time };
  }
  return best?.version ?? null;
}

/**
 * Join the moonup channel file and the GitHub releases into a dated list of
 * the versions that moonup can install for a target. A version without a
 * GitHub release gets the date in its name (`0.1.YYYYMMDD+hash`), if any.
 */
export function mergeReleases(
  channel: unknown,
  githubReleases: { tag_name?: unknown; published_at?: unknown }[],
  target: string,
): ToolchainRelease[] {
  const dates = new Map<string, string>();
  for (const release of githubReleases) {
    if (typeof release.tag_name === "string" && typeof release.published_at === "string") {
      dates.set(stripV(release.tag_name), release.published_at);
    }
  }
  const releases = (channel as { releases?: unknown })?.releases;
  if (!Array.isArray(releases)) return [];

  const result: ToolchainRelease[] = [];
  for (const release of releases as { version?: unknown; targets?: unknown }[]) {
    if (typeof release.version !== "string") continue;
    if (!Array.isArray(release.targets) || !release.targets.includes(target)) continue;
    const version = stripV(release.version);
    const date = dates.get(version) ?? dateFromVersion(version);
    if (date) result.push({ version, date });
  }
  return result;
}

/** The moonup target name of a platform, or null when moonup has none */
export function moonupTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  const targets: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux",
    "linux-arm64": "aarch64-unknown-linux",
    "win32-x64": "x86_64-pc-windows",
  };
  return targets[`${platform}-${arch}`] ?? null;
}

function stripV(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function dateFromVersion(version: string): string | null {
  const match = version.match(/^0\.1\.(\d{4})(\d{2})(\d{2})(?:\+|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : null;
}

/** Find a command: a path as it is, a name on PATH */
function findCommand(command: string): string | null {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? command : null;
  }
  return Bun.which(command);
}

export class Toolchains {
  private options: ToolchainsOptions;
  private fetch: FetchFn;
  private releases: Promise<ToolchainRelease[]> | null = null;
  private installs = new Map<string, Promise<void>>();

  constructor(options: ToolchainsOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
  }

  get setting(): string {
    return this.options.setting;
  }

  get moonup(): string {
    return this.options.moonup;
  }

  /** MOON_HOME of builds with moonup toolchains */
  get moonHome(): string {
    return join(this.options.workDir, "moon-home");
  }

  /** MOONUP_HOME of builds */
  get moonupHome(): string {
    return join(this.options.workDir, "moonup-home");
  }

  private get usesMoonup(): boolean {
    return this.options.setting !== "current";
  }

  /** The MOON_HOME of the user, for the "current" toolchain */
  private get userMoonHome(): string {
    return process.env.MOON_HOME ?? join(homedir(), ".moon");
  }

  private get userMoon(): string {
    return join(this.userMoonHome, "bin", process.platform === "win32" ? "moon.exe" : "moon");
  }

  /** Why builds cannot run, or null when they can */
  async check(): Promise<string | null> {
    if (!this.usesMoonup) {
      return existsSync(this.userMoon)
        ? null
        : `moon is not installed at ${this.userMoon} (toolchain = "current")`;
    }
    const moonup = findCommand(this.options.moonup);
    if (!moonup) {
      return `moonup is not found at '${this.options.moonup}' (toolchain = "${this.options.setting}"); install moonup or set [proxy.fallback] moonup`;
    }
    const shim = join(
      dirname(moonup),
      process.platform === "win32" ? "moonup-shim.exe" : "moonup-shim",
    );
    if (!existsSync(shim)) {
      return `moonup-shim is not next to ${moonup}; moonup cannot install toolchains without it`;
    }
    return null;
  }

  /** The toolchain for a version published at `createdAt`: "current" or a version */
  async resolve(createdAt: string | undefined): Promise<string> {
    const setting = this.options.setting;
    if (setting === "current") return "current";
    if (setting !== "auto") return stripV(setting);
    if (!createdAt) {
      throw new Error("The index line has no publish time (created_at) to select a toolchain");
    }
    const version = selectToolchain(createdAt, await this.listReleases());
    if (!version) {
      throw new Error(`No toolchain was released before ${createdAt}`);
    }
    return version;
  }

  /** The dated toolchain list, cached for a day; a stale copy is used when a fetch fails */
  listReleases(): Promise<ToolchainRelease[]> {
    if (!this.releases) {
      this.releases = this.loadReleases().catch((err) => {
        this.releases = null;
        throw err;
      });
    }
    return this.releases;
  }

  private async loadReleases(): Promise<ToolchainRelease[]> {
    const cachePath = join(this.options.workDir, "toolchain-releases.json");
    let cached: { fetchedAt: number; releases: ToolchainRelease[] } | null = null;
    if (existsSync(cachePath)) {
      try {
        cached = JSON.parse(await readFile(cachePath, "utf8"));
      } catch {
        cached = null;
      }
    }
    if (cached && Date.now() - cached.fetchedAt < RELEASES_MAX_AGE_MS) return cached.releases;

    try {
      const target = moonupTarget();
      if (!target)
        throw new Error(`moonup has no toolchains for ${process.platform}-${process.arch}`);
      const distServer =
        this.options.distServer ?? process.env.MOONUP_DIST_SERVER ?? DEFAULT_DIST_SERVER;
      const channel = await this.getJson(`${distServer.replace(/\/+$/, "")}/channel-latest.json`);
      const github: { tag_name?: unknown; published_at?: unknown }[] = [];
      const api = this.options.releasesApi ?? DEFAULT_RELEASES_API;
      for (let page = 1; page <= 20; page++) {
        const items = (await this.getJson(`${api}?per_page=100&page=${page}`, true)) as unknown[];
        if (!Array.isArray(items) || items.length === 0) break;
        github.push(...(items as { tag_name?: unknown; published_at?: unknown }[]));
        if (items.length < 100) break;
      }
      const releases = mergeReleases(channel, github, target);
      if (releases.length === 0) throw new Error("The toolchain release list is empty");
      await fs.writeFileAtomic(
        cachePath,
        new TextEncoder().encode(JSON.stringify({ fetchedAt: Date.now(), releases })),
      );
      return releases;
    } catch (err) {
      if (cached) {
        logger.warn(`Using the cached toolchain list: ${err instanceof Error ? err.message : err}`);
        return cached.releases;
      }
      throw err;
    }
  }

  private async getJson(url: string, github = false): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (github && process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await this.fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  }

  /** Install a toolchain with moonup when it is not installed. Concurrent calls share one install. */
  ensure(version: string): Promise<void> {
    if (version === "current" || !this.usesMoonup) return Promise.resolve();
    if (existsSync(join(this.moonupHome, "toolchains", version))) return Promise.resolve();
    let install = this.installs.get(version);
    if (!install) {
      install = this.install(version).finally(() => this.installs.delete(version));
      this.installs.set(version, install);
    }
    return install;
  }

  private async install(version: string): Promise<void> {
    const moonup = findCommand(this.options.moonup);
    if (!moonup) throw new Error(`moonup is not found at '${this.options.moonup}'`);
    logger.info(`Installing toolchain ${version} with moonup`);
    const result = await this.spawn([moonup, "install", version], this.options.workDir, {});
    if (result.exitCode !== 0) {
      throw new Error(
        `moonup install ${version} failed: ${lastLines(result.stderr || result.stdout)}`,
      );
    }
  }

  /** The directory with moon, moonc, moonfmt and moon-wasm-opt of a toolchain */
  binDir(version: string): string {
    return version === "current"
      ? join(this.userMoonHome, "bin")
      : join(this.moonupHome, "toolchains", version, "bin");
  }

  /**
   * Run `moon <args>` with a toolchain ("current" or a version).
   *
   * The bin directory of the toolchain goes first on PATH: builds run tools
   * such as `moonfmt` from PATH (pre-build steps), and a moonfmt of another
   * toolchain can write code that the old core does not know.
   *
   * With `registry`, moon gets its index and dependencies from that URL: by
   * MOONCAKES_REGISTRY and by a `config.json` in the `registry` form, which
   * old and new moon both read. (Some old moon versions still download
   * dependency zips from download.mooncakes.io.)
   */
  async run(
    version: string,
    args: string[],
    cwd: string,
    options: { registry?: string | null } = {},
  ): Promise<RunResult> {
    const home = version === "current" ? await this.currentMoonHome() : this.moonHome;
    await mkdir(home, { recursive: true });
    await writeRegistryConfig(home, options.registry ?? null);
    const bin = this.binDir(version);
    const env: Record<string, string> = {
      MOON_HOME: home,
      PATH: [bin, join(bin, "internal"), process.env.PATH ?? ""].join(delimiter),
    };
    if (options.registry) env.MOONCAKES_REGISTRY = options.registry;

    if (version === "current") {
      return this.spawn([this.userMoon, ...args], cwd, env);
    }
    const moonup = findCommand(this.options.moonup);
    if (!moonup) throw new Error(`moonup is not found at '${this.options.moonup}'`);
    return this.spawn([moonup, "run", version, "moon", ...args], cwd, env);
  }

  /** Run a tool of a toolchain (for example `moon-wasm-opt`); null when the toolchain has none */
  async runTool(
    version: string,
    tool: string,
    args: string[],
    cwd: string,
  ): Promise<RunResult | null> {
    const path = join(this.binDir(version), process.platform === "win32" ? `${tool}.exe` : tool);
    if (!existsSync(path)) return null;
    return this.spawn([path, ...args], cwd, {});
  }

  /**
   * A MOON_HOME with the binaries and core library of the user's MOON_HOME,
   * but its own registry cache and config.json, so builds use the
   * registry that the caller sets.
   */
  private async currentMoonHome(): Promise<string> {
    const home = join(this.options.workDir, "moon-home-current");
    await mkdir(home, { recursive: true });
    for (const name of ["bin", "lib", "include"]) {
      const link = join(home, name);
      const target = join(this.userMoonHome, name);
      if (!existsSync(link) && existsSync(target)) {
        await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
      }
    }
    return home;
  }

  private async spawn(cmd: string[], cwd: string, env: Record<string, string>): Promise<RunResult> {
    await mkdir(this.moonHome, { recursive: true });
    await mkdir(this.moonupHome, { recursive: true });
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      MOON_HOME: this.moonHome,
      MOONUP_HOME: this.moonupHome,
      ...env,
    };
    // The toolchain comes from the command, not from the caller's environment
    childEnv.MOONUP_TOOLCHAIN_SPEC = undefined;
    childEnv.MOON_CORE_OVERRIDE = undefined;
    const proc = Bun.spawn(cmd, {
      cwd,
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: RUN_TIMEOUT_MS,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  }
}

/** Write (or remove) the registry config.json of a build MOON_HOME */
async function writeRegistryConfig(home: string, registry: string | null): Promise<void> {
  const path = join(home, "config.json");
  if (!registry) {
    await rm(path, { force: true });
    return;
  }
  const base = registry.replace(/\/+$/, "");
  const config = { registry: base, index: `${base}/git/index`, symbols: `${base}/symbols.zip` };
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** The last lines of command output, for an error message */
export function lastLines(text: string, count = 15): string {
  return text.trim().split("\n").slice(-count).join("\n");
}

export default Toolchains;
