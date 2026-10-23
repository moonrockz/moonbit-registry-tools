# moonbit-registry-tools

A CLI tool for managing MoonBit registries, including local registry setup, mirroring from mooncakes.io, and serving as a registry server.

## Overview

The MoonBit registry (mooncakes.io) is the official package registry for the MoonBit programming language. This tool helps you:

- Set up a local/private registry for your organization
- Mirror packages from mooncakes.io for offline access or faster builds
- Mirror from multiple sources including private registries
- Serve packages to your development team
- Sync your local registry with remote git repositories

## Installation

### Using Mise (Recommended)

If you have [mise](https://mise.jdx.dev) installed:

```bash
mise use -g "github:moonrockz/moonbit-registry-tools@latest"
```

**Windows ARM64 users:** Run the x64 binary via emulation:

```bash
MISE_ARCH=x64 mise use -g "github:moonrockz/moonbit-registry-tools@latest"
```

### Download Pre-built Binaries

Download from [GitHub Releases](https://github.com/moonrockz/moonbit-registry-tools/releases):

| Platform | Download |
|----------|----------|
| Linux x64 | [moonbit-registry-linux-x64.tar.gz](https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz) |
| Linux ARM64 | [moonbit-registry-linux-arm64.tar.gz](https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-arm64.tar.gz) |
| macOS Intel | [moonbit-registry-darwin-x64.tar.gz](https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-darwin-x64.tar.gz) |
| macOS Apple Silicon | [moonbit-registry-darwin-arm64.tar.gz](https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-darwin-arm64.tar.gz) |
| Windows x64 | [moonbit-registry-windows-x64.zip](https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-windows-x64.zip) |

### From Source

Prerequisites: [Bun](https://bun.sh) (v1.0+) and Git

```bash
git clone https://github.com/moonrockz/moonbit-registry-tools.git
cd moonbit-registry-tools
bun install
bun run build
```

The compiled binary will be available at `dist/moonbit-registry`.

### Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Run tests
bun test

# Build
bun run build
```

## Usage

### Initialize a Local Registry

```bash
# Initialize in current directory
moonbit-registry init

# Initialize at a specific path with a custom name
moonbit-registry init ./my-registry --name my-company-registry
```

This creates:
- `registry.toml` - Configuration file
- `data/index/` - Git repository for package index
- `data/packages/` - Cached package files

### Mirror Packages

Mirror packages from the upstream mooncakes.io registry:

```bash
# Mirror specific packages using glob patterns
moonbit-registry mirror "moonbitlang/*"
moonbit-registry mirror "company/pkg-*" "moonbitlang/core"

# Mirror the entire registry
moonbit-registry mirror --full

# Strict mode: only mirror exact pattern matches (no dependency resolution)
moonbit-registry mirror --strict "moonbitlang/core"

# Quiet mode: suppress warnings about skipped dependencies
moonbit-registry mirror -q "moonbitlang/*"
```

By default, the mirror command automatically includes transitive dependencies. Use `--strict` to disable this behavior.

### Start the Registry Server

```bash
# Start server with default settings (port 8080)
moonbit-registry serve

# Specify a different port
moonbit-registry serve --port 3000

# Specify host and port
moonbit-registry serve --host 0.0.0.0 --port 8080
```

### Update Moon's Package Index

The `update` command runs `moon update` with a specific registry configured:

```bash
# Update from your local registry (uses server.base_url from config)
moonbit-registry update

# Update from a specific registry URL
moonbit-registry update --registry http://localhost:8080

# Update from the official mooncakes.io registry
moonbit-registry update --mooncakes
```

This runs `moon update` with the `MOONCAKES_REGISTRY` environment variable set to your private registry URL.
If `$MOON_HOME/config.json` exists, moon ignores that variable (see below).

#### Manual Configuration

Alternatively, set the environment variable directly:

```bash
# Set the registry URL for moon
export MOONCAKES_REGISTRY=http://localhost:8080

# Now moon commands will use your local registry
moon new my-project
cd my-project
moon build
```

Current `moon` releases also read `$MOON_HOME/config.json` (default `~/.moon/config.json`).
When that file exists, moon ignores `MOONCAKES_REGISTRY`. To use the file instead of the
environment variable, write:

```json
{
  "api": "http://localhost:8080",
  "index": "http://localhost:8080/git/index",
  "download": "http://localhost:8080"
}
```

#### Server Requirements for moon

- moon clones the index with `git clone --depth 1` and updates it with `git fetch --depth=1`.
  Shallow fetches need the Git Smart HTTP protocol, so the server needs `git-http-backend`
  (part of a normal git install). Smart HTTP is on by default (`[server.smart_http]`).
  Static hosting with the dumb HTTP protocol (for example GitHub Pages) does not work.
- moon fetches only the `main` branch of the index. Keep `git.branch = "main"`.

#### Index Without a Server

You can also keep the index in a git repository on GitHub and use no server.
A GitHub repository URL supports Smart HTTP and shallow fetches. The repository must
have a branch named `main`. The workflow templates below push a mirrored index to such a
repository. Then each client writes `$MOON_HOME/config.json`:

```json
{
  "api": "https://mooncakes.io",
  "index": "https://github.com/moonrockz/mooncakes-index.git",
  "download": "https://download.mooncakes.io"
}
```

In this setup, moon downloads the package archives from the upstream download host.

### View/Modify Configuration

```bash
# View all configuration
moonbit-registry config

# View specific value
moonbit-registry config server.port

# Set a value
moonbit-registry config server.port 9000
```

### Manage Mirror Sources

Configure multiple upstream sources for mirroring:

```bash
# List configured sources
moonbit-registry source list

# Add mooncakes.io using a preset
moonbit-registry source add mooncakes --from-preset mooncakes

# Add a custom private registry
moonbit-registry source add mycompany \
  --url https://registry.mycompany.com \
  --index-url https://registry.mycompany.com/git/index \
  --priority 50

# Add a source with authentication
moonbit-registry source add private \
  --url https://private.example.com \
  --index-url https://private.example.com/git/index
# Then edit registry.toml to add auth:
# [sources.auth]
# type = "bearer"
# token = "${REGISTRY_TOKEN}"

# Set the default source for mirroring
moonbit-registry source default mooncakes

# Enable/disable sources
moonbit-registry source enable mycompany
moonbit-registry source disable mooncakes

# Remove a source
moonbit-registry source remove mycompany
```

### Sync with Remote Git

If you want to share your registry index with others:

```bash
# Configure remote URL
moonbit-registry config git.remote_url "https://github.com/org/registry-index.git"

# Push local index to remote
moonbit-registry sync --push

# Pull updates from remote
moonbit-registry sync --pull
```

## Proxy Mode

In proxy mode, `serve` is a caching proxy for an upstream registry. Use it on your machine or
on your LAN when you want the full registry but do not want to download it all first.

- The served index is a full copy of the index of the default source: all packages and all
  versions, with each line copied as it is. The proxy refreshes the index when it starts and
  then on `index_refresh_interval` (default 10 minutes). Requests do not wait for a refresh.
  If a refresh fails, the proxy logs a warning and continues to serve the last index.
- The proxy downloads a package zip, a prebuilt wasm file or `symbols.zip` from upstream on
  the first request. Then it keeps the file in its cache and serves it from there.
- The proxy compares each zip with the SHA-256 checksum in the index, and each prebuilt wasm
  file with the `.sha256` file from upstream. If a checksum is different, the proxy does not
  keep the file and sends `502 Bad Gateway`. If upstream does not have the file, it sends
  `404`.
- When many clients ask for the same missing file at the same time, the proxy downloads it
  only once.

Mirror mode (without `--proxy`) does not change: the served index has only the packages that
you mirrored.

### Start a proxy

Upstream mooncakes.io:

```bash
moonbit-registry init my-proxy
cd my-proxy
moonbit-registry source add mooncakes --from-preset mooncakes
moonbit-registry source default mooncakes
moonbit-registry serve --proxy --port 8080
```

Upstream index mirror on GitHub (`moonrockz/mooncakes-index`), with downloads from
download.mooncakes.io:

```bash
moonbit-registry source add moonrockz --from-preset moonrockz
moonbit-registry source default moonrockz
moonbit-registry serve --proxy --port 8080
```

You can also set proxy mode in `registry.toml` instead of `--proxy`:

```toml
default_source = "mooncakes"

[[sources]]
name = "mooncakes"
type = "mooncakes"
url = "https://mooncakes.io"
index_url = "https://mooncakes.io/git/index"   # or https://github.com/moonrockz/mooncakes-index.git
download_url = "https://download.mooncakes.io" # zips and prebuilt wasm
symbols_url = "https://download.mooncakes.io/symbols.zip"

[proxy]
enabled = true
index_refresh_interval = "10m"
symbols_max_age = "1d"
```

`default_source` is a top-level key. Put it before the first `[table]`, or TOML puts it in
that table.

To chain proxies, add the upstream proxy as a source of type `moonbit-registry`, with `url`
set to its address and `index_url` set to `<url>/git/index`.

### Configure moon

With `$MOON_HOME/config.json` (default `~/.moon/config.json`):

```json
{
  "api": "https://mooncakes.io",
  "index": "http://localhost:8080/git/index",
  "download": "http://localhost:8080"
}
```

`api` is for search and publishing. The proxy does not serve it, so keep the mooncakes.io
value.

With the environment variable (only when `$MOON_HOME/config.json` does not exist):

```bash
export MOONCAKES_REGISTRY=http://localhost:8080
```

Then use moon as usual: `moon update`, `moon add`, `moon build`, `moonx`.

### Fill the cache before you go offline

In proxy mode, `mirror` downloads the zips of the packages that match the patterns, and of
their dependencies, into the cache. It does not change the served index. Set
`[proxy] enabled = true` in `registry.toml`, or give `--proxy` to `mirror` too.
`--prebuild` also downloads the prebuilt wasm of the executable packages in these zips, when
upstream has them (`moonx` uses these files). Packages that have no prebuild upstream are
skipped.

```bash
moonbit-registry mirror 'moonbitlang/*' --proxy --prebuild
```

You can run this while the proxy runs.

### Offline use

When upstream is not available, the proxy serves the last index and all files in its cache.
A request for a file that is not in the cache gets `502` (or `404`). An old `symbols.zip`
is served when the proxy cannot get a new one.

### Fallbacks (opt-in)

When upstream cannot send a file, the proxy can make it. Both fallbacks are off by default.

```toml
[proxy.fallback]
github = true          # rebuild a zip from the GitHub tag of its repository
build_wasm = true      # build a missing prebuilt wasm from the package source
toolchain = "auto"     # "auto", "current" or a version such as "0.6.34+e16ca94e6"
moonup = "moonup"      # path of moonup (https://github.com/chawyehsu/moonup)
# manifest_url = "https://example.com/manifests"   # when the index has no manifests/
```

- **GitHub rebuild.** When the download of a zip fails (network error, `5xx` or `404`) and
  the index line has a GitHub `repository`, the proxy downloads the tarball of tag
  `v<version>` (or `<version>`), finds the module, and runs `moon package`. It puts the
  entries in the order of the published zip, from the manifest line of the version. It serves
  the rebuild **only when its SHA-256 is the checksum in the index**, that is, when it is
  byte-identical to the published zip. Otherwise it sends `502` and logs the entries that are
  different. Without a manifest line, it does not rebuild. Before moon runs, each file of the
  manifest must be in the tag with the same SHA-256; if not, moon does not run.
- **Local wasm build.** When upstream has no prebuilt wasm or cannot be reached, the proxy
  builds the executable package from its zip (from the cache, from upstream, or from a GitHub
  rebuild, always checked against the index) with `moon build --target wasm --release`, and
  then `moon-wasm-opt -O --all-features` when the toolchain has it. It writes the `.sha256`
  itself and sends `X-Registry-Built-Locally: true` with both files. In general this wasm is
  not byte-identical to an upstream prebuild. It is trusted because the proxy built it from
  checked sources. moonx waits about 30 seconds for a file: when a first build takes longer
  (for example while moonup installs a toolchain), run moonx again, or fill the cache first
  with `mirror --proxy --prebuild`.
- **Toolchain.** Old packages often build only with the toolchain of their publish date.
  With `toolchain = "auto"`, the proxy uses the newest toolchain released before the
  `created_at` of the version, and installs it with moonup when it is missing. moonup and its
  toolchains use their own `MOON_HOME` and `MOONUP_HOME` below `data_dir/fallback/`, so your
  `~/.moon` does not change. `toolchain` can also be a fixed version or `nightly-YYYY-MM-DD`.
  With `toolchain = "current"`, the proxy uses the moon of your `MOON_HOME` and does not need
  moonup. When moonup is missing, the proxy logs one error and the fallbacks stay off.
- **Package hooks and secrets.** Builds run with `MOON_IGNORE_PREBUILD=1` and
  `MOON_IGNORE_POSTADD=1`, so moon does not run the `pre-build` or `postadd` commands of the
  code it builds. A package that needs its pre-build output can fail to build (or, for a
  GitHub rebuild, fail `moon package`, which checks the tests too). The proxy does
  not run toolchains released before 2025-05-29, which do not know these variables, so
  versions that need such a toolchain cannot be rebuilt. Child processes get an environment
  from an allowlist: `GITHUB_TOKEN` and other secrets of the proxy are not passed.
- **Dependencies of a build** come through the proxy. Some old toolchains (for example
  `0.10.0`) download dependency zips from download.mooncakes.io directly, so a build with them
  needs that host.

#### Manifests

A manifest line records the entries of a published zip in archive order, with the SHA-256
and size of each file. The files are next to the index, at
`manifests/user/<owner>/<pkg>.manifest`; moon does not read them. An index mirror such as
`moonrockz/mooncakes-index` can carry them; the proxy copies them with the index.

```bash
# Print the manifest line of one zip
moonbit-registry manifest moonbitlang-x-0.5.6.zip

# Add the missing lines for the versions of an index (it downloads each zip and checks it)
moonbit-registry manifest build --index ./mooncakes-index --packages 'moonbitlang/*' --limit 500
```

`manifest build` can run again at any time. It adds only the lines that are missing and
keeps the order of the index.

### Disk use

All data is below `data_dir`:

| Path | Content |
|------|---------|
| `index/` | Served index (git), with the upstream clone in `index/sources/<source>/` |
| `packages/<owner>/<name>/<version>.zip` | Cached zips |
| `prebuild/<owner>/<name>@<version>/...` | Cached prebuilt wasm and `.sha256` files |
| `prebuild-local/<owner>/<name>@<version>/...` | Prebuilt wasm that the proxy built (fallback) |
| `fallback/` | Toolchains and temporary files of the fallbacks |
| `symbols/symbols.zip` | Cached symbol database |

The index takes some tens of MB. The cache grows only with the files that clients ask for.
For scale: all zips of mooncakes.io together are about 16 GB, and most projects use a very
small part of them. To clear the cache, stop the proxy and delete `packages/`, `prebuild/`
and `symbols/`.

## Configuration

Configuration is stored in `registry.toml`. See `registry.example.toml` for all available options.

### Key Configuration Options

```toml
# Top-level keys come before the first table
default_source = "mooncakes"

[registry]
name = "my-company-registry"
data_dir = "./data"

# Multiple sources (recommended)
[[sources]]
name = "mooncakes"
type = "mooncakes"
url = "https://mooncakes.io"
index_url = "https://mooncakes.io/git/index"
index_type = "git"
download_url = "https://download.mooncakes.io"  # Optional: zips and prebuilt wasm
enabled = true
priority = 100

[[sources]]
name = "partner"
type = "moonbit-registry"
url = "https://partner.example.com/registry"
index_url = "https://partner.example.com/registry/git/index"
index_type = "git"
enabled = true
priority = 50
[sources.auth]
type = "bearer"
token = "${PARTNER_REGISTRY_TOKEN}"  # Environment variable

[mirror]
auto_sync = false
sync_interval = "1h"
packages = []  # Default patterns to mirror

[server]
host = "0.0.0.0"
port = 8080
base_url = "http://localhost:8080"

[proxy]
enabled = false  # true (or serve --proxy) for proxy mode
index_refresh_interval = "10m"
symbols_max_age = "1d"

[git]
remote_url = ""  # Optional: push index to remote
branch = "main"
auto_push = false
```

### Authentication

Sources can use bearer token or basic authentication:

```toml
# Bearer token (recommended)
[sources.auth]
type = "bearer"
token = "${MY_TOKEN}"  # Use env var for security

# Basic auth
[sources.auth]
type = "basic"
username = "user"
password = "${MY_PASSWORD}"
```

## API Endpoints

When running `moonbit-registry serve`, the following endpoints are available:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Registry info and available endpoints |
| `GET /health` | Health check |
| `GET /git/index` | Git index (Smart HTTP, with dumb HTTP fallback) |
| `GET /user/{username}/{package}/{version}.zip` | Download package (also accepts the `%2F` form that moon sends) |
| `GET /symbols.zip` | Redirect to the mooncakes.io symbol database (mooncakes sources only). In proxy mode: cached copy |
| `GET /prebuild/{username}/{package}@{version}/{path}/{file}.wasm` | Prebuilt wasm, and the same URL with `.sha256`. In proxy mode, downloaded on a miss |
| `GET /assets/{username}/{package}@{version}/{path}/{file}.wasm` | The same prebuilt wasm, at the path of legacy clients (`MOONCAKES_REGISTRY`) |
| `GET /user/{username}/{package}` | Package metadata (JSON) |

## Getting Started

### Scenario 1: Mirror from mooncakes.io for Offline Development

Set up a local cache of packages for offline development or faster CI builds.

```bash
# Initialize a local registry
moonbit-registry init ./my-registry
cd my-registry

# Mirror specific packages you need
moonbit-registry mirror "moonbitlang/core" "moonbitlang/x"

# Or mirror all packages from an organization
moonbit-registry mirror "moonbitlang/*"

# Start the server
moonbit-registry serve --port 8080

# In another terminal, configure moon to use your local registry
export MOONCAKES_REGISTRY=http://localhost:8080

# Now moon commands use your local mirror
moon new my-project
cd my-project
moon add moonbitlang/x
moon build
```

### Scenario 2: Set Up a Team Registry with Multiple Sources

Create a registry that mirrors from mooncakes.io and a partner's private registry.

```bash
# Initialize registry
moonbit-registry init ./team-registry
cd team-registry

# Add mooncakes.io as primary source (using preset)
moonbit-registry source add mooncakes --from-preset mooncakes

# Add a partner's private registry
moonbit-registry source add partner \
  --url https://partner.example.com/registry \
  --index-url https://partner.example.com/registry/git/index

# List configured sources
moonbit-registry source list

# Mirror packages from the default source (mooncakes)
moonbit-registry mirror "moonbitlang/*"

# Mirror from a specific source
moonbit-registry mirror -s partner "partner-org/*"

# Start serving
moonbit-registry serve
```

### Scenario 3: Air-Gapped Environment Setup

For environments without internet access, pre-populate a registry and transfer it.

```bash
# On a machine WITH internet access:
moonbit-registry init ./offline-registry
cd offline-registry

# Mirror everything your team needs
moonbit-registry mirror --full  # Or specific patterns

# The registry is now in ./offline-registry/data/
# Transfer the entire directory to your air-gapped environment

# On the air-gapped machine:
cd /path/to/offline-registry
moonbit-registry serve --host 0.0.0.0 --port 8080

# Configure all developer machines:
export MOONCAKES_REGISTRY=http://registry-server:8080
```

### Scenario 4: CI/CD Pipeline Cache

Speed up your CI builds by caching packages locally.

```yaml
# .github/workflows/ci.yml
jobs:
  build:
    steps:
      - uses: actions/checkout@v4

      - name: Cache MoonBit packages
        uses: actions/cache@v4
        with:
          path: .moonbit-registry
          key: moonbit-packages-${{ hashFiles('moon.mod') }}

      - name: Start local registry
        run: |
          moonbit-registry init .moonbit-registry 2>/dev/null || true
          moonbit-registry source add mooncakes --from-preset mooncakes -d .moonbit-registry 2>/dev/null || true
          moonbit-registry mirror -d .moonbit-registry "moonbitlang/core"
          moonbit-registry serve -d .moonbit-registry &
          sleep 2

      - name: Build with local cache
        env:
          MOONCAKES_REGISTRY: http://localhost:8080
        run: moon build
```

## GitHub Actions

Use moonbit-registry-tools directly in your GitHub Actions workflows.

### Quick Start

```yaml
- name: Initialize registry
  uses: moonrockz/moonbit-registry-tools@main
  with:
    command: init
    registry-dir: .moonbit-registry

- name: Mirror packages
  uses: moonrockz/moonbit-registry-tools@main
  with:
    command: mirror
    registry-dir: .moonbit-registry
    patterns: "moonbitlang/core moonbitlang/x"

- name: Start registry server
  uses: moonrockz/moonbit-registry-tools@main
  with:
    command: serve
    registry-dir: .moonbit-registry
    port: '8080'
    background: 'true'
```

### Available Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize a new registry |
| `mirror` | Mirror packages from upstream |
| `sync` | Sync index with remote git |
| `serve` | Start the registry server |
| `source-add` | Add a mirror source |
| `config` | View or modify configuration |

### Action Inputs

#### Common Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `command` | Command to run (required) | - |
| `registry-dir` | Path to registry directory | `.moonbit-registry` |
| `verbose` | Enable verbose logging | `false` |
| `version` | Tool version to use | `latest` |

#### Mirror Command Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `patterns` | Package patterns (space-separated) | - |
| `full` | Mirror entire registry | `false` |
| `strict` | Exact matches only (no deps) | `false` |
| `source` | Specific source to mirror from | - |

#### Serve Command Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `port` | Server port | `8080` |
| `host` | Server host | `0.0.0.0` |
| `background` | Run in background | `false` |

#### Sync Command Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `sync-mode` | Mode: `push`, `pull`, or `both` | `pull` |

### Action Outputs

| Output | Description |
|--------|-------------|
| `registry-url` | URL of the registry server (serve command) |
| `registry-dir` | Path to the registry directory |
| `packages-mirrored` | Number of packages mirrored |

### Workflow Templates

We provide ready-to-use workflow templates in [`.github/workflows/templates/`](.github/workflows/templates/):

| Template | Description |
|----------|-------------|
| [`mirror-registry.yml`](.github/workflows/templates/mirror-registry.yml) | Mirror the mooncakes.io index to branch `main` of a git repository on GitHub |
| [`ci-with-cache.yml`](.github/workflows/templates/ci-with-cache.yml) | CI workflow with package caching |
| [`private-registry.yml`](.github/workflows/templates/private-registry.yml) | Private, curated index of approved packages in a private git repository |

Copy the template to your repository's `.github/workflows/` directory and customize as needed.
The header comment of each template lists the setup steps.

Do not deploy the index to GitHub Pages or another static host. Static hosts use the dumb
HTTP protocol, and current moon fails with
`dumb http transport does not support shallow capabilities`.

### Example: Complete Mirror Setup

The mirror job checks out the index repository into the registry's `data/index` directory,
mirrors into it, and pushes to `main` with a deploy key. The secret `INDEX_DEPLOY_KEY`
holds the private half of a deploy key with write access to the index repository.
In an organization, first allow deploy keys: Settings > Member privileges > Deploy keys.

```yaml
name: Mirror Registry

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:

permissions:
  contents: read

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout index repository
        uses: actions/checkout@v4
        with:
          repository: my-org/mooncakes-index
          ref: main
          ssh-key: ${{ secrets.INDEX_DEPLOY_KEY }}
          path: .registry/data/index

      - name: Configure git
        run: |
          git -C .registry/data/index config user.name "github-actions[bot]"
          git -C .registry/data/index config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Initialize registry
        uses: moonrockz/moonbit-registry-tools@main
        with:
          command: init
          registry-dir: .registry
          registry-name: my-mirror

      - name: Add mooncakes source
        uses: moonrockz/moonbit-registry-tools@main
        with:
          command: source-add
          registry-dir: .registry
          source-name: mooncakes
          source-preset: mooncakes

      - name: Mirror all packages
        uses: moonrockz/moonbit-registry-tools@main
        with:
          command: mirror
          registry-dir: .registry
          full: 'true'
          verbose: 'true'

      - name: Push index
        run: git -C .registry/data/index push origin HEAD:main
```

Clients then use the `config.json` from [Index Without a Server](#index-without-a-server),
with `index` set to the URL of your index repository.

### Publishing Packages (Coming Soon)

> **Note:** Publishing packages to a private registry is not yet supported. Currently, this tool only supports mirroring (pulling) packages from upstream registries.
>
> Planned features:
> - `moonbit-registry publish` command for uploading packages
> - API endpoint for package uploads
> - Authentication for publish operations
>
> For now, to share internal packages, you can manually add them to the registry's `data/packages/` directory and update the index.

## Development

### Project Structure

```
src/
├── index.ts           # CLI entry point
├── cli/               # Command implementations
├── core/              # Registry, index, and package management
├── server/            # HTTP server and routes
├── config/            # Configuration loading
└── utils/             # Utilities (git, fs, crypto, logging)
```

### Running Tests

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch
```

### Mise Tasks

If you have [mise](https://mise.jdx.dev) installed:

```bash
mise run build     # Build the CLI
mise run test      # Run tests
mise run test:e2e  # Run E2E tests (requires moon CLI)
mise run dev       # Development mode
mise run lint      # Lint code
mise run fmt       # Format code
mise run clean     # Clean artifacts
```

## Agentic Tooling

This repository leverages the [AGENTS.md spec](https://github.com/anthropics/agents-spec/blob/main/AGENTS.md) and the [Agent Skills spec](https://github.com/anthropics/agents-spec/blob/main/SKILLS.md) for AI-assisted development.

See [AGENTS.md](AGENTS.md) for repository conventions, task patterns, and guidance for AI agents working with this codebase.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
