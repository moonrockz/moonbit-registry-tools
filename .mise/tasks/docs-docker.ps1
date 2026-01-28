#Requires -Version 5.1
<#!
.SYNOPSIS
    Serve docs site locally via Docker
.DESCRIPTION
    Runs the docs site using Docker.
#>
#MISE description="Serve docs site locally via Docker"

$ErrorActionPreference = "Stop"

& bun scripts/docs-serve-docker.ts -- @args
exit $LASTEXITCODE
