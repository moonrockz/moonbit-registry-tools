# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.5] - 2026-02-04

### Fixed

- Use correct download URL for mooncakes.io packages (`download.mooncakes.io` instead of `mooncakes.io`)

## [0.2.4] - 2026-02-04

### Fixed

- Handle undefined deps in dependency resolver - some mooncakes packages have deps as undefined/null

## [0.2.3] - 2026-02-04

### Fixed

- Throw error when git clone fails instead of silently continuing
- Check for `.git` directory to verify repo root rather than using `git rev-parse` which returns true inside any parent repo
- Handle mooncakes index structure with `user/` prefix and `.index` suffix

## [0.2.0] - 2026-02-04

### Fixed

- Multiple path resolution fixes for mooncakes.io index structure

## [0.1.0] - 2026-01-27

### Added

- Initial release of MoonBit Registry CLI tool
- `init` command to initialize a new local registry
- `mirror` command to mirror packages from upstream registries
- `serve` command to start HTTP server for serving packages
- `config` command to view and modify registry configuration
- `source` command to manage multiple mirror sources
- `sync` command to sync registry index with remote git repository
- Multi-source mirroring support with priority-based fallback
- Support for mooncakes.io and custom registry sources
- Bearer token and basic authentication for private registries
- Git-based index management with dumb HTTP protocol
- Package caching with checksum verification
- Transitive dependency resolution with glob pattern matching
- CORS support for browser-based clients
- End-to-end tests for registry mirroring with moon CLI integration
- Manually triggered GitHub workflow for E2E tests
- PowerShell shims for Windows mise task compatibility
- Comprehensive test suite with unit and integration tests
- GitHub Pages documentation site with just-the-docs theme
- Documentation recipes for offline development, CI/CD caching, multi-source mirroring, team registries, and authentication
- Changelog in keepachangelog format with release notes automation
- Expanded README with getting started scenarios and configuration examples

[Unreleased]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.0...v0.2.3
[0.2.0]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/moonrockz/moonbit-registry-tools/releases/tag/v0.1.0
