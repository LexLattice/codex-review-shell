@echo off
setlocal EnableExtensions

set "SYNC_ROOT=%~dp0"
if "%SYNC_ROOT:~-1%"=="\" set "SYNC_ROOT=%SYNC_ROOT:~0,-1%"
pushd "%SYNC_ROOT%" >nul

set "WSL_DISTRO=%CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO%"
if not defined WSL_DISTRO set "WSL_DISTRO=Ubuntu"

set "WSL_PATH=%CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH%"
if not defined WSL_PATH set "WSL_PATH=/home/rose/work/LexLattice/codex-review-shell-direct"

set "WSL_WIN_PATH=%WSL_PATH:/=\%"
set "WSL_ROOT=\\wsl.localhost\%WSL_DISTRO%%WSL_WIN_PATH%"
set "SYNC_STAMP=%SYNC_ROOT%\.wsl-sync-head.txt"

if not exist "%WSL_ROOT%\package.json" (
  >&2 echo WSL sync source not found: %WSL_ROOT%
  exit /b 1
)

call :read_wsl_head
call :mirror_repo || exit /b 1
> "%SYNC_STAMP%" echo %WSL_HEAD%
echo Synced WSL HEAD %WSL_HEAD% from %WSL_ROOT%

echo Ensuring Windows dependencies are current...
pushd "%SYNC_ROOT%" >nul
call npm.cmd install --no-fund --no-audit
set "INSTALL_RC=%ERRORLEVEL%"
popd >nul
if not "%INSTALL_RC%"=="0" exit /b %INSTALL_RC%

echo WSL sync complete from %WSL_ROOT%
exit /b 0

:read_wsl_head
set "WSL_HEAD=unknown"
set "WSL_HEAD_TMP=%TEMP%\codex-review-shell-wsl-head-%RANDOM%.txt"
C:\Windows\System32\wsl.exe -d "%WSL_DISTRO%" --cd "%WSL_PATH%" git rev-parse --short=12 HEAD > "%WSL_HEAD_TMP%" 2>nul
if exist "%WSL_HEAD_TMP%" set /p WSL_HEAD=<"%WSL_HEAD_TMP%"
if exist "%WSL_HEAD_TMP%" del "%WSL_HEAD_TMP%" >nul 2>nul
call :validate_wsl_head
if not "%WSL_HEAD%"=="unknown" exit /b 0
set "WSL_HEAD_LINE="
set "WSL_FULL_HEAD="
if exist "%WSL_ROOT%\.git\HEAD" set /p WSL_HEAD_LINE=<"%WSL_ROOT%\.git\HEAD"
if not defined WSL_HEAD_LINE exit /b 0
set "WSL_HEAD_PREFIX=%WSL_HEAD_LINE:~0,5%"
if not "%WSL_HEAD_PREFIX%"=="ref: " goto detached_head
set "WSL_HEAD_REF=%WSL_HEAD_LINE:~5%"
set "WSL_HEAD_REF=%WSL_HEAD_REF:/=\%"
if exist "%WSL_ROOT%\.git\%WSL_HEAD_REF%" set /p WSL_FULL_HEAD=<"%WSL_ROOT%\.git\%WSL_HEAD_REF%"
goto finish_wsl_head

:detached_head
set "WSL_FULL_HEAD=%WSL_HEAD_LINE%"

:finish_wsl_head
if defined WSL_FULL_HEAD set "WSL_HEAD=%WSL_FULL_HEAD:~0,12%"
call :validate_wsl_head
exit /b 0

:validate_wsl_head
if "%WSL_HEAD:~11,1%"=="" set "WSL_HEAD=unknown"
if not "%WSL_HEAD:~12,1%"=="" set "WSL_HEAD=%WSL_HEAD:~0,12%"
exit /b 0

:mirror_repo
robocopy "%WSL_ROOT%" "%SYNC_ROOT%" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP ^
  /XD ".git" "node_modules" ".cache" ".profiles" ".codex-home" ^
  /XF ".git" ".wsl-sync-head.txt" "launcher-stdout.log" "launcher-stderr.log" "launcher-wsl-stdout.log" "launcher-wsl-stderr.log" "start-debug.log" >nul
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  >&2 echo robocopy failed for repo mirror
  exit /b %RC%
)
exit /b 0
