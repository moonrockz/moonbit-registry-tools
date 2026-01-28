#Requires -Version 5.1
<#!
.SYNOPSIS
    Check formatting
.DESCRIPTION
    Runs Biome formatting check.
#>
#MISE description="Check formatting"

$ErrorActionPreference = "Stop"

& bun scripts/format-check.ts -- @args
exit $LASTEXITCODE
