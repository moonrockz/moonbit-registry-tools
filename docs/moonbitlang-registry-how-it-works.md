---
layout: default
title: MoonBit Registry Internals
parent: KB
nav_order: 2
---

# MoonBit Registry Internals

This page describes **how the official MoonBit registry works conceptually** (the pieces that `moon` and mooncakes.io rely on), and how that maps to the theory behind `moonbit-registry`.
{: .fs-6 .fw-300 }

---

## Big picture

MoonBit’s ecosystem is centered on a **package index** and **package archives**:

1. **Index**: metadata about packages, versions, and dependencies.
2. **Archives**: the actual package contents that `moon` downloads.
3. **Clients (`moon`)**: resolve dependencies via the index, then fetch archives.
4. **Registry server (mooncakes.io)**: hosts index + archives for public access.

`moon` doesn’t need “magic” access to mooncakes.io; it needs a registry endpoint that provides the same **index structure** and **package archive URLs**.

---

## How packages are stored and organized (conceptual)

At a high level, the official registry is organized like this:

- **Package metadata (index)**
  - Namespaced by organization/user (e.g., `moonbitlang/core`).
  - Contains versions, dependency graphs, and metadata (description, license, etc.).
  - Stored in a **Git repository**, so it can be versioned, cloned, and diffed.

- **Package archives**
  - Stored as versioned tarballs/archives.
  - Serve as immutable artifacts for a given package version.

This split (index vs archives) is the key to efficient sync and caching.

---

## Publishing and updates (conceptual)

When a package is published:

1. A new **archive** is created for the version.
2. The **index** is updated with the new version metadata and dependency info.
3. Clients pull the updated index, then fetch the new archive if needed.

This means **index updates are fast** (small Git changes) while **archives are immutable** once published.

---

## How `moon` uses the registry

When you run `moon update` or build with dependencies:

1. **Index sync**  
   `moon` pulls the package index (git-based), so it can resolve versions and deps.

2. **Dependency resolution**  
   `moon` computes a dependency graph from the index metadata.

3. **Archive fetch**  
   `moon` downloads the exact archives for the resolved versions.

This is why a local registry can fully replace mooncakes.io: if it exposes the same index and archive layout, `moon` can use it transparently.

---

## How mooncakes.io fits in

**mooncakes.io** is the public registry service that:

- Hosts the **official index** for public packages.
- Hosts **package archives** for those versions.
- Provides the canonical upstream used by default in `moon`.

---

## Theory: why `moonbit-registry` works

`moonbit-registry` is designed to be **registry‑compatible** rather than custom:

- **Index compatibility** means `moon` can resolve dependencies without changes.
- **Archive compatibility** means `moon` can download artifacts from your server.
- **Git‑based index** makes mirroring and syncing reliable and incremental.

In other words, `moonbit-registry` doesn’t invent a new protocol; it **mirrors the public registry’s shape** so the client behaves the same way.

---

## Sync and caching model

`moonbit-registry` treats registries as **sources**:

- Each source has an **index URL** and an **archive base URL**.
- The tool **syncs index changes** and **pulls archives on demand** (or ahead of time).
- Multiple sources can be ordered for fallback or internal‑first resolution.

This gives you:

- **Deterministic builds** (pin by version, sync index, fetch exact archive).
- **Offline/air‑gapped** workflows (mirror once, build many times).
- **Faster CI** (local network + cached artifacts).

---

## Relationship to your local registry

The local registry you run is a **drop‑in replacement** for mooncakes.io for your team:

- Same client behavior (`moon update`, `moon build`).
- Same index + archive split.
- Additional control over sync timing, caching, and sources.

See also:

- [How the Registry Works (local)]({{ site.baseurl }}/registry-how-it-works)
- [CI/CD Cache]({{ site.baseurl }}/recipes/ci-cd-cache)
