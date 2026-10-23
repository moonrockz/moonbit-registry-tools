---
layout: default
title: Personal Proxy
parent: Recipes
nav_order: 7
---

# Personal Proxy on Your Computer

Run a caching proxy on your computer. Builds continue when mooncakes.io or your network is not
available.
{: .fs-6 .fw-300 }

---

## Use Case

- You want `moon update`, `moon add` and `moon build` to work on a train or in a plane.
- You want to download each package version only one time, for all your projects.
- You want `moonx` tools (for example `moonfmt`) to start when you are offline.

{: .note }
Proxy mode needs moonbit-registry-tools v0.4.0 or later. See
[Caching Proxy]({{ site.baseurl }}/recipes/proxy-mode) for all the settings.

## Step 1: Create and Start the Proxy

```bash
moonbit-registry init ~/.moonbit-proxy
cd ~/.moonbit-proxy
moonbit-registry config proxy.enabled true
moonbit-registry config server.host 127.0.0.1
moonbit-registry serve
```

`server.host = 127.0.0.1` keeps the proxy on your computer. Other computers on your network
cannot connect to it.

The first start clones the mooncakes.io index (about 20 MB). Wait for this line in the log:

```
✓ Proxy index is ready
```

Before this line, the proxy answers `503` for `/git/index`, and `moon update` fails. This
prevents moon from keeping an empty index.

## Step 2: Point moon at the Proxy

Write `~/.moon/config.json`:

```json
{
  "api": "https://mooncakes.io",
  "index": "http://127.0.0.1:8080/git/index",
  "download": "http://127.0.0.1:8080"
}
```

Then make moon clone the index from the proxy:

```bash
moon update
```

All projects now use the proxy. `api` stays on mooncakes.io: only `moon search`, `moon view`,
`moon login` and `moon publish` use it.

## Step 3: Start the Proxy When You Log In

### macOS (launchd)

Write `~/Library/LaunchAgents/io.moonrockz.moonbit-proxy.plist`. Replace `YOU` with your user
name, and the binary path with the output of `which moonbit-registry`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.moonrockz.moonbit-proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/moonbit-registry</string>
    <string>serve</string>
    <string>--dir</string>
    <string>/Users/YOU/.moonbit-proxy</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/YOU/.moonbit-proxy/proxy.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOU/.moonbit-proxy/proxy.log</string>
</dict>
</plist>
```

Load it, and make sure that it runs:

```bash
plutil -lint ~/Library/LaunchAgents/io.moonrockz.moonbit-proxy.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.moonrockz.moonbit-proxy.plist
curl http://127.0.0.1:8080/health
```

To stop it:

```bash
launchctl bootout gui/$(id -u)/io.moonrockz.moonbit-proxy
```

### Linux (systemd user service)

Write `~/.config/systemd/user/moonbit-proxy.service`. Replace the binary path with the output
of `which moonbit-registry`:

```ini
[Unit]
Description=MoonBit registry caching proxy

[Service]
ExecStart=%h/.local/bin/moonbit-registry serve --dir %h/.moonbit-proxy
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now moonbit-proxy.service
curl http://127.0.0.1:8080/health
```

A user service starts when you log in. To start it when the computer starts, run
`loginctl enable-linger $USER`.

## Step 4: Fill the Cache Before You Go Offline

The proxy caches only the files that a client asked for. To get more files before you go
offline:

```bash
cd ~/.moonbit-proxy
# All versions of the packages that match, and their dependencies
moonbit-registry mirror 'moonbitlang/x' --proxy
# Also the prebuilt wasm of executable packages, for moonx
moonbit-registry mirror 'moonbitlang/parser' --proxy --prebuild
```

You can do this while the proxy runs. It does not change the served index. As an example,
`moonbitlang/x` (60 versions) takes about 10 seconds. `moonbitlang/parser --prebuild`
(375 versions, 87 wasm files) takes about 4 minutes and 220 MB.

## When You Are Offline

| What you do | Result |
|-------------|--------|
| `moon update` | The last index from the proxy. The proxy logs `Proxy index refresh failed, serving the last index` |
| `moon add` or `moon build` with cached versions | Works |
| `moon add` of a version that is not cached | `502` from the proxy |
| `moonx` with a cached prebuilt wasm | Works |
| `moon search`, `moon view`, `moon publish` | Fail: they use `api` on mooncakes.io |

## Stop Using the Proxy

Delete `~/.moon/config.json`, or set `index` and `download` back to mooncakes.io:

```json
{
  "api": "https://mooncakes.io",
  "index": "https://mooncakes.io/git/index",
  "download": "https://download.mooncakes.io"
}
```

Then run `moon update`.

## Related

- [Team Proxy]({{ site.baseurl }}/recipes/proxy-team): one proxy for a team. Your personal
  proxy can use it as its upstream.
- [Corporate Network]({{ site.baseurl }}/recipes/proxy-corporate): when mooncakes.io is
  blocked.
