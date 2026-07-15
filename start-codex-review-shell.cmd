@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\%USERNAME%\AppData\Roaming\npm;%PATH%"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO set "CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO=Ubuntu"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH set "CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH=/home/rose/work/LexLattice/codex-review-shell-direct"
if not defined CODEX_REVIEW_SHELL_USER_DATA_DIR set "CODEX_REVIEW_SHELL_USER_DATA_DIR=%APPDATA%\codex-review-shell-direct"
if not defined CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME=%ROOT_DIR%\.codex-home"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME=/home/rose/.codex"

set "LAUNCHER_STDOUT=%ROOT_DIR%\launcher-stdout.log"
set "LAUNCHER_STDERR=%ROOT_DIR%\launcher-stderr.log"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

type nul > "%LAUNCHER_STDOUT%"
type nul > "%LAUNCHER_STDERR%"

cd /d "%ROOT_DIR%"

echo Launch started %DATE% %TIME% >> "%LAUNCHER_STDOUT%"
echo Root: %ROOT_DIR% >> "%LAUNCHER_STDOUT%"
echo WSL distro: %CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO% >> "%LAUNCHER_STDOUT%"
echo WSL path: %CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH% >> "%LAUNCHER_STDOUT%"

set "KILL_SCRIPT=%TEMP%\codex-review-shell-direct-kill-%RANDOM%.ps1"
> "%KILL_SCRIPT%" echo $targets = Get-CimInstance Win32_Process ^| Where-Object {
>> "%KILL_SCRIPT%" echo   ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*scripts\run-electron.mjs*' -and $_.CommandLine -like '*codex-review-shell-direct*') -or
>> "%KILL_SCRIPT%" echo   ($_.Name -eq 'electron.exe' -and $_.CommandLine -like '*codex-review-shell-direct*')
>> "%KILL_SCRIPT%" echo }
>> "%KILL_SCRIPT%" echo if ($targets) { $targets ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
call "%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%KILL_SCRIPT%" >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
if exist "%KILL_SCRIPT%" del "%KILL_SCRIPT%" >nul 2>nul

echo Existing WSL Codex app-server processes before launch: >> "%LAUNCHER_STDOUT%"
"%SystemRoot%\System32\wsl.exe" -d "%CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO%" -- bash -lc "pgrep -af 'codex app-server --listen ws://127[.]0[.]0[.]1:' || true" >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"

call "%ROOT_DIR%\sync-from-wsl.cmd" >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
if errorlevel 1 exit /b %ERRORLEVEL%

if exist "%ROOT_DIR%\src\renderer\app.js" (
  for %%F in ("%ROOT_DIR%\src\renderer\app.js") do echo Renderer app.js: %%~zF bytes, modified %%~tF >> "%LAUNCHER_STDOUT%"
)
if exist "%ROOT_DIR%\src\renderer\styles.css" (
  for %%F in ("%ROOT_DIR%\src\renderer\styles.css") do echo Renderer styles.css: %%~zF bytes, modified %%~tF >> "%LAUNCHER_STDOUT%"
)

call node scripts\run-electron.mjs . >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
