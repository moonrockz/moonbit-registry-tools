---
layout: default
title: Home
nav_order: 1
description: "MoonBit Registry Tools - A CLI for managing MoonBit package registries"
permalink: /
---

# MoonBit Registry Tools

A CLI tool for managing MoonBit registries, including local registry setup, mirroring from mooncakes.io, and serving as a registry server.
{: .fs-6 .fw-300 }

[Get Started]({{ site.baseurl }}/getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/moonrockz/moonbit-registry-tools){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## Overview

The MoonBit registry ([mooncakes.io](https://mooncakes.io)) is the official package registry for the MoonBit programming language. This tool helps you:

- **Set up a local/private registry** for your organization
- **Mirror packages** from mooncakes.io for offline access or faster builds
- **Mirror from multiple sources** including private registries
- **Serve packages** to your development team
- **Sync your registry** with remote git repositories

## Key Features

### Multi-Source Mirroring

Mirror packages from multiple upstream registries with priority-based fallback. Configure mooncakes.io as your primary source and add private registries for internal packages.

### Offline Development

Pre-populate a registry with all packages your team needs, then transfer it to air-gapped environments. Perfect for secure or disconnected development scenarios.

### CI/CD Integration

Speed up your continuous integration builds by caching packages locally. The registry server integrates seamlessly with GitHub Actions, GitLab CI, and other CI systems.

### Authentication Support

Connect to private registries using bearer tokens or basic authentication. Credentials can be stored securely using environment variables.

## Quick Example

```bash
# Initialize a local registry
moonbit-registry init ./my-registry
cd my-registry

# Mirror packages from mooncakes.io
moonbit-registry mirror "moonbitlang/*"

# Start the server
moonbit-registry serve --port 8080

# Configure moon to use your local registry
export MOONCAKES_REGISTRY=http://localhost:8080
moon build
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Development Team                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              moonbit-registry serve (localhost:8080)         │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │   Git Index     │  │  Package Cache  │                   │
│  │  (data/index/)  │  │ (data/packages/)│                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
      │ mooncakes.io│  │  Partner    │  │  Private    │
      │  (primary)  │  │  Registry   │  │  Registry   │
      └─────────────┘  └─────────────┘  └─────────────┘
```

## Next Steps

- [Installation]({{ site.baseurl }}/installation) - Install the CLI tool
- [Getting Started]({{ site.baseurl }}/getting-started) - Set up your first registry
- [Recipes]({{ site.baseurl }}/recipes) - Common use cases and examples
