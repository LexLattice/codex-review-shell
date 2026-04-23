@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\%USERNAME%\AppData\Roaming\npm;%PATH%"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO set "CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO=Ubuntu"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH set "CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH=/home/rose/work/LexLattice/codex-review-shell"

set "LAUNCHER_STDOUT=%ROOT_DIR%\launcher-stdout.log"
set "LAUNCHER_STDERR=%ROOT_DIR%\launcher-stderr.log"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

type nul > "%LAUNCHER_STDOUT%"
type nul > "%LAUNCHER_STDERR%"

cd /d "%ROOT_DIR%"

call "%POWERSHELL%" -NoProfile -Command ^
  "$targets = Get-CimInstance Win32_Process | Where-Object { " ^
  "($_.Name -eq 'node.exe' -and $_.CommandLine -like '*scripts\\run-electron.mjs*' -and $_.CommandLine -like '*codex-review-shell*') -or " ^
  "($_.Name -eq 'electron.exe' -and $_.CommandLine -like '*codex-review-shell*')" ^
  "}; " ^
  "if ($targets) { $targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }" ^
  >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"

call "%ROOT_DIR%\sync-from-wsl.cmd" >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
if errorlevel 1 exit /b %ERRORLEVEL%

call node scripts\run-electron.mjs . >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
