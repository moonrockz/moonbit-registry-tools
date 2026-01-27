---
layout: default
title: Recipes
nav_order: 4
has_children: true
---

# Recipes

Practical examples and patterns for common use cases.
{: .fs-6 .fw-300 }

---

## Available Recipes

| Recipe | Description |
|--------|-------------|
| [Offline Development]({{ site.baseurl }}/recipes/offline-development) | Set up a registry for air-gapped environments |
| [CI/CD Cache]({{ site.baseurl }}/recipes/ci-cd-cache) | Speed up builds with a local package cache |
| [Multiple Sources]({{ site.baseurl }}/recipes/multiple-sources) | Mirror from multiple registries |
| [Team Registry]({{ site.baseurl }}/recipes/team-registry) | Share a registry across your team |
| [Authentication]({{ site.baseurl }}/recipes/authentication) | Connect to private registries |

---

## Quick Reference

### Common Commands

```bash
# Initialize
moonbit-registry init [path] [--name <name>]

# Mirror packages
moonbit-registry mirror <patterns...> [--full] [--strict] [-s <source>]

# Serve registry
moonbit-registry serve [--port <port>] [--host <host>]

# Manage sources
moonbit-registry source list
moonbit-registry source add <name> [options]
moonbit-registry source remove <name>
moonbit-registry source default <name>

# Configuration
moonbit-registry config [key] [value]

# Sync with remote
moonbit-registry sync [--push] [--pull]
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MOONCAKES_REGISTRY` | URL of the registry for moon CLI |
| `PARTNER_REGISTRY_TOKEN` | Token for authenticated sources (example) |
