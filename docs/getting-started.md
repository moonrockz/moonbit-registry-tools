---
layout: default
title: Getting Started
nav_order: 3
---

# Getting Started

This guide will walk you through setting up your first local MoonBit registry.
{: .fs-6 .fw-300 }

---

## Step 1: Initialize a Registry

Create a new directory for your registry and initialize it:

```bash
moonbit-registry init ./my-registry
cd my-registry
```

This creates the following structure:

```
my-registry/
├── registry.toml      # Configuration file
└── data/
    ├── index/         # Git repository for package index
    └── packages/      # Cached package files
```

## Step 2: Mirror Packages

Mirror the packages your team needs from mooncakes.io:

```bash
# Mirror specific packages
moonbit-registry mirror "moonbitlang/core" "moonbitlang/x"

# Or mirror all packages from an organization
moonbit-registry mirror "moonbitlang/*"

# Mirror with dependencies (default behavior)
moonbit-registry mirror "some/package"
```

{: .note }
By default, the mirror command automatically includes transitive dependencies. Use `--strict` to mirror only the exact patterns specified.

## Step 3: Start the Server

Start the registry server to serve packages:

```bash
moonbit-registry serve --port 8080
```

You should see output like:

```
[INFO] Starting registry server...
[INFO] Listening on http://0.0.0.0:8080
```

## Step 4: Configure MoonBit

In a new terminal, update moon's package index to use your local registry:

```bash
# From your registry directory
moonbit-registry update

# Or specify the registry URL explicitly
moonbit-registry update --registry http://localhost:8080
```

This runs `moon update` with your private registry configured.

{: .tip }
To switch back to the official mooncakes.io registry:
```bash
moonbit-registry update --mooncakes
```

{: .note }
For permanent configuration, set the environment variable in your shell profile:
```bash
export MOONCAKES_REGISTRY=http://localhost:8080
```

## Step 5: Use Your Registry

Now you can use moon commands as usual, and they'll fetch packages from your local registry:

```bash
# Create a new project
moon new my-project
cd my-project

# Add a dependency
moon add moonbitlang/x

# Build the project
moon build
```

---

## Configuration

The `registry.toml` file controls your registry's behavior. Here are the key settings:

```toml
[registry]
name = "my-company-registry"
data_dir = "./data"

[server]
host = "0.0.0.0"
port = 8080
base_url = "http://localhost:8080"

[mirror]
auto_sync = false
sync_interval = "1h"
packages = []  # Default patterns to mirror
```

### View and Modify Configuration

```bash
# View all configuration
moonbit-registry config

# View a specific value
moonbit-registry config server.port

# Set a value
moonbit-registry config server.port 9000
```

---

## Adding Multiple Sources

You can configure multiple upstream sources for mirroring:

```bash
# Add mooncakes.io (using preset)
moonbit-registry source add mooncakes --from-preset mooncakes

# Add a custom registry
moonbit-registry source add partner \
  --url https://partner.example.com/registry \
  --index-url https://partner.example.com/registry/git/index

# List all sources
moonbit-registry source list

# Mirror from a specific source
moonbit-registry mirror -s partner "partner-org/*"
```

---

## Next Steps

- Explore [Recipes]({{ site.baseurl }}/recipes) for common use cases
- Learn about [CI/CD Integration]({{ site.baseurl }}/recipes/ci-cd-cache)
- Set up [Multiple Sources]({{ site.baseurl }}/recipes/multiple-sources)
