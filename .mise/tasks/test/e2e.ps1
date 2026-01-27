#Requires -Version 5.1
<#
.SYNOPSIS
    Run E2E tests
.DESCRIPTION
    Runs end-to-end tests that require the moon CLI to be installed.
#>
#MISE description="Run E2E tests (requires moon CLI)"
#USAGE flag "-v --verbose" help="Verbose output"

param()

$ErrorActionPreference = "Stop"

# Check if moon CLI is available
$moonPath = Get-Command moon -ErrorAction SilentlyContinue
if (-not $moonPath) {
    Write-Host "Error: moon CLI is not installed" -ForegroundColor Red
    Write-Host "Install from: https://www.moonbitlang.com/download/"
    exit 1
}

Write-Host "Moon CLI version: $(moon version)"
Write-Host ""

$args_list = @()
if ($env:usage_verbose -eq "true") { $args_list += "--verbose" }

# Run E2E tests with extended timeout
$testArgs = @("test", "tests/e2e/", "--timeout", "300000") + $args_list
& bun @testArgs
exit $LASTEXITCODE
