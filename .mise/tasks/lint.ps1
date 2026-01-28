#Requires -Version 5.1
<#!
.SYNOPSIS
    Lint code
.DESCRIPTION
    Runs Biome checks.
#>
#MISE description="Lint code"
#USAGE flag "--fix" help="Auto-fix issues"

$ErrorActionPreference = "Stop"

& bun scripts/lint.ts -- @args
exit $LASTEXITCODE
