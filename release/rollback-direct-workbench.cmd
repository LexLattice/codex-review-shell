@echo off
rem Switches the daily app back to the version installed before the current one.
call "%~dp0update-direct-workbench.cmd" --previous %* & exit /b
