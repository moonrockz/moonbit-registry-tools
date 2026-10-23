# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Caching proxy mode: `serve --proxy` or `[proxy] enabled = true`. The served index is a full
  copy of the index of the default source, refreshed on start and every
  `index_refresh_interval` (default `10m`) without blocking requests. When a refresh fails,
  the proxy logs a warning and serves the last index. Until the first refresh ends (and no
  index from an earlier run exists), `/git/index` answers `503` with `Retry-After`, so that a
  client does not clone and keep an empty index. A committed index from an earlier run, in any
  index layout, is served at once.
- In proxy mode, the server downloads files from the default source on the first request and
  caches them: package zips (both URL forms), prebuilt wasm at `/prebuild/...` and the legacy
  `/assets/...` path (with the `.sha256` files), and `symbols.zip` (fresh for
  `symbols_max_age`, default `1d`; an old copy is served when upstream fails). Zips are
  checked against the index checksum and wasm files against the upstream `.sha256`. A cached
  zip is checked again against the current index checksum once per process; when it does not
  match, the proxy deletes it and downloads it again. A file
  with a different checksum is not cached, and the client gets `502`. Concurrent requests for
  the same missing file share one download. Files are written to a temporary file and renamed.
- Sources accept `download_url` (base URL for zips and prebuilt wasm) and `symbols_url`.
  `source add` has `--download-url` and `--symbols-url`. The `mooncakes` preset sets both, and
  a new `moonrockz` preset uses the index mirror `moonrockz/mooncakes-index` on GitHub with
  downloads from download.mooncakes.io.
- `mirror --proxy` (or `mirror` with `[proxy] enabled = true`) fills the proxy cache and does
  not change the served index. `mirror --prebuild` also downloads the prebuilt wasm of the
  executable packages in the mirrored zips, when upstream has them.
- README section "Proxy Mode" and the recipe "Caching Proxy".
- Archive manifests: one JSON line per version with the entries of the published zip in
  archive order (path, SHA-256, size), the zip checksum and an order-free `content_digest`.
  They are stored next to an index at `manifests/user/<owner>/<pkg>.manifest`, which moon does
  not read. `moonbit-registry manifest <zip>` prints a line; `moonbit-registry manifest build
  --index <dir> [--packages <glob>...] [--limit N] [--concurrency N]` adds the missing lines
  (each zip is checked against the index checksum first). It can run again and keeps the
  index order.
- Opt-in proxy fallbacks in `[proxy.fallback]`, all off by default:
  - `github = true`: when upstream cannot send a zip, rebuild it from the GitHub tag
    (`v<version>` or `<version>`) with `moon package`, put the entries in the published order
    from the manifest, and serve it only when it is byte-identical to the published zip (its
    SHA-256 is the index checksum). A mismatch gives `502` and a log of the entries that are
    different. Without a manifest line there is no rebuild.
  - `build_wasm = true`: when upstream has no prebuilt wasm or cannot be reached, build it from
    the checked source zip (`moon build --target wasm --release`, then `moon-wasm-opt -O
    --all-features` when the toolchain has it). The proxy writes the `.sha256`, keeps these
    files in `prebuild-local/`, and sends `X-Registry-Built-Locally: true`.
  - `toolchain = "auto" | "current" | "<version>" | "nightly-YYYY-MM-DD"` and
    `moonup = "<path>"`: with `auto`, builds
    use the newest toolchain released before the `created_at` of the version, installed with
    moonup into a `MOON_HOME` of the proxy. When moonup is missing, the fallbacks log one error
    and stay off.
  - `manifest_url`: base URL of manifest files, for an index without `manifests/`.
  - With a fallback on, file requests have no idle timeout, because a build can take longer
    than the 10 second default of the server.
  - Builds do not run package hooks: each moon command gets `MOON_IGNORE_PREBUILD=1` and
    `MOON_IGNORE_POSTADD=1`, and the proxy logs the hooks that it finds. Toolchains released
    before 2025-05-29 (and moon binaries that do not know these variables) are refused, so old
    versions that need them cannot be rebuilt.
  - Child processes get an environment from an allowlist (no `GITHUB_TOKEN` or other secrets
    of the proxy), with their own `HOME` and a new `MOON_HOME` for each command.
  - Before `moon package` runs on a GitHub tag, each file of the manifest must be in the tag
    with the same SHA-256.
  - Builds that ask the proxy for a dependency that needs a GitHub rebuild do not deadlock:
    zip rebuilds do not wait in a queue (one rebuild per version at a time), at most two wasm
    builds run at the same time, and only moonup installs run one at a time.

### Fixed

- The saved `registry.toml` put `default_source` after the `[[sources]]` tables, so TOML read it
  as a key of the last source and the first source became the default. `default_source` is now
  written before the first table. `registry.example.toml` and the README example had the same
  problem.

- The GitHub Action `source-add` and `config` commands passed `-d <registry-dir>` before the
  subcommand, so the CLI stopped with `unknown option '-d'`. The option now comes after the
  subcommand.

### Documentation

- The `mirror-registry.yml` and `private-registry.yml` workflow templates no longer deploy the
  index to GitHub Pages. Current moon fetches the index with `--depth 1`, and the dumb HTTP
  protocol of static hosts cannot do shallow fetches. The templates now push the index to
  branch `main` of a git repository on GitHub with a deploy key. Clients use
  `$MOON_HOME/config.json` with `index` set to that repository.
- The CI cache keys in the README, the CI/CD cache recipe and `ci-with-cache.yml` now hash
  `moon.mod`. Current moon does not accept `moon.mod.json`.
- The CI/CD cache recipes now download the `moonbit-registry` binary on each run and mirror
  the packages before `serve`. Before, a cache hit had no binary, and the served index was empty.
- The README and the KB pages describe the client configuration (`MOONCAKES_REGISTRY` and
  `$MOON_HOME/config.json`) and the Smart HTTP and `main` branch requirements of current moon.
- `docs/session-summary.md` says that `serve` uses Smart HTTP since v0.3.0.
- The Multiple Sources recipe now describes how v0.3.0 picks a source. The Team Registry
  Dockerfile now uses a Debian image with `git`, which Smart HTTP needs.
- The GitHub Actions example in the Authentication recipe now renders `secrets.*` correctly on
  the documentation site.

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
