# MoonBit Registry Tools - Implementation Plan

## Overview

Create a TypeScript CLI tool named `moonbit-registry` using Bun that helps users manage MoonBit registries, including local registry setup, mirroring from mooncakes.io, and serving as a registry server.

## Key Design Decisions

1. **CLI Name**: `moonbit-registry` - full descriptive name matching the repo
2. **Git Protocol**: Dumb HTTP for initial implementation (static file serving)
3. **Mirroring**: Glob patterns with smart dependency resolution
   - Automatically includes transitive dependencies
   - `--strict` flag for exact pattern matching only
   - Warnings for skipped dependencies (unless `--quiet` or already cached)

## Project Structure

```
moonbit-registry-tools/
├── docs/
│   └── prds/
│       └── smart-http-protocol.md  # PRD for future Smart HTTP support
├── .mise/
│   └── tasks/
│       ├── build              # Build the CLI
│       ├── test               # Run tests
│       ├── lint               # Run linter
│       ├── fmt                # Format code
│       ├── dev                # Development mode
│       └── clean              # Clean build artifacts
├── src/
│   ├── index.ts               # CLI entry point
│   ├── cli/
│   │   ├── index.ts           # Commander setup
│   │   ├── commands/
│   │   │   ├── init.ts        # Initialize local registry
│   │   │   ├── mirror.ts      # Mirror from upstream
│   │   │   ├── serve.ts       # Start registry server
│   │   │   ├── config.ts      # Manage configuration
│   │   │   └── sync.ts        # Sync with remote git
│   │   └── utils.ts           # CLI utilities
│   ├── core/
│   │   ├── registry.ts            # Registry abstraction
│   │   ├── index-manager.ts       # Git index management
│   │   ├── package-store.ts       # Package storage/caching
│   │   ├── dependency-resolver.ts # Glob matching + transitive deps
│   │   └── types.ts               # Core type definitions
│   ├── server/
│   │   ├── index.ts           # Server entry
│   │   ├── routes/
│   │   │   ├── git.ts         # Git index endpoints
│   │   │   └── packages.ts    # Package download endpoints
│   │   └── middleware.ts      # Server middleware
│   ├── config/
│   │   ├── loader.ts          # TOML config loader
│   │   ├── schema.ts          # Config schema/validation
│   │   └── defaults.ts        # Default configuration
│   └── utils/
│       ├── git.ts             # Git operations
│       ├── fs.ts              # File system helpers
│       ├── crypto.ts          # SHA256 checksums
│       └── logger.ts          # Logging utility
├── tests/
│   ├── core/
│   │   ├── registry.test.ts
│   │   ├── index-manager.test.ts
│   │   └── package-store.test.ts
│   ├── server/
│   │   └── routes.test.ts
│   └── cli/
│       └── commands.test.ts
├── mise.toml                   # Mise configuration
├── bunfig.toml                 # Bun configuration
├── tsconfig.json               # TypeScript config
├── biome.json                  # Biome linter/formatter config
├── package.json                # Dependencies
├── registry.example.toml       # Example configuration
└── README.md                   # Updated documentation
```

## CLI Commands

### `moonbit-registry init [path]`
Initialize a new local registry at the specified path.
- Creates directory structure (index/, packages/)
- Initializes git repo for index
- Creates default config file

### `moonbit-registry mirror [patterns...]`
Mirror packages from upstream registry with smart dependency resolution.
- Supports glob patterns: `moonbitlang/*`, `company/pkg-*`
- `--full`: Mirror entire registry
- `--strict`: Only mirror exact pattern matches (no dependency resolution)
- `--quiet`: Suppress warnings about skipped dependencies
- Automatically resolves and includes transitive dependencies
- Logs warnings for dependencies not included (unless already cached)

### `moonbit-registry serve [--port <port>]`
Start a local registry server (Dumb HTTP).
- Serves git index via static file serving
- Serves package downloads at `/user/{username}/{package}/{version}.zip`
- Configurable port (default: 8080)

### `moonbit-registry sync [--push|--pull]`
Sync local registry with remote git repository.
- `--push`: Push local index to remote
- `--pull`: Pull updates from remote

### `moonbit-registry config [key] [value]`
View or modify configuration.

## Configuration File (registry.toml)

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
packages = []  # Empty = all packages

[server]
host = "0.0.0.0"
port = 8080
base_url = "http://localhost:8080"

[git]
remote_url = ""  # Optional: push index to remote
branch = "main"
auto_push = false
```

## Core Components

### 1. IndexManager (`src/core/index-manager.ts`)
- Clone/pull upstream index
- Parse JSONL index files
- Write index entries
- Git operations (commit, push)

### 2. PackageStore (`src/core/package-store.ts`)
- Download packages from upstream
- Store packages locally
- Verify SHA256 checksums
- Serve package files

### 3. DependencyResolver (`src/core/dependency-resolver.ts`)
- Parse package dependencies from index
- Build dependency graph
- Resolve transitive dependencies for mirroring
- Track which dependencies are missing/skipped

### 4. Registry (`src/core/registry.ts`)
- High-level registry operations
- Coordinate index and package store
- Handle mirroring logic with dependency resolution

### 5. Server (`src/server/`)
- Bun.serve() based HTTP server
- `/git/index` - Git smart HTTP protocol (or dumb HTTP)
- `/user/{username}/{package}/{version}.zip` - Package downloads

## Mise Tasks

### `.mise/tasks/build`
```bash
#!/usr/bin/env bash
#MISE description="Build the CLI binary"
#MISE sources=["src/**/*.ts", "package.json"]
#MISE outputs=["dist/moonbit-registry"]

bun build src/index.ts --compile --outfile dist/moonbit-registry
```

### `.mise/tasks/test`
```bash
#!/usr/bin/env bash
#MISE description="Run tests"
#USAGE flag "-w --watch" help="Watch mode"
#USAGE flag "--coverage" help="Generate coverage report"

args=""
[ "${usage_watch:-false}" = "true" ] && args="$args --watch"
[ "${usage_coverage:-false}" = "true" ] && args="$args --coverage"
bun test $args
```

### `.mise/tasks/dev`
```bash
#!/usr/bin/env bash
#MISE description="Run in development mode with watch"

bun --watch src/index.ts -- "$@"
```

### `.mise/tasks/lint`
```bash
#!/usr/bin/env bash
#MISE description="Lint code"
#USAGE flag "--fix" help="Auto-fix issues"

args="check"
[ "${usage_fix:-false}" = "true" ] && args="$args --write"
bun x biome $args .
```

### `.mise/tasks/fmt`
```bash
#!/usr/bin/env bash
#MISE description="Format code"

bun x biome format --write .
```

### `.mise/tasks/clean`
```bash
#!/usr/bin/env bash
#MISE description="Clean build artifacts"

rm -rf dist/ node_modules/.cache/
```

## Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "toml": "^3.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

## Implementation Order

1. **Phase 1: Project Setup**
   - Initialize Bun project
   - Set up mise.toml and file-based tasks
   - Configure TypeScript, Biome
   - Update .gitignore for TypeScript/Bun
   - Create PRD for Smart HTTP protocol

2. **Phase 2: Core Infrastructure**
   - Config loader (TOML parsing)
   - Logger utility
   - Git utilities
   - Type definitions

3. **Phase 3: Registry Core**
   - IndexManager implementation
   - PackageStore implementation
   - DependencyResolver (glob matching + transitive deps)
   - Registry abstraction

4. **Phase 4: CLI Commands**
   - Commander setup
   - `init` command
   - `mirror` command (with glob/strict/quiet flags)
   - `config` command
   - `sync` command

5. **Phase 5: Server**
   - HTTP server with Bun.serve()
   - Dumb HTTP git index serving (static files)
   - Package download endpoints
   - `serve` command

6. **Phase 6: Testing**
   - Unit tests for core modules
   - Integration tests for CLI
   - Server endpoint tests

## Verification

1. **Build verification**: `mise run build` produces executable
2. **Test verification**: `mise run test` passes all tests
3. **Manual testing**:
   ```bash
   # Initialize local registry
   ./dist/moonbit-registry init ./my-registry

   # Mirror packages with glob pattern (includes dependencies)
   ./dist/moonbit-registry mirror "moonbitlang/*"

   # Mirror with strict mode (exact matches only)
   ./dist/moonbit-registry mirror --strict "moonbitlang/core"

   # Start server
   ./dist/moonbit-registry serve --port 8080

   # In another terminal, configure moon to use local registry
   export MOONCAKES_REGISTRY=http://localhost:8080
   moon new test-project
   cd test-project
   moon build  # Should use local registry
   ```

## Files to Create/Modify

| File | Action |
|------|--------|
| `mise.toml` | Create |
| `.mise/tasks/*` | Create (6 task files) |
| `docs/prds/smart-http-protocol.md` | Create (PRD for future feature) |
| `package.json` | Create |
| `tsconfig.json` | Create |
| `biome.json` | Create |
| `bunfig.toml` | Create |
| `src/index.ts` | Create - CLI entry point |
| `src/cli/index.ts` | Create - Commander setup |
| `src/cli/commands/*.ts` | Create (5 command files) |
| `src/core/types.ts` | Create - Type definitions |
| `src/core/registry.ts` | Create - Registry abstraction |
| `src/core/index-manager.ts` | Create - Git index management |
| `src/core/package-store.ts` | Create - Package storage |
| `src/core/dependency-resolver.ts` | Create - Dep resolution + glob |
| `src/server/index.ts` | Create - Bun HTTP server |
| `src/server/routes/*.ts` | Create (2 route files) |
| `src/config/loader.ts` | Create - TOML config |
| `src/config/schema.ts` | Create - Validation |
| `src/utils/*.ts` | Create (4 utility files) |
| `tests/**/*.test.ts` | Create (~6 test files) |
| `.gitignore` | Update for TS/Bun |
| `README.md` | Update with usage docs |
| `registry.example.toml` | Create |

## PRD: Smart HTTP Protocol (docs/prds/smart-http-protocol.md)

The PRD will cover:
- **Problem**: Dumb HTTP requires full clone of index repo on updates
- **Solution**: Implement Git Smart HTTP protocol for efficient incremental updates
- **Benefits**:
  - Supports `git push` for publishing packages
  - Efficient delta transfers for large indexes
  - Native authentication support
- **Technical approach**: Implement git-http-backend compatible endpoints
- **Timeline**: Future enhancement after v1.0 release
