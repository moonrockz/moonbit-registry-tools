/**
 * Git HTTP Backend CGI wrapper
 *
 * Invokes git-http-backend CGI binary for Smart HTTP protocol support.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import logger from "./logger.ts";

/** Platform-specific paths to git-http-backend */
const BACKEND_PATHS = {
  win32: [
    "C:\\Program Files\\Git\\mingw64\\libexec\\git-core\\git-http-backend.exe",
    "C:\\Program Files (x86)\\Git\\mingw64\\libexec\\git-core\\git-http-backend.exe",
  ],
  linux: ["/usr/lib/git-core/git-http-backend", "/usr/libexec/git-core/git-http-backend"],
  darwin: [
    "/usr/local/libexec/git-core/git-http-backend",
    "/opt/homebrew/libexec/git-core/git-http-backend",
    "/usr/libexec/git-core/git-http-backend",
  ],
} as const;

/** CGI request parameters */
export interface CgiRequest {
  method: "GET" | "POST";
  pathInfo: string;
  queryString?: string;
  contentType?: string;
  body?: ReadableStream<Uint8Array> | null;
}

/** CGI response */
export interface CgiResponse {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

/**
 * Find the git-http-backend binary on the system
 * @param customPath Optional custom path to the binary
 * @returns Path to git-http-backend or null if not found
 */
export function findGitHttpBackend(customPath?: string): string | null {
  // Check custom path first
  if (customPath) {
    if (existsSync(customPath)) {
      logger.debug(`Using custom git-http-backend path: ${customPath}`);
      return customPath;
    }
    logger.warn(`Custom git-http-backend path not found: ${customPath}`);
    return null;
  }

  // Check platform-specific paths
  const platform = process.platform as keyof typeof BACKEND_PATHS;
  const paths = BACKEND_PATHS[platform] || [];

  for (const path of paths) {
    if (existsSync(path)) {
      logger.debug(`Found git-http-backend at: ${path}`);
      return path;
    }
  }

  // Try to find via PATH using 'which' or 'where'
  try {
    const result = Bun.spawnSync({
      cmd: platform === "win32" ? ["where", "git-http-backend"] : ["which", "git-http-backend"],
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode === 0) {
      const path = result.stdout.toString().trim().split("\n")[0];
      if (path && existsSync(path)) {
        logger.debug(`Found git-http-backend in PATH: ${path}`);
        return path;
      }
    }
  } catch {
    // Ignore errors from which/where
  }

  logger.warn("git-http-backend not found on system");
  return null;
}

/**
 * Parse CGI response headers from the output
 * @param headerData Raw header bytes
 * @returns Parsed status and headers
 */
function parseCgiHeaders(headerData: string): { status: number; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  let status = 200;

  const lines = headerData.split("\r\n");
  for (const line of lines) {
    if (!line) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const name = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (name === "status") {
      // Parse "Status: 200 OK" format
      const statusMatch = value.match(/^(\d+)/);
      if (statusMatch) {
        status = Number.parseInt(statusMatch[1], 10);
      }
    } else {
      headers[name] = value;
    }
  }

  return { status, headers };
}

/**
 * Invoke git-http-backend CGI
 * @param backendPath Path to git-http-backend binary
 * @param gitDir Path to the git repository directory
 * @param request CGI request parameters
 * @returns CGI response
 */
export async function invokeCgi(
  backendPath: string,
  gitDir: string,
  request: CgiRequest,
): Promise<CgiResponse> {
  const env: Record<string, string> = {
    ...process.env,
    GIT_PROJECT_ROOT: gitDir,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: request.pathInfo,
    REQUEST_METHOD: request.method,
  };

  if (request.queryString) {
    env.QUERY_STRING = request.queryString;
  }

  if (request.contentType) {
    env.CONTENT_TYPE = request.contentType;
  }

  logger.debug(`Invoking git-http-backend: ${backendPath}`);
  logger.debug(`  GIT_PROJECT_ROOT: ${gitDir}`);
  logger.debug(`  PATH_INFO: ${request.pathInfo}`);
  logger.debug(`  REQUEST_METHOD: ${request.method}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(backendPath, [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let headerBuffer = "";
    let headersParsed = false;
    let parsedStatus = 200;
    let parsedHeaders: Record<string, string> = {};

    // Create a readable stream for the response body
    const bodyChunks: Uint8Array[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      if (!headersParsed) {
        // Still parsing headers
        headerBuffer += chunk.toString("binary");
        const headerEnd = headerBuffer.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          headersParsed = true;
          const headerPart = headerBuffer.slice(0, headerEnd);
          const bodyPart = headerBuffer.slice(headerEnd + 4);

          const parsed = parseCgiHeaders(headerPart);
          parsedStatus = parsed.status;
          parsedHeaders = parsed.headers;

          if (bodyPart.length > 0) {
            bodyChunks.push(Buffer.from(bodyPart, "binary"));
          }
        }
      } else {
        bodyChunks.push(new Uint8Array(chunk));
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      logger.debug(`git-http-backend stderr: ${chunk.toString()}`);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn git-http-backend: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (!headersParsed) {
        // If we never got headers, treat as error
        if (code !== 0) {
          reject(new Error(`git-http-backend exited with code ${code}`));
          return;
        }
        // Empty response
        parsedStatus = 204;
        parsedHeaders = {};
      }

      // Combine all body chunks
      const totalLength = bodyChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const body = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of bodyChunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }

      // Create a ReadableStream from the collected body
      const bodyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      });

      resolve({
        status: parsedStatus,
        headers: parsedHeaders,
        body: bodyStream,
      });
    });

    // Write request body if present
    if (request.body) {
      const reader = request.body.getReader();
      const writeBody = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            proc.stdin.write(value);
          }
          proc.stdin.end();
        } catch (err) {
          logger.error(`Error writing to git-http-backend stdin: ${err}`);
          proc.stdin.end();
        }
      };
      writeBody();
    } else {
      proc.stdin.end();
    }
  });
}

export default {
  findGitHttpBackend,
  invokeCgi,
};
