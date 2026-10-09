@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "CODEX_EXPERIENCE=world-manager-studio"
set "CODEX_DIRECT_T3_GUI="
set "CODEX_WORLD_MANAGER="
set "CODEX_WORLD_MANAGER_MOCKUP="

rem One line: the launcher sync may rewrite this file while it runs, and
rem cmd.exe would read the rest of it from the changed file.
call "%~dp0start-codex-review-shell.cmd" & exit /b !ERRORLEVEL!
