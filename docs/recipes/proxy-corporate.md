---
layout: default
title: Corporate Network
parent: Recipes
nav_order: 9
---

# Corporate Network

Use MoonBit packages in a network where mooncakes.io is blocked, where traffic must go through
an egress proxy, or where there is no internet access.
{: .fs-6 .fw-300 }

---

## Use Case

Your network policy does not let developer computers and CI runners connect to the MoonBit
registry (mooncakes.io and download.mooncakes.io). You want them to use packages from one
internal host that your security team controls.

{: .note }
Proxy mode needs moonbit-registry-tools v0.4.0 or later. Set up the proxy host with
[Team Proxy]({{ site.baseurl }}/recipes/proxy-team), then apply the scenario that agrees with
your network.

## Select Your Scenario

| Scenario | Proxy host can reach | Use |
|----------|----------------------|-----|
| [A](#scenario-a-only-the-proxy-host-can-reach-the-registry) | mooncakes.io, directly | Allowlist for one host |
| [B](#scenario-b-traffic-goes-through-an-egress-proxy) | mooncakes.io, through an HTTP proxy with TLS inspection | Proxy and CA variables |
| [C](#scenario-c-mooncakesio-is-blocked-github-is-allowed) | GitHub only | Index from GitHub, zips rebuilt from GitHub tags |
| [D](#scenario-d-no-internet-access) | Nothing | Fill a cache outside, copy it in |

In all scenarios, the clients connect only to the proxy host.

## What the Clients Need

Each client needs only the proxy. Write `~/.moon/config.json`:

```json
{
  "api": "https://mooncakes.io",
  "index": "http://moonbit-proxy.example.internal:8080/git/index",
  "download": "http://moonbit-proxy.example.internal:8080"
}
```

| moon command | Uses | Works through the proxy |
|--------------|------|-------------------------|
| `moon update`, `moon add`, `moon install`, `moon build`, `moon test`, `moon run` | `index`, `download` | Yes |
| `moonx <tool>` | `download` (`/prebuild/...`) | Yes |
| `moon search`, `moon view` | `api` | No |
| `moon login`, `moon register`, `moon publish` | `api` | No |

When mooncakes.io is blocked for clients, the commands that use `api` fail, for example with
`tunnel error ... Connection refused`. Developers can find packages on the mooncakes.io web
site from a computer that can reach it. You can also set `api` to the proxy URL; then these
commands fail with `404 Not Found`, and the other commands continue to work.

Instead of `config.json`, a client can set `MOONCAKES_REGISTRY` to the proxy URL. moon then
uses the proxy for all URLs, `api` included: `moon search` and `moon view` fail, and the
other commands work. moon ignores `MOONCAKES_REGISTRY` when `config.json` exists.

To make sure that a client uses only the proxy, block all other hosts for one command and run
a build:

```bash
export HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9
export NO_PROXY=moonbit-proxy.example.internal
moon update && moon build
```

## Hosts That the Proxy Host Uses

| Host (port 443) | Use | Scenarios |
|-----------------|-----|-----------|
| `mooncakes.io` | Index (`mooncakes` source) | A, B |
| `download.mooncakes.io` | Zips, prebuilt wasm, `symbols.zip` | A, B |
| `d15l9c1mnzh3r.cloudfront.net` | download.mooncakes.io redirects all downloads here | A, B |
| `github.com` | Index (`moonrockz` source); toolchain binaries for moonup | C (and A, B with fallbacks) |
| `api.github.com` | Tag tarballs for the GitHub rebuild; toolchain list for moonup | Fallbacks |
| `codeload.github.com` | api.github.com redirects tarballs here | Fallbacks |
| `raw.githubusercontent.com` | `manifest_url` of the moonrockz index mirror | Fallbacks with the `mooncakes` source |
| `moonup.csu.moe` | moonup toolchain index (`MOONUP_DIST_SERVER`) | `toolchain = "auto"` |
| `release-assets.githubusercontent.com` | Toolchain downloads by moonup | `toolchain = "auto"` |

The CloudFront host name can change. When downloads fail with a connection error, find the
current host:

```bash
curl -sI https://download.mooncakes.io/user/moonbitlang/x/0.5.4.zip | grep -i '^location'
```

## Scenario A: Only the Proxy Host Can Reach the Registry

1. Set up the proxy host with [Team Proxy]({{ site.baseurl }}/recipes/proxy-team).
2. In the firewall, let the proxy host connect to `mooncakes.io`, `download.mooncakes.io`
   and the CloudFront host on port 443.
3. Let the clients connect to the proxy host on port 8080. Block the registry hosts for the
   clients.
4. Write `config.json` on the clients (see above).

## Scenario B: Traffic Goes Through an Egress Proxy

The proxy host uses the standard proxy variables for all its downloads (index clone, zips,
wasm, `symbols.zip`, GitHub tarballs). moon and moonup, which the fallbacks start, use them
too. Put them in `/etc/moonbit-proxy.env`:

```bash
HTTPS_PROXY=http://egress.example.internal:3128
HTTP_PROXY=http://egress.example.internal:3128
NO_PROXY=localhost,127.0.0.1,.example.internal
```

`HTTP_PROXY` applies only to `http://` URLs. All registry URLs are `https://`, so you must set
`HTTPS_PROXY`.

When the egress proxy inspects TLS with a corporate CA certificate, each program must trust
that certificate. Add these lines too:

```bash
# moonbit-registry (Bun): downloads of zips, wasm, symbols.zip, tarballs
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/corporate-ca.pem
# git: index clone and fetch
GIT_SSL_CAINFO=/etc/ssl/certs/corporate-ca.pem
# moon, started by the fallbacks
SSL_CERT_FILE=/etc/ssl/certs/corporate-ca.pem
```

| Program | Variable | Without it |
|---------|----------|------------|
| moonbit-registry | `NODE_EXTRA_CA_CERTS` | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| git | `GIT_SSL_CAINFO` (git does not read `SSL_CERT_FILE`) | `SSL certificate problem: unable to get local issuer certificate` |
| moon | `SSL_CERT_FILE` | `invalid peer certificate: UnknownIssuer` |

On macOS, moonup uses the system keychain, not `SSL_CERT_FILE`. Add the CA certificate to the
keychain, or use `toolchain = "current"`, which does not need moonup.

The clients connect only to the proxy host, so they do not need the egress proxy. When the
clients have `HTTPS_PROXY` set for other work, add the proxy host to their `NO_PROXY`.

## Scenario C: mooncakes.io Is Blocked, GitHub Is Allowed

Use the index mirror on GitHub, and rebuild each zip from the GitHub tag of its version. The
proxy serves a rebuilt zip only when its SHA-256 is equal to the checksum of the published
zip in the index.

```bash
cd /var/lib/moonbit-proxy
sudo -u moonbit-proxy moonbit-registry source add moonrockz --from-preset moonrockz \
  --download-url http://127.0.0.1:9 --symbols-url http://127.0.0.1:9/symbols.zip
sudo -u moonbit-proxy moonbit-registry source default moonrockz
```

The `moonrockz` source clones the index from `github.com/moonrockz/mooncakes-index`. That
index has a manifest line for each version, which the rebuild needs.

`--download-url http://127.0.0.1:9` points downloads at a closed port, so each download fails
at once and the fallback starts. Without it, the proxy tries download.mooncakes.io first. When
your firewall drops the packets instead of refusing the connection, each download then waits
for its timeout (5 minutes).

Add the fallback to `registry.toml`, and `GITHUB_TOKEN` to `/etc/moonbit-proxy.env`:

```toml
[proxy.fallback]
github = true
toolchain = "current"
```

| `toolchain` | The rebuild uses | Hosts |
|-------------|------------------|-------|
| `current` | The moon that you install for the service user | `github.com`, `api.github.com`, `codeload.github.com` |
| `auto` | The toolchain of the publish date, installed by moonup | Also `moonup.csu.moe`, `release-assets.githubusercontent.com` |

With `current`, a new moon can make a zip that is not byte-identical to an old published zip.
The proxy then refuses the rebuild and sends `502`. `auto` rebuilds more old versions, but the
first rebuild with a toolchain installs it (about 400 MB) and can take some minutes. moon waits
only about 30 seconds, so the first `moon build` can fail with `operation timed out`. The
proxy completes the rebuild, and the next `moon build` works. To rebuild before developers need
the zips:

```bash
sudo -u moonbit-proxy moonbit-registry mirror 'moonbitlang/x' --proxy --dir /var/lib/moonbit-proxy
```

In this scenario:

- `symbols.zip` is not available. The proxy sends `502`, and `moon update` prints
  `Warning: failed to update symbols` and continues.
- Prebuilt wasm for `moonx` is not available from upstream. Set `build_wasm = true` in
  `[proxy.fallback]` to build it on the proxy host.
- Versions that cannot be rebuilt (see
  [Trust Model]({{ site.baseurl }}/recipes/proxy-mode#trust-model)) give `502`.

## Scenario D: No Internet Access

Fill a cache on a computer outside the network, then copy it to the proxy host. The cache
directory does not depend on the operating system. Install the moonbit-registry binary for
the proxy host separately.

On the computer outside:

```bash
moonbit-registry init moonbit-proxy
cd moonbit-proxy
moonbit-registry config registry.data_dir ./data
moonbit-registry config proxy.enabled true
moonbit-registry mirror 'moonbitlang/*' --proxy --prebuild
```

`init` writes an absolute `data_dir`. `./data` is relative to the directory of
`registry.toml`, so the copy works at a different path. `mirror --proxy` also clones the index
and caches `symbols.zip`. Make sure that the served index has a commit before you copy:

```bash
git -C data/index log --oneline -1    # Proxy index of upstream at ...
tar -czf moonbit-proxy.tar.gz -C .. moonbit-proxy
```

On the proxy host inside, extract the archive (for example to `/var/lib/moonbit-proxy`) and
start the proxy as in [Team Proxy]({{ site.baseurl }}/recipes/proxy-team). It serves the copied
index at once. Each index refresh fails and the log shows
`Proxy index refresh failed, serving the last index`. Set a long interval to make the log
shorter:

```bash
sudo -u moonbit-proxy moonbit-registry config proxy.index_refresh_interval 1d
```

Only the versions in the cache are available. A request for another version gets `502`. To
add packages or new versions, run `mirror` again outside, and copy the directory again. The
copy has the full index, so moon can select versions that are not in the cache: tell
developers to use versions that the cache has, or mirror all the versions that they need.

## Related

- [Team Proxy]({{ site.baseurl }}/recipes/proxy-team): install the proxy host.
- [Caching Proxy]({{ site.baseurl }}/recipes/proxy-mode): all settings, the fallbacks and the
  trust model.
- [Offline Development]({{ site.baseurl }}/recipes/offline-development): a registry that serves
  only the packages that you mirror.
