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
          key: moonbit-packages-{% raw %}{{ hashFiles('moon.mod.json') }}{% endraw %}
          restore-keys: |
            moonbit-packages-

      - name: Setup local registry
        run: |
          # Download moonbit-registry if not cached
          if [ ! -f .moonbit-registry/registry.toml ]; then
            curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz
            tar -xzf moonbit-registry-linux-x64.tar.gz
            ./moonbit-registry init .moonbit-registry
          fi

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

For even faster builds, pre-populate the cache with commonly used packages:

```yaml
      - name: Setup local registry
        run: |
          if [ ! -f .moonbit-registry/registry.toml ]; then
            ./moonbit-registry init .moonbit-registry
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
  key: moonbit-packages
  paths:
    - .moonbit-registry/

build:
  stage: build
  before_script:
    - curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
    - export PATH="$HOME/.moon/bin:$PATH"
    - |
      if [ ! -f .moonbit-registry/registry.toml ]; then
        curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz
        tar -xzf moonbit-registry-linux-x64.tar.gz
        ./moonbit-registry init .moonbit-registry
      fi
    - ./moonbit-registry serve -d .moonbit-registry &
    - sleep 2
  script:
    - moon build

test:
  stage: test
  before_script:
    - curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
    - export PATH="$HOME/.moon/bin:$PATH"
    - ./moonbit-registry serve -d .moonbit-registry &
    - sleep 2
  script:
    - moon test
```

---

## Self-Hosted Registry

For organizations with many CI jobs, consider running a persistent registry server:

1. Deploy the registry on a dedicated server
2. Pre-populate with all packages your projects need
3. Configure all CI jobs to use it

```yaml
# All CI jobs just need this environment variable
env:
  MOONCAKES_REGISTRY: http://registry.internal.company.com:8080
```

This eliminates the need for per-job caching and ensures consistent package availability.

---

## Tips

{: .tip }
**Cache Key Strategy**: Use `moon.mod.json` hash as part of the cache key to invalidate when dependencies change.

{: .warning }
**Cache Size**: The `--full` mirror can be large. Consider mirroring only packages you actually use.
