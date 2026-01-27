/**
 * Git operations utility
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import logger from "./logger.ts";

export interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a git command and return the result */
async function runGit(args: string[], cwd?: string): Promise<GitResult> {
  try {
    const result = await $`git ${args}`.cwd(cwd ?? process.cwd()).quiet();
    return {
      success: result.exitCode === 0,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
      exitCode: result.exitCode,
    };
  } catch (err) {
    const error = err as { stdout?: Buffer; stderr?: Buffer; exitCode?: number };
    return {
      success: false,
      stdout: error.stdout?.toString().trim() ?? "",
      stderr: error.stderr?.toString().trim() ?? "",
      exitCode: error.exitCode ?? 1,
    };
  }
}

/** Check if a directory is a git repository */
export async function isGitRepo(dir: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--git-dir"], dir);
  return result.success;
}

/** Initialize a new git repository */
export async function initRepo(dir: string, branch = "main"): Promise<GitResult> {
  logger.debug(`Initializing git repo in ${dir}`);
  const result = await runGit(["init", "-b", branch], dir);
  if (result.success) {
    logger.debug(`Git repo initialized with branch ${branch}`);
  }
  return result;
}

/** Clone a repository */
export async function cloneRepo(url: string, dest: string, branch?: string): Promise<GitResult> {
  logger.info(`Cloning ${url} to ${dest}`);
  const args = ["clone", "--depth", "1"];
  if (branch) {
    args.push("-b", branch);
  }
  args.push(url, dest);
  return runGit(args);
}

/** Pull updates from remote */
export async function pull(dir: string, remote = "origin", branch?: string): Promise<GitResult> {
  logger.debug(`Pulling updates in ${dir}`);
  const args = ["pull", remote];
  if (branch) {
    args.push(branch);
  }
  return runGit(args, dir);
}

/** Fetch updates from remote */
export async function fetch(dir: string, remote = "origin"): Promise<GitResult> {
  logger.debug(`Fetching updates in ${dir}`);
  return runGit(["fetch", remote], dir);
}

/** Push to remote */
export async function push(
  dir: string,
  remote = "origin",
  branch?: string,
  setUpstream = false
): Promise<GitResult> {
  logger.debug(`Pushing to ${remote} in ${dir}`);
  const args = ["push"];
  if (setUpstream) {
    args.push("-u");
  }
  args.push(remote);
  if (branch) {
    args.push(branch);
  }
  return runGit(args, dir);
}

/** Add files to staging */
export async function add(dir: string, files: string[]): Promise<GitResult> {
  return runGit(["add", ...files], dir);
}

/** Commit changes */
export async function commit(dir: string, message: string): Promise<GitResult> {
  return runGit(["commit", "-m", message], dir);
}

/** Get current branch name */
export async function getCurrentBranch(dir: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  return result.success ? result.stdout : null;
}

/** Check if there are uncommitted changes */
export async function hasChanges(dir: string): Promise<boolean> {
  const result = await runGit(["status", "--porcelain"], dir);
  return result.success && result.stdout.length > 0;
}

/** Add a remote */
export async function addRemote(dir: string, name: string, url: string): Promise<GitResult> {
  return runGit(["remote", "add", name, url], dir);
}

/** Set remote URL */
export async function setRemoteUrl(dir: string, name: string, url: string): Promise<GitResult> {
  return runGit(["remote", "set-url", name, url], dir);
}

/** Get remote URL */
export async function getRemoteUrl(dir: string, name = "origin"): Promise<string | null> {
  const result = await runGit(["remote", "get-url", name], dir);
  return result.success ? result.stdout : null;
}

/** Check if repo has a specific remote */
export async function hasRemote(dir: string, name: string): Promise<boolean> {
  const result = await runGit(["remote"], dir);
  if (!result.success) return false;
  return result.stdout.split("\n").includes(name);
}

/** Configure git user for a repository */
export async function configureUser(
  dir: string,
  name: string,
  email: string
): Promise<GitResult> {
  const nameResult = await runGit(["config", "user.name", name], dir);
  if (!nameResult.success) return nameResult;
  return runGit(["config", "user.email", email], dir);
}

/** Ensure .git directory exists and is initialized */
export async function ensureRepo(dir: string, branch = "main"): Promise<boolean> {
  const gitDir = join(dir, ".git");
  if (existsSync(gitDir)) {
    return true;
  }
  const result = await initRepo(dir, branch);
  return result.success;
}

export const git = {
  run: runGit,
  isRepo: isGitRepo,
  init: initRepo,
  clone: cloneRepo,
  pull,
  fetch,
  push,
  add,
  commit,
  getCurrentBranch,
  hasChanges,
  addRemote,
  setRemoteUrl,
  getRemoteUrl,
  hasRemote,
  configureUser,
  ensureRepo,
};

export default git;
