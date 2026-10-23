/**
 * E2E Tests for MoonBit Registry mirroring and serving
 *
 * These tests:
 * 1. Initialize a local registry
 * 2. Mirror a package from mooncakes.io
 * 3. Start the registry server
 * 4. Use moon CLI with MOONCAKES_REGISTRY to install the package
 * 5. Verify that the project builds with the package
 *
 * moon runs with its own MOON_HOME so the test does not touch the registry
 * index of the user.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { $ } from "bun";

// Timeout for E2E tests (network operations may be slow)
const E2E_TIMEOUT = 300_000; // 5 minutes

// Test package - official MoonBit extended library (stable, widely used)
const TEST_PACKAGE = "moonbitlang/x";

// Server port - use high port to avoid conflicts
const SERVER_PORT = 18080;

describe("E2E: Mirror and Serve", () => {
  let tempDir: string;
  let registryDir: string;
  let projectDir: string;
  let serverProcess: Subprocess | null = null;
  const cliPath = join(import.meta.dir, "../../src/index.ts");

  // Check if moon CLI is available
  let moonAvailable = false;
  beforeEach(async () => {
    try {
      await $`moon version`.quiet();
      moonAvailable = true;
    } catch {
      moonAvailable = false;
    }

    tempDir = await mkdtemp(join(tmpdir(), "moonbit-e2e-test-"));
    registryDir = join(tempDir, "registry");
    projectDir = join(tempDir, "test-project");
  });

  afterEach(async () => {
    // Kill server if running
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {
        // Process may already be dead
      }
      serverProcess = null;
    }

    // Clean up temp directory with retry (files might be locked)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        break;
      } catch {
        await Bun.sleep(1000);
      }
    }
  });

  it(
    "should mirror packages and serve them to moon CLI",
    async () => {
      if (!moonAvailable) {
        console.log("Skipping E2E test: moon CLI not installed");
        return;
      }

      // Step 1: Initialize registry
      console.log("Step 1: Initializing registry...");
      await $`bun ${cliPath} init ${registryDir}`.quiet();
      expect(existsSync(join(registryDir, "registry.toml"))).toBe(true);
      expect(existsSync(join(registryDir, "data", "index", ".git"))).toBe(true);

      // Step 2: Mirror the test package
      console.log(`Step 2: Mirroring ${TEST_PACKAGE}...`);
      await $`bun ${cliPath} mirror ${TEST_PACKAGE} -d ${registryDir}`;

      // Verify index was updated
      const indexDir = join(registryDir, "data", "index");
      expect(existsSync(indexDir)).toBe(true);

      // Step 3: Start server in background
      console.log(`Step 3: Starting server on port ${SERVER_PORT}...`);
      serverProcess = Bun.spawn(
        ["bun", cliPath, "serve", "--port", SERVER_PORT.toString(), "-d", registryDir],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      // Wait for server to be ready
      await waitForServer(`http://localhost:${SERVER_PORT}/health`, 30_000, serverProcess);
      console.log("Server is ready");

      // Step 4: Create a test MoonBit project
      console.log("Step 4: Creating test MoonBit project...");
      await mkdir(projectDir, { recursive: true });

      // Current moon rejects `moon.mod.json`; use the `moon.mod` / `moon.pkg` DSL
      await writeFile(
        join(projectDir, "moon.mod"),
        'name = "e2e/test-project"\n\nversion = "0.1.0"\n',
      );
      const mainDir = join(projectDir, "main");
      await mkdir(mainDir, { recursive: true });
      await writeFile(
        join(mainDir, "moon.pkg"),
        `import {\n  "${TEST_PACKAGE}/codec/base64",\n}\n\npkgtype(kind: "executable")\n`,
      );
      await writeFile(
        join(mainDir, "main.mbt"),
        'fn main {\n  println(@base64.encode(b"hello"))\n}\n',
      );

      // Step 5: Fetch the index and add the dependency from the private registry
      console.log("Step 5: Adding dependency from private registry...");
      const registryUrl = `http://localhost:${SERVER_PORT}`;
      const env = {
        ...process.env,
        MOONCAKES_REGISTRY: registryUrl,
        MOON_HOME: join(tempDir, "moon-home"),
      };

      // moon clones the index with `--depth 1`, which needs smart HTTP
      await $`moon update`.cwd(projectDir).env(env);
      await $`moon add ${TEST_PACKAGE}`.cwd(projectDir).env(env);

      // Step 6: Verify moon.mod contains the dependency
      console.log("Step 6: Verifying dependency was added...");
      const updatedMoonMod = await readFile(join(projectDir, "moon.mod"), "utf-8");
      expect(updatedMoonMod).toContain(`"${TEST_PACKAGE}@`);

      // Step 7: Build and run the project with the mirrored dependency
      console.log("Step 7: Running moon build...");
      const buildResult = await $`moon build`.cwd(projectDir).env(env).nothrow();
      expect(buildResult.exitCode).toBe(0);

      const runResult = await $`moon run main`.cwd(projectDir).env(env).nothrow();
      expect(runResult.exitCode).toBe(0);
      expect(runResult.stdout.toString()).toContain("aGVsbG8=");

      console.log("E2E test completed successfully!");
    },
    E2E_TIMEOUT,
  );
});

/**
 * Wait for server health endpoint to respond
 */
async function waitForServer(
  healthUrl: string,
  timeoutMs: number,
  serverProcess: Subprocess,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    // Check if server process died
    if (serverProcess.exitCode !== null) {
      const stderr = await new Response(serverProcess.stderr).text();
      throw new Error(`Server process exited with code ${serverProcess.exitCode}: ${stderr}`);
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(500);
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}
