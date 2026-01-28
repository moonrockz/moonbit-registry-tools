# .mise task conventions

This repo uses conventional file tasks (files under `.mise/tasks/`) instead of inline task commands.

## Pattern

All task files should follow this pattern:

- **Bash shim** (`.mise/tasks/<task>`): minimal wrapper that calls a Bun script.
- **PowerShell shim** (`.mise/tasks/<task>.ps1`): minimal wrapper that calls the same Bun script.
- **Bun script** (`scripts/<task>.ts`): contains the real logic.

This keeps task behavior consistent across platforms and makes it easier to test, reuse, and lint.

## Template

Bash shim:

```bash
#!/usr/bin/env bash
#MISE description="..."

set -e

bun scripts/<task>.ts -- "$@"
```

PowerShell shim:

```powershell
#Requires -Version 5.1
<#!
.SYNOPSIS
    ...
.DESCRIPTION
    ...
#>
#MISE description="..."

$ErrorActionPreference = "Stop"

& bun scripts/<task>.ts -- @args
exit $LASTEXITCODE
```

Bun script (TypeScript):

```ts
import { spawn } from "node:child_process";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

const extraArgs = process.argv.slice(2);
// ...
```

## Notes

- Keep shims minimal; all logic belongs in the Bun script.
- Ensure both shims point to the same Bun script name.
- Prefer adding `run_windows` in `mise.toml` for any new tasks.
