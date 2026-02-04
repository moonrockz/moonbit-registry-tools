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

## Configuration

Configuration is stored in `registry.toml`. See `registry.example.toml` for all available options.

### Key Configuration Options

```toml
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

default_source = "mooncakes"

[mirror]
auto_sync = false
sync_interval = "1h"
packages = []  # Default patterns to mirror

[server]
host = "0.0.0.0"
port = 8080
base_url = "http://localhost:8080"

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
| `GET /git/index` | Git index (dumb HTTP protocol) |
| `GET /user/{username}/{package}/{version}.zip` | Download package |
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
          key: moonbit-packages-${{ hashFiles('moon.mod.json') }}

      - name: Start local registry
        run: |
          moonbit-registry init .moonbit-registry 2>/dev/null || true
          moonbit-registry serve -d .moonbit-registry &
          sleep 2

      - name: Build with local cache
        env:
          MOONCAKES_REGISTRY: http://localhost:8080
        run: moon build
```

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
