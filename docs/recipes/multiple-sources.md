---
layout: default
title: Multiple Sources
parent: Recipes
nav_order: 3
---

# Multiple Sources

Mirror packages from multiple upstream registries.
{: .fs-6 .fw-300 }

---

## Use Case

Your organization needs to:

- Mirror from the official mooncakes.io registry
- Also mirror from a partner's private registry
- Aggregate packages from multiple sources into one local registry

## Solution

Configure multiple sources with different priorities for fallback.

### Step 1: Initialize Registry

```bash
moonbit-registry init ./multi-source-registry
cd multi-source-registry
```

### Step 2: Add Sources

```bash
# Add mooncakes.io as the primary source (using preset)
moonbit-registry source add mooncakes --from-preset mooncakes

# Add a partner's registry
moonbit-registry source add partner \
  --url https://partner.example.com/registry \
  --index-url https://partner.example.com/registry/git/index \
  --priority 50

# Add another internal registry
moonbit-registry source add internal \
  --url https://internal.company.com/moonbit \
  --index-url https://internal.company.com/moonbit/git/index \
  --priority 25
```

### Step 3: Verify Configuration

```bash
moonbit-registry source list
```

Output:
```
Configured sources:

  mooncakes (default) [enabled]
    Type: mooncakes
    URL: https://mooncakes.io
    Index: https://mooncakes.io/git/index (git)
    Priority: 100

  partner [enabled]
    Type: custom
    URL: https://partner.example.com/registry
    Index: https://partner.example.com/registry/git/index (git)
    Priority: 50

  internal [enabled]
    Type: custom
    URL: https://internal.company.com/moonbit
    Index: https://internal.company.com/moonbit/git/index (git)
    Priority: 25
```

### Step 4: Mirror from Specific Sources

```bash
# Mirror from the default source (mooncakes)
moonbit-registry mirror "moonbitlang/*"

# Mirror from a specific source
moonbit-registry mirror -s partner "partner-org/*"
moonbit-registry mirror -s internal "company/*"
```

---

## Configuration File

You can also configure sources directly in `registry.toml`:

```toml
[[sources]]
name = "mooncakes"
type = "mooncakes"
url = "https://mooncakes.io"
index_url = "https://mooncakes.io/git/index"
index_type = "git"
enabled = true
priority = 100

[[sources]]
name = "partner"
type = "moonbit-registry"
url = "https://partner.example.com/registry"
index_url = "https://partner.example.com/registry/git/index"
index_type = "git"
enabled = true
priority = 50

[[sources]]
name = "internal"
type = "custom"
url = "https://internal.company.com/moonbit"
index_url = "https://internal.company.com/moonbit/git/index"
index_type = "git"
enabled = true
priority = 25

default_source = "mooncakes"
```

---

## Priority and Fallback

Sources are tried in priority order (lower number = higher priority) when:

1. A package is requested but not cached
2. The server's upstream fallback is enabled

For mirroring, you must explicitly specify the source with `-s` unless using the default.

---

## Managing Sources

```bash
# Change the default source
moonbit-registry source default internal

# Temporarily disable a source
moonbit-registry source disable partner

# Re-enable a source
moonbit-registry source enable partner

# Remove a source entirely
moonbit-registry source remove partner
```
