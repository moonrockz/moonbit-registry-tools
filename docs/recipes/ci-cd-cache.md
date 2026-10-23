---
layout: default
title: CI/CD Cache
parent: Recipes
nav_order: 2
---

# CI/CD Cache

Speed up your CI/CD builds by caching MoonBit packages locally.
{: .fs-6 .fw-300 }

---

## Use Case

Your CI builds are slow because they download packages from mooncakes.io on every run. You want to cache packages to:

- Reduce build times
- Decrease network bandwidth usage
- Improve reliability (less dependent on external services)

## GitHub Actions

### Basic Setup

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup MoonBit
        run: |
          curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
          echo "$HOME/.moon/bin" >> $GITHUB_PATH

      - name: Cache MoonBit packages
        uses: actions/cache@v4
        with:
          path: .moonbit-registry
          key: moonbit-packages-{% raw %}{{ hashFiles('moon.mod') }}{% endraw %}
          restore-keys: |
            moonbit-packages-

      - name: Setup local registry
        run: |
          # The cache holds the registry, not the binary, so always download it
          curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz
          tar -xzf moonbit-registry-linux-x64.tar.gz

          if [ ! -f .moonbit-registry/registry.toml ]; then
            ./moonbit-registry init .moonbit-registry
            ./moonbit-registry source add mooncakes --from-preset mooncakes -d .moonbit-registry
          fi

          # The served index holds only mirrored packages.
          # Mirror the packages that your project uses (with their dependencies).
          ./moonbit-registry mirror -d .moonbit-registry "moonbitlang/core"

          # Start the server in the background
          ./moonbit-registry serve -d .moonbit-registry &
          sleep 2

      - name: Build
        env:
          MOONCAKES_REGISTRY: http://localhost:8080
        run: moon build

      - name: Test
        env:
          MOONCAKES_REGISTRY: http://localhost:8080
        run: moon test
```

### With Pre-populated Cache

For even faster builds, mirror the packages only when the cache is empty:

```yaml
      - name: Setup local registry
        run: |
          if [ ! -f .moonbit-registry/registry.toml ]; then
            ./moonbit-registry init .moonbit-registry
            ./moonbit-registry source add mooncakes --from-preset mooncakes -d .moonbit-registry
            # Pre-mirror common packages
            ./moonbit-registry mirror -d .moonbit-registry "moonbitlang/*"
          fi
          ./moonbit-registry serve -d .moonbit-registry &
          sleep 2
```

---

## GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - build
  - test

variables:
  MOONCAKES_REGISTRY: http://localhost:8080

cache:
  key:
    files:
      - moon.mod
  paths:
    - .moonbit-registry/

.registry-setup: &registry-setup
  - curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
  - export PATH="$HOME/.moon/bin:$PATH"
  # The cache holds the registry, not the binary, so always download it
  - curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz
  - tar -xzf moonbit-registry-linux-x64.tar.gz
  - |
    if [ ! -f .moonbit-registry/registry.toml ]; then
      ./moonbit-registry init .moonbit-registry
      ./moonbit-registry source add mooncakes --from-preset mooncakes -d .moonbit-registry
    fi
  - ./moonbit-registry mirror -d .moonbit-registry "moonbitlang/core"
  - ./moonbit-registry serve -d .moonbit-registry &
  - sleep 2

build:
  stage: build
  before_script: *registry-setup
  script:
    - moon build

test:
  stage: test
  before_script: *registry-setup
  script:
    - moon test
```

---

## Self-Hosted Registry

For organizations with many CI jobs, consider running a persistent registry server.
The server must serve the index with Git Smart HTTP (the default for `moonbit-registry serve`):

1. Deploy the registry on a dedicated server
2. Pre-populate with all packages your projects need
3. Configure all CI jobs to use it

```yaml
# All CI jobs just need this environment variable
env:
  MOONCAKES_REGISTRY: http://registry.internal.company.com:8080
```

This eliminates the need for per-job caching and ensures consistent package availability.

If your index is in a git repository on GitHub (see the `mirror-registry.yml` template), write
`$MOON_HOME/config.json` in the job instead. When that file exists, moon ignores `MOONCAKES_REGISTRY`.

```yaml
      - name: Configure moon
        run: |
          mkdir -p ~/.moon
          cat > ~/.moon/config.json << 'EOF'
          {
            "api": "https://mooncakes.io",
            "index": "https://github.com/my-org/mooncakes-index.git",
            "download": "https://download.mooncakes.io"
          }
          EOF
```

---

## Tips

{: .tip }
**Cache Key Strategy**: Use the `moon.mod` hash as part of the cache key to invalidate when dependencies change. Current moon does not accept `moon.mod.json`.

{: .warning }
**Cache Size**: The `--full` mirror can be large. Consider mirroring only packages you actually use.
