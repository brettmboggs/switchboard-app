@echo off
rem Switchboard status line for Claude Code on Windows. Same as statusline.sh, using the curl.exe built into Windows 10 and 11: posts the JSON Claude Code feeds it to the board and prints nothing.
curl.exe -s -m 1 -o NUL -X POST "http://127.0.0.1:4747/hook/claude/status?term=%SWITCHBOARD_TERM%" -H "Content-Type: application/json" -H "X-Switchboard: 1" --data-binary @- 2>NUL
exit /b 0
