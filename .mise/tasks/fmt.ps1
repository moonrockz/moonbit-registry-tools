#Requires -Version 5.1
<#!
.SYNOPSIS
    Format code
.DESCRIPTION
    Runs Biome formatter.
#>
#MISE description="Format code"

$ErrorActionPreference = "Stop"

& bun scripts/format.ts -- @args
exit $LASTEXITCODE
