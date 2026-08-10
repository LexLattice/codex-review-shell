@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\%USERNAME%\AppData\Roaming\npm;%PATH%"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO set "CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO=Ubuntu"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH set "CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH=/home/rose/work/LexLattice/codex-review-shell"
if not defined CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME=%ROOT_DIR%\.codex-home"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME=/home/rose/.codex"

set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
for /f %%T in ('powershell.exe -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss-fff"') do set "LAUNCH_ID=%%T"
if not defined LAUNCH_ID set "LAUNCH_ID=unknown-%RANDOM%"
set "LAUNCHER_LOG_DIR=%LOCALAPPDATA%\codex-review-shell-direct\launcher-logs"
if not exist "%LAUNCHER_LOG_DIR%" mkdir "%LAUNCHER_LOG_DIR%" >nul 2>nul
set "LAUNCHER_STDOUT=%LAUNCHER_LOG_DIR%\launcher-%LAUNCH_ID%.stdout.log"
set "LAUNCHER_STDERR=%LAUNCHER_LOG_DIR%\launcher-%LAUNCH_ID%.stderr.log"
set "CODEX_REVIEW_SHELL_SYNC_STDOUT=%LAUNCHER_STDOUT%"
set "CODEX_REVIEW_SHELL_SYNC_STDERR=%LAUNCHER_STDERR%"

type nul > "%LAUNCHER_STDOUT%"
type nul > "%LAUNCHER_STDERR%"
> "%ROOT_DIR%\launcher-latest.txt" echo stdout=%LAUNCHER_STDOUT%
>> "%ROOT_DIR%\launcher-latest.txt" echo stderr=%LAUNCHER_STDERR%

cd /d "%ROOT_DIR%"

echo Launch started %DATE% %TIME% >> "%LAUNCHER_STDOUT%"
echo Root: %ROOT_DIR% >> "%LAUNCHER_STDOUT%"
echo WSL distro: %CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO% >> "%LAUNCHER_STDOUT%"
echo WSL path: %CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH% >> "%LAUNCHER_STDOUT%"
call :stage "Stopping an earlier Direct Shell instance, if present"

set "KILL_SCRIPT=%TEMP%\codex-review-shell-kill-%RANDOM%.ps1"
> "%KILL_SCRIPT%" echo $targets = Get-CimInstance Win32_Process ^| Where-Object {
>> "%KILL_SCRIPT%" echo   ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*scripts\run-electron.mjs*' -and $_.CommandLine -like '*codex-review-shell*') -or
>> "%KILL_SCRIPT%" echo   ($_.Name -eq 'electron.exe' -and $_.CommandLine -like '*codex-review-shell*')
>> "%KILL_SCRIPT%" echo }
>> "%KILL_SCRIPT%" echo if ($targets) { $targets ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
call "%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%KILL_SCRIPT%" >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
if exist "%KILL_SCRIPT%" del "%KILL_SCRIPT%" >nul 2>nul

call :stage "Synchronizing the WSL worktree"
call "%ROOT_DIR%\sync-from-wsl.cmd"
if errorlevel 1 (
  set "SYNC_RC=!ERRORLEVEL!"
  call :stage "Synchronization failed; see the launch log"
  exit /b !SYNC_RC!
)

if exist "%ROOT_DIR%\src\renderer\app.js" (
  for %%F in ("%ROOT_DIR%\src\renderer\app.js") do echo Renderer app.js: %%~zF bytes, modified %%~tF >> "%LAUNCHER_STDOUT%"
)
if exist "%ROOT_DIR%\src\renderer\styles.css" (
  for %%F in ("%ROOT_DIR%\src\renderer\styles.css") do echo Renderer styles.css: %%~zF bytes, modified %%~tF >> "%LAUNCHER_STDOUT%"
)

call :stage "Starting Windows Electron"
if not exist "%NODE_EXE%" (
  call :stage "Windows Node.js was not found at %NODE_EXE%"
  exit /b 1
)
call "%NODE_EXE%" scripts\run-electron.mjs . >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
set "APP_RC=%ERRORLEVEL%"
call :stage "Windows Electron exited with code %APP_RC%"
exit /b %APP_RC%

:stage
echo [Direct Shell] %~1
echo [%DATE% %TIME%] %~1 >> "%LAUNCHER_STDOUT%"
exit /b 0
