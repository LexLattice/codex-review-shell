Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & scriptDir & "\start-codex-review-shell-wsl.cmd" & Chr(34), 0, False
