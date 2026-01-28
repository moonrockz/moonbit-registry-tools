# AGENTS.md

## Repo overview
- MoonBit registry tooling (CLI + docs site).
- Docs are in `docs/` and published via GitHub Pages.

## Task conventions
- Prefer running tasks through `mise`.
- For task scripts, use the bash + PowerShell shim pattern that calls a Bun script in `scripts/`.
- See `.mise/AGENTS.md` for the detailed pattern and templates.

## Local docs
- Serve docs (Windows): `mise run docs`
- Serve docs (WSL): `mise run docs:wsl`
- Serve docs (Docker): `mise run docs:docker`
- Build docs: `mise run docs_build`

Notes:
- Local-only overrides live in `docs/_config_local.yml` and are excluded from GitHub Pages.
- On Windows, livereload is disabled by default; set `DOCS_LIVERELOAD=true` to enable.

## Formatting / linting
- Format: `mise run fmt`
- Lint: `mise run lint`
- YAML lint: `mise run yamllint`

## Common paths
- CLI entry: `src/cli/index.ts`
- Docs home: `docs/index.md`
- Docs config: `docs/_config.yml`
