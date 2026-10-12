@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem This script mirrors itself from WSL while running; cmd.exe reads batch
rem files as it goes, so run from a copy in %TEMP% (see the launcher).
if not defined CODEX_REVIEW_SHELL_SYNC_ROOT_DIR (
  set "CODEX_REVIEW_SHELL_SYNC_ROOT_DIR=%~dp0"
  set "SYNC_COPY=%TEMP%\codex-review-shell-sync-%RANDOM%%RANDOM%.cmd"
  copy /y "%~f0" "!SYNC_COPY!" >nul || exit /b 1
  call "!SYNC_COPY!" %*
  set "SYNC_COPY_RC=!ERRORLEVEL!"
  del "!SYNC_COPY!" >nul 2>nul
  exit /b !SYNC_COPY_RC!
)
set "SYNC_ROOT=%CODEX_REVIEW_SHELL_SYNC_ROOT_DIR%"
if "%SYNC_ROOT:~-1%"=="\" set "SYNC_ROOT=%SYNC_ROOT:~0,-1%"
if "%SYNC_ROOT:~0,2%"=="\\" (
  >&2 echo Refusing to sync into %SYNC_ROOT%: the sync target must be a Windows folder, not the WSL checkout.
  exit /b 1
)
pushd "%SYNC_ROOT%" >nul

set "WSL_DISTRO=%CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO%"
if not defined WSL_DISTRO set "WSL_DISTRO=Ubuntu"

set "WSL_PATH=%CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH%"
if not defined WSL_PATH set "WSL_PATH=/home/rose/work/LexLattice/codex-review-shell-direct"

set "WSL_WIN_PATH=%WSL_PATH:/=\%"
set "WSL_ROOT=\\wsl.localhost\%WSL_DISTRO%%WSL_WIN_PATH%"
set "SYNC_STAMP=%SYNC_ROOT%\.wsl-sync-head.txt"
rem Changes whenever this sync changes the mirror's files or dependencies;
rem a running app compares it with the one it started on (scripts/app-control.mjs).
set "SYNC_GENERATION=%SYNC_ROOT%\.sync-generation.txt"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"

if not exist "%WSL_ROOT%\package.json" (
  >&2 echo WSL sync source not found: %WSL_ROOT%
  exit /b 1
)

rem /check: copy nothing; exit 0 when the mirror matches WSL, 1 when not.
if /i "%~1"=="/check" (
  call :mirror_repo /L
  if !RC! GEQ 8 exit /b 1
  exit /b !MIRROR_CHANGED!
)

call :read_wsl_head
call :report "Mirroring changed source files from WSL"
call :mirror_repo || exit /b 1
if "%MIRROR_CHANGED%"=="1" call :new_generation
if not exist "%SYNC_GENERATION%" call :new_generation
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
  if "!INSTALL_RC!"=="0" call :new_generation
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
"%SystemRoot%\System32\fc.exe" /b "%SYNC_ROOT%\package-lock.json" "%DEPENDENCY_STAMP_DIR%\package-lock.json" >nul 2>nul
if errorlevel 1 call :dependency_install_required "package-lock.json changed"
if "!DEPENDENCIES_NEED_INSTALL!"=="1" exit /b 0
"%SystemRoot%\System32\fc.exe" /b "%SYNC_ROOT%\package.json" "%DEPENDENCY_STAMP_DIR%\package.json" >nul 2>nul
if not errorlevel 1 exit /b 0
call :package_json_dependencies_changed
exit /b 0

rem Most package.json edits here add a script, which npm install doesn't
rem need (it took up to 12 s of the launch). Only the fields install reads
rem count; without Node, any change does.
:package_json_dependencies_changed
set "SYNC_NODE=C:\Program Files\nodejs\node.exe"
set "DEPENDENCY_FIELDS_JS=const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const s=p.scripts||{};process.stdout.write(JSON.stringify([p.dependencies,p.devDependencies,p.optionalDependencies,p.peerDependencies,p.overrides,p.workspaces,p.packageManager,s.preinstall,s.install,s.postinstall,s.prepare]))"
set "DEPS_NOW=%TEMP%\codex-review-shell-deps-now-%RANDOM%%RANDOM%.json"
set "DEPS_STAMPED=%TEMP%\codex-review-shell-deps-stamped-%RANDOM%%RANDOM%.json"
set "DEPS_COMPARED=0"
if exist "%SYNC_NODE%" (
  "%SYNC_NODE%" -e "%DEPENDENCY_FIELDS_JS%" "%SYNC_ROOT%\package.json" > "%DEPS_NOW%" 2>nul && "%SYNC_NODE%" -e "%DEPENDENCY_FIELDS_JS%" "%DEPENDENCY_STAMP_DIR%\package.json" > "%DEPS_STAMPED%" 2>nul && set "DEPS_COMPARED=1"
)
set "DEPS_SAME=0"
if "%DEPS_COMPARED%"=="1" (
  "%SystemRoot%\System32\fc.exe" /b "%DEPS_NOW%" "%DEPS_STAMPED%" >nul 2>nul
  if not errorlevel 1 set "DEPS_SAME=1"
)
if exist "%DEPS_NOW%" del "%DEPS_NOW%" >nul 2>nul
if exist "%DEPS_STAMPED%" del "%DEPS_STAMPED%" >nul 2>nul
if "%DEPS_SAME%"=="1" (
  rem Installed for the same dependencies: stamp this package.json so the
  rem next launch's byte compare matches again.
  copy /y "%SYNC_ROOT%\package.json" "%DEPENDENCY_STAMP_DIR%\package.json" >nul
  exit /b 0
)
call :dependency_install_required "package.json dependencies changed"
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

:new_generation
> "%SYNC_GENERATION%" echo %DATE% %TIME% %RANDOM%%RANDOM%
exit /b 0

rem %1: /L to only list the differences. Sets MIRROR_CHANGED (1 or 0).
rem Robocopy's exit code can't tell whether anything differed: it counts the
rem mirror's own stamp files (excluded from the copy) as extras. Its file
rem list can: empty when the mirror matched.
:mirror_repo
set "MIRROR_OUT=%TEMP%\codex-review-shell-mirror-%RANDOM%%RANDOM%.txt"
"%SystemRoot%\System32\robocopy.exe" "%WSL_ROOT%" "%SYNC_ROOT%" /MIR %1 /R:1 /W:1 /NDL /NJH /NJS /NP ^
  /XD ".git" "node_modules" ".cache" ".profiles" ".codex-home" "logs" ^
  /XF ".git" ".wsl-sync-head.txt" ".sync-generation.txt" "launcher-stdout.log" "launcher-stderr.log" "launcher-latest.txt" "launcher-wsl-stdout.log" "launcher-wsl-stderr.log" "start-debug.log" > "%MIRROR_OUT%"
set "RC=%ERRORLEVEL%"
set "MIRROR_CHANGED=1"
"%SystemRoot%\System32\findstr.exe" /r "[a-zA-Z0-9]" "%MIRROR_OUT%" >nul 2>nul
if errorlevel 1 set "MIRROR_CHANGED=0"
del "%MIRROR_OUT%" >nul 2>nul
if "%~1"=="/L" exit /b 0
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
