---
layout: default
title: Caching Proxy
parent: Recipes
nav_order: 6
---

# Caching Proxy

Run a registry that has all of mooncakes.io, but downloads files only when a client asks for them.
{: .fs-6 .fw-300 }

---

## Use Case

- A team on one LAN wants one shared download cache for mooncakes.io.
- A laptop must continue to build when the network is not available.
- You do not want to mirror all of mooncakes.io first (about 16 GB of zips).

## How It Works

In proxy mode, `moonbit-registry serve`:

1. Serves a full copy of the index of the default source. It refreshes the copy when it starts
   and then every `index_refresh_interval` (default `10m`). Clients do not wait for a refresh.
   When a refresh fails, the proxy logs a warning and serves the last index.
2. Downloads a zip, a prebuilt wasm file (and its `.sha256`) or `symbols.zip` from upstream on
   the first request, keeps it in the cache, and serves it from the cache after that.
3. Compares each zip with the checksum in the index, and each wasm file with its `.sha256`
   file. When a checksum is different, the proxy keeps nothing and sends `502`.

## Step 1: Create the Proxy

Upstream mooncakes.io:

```bash
moonbit-registry init ~/moonbit-proxy
cd ~/moonbit-proxy
moonbit-registry source add mooncakes --from-preset mooncakes
moonbit-registry source default mooncakes
```

Or the index mirror on GitHub, with downloads from download.mooncakes.io:

```bash
moonbit-registry source add moonrockz --from-preset moonrockz
moonbit-registry source default moonrockz
```

## Step 2: Start It

```bash
moonbit-registry serve --proxy --port 8080
```

The first start clones the upstream index (some tens of MB). Wait for `Proxy index is ready`
before the first `moon update`.

To make proxy mode the default, add this to `registry.toml`:

```toml
[proxy]
enabled = true
index_refresh_interval = "10m"
symbols_max_age = "1d"
```

## Step 3: Configure the Clients

Write `$MOON_HOME/config.json` (default `~/.moon/config.json`). Use the address of the proxy
host on a LAN:

```json
{
  "api": "https://mooncakes.io",
  "index": "http://localhost:8080/git/index",
  "download": "http://localhost:8080"
}
```

Or, when `$MOON_HOME/config.json` does not exist:

```bash
export MOONCAKES_REGISTRY=http://localhost:8080
```

Then use moon as usual:

```bash
moon update
moon add moonbitlang/x
moon build
moonx moonbitlang/parser/cmd/moonfmt@0.3.3 main.mbt
```

## Step 4 (Optional): Fill the Cache Before You Go Offline

```bash
moonbit-registry mirror 'moonbitlang/*' --proxy --prebuild
```

This downloads the zips of the matching packages and of their dependencies, and with
`--prebuild` the prebuilt wasm of their executable packages. It does not change the served
index.

## Offline Behavior

| Request | Upstream available | Upstream not available |
|---------|--------------------|------------------------|
| Index (`moon update`) | Refreshed every interval | Last index |
| Zip or wasm in the cache | From the cache | From the cache |
| Zip or wasm not in the cache | Downloaded, checked, cached | `502` |
| `symbols.zip` | Downloaded again when older than `symbols_max_age` | Last copy |

## Chained Proxies

A proxy can use another proxy as its upstream:

```bash
moonbit-registry source add office -t moonbit-registry \
  -u http://office-proxy:8080 -i http://office-proxy:8080/git/index
moonbit-registry source default office
moonbit-registry serve --proxy --port 8080
```

## Disk Use

| Path below `data_dir` | Content |
|------------------------|---------|
| `index/` | Served index, with the upstream clone in `index/sources/` |
| `packages/` | Cached zips |
| `prebuild/` | Cached prebuilt wasm and `.sha256` files |
| `symbols/` | Cached `symbols.zip` |

To clear the cache, stop the proxy and delete `packages/`, `prebuild/` and `symbols/`.
