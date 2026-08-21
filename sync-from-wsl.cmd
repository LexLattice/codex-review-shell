@echo off
setlocal EnableExtensions EnableDelayedExpansion

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
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"

if not exist "%WSL_ROOT%\package.json" (
  >&2 echo WSL sync source not found: %WSL_ROOT%
  exit /b 1
)

call :read_wsl_head
call :report "Mirroring changed source files from WSL"
call :mirror_repo || exit /b 1
> "%SYNC_STAMP%" echo %WSL_HEAD%
call :report "Mirrored WSL HEAD %WSL_HEAD% from %WSL_ROOT%"

call :dependencies_need_install
if "%DEPENDENCIES_NEED_INSTALL%"=="0" (
  call :report "Windows dependencies unchanged; npm install skipped"
) else (
  call :report "Running npm install because !DEPENDENCY_INSTALL_REASON!"
  if not exist "%NPM_CMD%" (
    call :error "Windows npm was not found at %NPM_CMD%"
    exit /b 1
  )
  pushd "%SYNC_ROOT%" >nul
  if defined CODEX_REVIEW_SHELL_SYNC_STDOUT (
    call "%NPM_CMD%" install --no-fund --no-audit >> "%CODEX_REVIEW_SHELL_SYNC_STDOUT%" 2>> "%CODEX_REVIEW_SHELL_SYNC_STDERR%"
  ) else (
    call "%NPM_CMD%" install --no-fund --no-audit
  )
  set "INSTALL_RC=!ERRORLEVEL!"
  if "!INSTALL_RC!"=="0" call :record_dependency_inputs
  popd >nul
  if not "!INSTALL_RC!"=="0" exit /b !INSTALL_RC!
)

call :report "WSL synchronization complete"
exit /b 0

:dependencies_need_install
set "DEPENDENCIES_NEED_INSTALL=0"
set "DEPENDENCY_INSTALL_REASON=dependency inputs changed"
set "DEPENDENCY_STAMP_DIR=%SYNC_ROOT%\node_modules\.codex-review-shell-install"
if not exist "%SYNC_ROOT%\node_modules\.package-lock.json" call :dependency_install_required "node_modules package lock is missing"
if not exist "%SYNC_ROOT%\node_modules\electron\dist\electron.exe" call :dependency_install_required "Windows Electron is missing"
if not exist "%DEPENDENCY_STAMP_DIR%\package.json" call :dependency_install_required "package.json install stamp is missing"
if not exist "%DEPENDENCY_STAMP_DIR%\package-lock.json" call :dependency_install_required "package-lock.json install stamp is missing"
if "!DEPENDENCIES_NEED_INSTALL!"=="1" exit /b 0
"%SystemRoot%\System32\fc.exe" /b "%SYNC_ROOT%\package.json" "%DEPENDENCY_STAMP_DIR%\package.json" >nul 2>nul
if errorlevel 1 call :dependency_install_required "package.json changed"
"%SystemRoot%\System32\fc.exe" /b "%SYNC_ROOT%\package-lock.json" "%DEPENDENCY_STAMP_DIR%\package-lock.json" >nul 2>nul
if errorlevel 1 call :dependency_install_required "package-lock.json changed"
exit /b 0

:dependency_install_required
set "DEPENDENCIES_NEED_INSTALL=1"
set "DEPENDENCY_INSTALL_REASON=%~1"
exit /b 0

:record_dependency_inputs
if not exist "%DEPENDENCY_STAMP_DIR%" mkdir "%DEPENDENCY_STAMP_DIR%" >nul 2>nul
copy /y "%SYNC_ROOT%\package.json" "%DEPENDENCY_STAMP_DIR%\package.json" >nul
copy /y "%SYNC_ROOT%\package-lock.json" "%DEPENDENCY_STAMP_DIR%\package-lock.json" >nul
exit /b 0

:read_wsl_head
set "WSL_HEAD=unknown"
set "WINDOWS_GIT=C:\Program Files\Git\cmd\git.exe"
set "WSL_HEAD_TMP=%TEMP%\codex-review-shell-wsl-head-%RANDOM%.txt"
if exist "%WINDOWS_GIT%" "%WINDOWS_GIT%" -c safe.directory="%WSL_ROOT%" -C "%WSL_ROOT%" rev-parse --short=12 HEAD > "%WSL_HEAD_TMP%" 2>nul
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
"%SystemRoot%\System32\robocopy.exe" "%WSL_ROOT%" "%SYNC_ROOT%" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP ^
  /XD ".git" "node_modules" ".cache" ".profiles" ".codex-home" "logs" ^
  /XF ".git" ".wsl-sync-head.txt" "launcher-stdout.log" "launcher-stderr.log" "launcher-latest.txt" "launcher-wsl-stdout.log" "launcher-wsl-stderr.log" "start-debug.log" >nul
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  call :error "robocopy failed for repo mirror with code %RC%"
  exit /b %RC%
)
exit /b 0

:report
echo [Direct Shell] %~1
if defined CODEX_REVIEW_SHELL_SYNC_STDOUT echo [%DATE% %TIME%] %~1 >> "%CODEX_REVIEW_SHELL_SYNC_STDOUT%"
exit /b 0

:error
>&2 echo [Direct Shell] %~1
if defined CODEX_REVIEW_SHELL_SYNC_STDERR echo [%DATE% %TIME%] %~1 >> "%CODEX_REVIEW_SHELL_SYNC_STDERR%"
exit /b 0
