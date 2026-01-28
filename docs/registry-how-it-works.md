---
layout: default
title: How the Registry Works
parent: KB
nav_order: 1
---

# How the Registry Works

This page explains the core components of a MoonBit registry and how the `moonbit-registry` tooling ties them together.
{: .fs-6 .fw-300 }

---

## High‑level flow

```
moonbit-registry mirror    moonbit-registry serve       moon / moon update
┌──────────────────────┐   ┌──────────────────────┐     ┌──────────────────┐
│ Fetch index + packages│ → │ Serve index + packages│ ←  │ Clients consume  │
└──────────────────────┘   └──────────────────────┘     └──────────────────┘
```

1. **Mirror** pulls package metadata (index) and package archives from upstream registries.
2. **Store** saves data locally in the registry directory.
3. **Serve** exposes the local index and cached packages over HTTP.
4. **Clients** point MoonBit to the local registry and use it like the public registry.

---

## Registry layout

When you initialize a registry, the tool creates a predictable layout:

```
registry/
├── registry.toml
└── data/
    ├── index/         # Git repository for package metadata
    └── packages/      # Cached package archives
```

- **`registry.toml`**: configuration for sources, server settings, and defaults.
- **`data/index/`**: a Git repository that mirrors package metadata.
- **`data/packages/`**: cached package archives used by the server.

---

## Mirroring and sync

The `mirror` command is responsible for keeping your local registry current.

Typical steps:
- Resolve patterns like `moonbitlang/*`.
- Fetch/refresh the **index** for the source.
- Download package archives (and by default, dependencies).

{: .note }
By default, the mirror command includes dependencies. Use `--strict` if you want only the exact patterns you specify.

---

## Serving packages

The `serve` command starts an HTTP server that exposes:

- **Index data** (so clients can resolve package metadata)
- **Package archives** (so clients can download packages)

This allows `moon` to consume your local registry just like the official one.

---

## Client configuration

Point MoonBit at your local registry by setting `MOONCAKES_REGISTRY` or using the `update` command:

```bash
# Update using current registry config
moonbit-registry update

# Or set explicitly
export MOONCAKES_REGISTRY=http://localhost:8080
moon update
```

---

## Why a local registry?

- **Faster builds**: packages come from your LAN or local disk cache.
- **Offline support**: mirror once, build without internet access.
- **Reliability**: less dependence on external services.
- **Control**: integrate internal/private packages with public ones.

---

## Next steps

- [Getting Started]({{ site.baseurl }}/getting-started)
- [CI/CD Cache]({{ site.baseurl }}/recipes/ci-cd-cache)
- [Multiple Sources]({{ site.baseurl }}/recipes/multiple-sources)
