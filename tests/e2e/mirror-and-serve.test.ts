/**
 * E2E Tests for MoonBit Registry mirroring and serving
 *
 * These tests:
 * 1. Initialize a local registry
 * 2. Mirror a package from mooncakes.io
 * 3. Start the registry server
 * 4. Use moon CLI with MOONCAKES_REGISTRY to install the package
 * 5. Verify the installation succeeded
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

      // Create a minimal moon.mod.json
      const moonMod = {
        name: "e2e-test-project",
        version: "0.1.0",
        deps: {},
        "test-deps": {},
      };
      await writeFile(join(projectDir, "moon.mod.json"), JSON.stringify(moonMod, null, 2));

      // Create moon.pkg.json for the main package
      const srcDir = join(projectDir, "src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, "moon.pkg.json"), JSON.stringify({ is_main: true }, null, 2));

      // Create a minimal main.mbt file
      await writeFile(join(srcDir, "main.mbt"), 'fn main { println("hello") }\n');

      // Step 5: Add dependency using private registry
      console.log("Step 5: Adding dependency from private registry...");
      const registryUrl = `http://localhost:${SERVER_PORT}`;
      const env = { ...process.env, MOONCAKES_REGISTRY: registryUrl };

      // Parse package name for moon add
      const [username, pkgName] = TEST_PACKAGE.split("/");
      await $`moon add ${username}/${pkgName}`.cwd(projectDir).env(env);

      // Step 6: Verify moon.mod.json contains the dependency
      console.log("Step 6: Verifying dependency was added...");
      const updatedMoonMod = JSON.parse(await readFile(join(projectDir, "moon.mod.json"), "utf-8"));
      expect(updatedMoonMod.deps).toBeDefined();
      expect(Object.keys(updatedMoonMod.deps)).toContain(`${username}/${pkgName}`);

      // Step 7: Verify moon check works (validates the dependency can be resolved)
      console.log("Step 7: Running moon check...");
      const checkResult = await $`moon check`.cwd(projectDir).env(env).nothrow();
      expect(checkResult.exitCode).toBe(0);

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
