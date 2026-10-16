@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem The daily Direct Workbench: starts the installed version current.txt
rem names, or brings it to the front when it already runs. It never changes
rem the installed code; update-direct-workbench.cmd does (scripts/release-install.mjs
rem copies this file into the release root).

rem An update rewrites this file while an app it started still runs, and
rem cmd.exe reads a batch file as it goes: run from a copy in %TEMP%.
if not defined CODEX_REVIEW_SHELL_RELEASE_LAUNCH_ROOT (
  set "CODEX_REVIEW_SHELL_RELEASE_LAUNCH_ROOT=%~dp0"
  set "LAUNCH_COPY=%TEMP%\codex-review-shell-release-launch-%RANDOM%%RANDOM%.cmd"
  copy /y "%~f0" "!LAUNCH_COPY!" >nul || exit /b 1
  call "!LAUNCH_COPY!" %*
  set "LAUNCH_RC=!ERRORLEVEL!"
  del "!LAUNCH_COPY!" >nul 2>nul
  exit /b !LAUNCH_RC!
)
set "ROOT_DIR=%CODEX_REVIEW_SHELL_RELEASE_LAUNCH_ROOT%"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "CODEX_EXPERIENCE=direct-workbench"
set "CODEX_DIRECT_T3_GUI="
set "CODEX_WORLD_MANAGER="
set "CODEX_WORLD_MANAGER_MOCKUP="
rem Every installed version answers on one control channel (src/main/app-control.js).
set "CODEX_REVIEW_SHELL_CONTROL_ROOT=%ROOT_DIR%"

set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\%USERNAME%\AppData\Roaming\npm;%PATH%"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO set "CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO=Ubuntu"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH set "CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH=/home/rose/work/LexLattice/codex-review-shell-direct"
if not defined CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME=%ROOT_DIR%\.codex-home"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME set "CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME=/home/rose/.codex"
if not defined CODEX_DIRECT_OPENCODE_WSL_DISTRO set "CODEX_DIRECT_OPENCODE_WSL_DISTRO=%CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO%"
if not defined CODEX_DIRECT_OPENCODE_WSL_BIN set "CODEX_DIRECT_OPENCODE_WSL_BIN=/home/rose/.opencode/bin/opencode"
rem The development mirror runs on the same profile; one profile runs one app.
set "MIRROR_ROOT=%CODEX_REVIEW_SHELL_WINDOWS_MIRROR%"
if not defined MIRROR_ROOT set "MIRROR_ROOT=C:\LexLattice\codex-review-shell-direct"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "LAUNCH_ID=%DATE%_%TIME%"
set "LAUNCH_ID=!LAUNCH_ID:/=-!"
set "LAUNCH_ID=!LAUNCH_ID::=-!"
set "LAUNCH_ID=!LAUNCH_ID:.=-!"
set "LAUNCH_ID=!LAUNCH_ID:,=-!"
set "LAUNCH_ID=!LAUNCH_ID: =0!"
set "LAUNCH_ID=!LAUNCH_ID!-%RANDOM%"
set "LAUNCHER_LOG_DIR=%LOCALAPPDATA%\codex-review-shell-direct\launcher-logs"
if not exist "%LAUNCHER_LOG_DIR%" mkdir "%LAUNCHER_LOG_DIR%" >nul 2>nul
set "LAUNCHER_STDOUT=%LAUNCHER_LOG_DIR%\release-%LAUNCH_ID%.stdout.log"
set "LAUNCHER_STDERR=%LAUNCHER_LOG_DIR%\release-%LAUNCH_ID%.stderr.log"
type nul > "%LAUNCHER_STDOUT%"
type nul > "%LAUNCHER_STDERR%"
> "%ROOT_DIR%\launcher-latest.txt" echo stdout=%LAUNCHER_STDOUT%
>> "%ROOT_DIR%\launcher-latest.txt" echo stderr=%LAUNCHER_STDERR%

set "CURRENT="
if exist "%ROOT_DIR%\current.txt" set /p CURRENT=<"%ROOT_DIR%\current.txt"
if not defined CURRENT (
  call :stage "No version is installed in %ROOT_DIR%; run update-direct-workbench.cmd"
  "%SystemRoot%\System32\timeout.exe" /t 30 >nul
  exit /b 1
)
set "VERSION_DIR=%ROOT_DIR%\versions\%CURRENT%"
set "ELECTRON_EXE=%VERSION_DIR%\node_modules\electron\dist\electron.exe"
echo Launch started %DATE% %TIME% >> "%LAUNCHER_STDOUT%"
echo Release root: %ROOT_DIR% >> "%LAUNCHER_STDOUT%"
echo Version: %CURRENT% >> "%LAUNCHER_STDOUT%"
if not exist "%ELECTRON_EXE%" (
  call :stage "Version %CURRENT% is incomplete (no %ELECTRON_EXE%); run update-direct-workbench.cmd %CURRENT% --force"
  "%SystemRoot%\System32\timeout.exe" /t 30 >nul
  exit /b 1
)
cd /d "%VERSION_DIR%"

rem Keeps a running app on the current version; one on another version, or
rem one from the mirror, quits first.
set "REUSE_RC=10"
if exist "%NODE_EXE%" (
  "%NODE_EXE%" "%VERSION_DIR%\scripts\app-control.mjs" reuse --retire-root "%MIRROR_ROOT%" >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
  set "REUSE_RC=!ERRORLEVEL!"
)
set "ELECTRON_RUN_AS_NODE="
if "!REUSE_RC!"=="0" (
  rem One more launch: it finds the app running, hands it the right to take
  rem the foreground, and quits (src/boot.js).
  "%ELECTRON_EXE%" . >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
  call :stage "Direct Workbench %CURRENT% is already running; brought it to the front"
  exit /b 0
)
rem An unanswered profile channel is not evidence that another profile's
rem app is hung. Electron's profile lock handles an existing instance; only
rem app-control may stop a PID that answered this profile's channel.

call :stage "Starting Direct Workbench %CURRENT%"
"%ELECTRON_EXE%" . >> "%LAUNCHER_STDOUT%" 2>> "%LAUNCHER_STDERR%"
set "APP_RC=%ERRORLEVEL%"
call :stage "Direct Workbench exited with code %APP_RC%"
exit /b %APP_RC%

:stage
echo [Direct Workbench] %~1
echo [%DATE% %TIME%] %~1 >> "%LAUNCHER_STDOUT%"
exit /b 0
