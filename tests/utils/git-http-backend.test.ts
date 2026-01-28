/**
 * Tests for git-http-backend utility
 */

import { describe, expect, it } from "bun:test";
import { findGitHttpBackend } from "../../src/utils/git-http-backend.ts";

describe("git-http-backend utility", () => {
  describe("findGitHttpBackend", () => {
    it("should return null for non-existent custom path", () => {
      const result = findGitHttpBackend("/nonexistent/path/git-http-backend");
      expect(result).toBeNull();
    });

    it("should try to find git-http-backend on system", () => {
      // This will return a path or null depending on the system
      const result = findGitHttpBackend();
      // We just check it doesn't throw
      expect(result === null || typeof result === "string").toBe(true);
    });

    it("should accept custom path if it exists", () => {
      // Test with a path that exists (the test file itself)
      const result = findGitHttpBackend(import.meta.path);
      // Won't be a valid git-http-backend but should return the path since it exists
      expect(result).toBe(import.meta.path);
    });
  });
});
