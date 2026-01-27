---
layout: default
title: Team Registry
parent: Recipes
nav_order: 4
---

# Team Registry

Share a registry across your development team.
{: .fs-6 .fw-300 }

---

## Use Case

Your team wants to:

- Share a consistent set of cached packages
- Reduce bandwidth by having one central cache
- Ensure everyone uses the same package versions

## Solution

Set up a centralized registry server that all team members connect to.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Developer Machines                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  Dev 1  │  │  Dev 2  │  │  Dev 3  │  │  Dev N  │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
└───────┼────────────┼────────────┼────────────┼──────────────┘
        │            │            │            │
        └────────────┴─────┬──────┴────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   Team Registry Server │
              │   (registry.team.local)│
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │     mooncakes.io       │
              └────────────────────────┘
```

### Step 1: Set Up the Server

On a dedicated server or VM:

```bash
# Install moonbit-registry
curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz
tar -xzf moonbit-registry-linux-x64.tar.gz
sudo mv moonbit-registry /usr/local/bin/

# Initialize the registry
sudo mkdir -p /opt/moonbit-registry
sudo moonbit-registry init /opt/moonbit-registry --name team-registry
```

### Step 2: Configure the Server

Edit `/opt/moonbit-registry/registry.toml`:

```toml
[registry]
name = "team-registry"
data_dir = "./data"

[[sources]]
name = "mooncakes"
type = "mooncakes"
url = "https://mooncakes.io"
index_url = "https://mooncakes.io/git/index"
index_type = "git"
enabled = true
priority = 100

default_source = "mooncakes"

[server]
host = "0.0.0.0"
port = 8080
base_url = "http://registry.team.local:8080"
```

### Step 3: Pre-populate with Packages

Mirror the packages your team commonly uses:

```bash
cd /opt/moonbit-registry
moonbit-registry mirror "moonbitlang/*"
moonbit-registry mirror "other/packages" "your/team-uses"
```

### Step 4: Run as a Service

Create a systemd service:

```ini
# /etc/systemd/system/moonbit-registry.service
[Unit]
Description=MoonBit Team Registry
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/moonbit-registry
ExecStart=/usr/local/bin/moonbit-registry serve
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable moonbit-registry
sudo systemctl start moonbit-registry
```

### Step 5: Configure Team Machines

Each developer adds to their shell profile:

```bash
# ~/.bashrc or ~/.zshrc
export MOONCAKES_REGISTRY=http://registry.team.local:8080
```

---

## Sharing the Index via Git

For distributed teams, you can sync the registry index via Git:

### On the Server

```bash
# Configure git remote
moonbit-registry config git.remote_url "git@github.com:your-org/registry-index.git"
moonbit-registry config git.auto_push true

# After mirroring, push to remote
moonbit-registry sync --push
```

### Team Members Can Pull Updates

```bash
# Pull latest index
moonbit-registry sync --pull

# Or just mirror new packages (will fetch index automatically)
moonbit-registry mirror "new/package"
```

---

## Docker Deployment

```dockerfile
# Dockerfile
FROM oven/bun:1.0-alpine

WORKDIR /app
COPY dist/moonbit-registry /usr/local/bin/
RUN moonbit-registry init /data

EXPOSE 8080
VOLUME /data

CMD ["moonbit-registry", "serve", "-d", "/data", "--host", "0.0.0.0"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  registry:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - registry-data:/data
    restart: unless-stopped

volumes:
  registry-data:
```

---

## Tips

{: .tip }
**DNS**: Set up a DNS entry like `registry.team.local` pointing to your server for easier configuration.

{: .tip }
**Backup**: Regularly backup the `data/` directory to preserve your cached packages and index.
