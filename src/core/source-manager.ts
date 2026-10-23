/**
 * Source Manager
 *
 * Manages multiple mirror sources, handling URL building, authentication,
 * and source resolution. Supports both legacy upstream config and new
 * sources array format.
 */

import { UPSTREAM } from "../config/defaults.ts";
import logger from "../utils/logger.ts";
import type { MirrorSource, RegistryConfig } from "./types.ts";

export class SourceManager {
  private sources: Map<string, MirrorSource>;
  private defaultSourceName: string | null;

  constructor(config: RegistryConfig) {
    this.sources = new Map();
    this.defaultSourceName = null;
    this.loadSources(config);
  }

  /** Load sources from config, handling legacy format */
  private loadSources(config: RegistryConfig): void {
    // Handle legacy upstream config
    if (config.upstream && (!config.sources || config.sources.length === 0)) {
      logger.debug("Using legacy upstream config as source");

      const legacySource: MirrorSource = {
        name: "upstream",
        type: "mooncakes",
        url: config.upstream.url,
        index_url: config.upstream.index_url,
        index_type: "git",
        package_url_pattern:
          "https://download.mooncakes.io/user/${username}/${name}/${version}.zip",
        enabled: config.upstream.enabled,
        priority: 0,
      };

      this.sources.set("upstream", legacySource);
      this.defaultSourceName = "upstream";
    }

    // Load configured sources
    if (config.sources && config.sources.length > 0) {
      for (const source of config.sources) {
        this.sources.set(source.name, source);
      }

      // Set default source
      if (config.default_source && this.sources.has(config.default_source)) {
        this.defaultSourceName = config.default_source;
      } else if (config.sources.length > 0) {
        // Use first source as default if not specified
        this.defaultSourceName = config.sources[0].name;
      }
    }
  }

  /** Get a source by name, or default source if name not provided */
  getSource(name?: string): MirrorSource | null {
    if (name) {
      return this.sources.get(name) ?? null;
    }
    return this.getDefaultSource();
  }

  /** Get the default source */
  getDefaultSource(): MirrorSource | null {
    if (!this.defaultSourceName) {
      return null;
    }
    return this.sources.get(this.defaultSourceName) ?? null;
  }

  /** Get the default source name */
  getDefaultSourceName(): string | null {
    return this.defaultSourceName;
  }

  /** List all configured sources */
  listSources(): MirrorSource[] {
    return Array.from(this.sources.values());
  }

  /** List all enabled sources sorted by priority */
  listEnabledSources(): MirrorSource[] {
    return this.listSources()
      .filter((s) => s.enabled)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /** Check if a source exists */
  hasSource(name: string): boolean {
    return this.sources.has(name);
  }

  /** Base URL of the zips and prebuilt wasm of a source */
  getDownloadBase(source: MirrorSource): string {
    if (source.download_url) {
      return trimSlash(source.download_url);
    }
    // Another moonbit-registry server (for example a chained proxy) serves
    // downloads below its own URL
    if (source.type === "moonbit-registry" && source.url) {
      return trimSlash(source.url);
    }
    return UPSTREAM.DOWNLOAD_URL;
  }

  /** Build package download URL for a source */
  buildPackageUrl(source: MirrorSource, username: string, name: string, version: string): string {
    if (!source.package_url_pattern) {
      return `${this.getDownloadBase(source)}/user/${encodeSegment(username)}/${encodeSegment(name)}/${encodeSegment(version)}.zip`;
    }

    return source.package_url_pattern
      .replace(/\$\{url\}/g, source.url)
      .replace(/\$\{download_url\}/g, this.getDownloadBase(source))
      .replace(/\$\{username\}/g, encodeSegment(username))
      .replace(/\$\{name\}/g, encodeSegment(name))
      .replace(/\$\{version\}/g, encodeSegment(version));
  }

  /**
   * Build the URL of a prebuilt wasm file (or its `.sha256`) for a source:
   * `<download>/prebuild/<owner>/<name>@<version>[/<package path>]/<file>`
   */
  buildPrebuildUrl(
    source: MirrorSource,
    username: string,
    name: string,
    version: string,
    packagePath: string[],
    file: string,
  ): string {
    const segments = [
      encodeSegment(username),
      `${encodeSegment(name)}@${encodeSegment(version)}`,
      ...packagePath.map(encodeSegment),
      encodeSegment(file),
    ];
    return `${this.getDownloadBase(source)}/prebuild/${segments.join("/")}`;
  }

  /** URL of the symbol database of a source */
  getSymbolsUrl(source: MirrorSource): string {
    if (source.symbols_url) {
      return source.symbols_url;
    }
    if (source.type === "moonbit-registry" && source.url && !source.download_url) {
      return `${trimSlash(source.url)}/symbols.zip`;
    }
    return `${this.getDownloadBase(source)}/symbols.zip`;
  }

  /** Get fetch options with auth headers for a source */
  getFetchOptions(source: MirrorSource): RequestInit {
    const options: RequestInit = {};

    if (source.auth && source.auth.type !== "none") {
      const headers: Record<string, string> = {};

      switch (source.auth.type) {
        case "bearer":
          if (source.auth.token) {
            // Support environment variable references like ${VAR}
            const token = this.resolveEnvVar(source.auth.token);
            headers.Authorization = `Bearer ${token}`;
          }
          break;

        case "basic":
          if (source.auth.username && source.auth.password) {
            const username = this.resolveEnvVar(source.auth.username);
            const password = this.resolveEnvVar(source.auth.password);
            const credentials = Buffer.from(`${username}:${password}`).toString("base64");
            headers.Authorization = `Basic ${credentials}`;
          }
          break;
      }

      if (Object.keys(headers).length > 0) {
        options.headers = headers;
      }
    }

    return options;
  }

  /** Resolve environment variable references like ${VAR} */
  private resolveEnvVar(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] ?? "";
    });
  }
}

/** Percent-encode one URL path segment as moon does (RFC 3986 unreserved kept) */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export default SourceManager;
