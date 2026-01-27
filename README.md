# moonbit-registry-tools

A CLI tool for managing MoonBit registries, including local registry setup, mirroring from mooncakes.io, and serving as a registry server.

## Overview

The MoonBit registry (mooncakes.io) is the official package registry for the MoonBit programming language. This tool helps you:

- Set up a local/private registry for your organization
- Mirror packages from mooncakes.io for offline access or faster builds
- Serve packages to your development team
- Sync your local registry with remote git repositories

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or later)
- Git

### From Source

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

### Configure MoonBit to Use Local Registry

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

[upstream]
enabled = true
url = "https://mooncakes.io"
index_url = "https://mooncakes.io/git/index"

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

## API Endpoints

When running `moonbit-registry serve`, the following endpoints are available:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Registry info and available endpoints |
| `GET /health` | Health check |
| `GET /git/index` | Git index (dumb HTTP protocol) |
| `GET /user/{username}/{package}/{version}.zip` | Download package |
| `GET /user/{username}/{package}` | Package metadata (JSON) |

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
mise run build    # Build the CLI
mise run test     # Run tests
mise run dev      # Development mode
mise run lint     # Lint code
mise run fmt      # Format code
mise run clean    # Clean artifacts
```

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
