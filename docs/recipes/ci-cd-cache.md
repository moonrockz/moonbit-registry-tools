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

## GitHub Actions With a Caching Proxy

In proxy mode, the local registry serves the full mooncakes.io index, so you do not have to
know which packages to mirror. The proxy downloads each zip on the first run, and
`actions/cache` keeps the zips and the index for the next runs. When mooncakes.io is not
available, the proxy serves the cached index and zips, and the build continues.

{: .note }
Proxy mode needs moonbit-registry-tools v0.4.0 or later.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup MoonBit
        run: |
          curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
          echo "$HOME/.moon/bin" >> "$GITHUB_PATH"

      - name: Install moonbit-registry
        run: |
          curl -fsSL https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz \
            | tar -xz -C "$RUNNER_TEMP"
          echo "$RUNNER_TEMP" >> "$GITHUB_PATH"

      - name: Restore the proxy cache
        uses: actions/cache@v4
        with:
          path: ~/moonbit-proxy
          key: moonbit-proxy-{% raw %}${{ hashFiles('**/moon.mod.json', '**/moon.mod') }}{% endraw %}
          restore-keys: moonbit-proxy-

      - name: Start the proxy
        run: |
          if [ ! -f ~/moonbit-proxy/registry.toml ]; then
            moonbit-registry init ~/moonbit-proxy
          fi
          cd ~/moonbit-proxy
          moonbit-registry config proxy.enabled true
          moonbit-registry config server.host 127.0.0.1
          nohup moonbit-registry serve > ~/moonbit-proxy.log 2>&1 &
          echo $! > ~/moonbit-proxy.pid
          # /git/index answers 503 until the proxy has an index
          for _ in $(seq 1 120); do
            curl -fsS -o /dev/null "http://127.0.0.1:8080/git/index/info/refs?service=git-upload-pack" && break
            sleep 1
          done
          curl -fsS -o /dev/null "http://127.0.0.1:8080/git/index/info/refs?service=git-upload-pack"

      - name: Point moon at the proxy
        run: |
          cat > ~/.moon/config.json <<'EOF'
          {
            "api": "https://mooncakes.io",
            "index": "http://127.0.0.1:8080/git/index",
            "download": "http://127.0.0.1:8080"
          }
          EOF

      - run: moon update
      - run: moon build
      - run: moon test

      - name: Stop the proxy
        if: always()
        run: |
          kill "$(cat ~/moonbit-proxy.pid)" || true
          cat ~/moonbit-proxy.log
```

- The first run clones the index (about 20 MB) and downloads the zips. The cache is then
  about 60 MB for a small project, most of it the index.
- `actions/cache` saves a new cache only when the key changes. The key here changes when a
  `moon.mod.json` or `moon.mod` changes, which is when new zips are likely.
- When the cache has the index, the proxy serves it at once and refreshes it in the
  background. When the refresh fails, the log shows
  `Proxy index refresh failed, serving the last index`, and the build continues with the
  cached files.
- The proxy log is in the output of the `Stop the proxy` step. It shows each download
  (`Proxy miss: ...`) and each file from the cache.

For CI runners in your own network, use one [Team Proxy]({{ site.baseurl }}/recipes/proxy-team)
for all runners instead of a proxy in each job.

## GitHub Actions With a Mirror

A mirror serves only the packages that you mirror. Use it when you want to control which
packages the build can use.

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
          key: moonbit-packages-{% raw %}${{ hashFiles('moon.mod') }}{% endraw %}
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
