# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-22

### Fixed

- `mirror` now publishes the index files of mirrored packages to the served index at
  `user/<owner>/<pkg>.index` (the layout that moon reads) and commits them. Before, the
  served index stayed empty, so `moon update` against the registry found no packages.
- `mirror` publishes only the versions whose archives it has cached. Before, a version whose
  download failed (404 or checksum mismatch) was still listed in the served index.
- `mirror` downloads yanked versions too. moon still selects yanked versions (it only
  warns that they are deprecated), so a mirror without them broke `moon add`.
- `mirror` (without `--strict`) now includes all transitive dependencies of every mirrored
  version, as the documentation says. Before, it included only dependencies that matched
  the patterns, and only from the latest version that was not yanked.
- A second `mirror` run downloads new upstream versions of packages that already have a
  cached version. Before, any cached version made `mirror` skip the whole package.
- The server accepts `/user/<owner>%2F<pkg>%2F<version>.zip`, the download path that moon
  requests when `MOONCAKES_REGISTRY` is set.
- Smart HTTP responses no longer send a duplicate `Content-Type` header, which made git
  reject them.
- `git-http-backend` is also found in `git --exec-path` (for example Homebrew git).
- Changing sources with `addSource`, `removeSource`, `setSourceEnabled`, or
  `setDefaultSource` now takes effect for index and package operations in the same process.

### Changed

- Smart HTTP is now enabled by default. moon clones the index with `--depth 1`, which the
  dumb HTTP protocol cannot serve. Set `[server.smart_http] enabled = false` to turn it off.
- When Smart HTTP is off or `git-http-backend` is missing, `info/refs?service=...` returns
  the dumb HTTP refs file instead of `501`, so full (not shallow) git clones still work.
  `serve` and `mirror` now run `git update-server-info` for dumb HTTP clients.
- `IndexManager.getPackageIndexPath` returns `user/<owner>/<pkg>.index`. Index files in the
  old `<owner>/<pkg>` layout are still read.
- `serve` warns when `git.branch` is not `main`, because moon fetches only `main`.

### Added

- `GET /symbols.zip` redirects to `https://download.mooncakes.io/symbols.zip` when the default
  source is a mooncakes source, so `moon update` does not warn that symbols failed.

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

[Unreleased]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.0...v0.2.3
[0.2.0]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/moonrockz/moonbit-registry-tools/releases/tag/v0.1.0
