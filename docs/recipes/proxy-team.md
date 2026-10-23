---
layout: default
title: Team Proxy
parent: Recipes
nav_order: 8
---

# Team Proxy on a Server

Run one caching proxy for a team or an office. Each package version is downloaded from
mooncakes.io one time, and all developers and CI runners get it from the proxy.
{: .fs-6 .fw-300 }

---

## Use Case

- A team on one network wants one shared cache of mooncakes.io.
- CI runners in the same network must not depend on mooncakes.io for each build.
- Developers want a cache that is already full when they start a new project.

To serve only packages that you approve, use [Team Registry]({{ site.baseurl }}/recipes/team-registry)
(mirror mode) instead. A proxy serves all of mooncakes.io.

{: .note }
Proxy mode needs moonbit-registry-tools v0.4.0 or later.

{: .warning }
The proxy has no authentication and no TLS. Any computer that can connect to its port can
download all packages through it. Put it on an internal network, or behind a firewall or a
reverse proxy that gives TLS and access control.

## Step 1: Install on a Linux Server

These steps use `/var/lib/moonbit-proxy` and a system user `moonbit-proxy`.

```bash
curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz
tar -xzf moonbit-registry-linux-x64.tar.gz
sudo install -m 755 moonbit-registry /usr/local/bin/moonbit-registry

# git is necessary: the proxy clones the index and serves it with git-http-backend
sudo apt-get install -y git

sudo useradd --system --home-dir /var/lib/moonbit-proxy --create-home \
  --shell /usr/sbin/nologin moonbit-proxy
cd /var/lib/moonbit-proxy
sudo -u moonbit-proxy moonbit-registry init .
sudo -u moonbit-proxy moonbit-registry config proxy.enabled true
```

The server listens on `0.0.0.0:8080`. To change the port:

```bash
sudo -u moonbit-proxy moonbit-registry config server.port 8080
```

## Step 2: Run It as a systemd Service

Write `/etc/systemd/system/moonbit-proxy.service`:

```ini
[Unit]
Description=MoonBit registry caching proxy
Wants=network-online.target
After=network-online.target

[Service]
User=moonbit-proxy
Group=moonbit-proxy
WorkingDirectory=/var/lib/moonbit-proxy
ExecStart=/usr/local/bin/moonbit-registry serve --proxy --dir /var/lib/moonbit-proxy
EnvironmentFile=-/etc/moonbit-proxy.env
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/moonbit-proxy

[Install]
WantedBy=multi-user.target
```

`/etc/moonbit-proxy.env` is optional. Use it for variables of the proxy, for example
`GITHUB_TOKEN` (for the [GitHub fallback](#step-5-optional-continue-when-downloads-fail)) or the
variables of an egress proxy (see [Corporate Network]({{ site.baseurl }}/recipes/proxy-corporate)).
Make it readable only by root:

```bash
sudo install -m 600 /dev/null /etc/moonbit-proxy.env
```

Start the service and make sure that the index is ready:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now moonbit-proxy.service
journalctl -u moonbit-proxy -f    # wait for "Proxy index is ready"
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:8080/git/index/info/refs?service=git-upload-pack'   # 200
```

## Step 3: Configure the Clients

On each developer computer and CI runner, write `~/.moon/config.json`. Use the name of your
server:

```json
{
  "api": "https://mooncakes.io",
  "index": "http://moonbit-proxy.example.internal:8080/git/index",
  "download": "http://moonbit-proxy.example.internal:8080"
}
```

Then run `moon update`. moon clones the index again from the proxy
(`Registry index re-cloned successfully`).

## Step 4 (Optional): Fill the Cache Every Night

Write `/etc/systemd/system/moonbit-proxy-prefill.service`:

```ini
[Unit]
Description=Fill the MoonBit proxy cache
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=moonbit-proxy
Group=moonbit-proxy
WorkingDirectory=/var/lib/moonbit-proxy
ExecStart=/usr/local/bin/moonbit-registry mirror moonbitlang/* --proxy --prebuild --dir /var/lib/moonbit-proxy
EnvironmentFile=-/etc/moonbit-proxy.env
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/moonbit-proxy
```

And `/etc/systemd/system/moonbit-proxy-prefill.timer`:

```ini
[Unit]
Description=Fill the MoonBit proxy cache every night

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now moonbit-proxy-prefill.timer
systemctl list-timers moonbit-proxy-prefill.timer
```

The prefill runs while the proxy serves clients. It does not change the served index. It
downloads only files that are not in the cache, so the first run takes much longer than the
next runs. As an example, the first run of `moonbitlang/*` took 25 minutes and about 2 GB:
1803 versions of 133 packages (with dependencies) and 330 prebuilt wasm files. Change
`moonbitlang/*` to the packages that your team uses.

## Step 5 (Optional): Continue When Downloads Fail

When download.mooncakes.io cannot send a zip, the proxy can rebuild the zip from the GitHub tag
of the version. It serves the rebuild only when it is byte-identical to the published zip. Add
to `/var/lib/moonbit-proxy/registry.toml`:

```toml
[proxy.fallback]
github = true
toolchain = "current"
# The mooncakes.io index has no manifests. Get them from the moonrockz index mirror.
manifest_url = "https://raw.githubusercontent.com/moonrockz/mooncakes-index/main/manifests"
```

Put `GITHUB_TOKEN=<token>` in `/etc/moonbit-proxy.env` for a higher GitHub rate limit, then
restart the service. The token needs no scopes: it reads only public tags.

- `toolchain = "current"` uses the moon of the service user, so install moon for that user
  first. With `toolchain = "auto"`, the proxy installs the toolchain of the publish date with
  [moonup](https://github.com/chawyehsu/moonup) instead. Set `moonup = "/path/to/moonup"`.
- The rebuild needs a manifest line for the version. The moonrockz index mirror adds them
  each day, so a version that is very new can have no manifest line yet.
- Some versions cannot be rebuilt, for example when a test needs files that a build hook
  makes. The proxy then sends `502`, as without the fallback.

See [Caching Proxy]({{ site.baseurl }}/recipes/proxy-mode#fallbacks-when-upstream-has-no-file-optional)
for all fallback settings and for the trust model.

## Laptops: Chain a Personal Proxy

A developer who travels can run a [personal proxy]({{ site.baseurl }}/recipes/proxy-personal)
that uses the team proxy as its upstream. In the office, the laptop gets files from the team
cache. Out of the office, it uses its own cache.

```bash
moonbit-registry init ~/.moonbit-proxy
cd ~/.moonbit-proxy
moonbit-registry source add office -t moonbit-registry \
  -u http://moonbit-proxy.example.internal:8080 \
  -i http://moonbit-proxy.example.internal:8080/git/index
moonbit-registry source default office
moonbit-registry config proxy.enabled true
moonbit-registry config server.host 127.0.0.1
moonbit-registry serve
```

The laptop log shows `Proxy cached moonbitlang/x@0.5.6 (365530 bytes, from office)`.

## Maintenance

| Task | Command |
|------|---------|
| See the log | `journalctl -u moonbit-proxy` |
| Upgrade | Install the new binary, then `sudo systemctl restart moonbit-proxy` |
| Disk use | `du -sh /var/lib/moonbit-proxy/data/*` |
| Clear the cache | Stop the service, delete `data/packages`, `data/prebuild` and `data/symbols`, start the service |

All zips of mooncakes.io are about 16 GB. A proxy keeps only the versions that clients or the
prefill asked for. After a restart, the proxy serves its last index at once, and checks each
cached zip against the index checksum again on its first request.
