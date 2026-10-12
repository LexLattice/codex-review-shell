@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Installs a release and switches the daily app to it (scripts/release-install.mjs):
rem   update-direct-workbench.cmd             the newest v* tag
rem   update-direct-workbench.cmd v0.5.1      that tag
rem   update-direct-workbench.cmd --previous  back to the version before
rem   update-direct-workbench.cmd --list      installed versions and tags

rem The installer rewrites this file while it runs: run from a copy in %TEMP%.
if not defined CODEX_REVIEW_SHELL_RELEASE_UPDATE_ROOT (
  set "CODEX_REVIEW_SHELL_RELEASE_UPDATE_ROOT=%~dp0"
  set "UPDATE_COPY=%TEMP%\codex-review-shell-release-update-%RANDOM%%RANDOM%.cmd"
  copy /y "%~f0" "!UPDATE_COPY!" >nul || exit /b 1
  call "!UPDATE_COPY!" %*
  set "UPDATE_RC=!ERRORLEVEL!"
  del "!UPDATE_COPY!" >nul 2>nul
  exit /b !UPDATE_RC!
)
set "ROOT_DIR=%CODEX_REVIEW_SHELL_RELEASE_UPDATE_ROOT%"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "CODEX_REVIEW_SHELL_RELEASE_ROOT=%ROOT_DIR%"
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO set "CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO=Ubuntu"
if not defined CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH set "CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH=/home/rose/work/LexLattice/codex-review-shell-direct"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"

rem The installer of the current version; before the first install, the one
rem in the WSL checkout.
set "CURRENT="
if exist "%ROOT_DIR%\current.txt" set /p CURRENT=<"%ROOT_DIR%\current.txt"
set "INSTALLER=%ROOT_DIR%\versions\%CURRENT%\scripts\release-install.mjs"
if not defined CURRENT set "INSTALLER="
if defined INSTALLER if not exist "!INSTALLER!" set "INSTALLER="
if not defined INSTALLER (
  set "WSL_WIN_PATH=%CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH:/=\%"
  set "INSTALLER=\\wsl.localhost\%CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO%!WSL_WIN_PATH!\scripts\release-install.mjs"
)

"%NODE_EXE%" "%INSTALLER%" %*
set "RC=%ERRORLEVEL%"
rem Keep the window readable when started from Explorer.
if not "%RC%"=="0" (
  echo.
  echo The update failed ^(code %RC%^); see the messages above.
  pause
)
exit /b %RC%
