---
layout: default
title: Installation
nav_order: 2
---

# Installation

There are several ways to install MoonBit Registry Tools depending on your platform and preferences.
{: .fs-6 .fw-300 }

---

## Install with Mise (Recommended)

If you have [mise](https://mise.jdx.dev) installed, you can install the CLI directly from GitHub releases:

```bash
mise use -g "github:moonrockz/moonbit-registry-tools@latest"
```

This installs the latest version globally. To install a specific version:

```bash
mise use -g "github:moonrockz/moonbit-registry-tools@0.1.0"
```

To add it to a project's `.mise.toml`:

```bash
mise use "github:moonrockz/moonbit-registry-tools@0.1.0"
```

### Windows ARM64 Users

Windows ARM64 does not have a native binary, but you can run the x64 version via emulation. Set the `MISE_ARCH` environment variable:

```bash
MISE_ARCH=x64 mise use -g "github:moonrockz/moonbit-registry-tools@latest"
```

To make this permanent, add to your shell profile or mise configuration:

```bash
# In ~/.bashrc or ~/.zshrc
export MISE_ARCH=x64
```

Or configure in `~/.config/mise/config.toml`:

```toml
[env]
MISE_ARCH = "x64"
```

---

## Download Pre-built Binaries

Alternatively, download a pre-built binary from the [GitHub Releases](https://github.com/moonrockz/moonbit-registry-tools/releases) page.

### Linux (x64)

```bash
curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-x64.tar.gz
tar -xzf moonbit-registry-linux-x64.tar.gz
sudo mv moonbit-registry /usr/local/bin/
```

### Linux (ARM64)

```bash
curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-linux-arm64.tar.gz
tar -xzf moonbit-registry-linux-arm64.tar.gz
sudo mv moonbit-registry /usr/local/bin/
```

### macOS (Intel)

```bash
curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-darwin-x64.tar.gz
tar -xzf moonbit-registry-darwin-x64.tar.gz
sudo mv moonbit-registry /usr/local/bin/
```

### macOS (Apple Silicon)

```bash
curl -LO https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-darwin-arm64.tar.gz
tar -xzf moonbit-registry-darwin-arm64.tar.gz
sudo mv moonbit-registry /usr/local/bin/
```

### Windows (x64)

Download the [Windows release](https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-windows-x64.zip), extract it, and add the directory to your PATH.

Or using PowerShell:

```powershell
Invoke-WebRequest -Uri "https://github.com/moonrockz/moonbit-registry-tools/releases/latest/download/moonbit-registry-windows-x64.zip" -OutFile "moonbit-registry.zip"
Expand-Archive -Path "moonbit-registry.zip" -DestinationPath "$env:LOCALAPPDATA\Programs\moonbit-registry"
# Add to PATH (requires admin or manual addition)
```

---

## Build from Source

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or later)
- [Git](https://git-scm.com/)

### Steps

```bash
# Clone the repository
git clone https://github.com/moonrockz/moonbit-registry-tools.git
cd moonbit-registry-tools

# Install dependencies
bun install

# Build the binary
bun run build

# The binary is now at dist/moonbit-registry
./dist/moonbit-registry --version
```

### Using Mise

If you have [mise](https://mise.jdx.dev) installed:

```bash
git clone https://github.com/moonrockz/moonbit-registry-tools.git
cd moonbit-registry-tools
mise install
mise run build
```

---

## Verify Installation

After installation, verify it's working:

```bash
moonbit-registry --version
moonbit-registry --help
```

You should see output like:

```
0.1.0
```

---

## Next Steps

Now that you have the CLI installed, proceed to [Getting Started]({{ site.baseurl }}/getting-started) to set up your first registry.
