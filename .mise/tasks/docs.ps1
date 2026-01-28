#Requires -Version 5.1
<#!
.SYNOPSIS
    Serve docs site locally
.DESCRIPTION
    Runs the docs site using Bun to invoke Jekyll.
#>
#MISE description="Serve docs site locally"

$ErrorActionPreference = "Stop"

& bun scripts/docs-serve.ts -- @args
exit $LASTEXITCODE
