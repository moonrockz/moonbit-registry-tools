#Requires -Version 5.1
<#
.SYNOPSIS
    Run tests
.DESCRIPTION
    Runs the test suite using Bun's test runner.
    On Windows, tests run sequentially to avoid Bun segfault issues.
#>
#MISE description="Run tests"
#USAGE flag "-w --watch" help="Watch mode"
#USAGE flag "--coverage" help="Generate coverage report"
#USAGE flag "--sequential" help="Run test files sequentially (workaround for Windows segfault)"

param()

$ErrorActionPreference = "Stop"

$args_list = @()
if ($env:usage_watch -eq "true") { $args_list += "--watch" }
if ($env:usage_coverage -eq "true") { $args_list += "--coverage" }

# Always run sequentially on Windows due to Bun segfault
# See: https://github.com/oven-sh/bun/issues/22452
Write-Host "Running tests sequentially (Windows workaround)..."
$failed = 0

$testFiles = Get-ChildItem -Path "tests" -Recurse -Filter "*.test.ts"
foreach ($testFile in $testFiles) {
    Write-Host "=== $($testFile.FullName) ==="
    $testArgs = @("test", $testFile.FullName) + $args_list
    & bun @testArgs
    if ($LASTEXITCODE -ne 0) {
        $failed = 1
    }
}

exit $failed
