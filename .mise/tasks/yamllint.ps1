#Requires -Version 5.1
<#!
.SYNOPSIS
    Lint YAML files
.DESCRIPTION
    Runs yamllint via uvx.
#>
#MISE description="Lint YAML files"

$ErrorActionPreference = "Stop"

& bun scripts/yamllint.ts -- @args
exit $LASTEXITCODE
