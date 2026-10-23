---
layout: default
title: mooncakes.io Outage
parent: Recipes
nav_order: 10
---

# Build During a mooncakes.io Outage

mooncakes.io or download.mooncakes.io is down, and `moon update` or `moon build` fails. Start a
proxy that gets the index from GitHub and rebuilds zips from GitHub tags.
{: .fs-6 .fw-300 }

---

## How It Works

- The [moonrockz/mooncakes-index](https://github.com/moonrockz/mooncakes-index) repository is a
  copy of the mooncakes.io index, updated each day. It also has a manifest line for each
  version: the files of the published zip, in order, with their SHA-256.
- When the proxy cannot download a zip, it downloads the tag of the version from GitHub, runs
  `moon package`, and puts the files in the published order.
- The proxy serves the result only when its SHA-256 is equal to the checksum in the index. A
  rebuilt zip is the same file as the published zip.

{: .note }
Proxy mode needs moonbit-registry-tools v0.4.0 or later. Only modules whose `repository` is on
GitHub, with a tag `v<version>` or `<version>`, can be rebuilt.

## Step 1: Start the Proxy

```bash
moonbit-registry init ~/moonbit-outage
cd ~/moonbit-outage
moonbit-registry source add moonrockz --from-preset moonrockz
moonbit-registry source default moonrockz
moonbit-registry config proxy.enabled true
moonbit-registry config server.host 127.0.0.1
cat >> registry.toml <<'EOF'

[proxy.fallback]
github = true
toolchain = "current"
EOF
GITHUB_TOKEN=$(gh auth token) moonbit-registry serve
```

`toolchain = "current"` uses your moon. `GITHUB_TOKEN` is optional. Without it, GitHub permits
60 requests in each hour.

When you already have a [personal proxy]({{ site.baseurl }}/recipes/proxy-personal), add the
`moonrockz` source and the `[proxy.fallback]` table to it instead.

## Step 2: Point moon at the Proxy

Write `~/.moon/config.json`, then run `moon update`:

```json
{
  "api": "https://mooncakes.io",
  "index": "http://127.0.0.1:8080/git/index",
  "download": "http://127.0.0.1:8080"
}
```

When the proxy rebuilds a zip, its log shows:

```
[INFO] Proxy miss: fetching moonbitlang/x@0.5.4 from moonrockz
[WARN] Upstream cannot send moonbitlang/x@0.5.4 (...), trying a GitHub rebuild
[INFO] GitHub rebuild of moonbitlang/x@0.5.4: checksum matches the index, serving the rebuild
[INFO] Proxy cached moonbitlang/x@0.5.4 (300267 bytes, from GitHub moonbitlang/x tag v0.5.4)
```

## When a Version Cannot Be Rebuilt

The proxy sends `502` and logs the reason. Common reasons:

| Log contains | Reason | What to do |
|--------------|--------|------------|
| `there is no manifest line` | The version is newer than the last update of the index mirror | Use an older version, or wait one day |
| `has no GitHub repository in the index`, `has no tag` | The source is not on GitHub, or has no tag for the version | Use another version |
| `does not have the files of the published` | The tag is not the source of the published zip | Use another version |
| `same files but other zip bytes` | Your moon packs the files in a different way | Set `toolchain = "auto"` and `moonup` (see [Toolchains]({{ site.baseurl }}/recipes/proxy-mode#toolchains)) |
| `moon package with toolchain ... failed` | For example, the module needs a build hook, which the proxy does not run | Use another version |

`moon search`, `moon view` and `moon publish` use mooncakes.io directly, so they do not work
during the outage.

## After the Outage

Delete `~/.moon/config.json` and run `moon update`, or keep the proxy as your
[personal proxy]({{ site.baseurl }}/recipes/proxy-personal).
