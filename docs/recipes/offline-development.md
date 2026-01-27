---
layout: default
title: Offline Development
parent: Recipes
nav_order: 1
---

# Offline Development

Set up a registry for air-gapped or disconnected environments.
{: .fs-6 .fw-300 }

---

## Use Case

You need to develop MoonBit applications in an environment without internet access, such as:

- Secure facilities with network restrictions
- Remote locations with limited connectivity
- Compliance requirements that prohibit external network access

## Solution

Pre-populate a registry on a connected machine, then transfer it to the air-gapped environment.

### Step 1: Prepare the Registry (Connected Machine)

```bash
# Create and initialize the registry
moonbit-registry init ./offline-registry
cd offline-registry

# Mirror all packages you'll need
# Option A: Mirror everything
moonbit-registry mirror --full

# Option B: Mirror specific packages and their dependencies
moonbit-registry mirror "moonbitlang/*" "company/internal-*"

# Verify the packages were downloaded
ls -la data/packages/
```

### Step 2: Transfer to Air-Gapped Environment

Transfer the entire `offline-registry` directory to your air-gapped environment using your approved method (USB drive, secure file transfer, etc.).

The directory contains:
- `registry.toml` - Configuration
- `data/index/` - Package metadata (git repository)
- `data/packages/` - Actual package files (.zip)

### Step 3: Serve the Registry (Air-Gapped Machine)

```bash
cd /path/to/offline-registry

# Start the server
moonbit-registry serve --host 0.0.0.0 --port 8080
```

{: .tip }
Consider running the server as a system service for automatic startup.

### Step 4: Configure Developer Machines

On each developer machine in the air-gapped environment:

```bash
# Add to shell profile (.bashrc, .zshrc, etc.)
export MOONCAKES_REGISTRY=http://registry-server:8080
```

Replace `registry-server` with the hostname or IP of the machine running the registry.

---

## Systemd Service (Linux)

To run the registry as a system service:

```ini
# /etc/systemd/system/moonbit-registry.service
[Unit]
Description=MoonBit Registry Server
After=network.target

[Service]
Type=simple
User=registry
WorkingDirectory=/opt/moonbit-registry
ExecStart=/usr/local/bin/moonbit-registry serve --host 0.0.0.0 --port 8080
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

---

## Updating the Offline Registry

When you need to add new packages:

1. On the connected machine, mirror the new packages
2. Transfer the updated `data/` directory
3. Restart the registry server (or it will pick up changes automatically)

```bash
# On connected machine
moonbit-registry mirror "new/package"

# Transfer data/packages/new/ and data/index/ updates
```
