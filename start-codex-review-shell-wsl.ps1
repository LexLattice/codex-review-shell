$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$wslDistro = $env:CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO
if ([string]::IsNullOrWhiteSpace($wslDistro)) {
  $wslDistro = "Ubuntu"
}

$wslPath = $env:CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH
if ([string]::IsNullOrWhiteSpace($wslPath)) {
  $wslPath = "/home/rose/work/LexLattice/codex-review-shell-direct"
}

if ([string]::IsNullOrWhiteSpace($env:CODEX_REVIEW_SHELL_PROFILE)) {
  $env:CODEX_REVIEW_SHELL_PROFILE = "direct"
}
if ([string]::IsNullOrWhiteSpace($env:CODEX_REVIEW_SHELL_USER_DATA_ROOT)) {
  $env:CODEX_REVIEW_SHELL_USER_DATA_ROOT = "$wslPath/.profiles"
}
if ([string]::IsNullOrWhiteSpace($env:CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME)) {
  $env:CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME = "$wslPath/.codex-home"
}
if ([string]::IsNullOrWhiteSpace($env:CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME)) {
  $env:CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME = "$wslPath/.codex-home"
}

$stdoutPath = Join-Path $repoRoot "launcher-wsl-stdout.log"
$stderrPath = Join-Path $repoRoot "launcher-wsl-stderr.log"

Set-Content -Path $stdoutPath -Value $null
Set-Content -Path $stderrPath -Value $null

$bashParts = @()
if (-not [string]::IsNullOrWhiteSpace($env:CODEX_REVIEW_SHELL_SMOKE_EXIT_MS)) {
  $bashParts += "export CODEX_REVIEW_SHELL_SMOKE_EXIT_MS='$($env:CODEX_REVIEW_SHELL_SMOKE_EXIT_MS)'"
}
$bashParts += "export CODEX_REVIEW_SHELL_PROFILE='$($env:CODEX_REVIEW_SHELL_PROFILE)'"
$bashParts += "export CODEX_REVIEW_SHELL_USER_DATA_ROOT='$($env:CODEX_REVIEW_SHELL_USER_DATA_ROOT)'"
$bashParts += "export CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME='$($env:CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME)'"
$bashParts += "export CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME='$($env:CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME)'"
$bashParts += "cd '$wslPath'"
$bashParts += "npm run dev:wsl"
$bashCommand = [string]::Join("; ", $bashParts)

& "C:\Windows\System32\wsl.exe" -d $wslDistro bash -lc $bashCommand 1>> $stdoutPath 2>> $stderrPath
exit $LASTEXITCODE
