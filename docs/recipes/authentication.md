---
layout: default
title: Authentication
parent: Recipes
nav_order: 5
---

# Authentication

Connect to private registries that require authentication.
{: .fs-6 .fw-300 }

---

## Use Case

You need to mirror packages from a private registry that requires authentication, such as:

- A company's internal registry
- A paid/licensed package source
- A partner's protected repository

## Supported Authentication Methods

| Method | Use Case |
|--------|----------|
| Bearer Token | API tokens, OAuth tokens, JWTs |
| Basic Auth | Username/password authentication |

---

## Bearer Token Authentication

Most common for modern APIs and registries.

### Step 1: Get Your Token

Obtain an API token from your registry provider. This might be:

- A personal access token
- An API key
- An OAuth access token

### Step 2: Store the Token Securely

**Never commit tokens to your repository!** Use environment variables:

```bash
# Add to your shell profile or CI secrets
export PRIVATE_REGISTRY_TOKEN="your-token-here"
```

### Step 3: Configure the Source

Add the source with the `--from-preset` or manually:

```bash
moonbit-registry source add private \
  --url https://private.example.com/registry \
  --index-url https://private.example.com/registry/git/index
```

Then edit `registry.toml` to add authentication:

```toml
[[sources]]
name = "private"
type = "moonbit-registry"
url = "https://private.example.com/registry"
index_url = "https://private.example.com/registry/git/index"
index_type = "git"
enabled = true
priority = 50

[sources.auth]
type = "bearer"
token = "${PRIVATE_REGISTRY_TOKEN}"
```

{: .note }
The `${VARIABLE}` syntax is expanded at runtime from environment variables.

### Step 4: Test the Connection

```bash
# Ensure your token is set
echo $PRIVATE_REGISTRY_TOKEN

# Try mirroring a package
moonbit-registry mirror -s private "private-org/some-package"
```

---

## Basic Authentication

For registries using username/password authentication.

### Configuration

```toml
[[sources]]
name = "legacy-registry"
type = "custom"
url = "https://legacy.example.com/registry"
index_url = "https://legacy.example.com/registry/index"
index_type = "http"
enabled = true

[sources.auth]
type = "basic"
username = "myuser"
password = "${LEGACY_REGISTRY_PASSWORD}"
```

{: .warning }
Avoid putting actual passwords in the config file. Always use environment variable references.

---

## CI/CD Integration

### GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      PRIVATE_REGISTRY_TOKEN: ${{ secrets.PRIVATE_REGISTRY_TOKEN }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup registry
        run: |
          moonbit-registry init .registry
          moonbit-registry source add private \
            --url https://private.example.com/registry \
            --index-url https://private.example.com/registry/git/index \
            -d .registry

          # Add auth to config
          cat >> .registry/registry.toml << EOF
          [sources.auth]
          type = "bearer"
          token = "\${PRIVATE_REGISTRY_TOKEN}"
          EOF

          moonbit-registry mirror -s private "private-org/*" -d .registry
```

### GitLab CI

```yaml
variables:
  PRIVATE_REGISTRY_TOKEN: $PRIVATE_REGISTRY_TOKEN

build:
  script:
    - moonbit-registry mirror -s private "private-org/*"
```

---

## Troubleshooting

### 401 Unauthorized

- Verify your token is set: `echo $PRIVATE_REGISTRY_TOKEN`
- Check the token hasn't expired
- Ensure the token has the required scopes/permissions

### 403 Forbidden

- The token may not have access to the requested package
- Check with your registry administrator for permissions

### Connection Errors

- Verify the registry URL is correct
- Check network connectivity and firewall rules
- For HTTPS, ensure the certificate is valid

---

## Security Best Practices

{: .warning }
**Never commit tokens** to version control. Use environment variables or secret management.

{: .tip }
**Rotate tokens regularly** and use tokens with minimal required permissions.

{: .tip }
**Use separate tokens** for CI/CD and local development to limit blast radius if compromised.
