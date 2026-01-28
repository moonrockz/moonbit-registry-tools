#Requires -Version 5.1
<#!
.SYNOPSIS
    Build docs site
.DESCRIPTION
    Builds the docs site using Bun to invoke Jekyll.
#>
#MISE description="Build docs site"

$ErrorActionPreference = "Stop"

& bun scripts/docs-build.ts -- @args
exit $LASTEXITCODE
