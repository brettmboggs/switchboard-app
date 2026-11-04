#!/bin/sh
# Switchboard status line for Claude Code (Linux and macOS). Claude Code runs
# this with the session's model, effort, context used and cost as JSON on
# stdin; this posts that to the local board, which shows it on the session's
# bar, and prints nothing. Never blocks Claude and never fails: if the board is
# not running, curl gives up at once and this still exits 0.
# Have a status line of your own? Keep it and chain this one; see hooks() in
# scripts/setup.mjs.
curl -s -m 1 -o /dev/null -X POST "http://127.0.0.1:4747/hook/claude/status?term=${SWITCHBOARD_TERM:-}" \
  -H 'Content-Type: application/json' -H 'X-Switchboard: 1' --data-binary @- 2>/dev/null
exit 0
