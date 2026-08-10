@echo off
setlocal EnableExtensions

set "CODEX_EXPERIENCE=direct-workbench"
set "CODEX_DIRECT_T3_GUI="
set "CODEX_WORLD_MANAGER="
set "CODEX_WORLD_MANAGER_MOCKUP="

call "%~dp0start-codex-review-shell.cmd"
exit /b %ERRORLEVEL%
