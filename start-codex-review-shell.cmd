@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem cmd.exe reads a batch file while it runs it, and the WSL sync below
rem rewrites this file in the mirror, so a changed launcher used to run
rem garbled lines on its first launch. Run from a copy in %TEMP% instead (the
rem whole block is parsed before it runs, so its last lines are safe too).
if not defined CODEX_REVIEW_SHELL_LAUNCH_ROOT (
  set "CODEX_REVIEW_SHELL_LAUNCH_ROOT=%~dp0"
  set "LAUNCH_COPY=%TEMP%\codex-review-shell-launch-%RANDOM%%RANDOM%.cmd"
  copy /y "%~f0" "!LAUNCH_COPY!" >nul || exit /b 1
  call "!LAUNCH_COPY!" %*
  set "LAUNCH_RC=!ERRORLEVEL!"
  del "!LAUNCH_COPY!" >nul 2>nul
  exit /b !LAUNCH_RC!
)
set "ROOT_DIR=%CODEX_REVIEW_SHELL_LAUNCH_ROOT%"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

rem Started from the WSL checkout (\\wsl.localhost\...): cmd.exe can't use a
rem UNC working directory, and syncing or installing there would write Windows
rem packages into the WSL node_modules. Hand over to the Windows mirror.
if "%ROOT_DIR:~0,2%"=="\\" (
  set "MIRROR_ROOT=%CODEX_REVIEW_SHELL_WINDOWS_MIRROR%"
  if not defined MIRROR_ROOT set "MIRROR_ROOT=C:\LexLattice\codex-review-shell-direct"
  if exist "!MIRROR_ROOT!\start-codex-review-shell.cmd" (
    echo [Direct Shell] Started from a WSL path; launching the Windows mirror at !MIRROR_ROOT!
    set "CODEX_REVIEW_SHELL_LAUNCH_ROOT="
    call "!MIRROR_ROOT!\start-codex-review-shell.cmd"
    exit /b !ERRORLEVEL!
  )
  echo [Direct Shell] This launcher runs from a Windows folder, not from %ROOT_DIR%.
  echo [Direct Shell] Run it from the Windows mirror, or set CODEX_REVIEW_SHELL_WINDOWS_MIRROR.
  "%SystemRoot%\System32\timeout.exe" /t 30 >nul
  exit /b 1
)

set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\%USERNAME%\AppData\Roaming\npm;%PATH%"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO set "CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO=Ubuntu"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH set "CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH=/home/rose/work/LexLattice/codex-review-shell-direct"
if not defined CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME=%ROOT_DIR%\.codex-home"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME=/home/rose/.codex"
if not defined CODEX_DIRECT_OPENCODE_WSL_DISTRO set "CODEX_DIRECT_OPENCODE_WSL_DISTRO=%CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO%"
if not defined CODEX_DIRECT_OPENCODE_WSL_BIN set "CODEX_DIRECT_OPENCODE_WSL_BIN=/home/rose/.opencode/bin/opencode"

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
