# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/moonrockz/moonbit-registry-tools/commits/main
