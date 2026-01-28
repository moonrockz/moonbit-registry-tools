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

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
