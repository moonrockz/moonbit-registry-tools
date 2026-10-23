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
 * `$MOON_HOME/lib`, so installs use a MOON_HOME of their own below the work
 * directory, never the MOON_HOME of the user. moon finds the core library
 * next to its own binary, so each run gets a new, empty MOON_HOME for its
 * registry index and cache, and concurrent runs share nothing.
 *
 * Builds run code from the registry, which nobody has checked. moon runs the
 * `pre-build` commands of packages and the `postadd` script of modules unless
 * MOON_IGNORE_PREBUILD and MOON_IGNORE_POSTADD are set. Every child gets both,
 * and an environment from an allowlist, without the secrets of the proxy.
 * Toolchains that do not know MOON_IGNORE_PREBUILD (released before
 * 2025-05-29) are refused.
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

/**
 * moon added MOON_IGNORE_PREBUILD on 2025-05-29 (moonbitlang/moon#836), and
 * MOON_IGNORE_POSTADD on 2025-04-11 (moonbitlang/moon#744). The first
 * toolchain with both is 0.1.20250529+8a98c8e02.
 */
export const MIN_TOOLCHAIN_DATE = "2025-05-29T00:00:00Z";

/** Turn off the hooks that run commands from packages */
export const HOOK_ENV: Readonly<Record<string, string>> = {
  MOON_IGNORE_PREBUILD: "1",
  MOON_IGNORE_POSTADD: "1",
};

/** Variables that children get from the environment of the proxy, when set */
const PASS_ENV = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  // Network settings: moonup downloads toolchains, old moon downloads dependencies
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "MOONUP_DIST_SERVER",
];

/** Windows programs need these to start */
const PASS_ENV_WINDOWS = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
];

/**
 * The environment of a child process: an allowlist of the proxy's variables,
 * then the variables that the proxy sets. Nothing else gets through, so
 * GITHUB_TOKEN and other secrets of the proxy stay in the proxy.
 */
export function childEnvironment(
  vars: { path: string; home: string } & Record<string, string>,
  source: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  const windows = platform === "win32";
  // Windows names are not case-sensitive
  const lookup = windows
    ? new Map(Object.entries(source).map(([key, value]) => [key.toUpperCase(), value]))
    : null;
  for (const name of windows ? [...PASS_ENV, ...PASS_ENV_WINDOWS] : PASS_ENV) {
    const value = lookup ? lookup.get(name.toUpperCase()) : source[name];
    if (value !== undefined) env[name] = value;
  }
  const { path, home, ...rest } = vars;
  env.PATH = path;
  env.HOME = home;
  if (windows) env.USERPROFILE = home;
  return { ...env, ...rest, ...HOOK_ENV };
}

/** A toolchain that the proxy does not run */
export class ToolchainRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolchainRefused";
  }
}

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
  const match =
    version.match(/^0\.1\.(\d{4})(\d{2})(\d{2})(?:\+|$)/) ??
    version.match(/^nightly-(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : null;
}

/** Whether a moon binary reads MOON_IGNORE_PREBUILD and MOON_IGNORE_POSTADD */
async function binaryKnowsHookEnv(path: string): Promise<boolean> {
  const data = await readFile(path);
  return Object.keys(HOOK_ENV).every((name) => data.includes(name));
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
  /** moonup installs run one at a time: they share MOONUP_HOME and MOON_HOME */
  private installQueue: Promise<unknown> = Promise.resolve();
  private hookChecks = new Map<string, Promise<boolean>>();

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

  /** MOON_HOME of `moonup install` (runs get their own) */
  get moonHome(): string {
    return join(this.options.workDir, "moon-home");
  }

  /** HOME of installs and tools */
  private get home(): string {
    return join(this.options.workDir, "home");
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

  /**
   * Select, check and install the toolchain for a version published at
   * `createdAt`. Throws ToolchainRefused for a toolchain that cannot turn
   * off pre-build and postadd hooks.
   */
  async prepare(createdAt: string | undefined): Promise<string> {
    const version = await this.resolve(createdAt);
    const date = await this.releaseDate(version);
    if (date && Date.parse(date) < Date.parse(MIN_TOOLCHAIN_DATE)) {
      throw new ToolchainRefused(
        `Toolchain ${version} was released on ${date.slice(0, 10)}, before ${MIN_TOOLCHAIN_DATE.slice(0, 10)}: it cannot turn off pre-build and postadd hooks (MOON_IGNORE_PREBUILD), so the proxy does not run it`,
      );
    }
    await this.ensure(version);
    const moon = this.moonBinary(version);
    if (!existsSync(moon)) throw new ToolchainRefused(`Toolchain ${version} has no ${moon}`);
    let check = this.hookChecks.get(moon);
    if (!check) {
      check = binaryKnowsHookEnv(moon);
      this.hookChecks.set(moon, check);
    }
    if (!(await check)) {
      throw new ToolchainRefused(
        `${moon} (toolchain ${version}) does not read MOON_IGNORE_PREBUILD and MOON_IGNORE_POSTADD, so it cannot turn off pre-build and postadd hooks; the proxy does not run it`,
      );
    }
    return version;
  }

  /** The release time of a toolchain, when known */
  private async releaseDate(version: string): Promise<string | null> {
    if (version === "current") return null;
    if (this.options.setting === "auto") {
      const release = (await this.listReleases()).find((r) => r.version === version);
      if (release) return release.date;
    }
    return dateFromVersion(version);
  }

  /** The moon binary of a toolchain */
  private moonBinary(version: string): string {
    return join(this.binDir(version), process.platform === "win32" ? "moon.exe" : "moon");
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

  /**
   * Install a toolchain with moonup when it is not installed. Concurrent
   * calls share one install, and installs run one at a time. moonup
   * downloads from its own server, never from the proxy, so an install
   * cannot wait for a fallback.
   */
  ensure(version: string): Promise<void> {
    if (version === "current" || !this.usesMoonup) return Promise.resolve();
    const running = this.installs.get(version);
    if (running) return running;
    if (existsSync(this.moonBinary(version))) return Promise.resolve();
    const install = this.installQueue
      .then(() => (existsSync(this.moonBinary(version)) ? undefined : this.install(version)))
      .finally(() => this.installs.delete(version));
    this.installQueue = install.catch(() => undefined);
    this.installs.set(version, install);
    return install;
  }

  private async install(version: string): Promise<void> {
    const moonup = findCommand(this.options.moonup);
    if (!moonup) throw new Error(`moonup is not found at '${this.options.moonup}'`);
    logger.info(`Installing toolchain ${version} with moonup`);
    await mkdir(this.moonHome, { recursive: true });
    const env = childEnvironment({
      path: process.env.PATH ?? "",
      home: this.home,
      MOON_HOME: this.moonHome,
      MOONUP_HOME: this.moonupHome,
    });
    const result = await this.spawn([moonup, "install", version], this.options.workDir, env);
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
   *
   * `home` is the MOON_HOME (and HOME) of this run: a directory of the
   * caller that no other run uses at the same time.
   */
  async run(
    version: string,
    args: string[],
    cwd: string,
    options: { home: string; registry?: string | null },
  ): Promise<RunResult> {
    const home = options.home;
    await mkdir(home, { recursive: true });
    if (version === "current") await this.linkCurrentToolchain(home);
    await writeRegistryConfig(home, options.registry ?? null);
    const bin = this.binDir(version);
    const vars: { path: string; home: string } & Record<string, string> = {
      path: [bin, join(bin, "internal"), process.env.PATH ?? ""].join(delimiter),
      home,
      MOON_HOME: home,
      MOONUP_HOME: this.moonupHome,
    };
    if (options.registry) vars.MOONCAKES_REGISTRY = options.registry;
    const env = childEnvironment(vars);

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
    const env = childEnvironment({ path: process.env.PATH ?? "", home: this.home });
    return this.spawn([path, ...args], cwd, env);
  }

  /**
   * Link the binaries and core library of the user's MOON_HOME into a run
   * MOON_HOME, which has its own registry cache and config.json.
   */
  private async linkCurrentToolchain(home: string): Promise<void> {
    for (const name of ["bin", "lib", "include"]) {
      const link = join(home, name);
      const target = join(this.userMoonHome, name);
      if (!existsSync(link) && existsSync(target)) {
        await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
      }
    }
  }

  /** Run a command with exactly `env` (see childEnvironment) */
  private async spawn(cmd: string[], cwd: string, env: Record<string, string>): Promise<RunResult> {
    await mkdir(this.moonupHome, { recursive: true });
    await mkdir(env.HOME, { recursive: true });
    const proc = Bun.spawn(cmd, {
      cwd,
      env,
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
