#Requires -Version 5.1
<#!
.SYNOPSIS
    Serve docs site locally via WSL
.DESCRIPTION
    Runs the docs site using WSL.
#>
#MISE description="Serve docs site locally via WSL"

$ErrorActionPreference = "Stop"

& bun scripts/docs-serve-wsl.ts -- @args
exit $LASTEXITCODE
