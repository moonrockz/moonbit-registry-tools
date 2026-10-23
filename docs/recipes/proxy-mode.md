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

The first start clones the upstream index (some tens of MB). Until the server logs
`Proxy index is ready`, it answers `503` for `/git/index`, so `moon update` fails and does not
keep an empty index. Run `moon update` again after that message. A restart with an index from
an earlier run serves that index at once.

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
| Zip or wasm not in the cache | Downloaded, checked, cached | `502`, or a fallback when it is on |
| `symbols.zip` | Downloaded again when older than `symbols_max_age` | Last copy |

## Fallbacks When Upstream Has No File (Optional)

Two fallbacks can make a file that upstream cannot send. They are off by default.

```toml
[proxy.fallback]
github = true
build_wasm = true
toolchain = "auto"
moonup = "/usr/local/bin/moonup"
```

### Rebuild a Zip From GitHub

When the download of a zip fails (no network, `5xx` or `404`), the proxy:

1. Reads the `repository` of the version from the index. It must be a GitHub repository.
2. Reads the manifest line of the version. Without a manifest line, it stops here.
3. Downloads the tarball of tag `v<version>`, or of tag `<version>` when the first does not
   exist. Set `GITHUB_TOKEN` for a higher GitHub rate limit.
4. Finds the directory whose `moon.mod` or `moon.mod.json` has the name of the module. This
   can be a subdirectory of the repository.
5. Compares the files of the tag with the manifest. Each file of the published zip must be in
   the tag, as a regular file, with the same SHA-256. When one is missing or different, the
   proxy stops here and does not run moon. Other files in the tag are allowed.
6. Runs `moon package` with the toolchain of the publish date.
7. Compares each file of the result with the manifest, puts the entries in the published
   order, and computes the SHA-256 of the result.

### Build a Prebuilt Wasm Locally

When upstream has no prebuilt wasm for an executable package, or cannot be reached, the proxy
gets the zip of the package (from the cache, from upstream, or from a GitHub rebuild), builds
the package with `moon build --target wasm --release` (then `moon-wasm-opt -O --all-features`
when the toolchain has it), and serves the result with a `.sha256` file that it writes. Both
responses have the header `X-Registry-Built-Locally: true`. These files are in
`prebuild-local/`, apart from the upstream files in `prebuild/`.

moonx waits about 30 seconds for a prebuilt file. The first build of a version can take
longer, for example when moonup must install a toolchain first. Then moonx fails, but the
proxy completes the build; run moonx again. To build before you need the files:

```bash
moonbit-registry mirror 'moonbitlang/parser' --proxy --prebuild
```

Upstream builds its prebuilds with a toolchain of its choice, sometimes a nightly. To get the
upstream file byte for byte, set that toolchain, for example `toolchain = "nightly-2026-06-17"`
gives the upstream `moonfmt.wasm` of `moonbitlang/parser@0.3.4`.

### Trust Model

- A rebuilt zip is served **only when it is byte-identical to the published zip**: its SHA-256
  must be the checksum in the index. The manifest gives only the order of the entries and the
  names of the files that are different; it cannot make the proxy serve other bytes. When the
  rebuild is different, the proxy sends `502` and logs the files that are different.
- A locally built wasm is **not** byte-identical to the upstream prebuild. The proxy trusts it
  because it built it from a zip that matches the index checksum, with a known toolchain. A
  client sees that the file is local from the `X-Registry-Built-Locally` header and from the
  proxy log.
- **Builds do not run commands from packages.** moon runs the `pre-build` commands of a
  package and the `scripts.postadd` command of a module, unless `MOON_IGNORE_PREBUILD` and
  `MOON_IGNORE_POSTADD` are set. The proxy sets both for each moon command (`update`,
  `package`, `build`). The proxy logs the hooks that it finds in a module. A package that needs
  the output of its pre-build can then fail to build; that fallback then sends `502`.
- **Builds do not get the secrets of the proxy.** A child process (moon, moonup,
  `moon-wasm-opt`) gets only `PATH`, its own `HOME`, `MOON_HOME` and `MOONUP_HOME`,
  `MOONCAKES_REGISTRY`, the locale and temporary directory variables, the network proxy
  variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `SSL_CERT_FILE`, ...),
  `MOONUP_DIST_SERVER`, and on Windows the system variables that programs need to start.
  `GITHUB_TOKEN` and all other variables stay in the proxy. The proxy itself uses
  `GITHUB_TOKEN` to download tag tarballs.

### Toolchains

Old packages often build only with the toolchain of their time: new moon does not accept
`moon.mod.json`. With `toolchain = "auto"`, the proxy uses the newest toolchain released before
the `created_at` of the version and installs it with
[moonup](https://github.com/chawyehsu/moonup). moonup and its toolchains use a `MOON_HOME` and
a `MOONUP_HOME` below `data_dir/fallback/toolchains/`, so `~/.moon` does not change. Each
toolchain takes about 150 MB.

| `toolchain` | Builds use |
|-------------|------------|
| `auto` (default) | The toolchain of the publish date, installed with moonup |
| `"0.6.34+e16ca94e6"` or `"nightly-2026-06-17"` | That toolchain, installed with moonup |
| `current` | The moon of your `MOON_HOME` (no moonup) |

When moonup is not found, the proxy logs one error and the fallbacks stay off.

The proxy does not run a toolchain that cannot turn off package hooks. moon reads
`MOON_IGNORE_PREBUILD` since 2025-05-29 (`0.1.20250529+8a98c8e02` is the first toolchain with
it). So:

- A toolchain released before 2025-05-29 is refused before moonup installs it. With
  `toolchain = "auto"`, this means that a version published before that date (or soon after
  it) cannot be rebuilt or built: the fallback sends `502` and the log gives the reason. Set a
  newer fixed `toolchain` when a newer toolchain can build these versions.
- After the install, the proxy also checks that the `moon` binary of the toolchain knows both
  variables. With `toolchain = "current"`, it checks the moon of your `MOON_HOME`.

Each moon command runs with a new, empty `MOON_HOME` (moon finds its core library next to its
binary), so builds that run at the same time do not share a registry index or cache. moonup
installs run one at a time. At most two local wasm builds run at the same time. Zip rebuilds
are not limited: a build can ask the proxy for a dependency that needs a rebuild, and a limit
there could make the two wait for each other. Each version is rebuilt only once at a time.

Builds get their dependencies through the proxy (with `MOONCAKES_REGISTRY` and a `config.json`
in the `MOON_HOME` of the command). Some old toolchains, for example `0.10.0`, download dependency zips
from download.mooncakes.io directly, so builds with them need that host.

### Manifests

A manifest line has the entries of a published zip in archive order, with the SHA-256 and
size of each file, plus the checksum of the zip and a `content_digest` that does not depend on
the order. Manifest files are next to the index, at `manifests/user/<owner>/<pkg>.manifest`.
moon reads only `user/<owner>/<pkg>.index`, so it does not see them. The proxy copies them with
the index, so an index mirror that has a `manifests/` directory gives the manifests to all its
proxies. For an index without one, set `manifest_url` to a base URL with the same layout.

To make the manifests of an index, while upstream is available:

```bash
moonbit-registry manifest build --index ./mooncakes-index --packages 'moonbitlang/*'
```

It downloads each zip from the default source, checks it against the index checksum, and adds
the lines that are missing. Run it again to continue after `--limit` or a failure.

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
| `prebuild-local/` | Prebuilt wasm that the proxy built (fallback) |
| `fallback/` | Toolchains and temporary files of the fallbacks |
| `symbols/` | Cached `symbols.zip` |

To clear the cache, stop the proxy and delete `packages/`, `prebuild/` and `symbols/`.
