#!/bin/sh
# Switchboard hook for Claude Code (Linux and macOS). Forwards one event to the
# local board. Never blocks Claude and never fails: if the board is not running,
# curl gives up at once and this still exits 0. The board itself notes which
# window was in front, so nothing platform-specific happens here.
curl -s -m 1 -o /dev/null -X POST "http://127.0.0.1:4747/hook/claude?event=$1&term=${SWITCHBOARD_TERM:-}" \
  -H 'Content-Type: application/json' -H 'X-Switchboard: 1' --data-binary @- 2>/dev/null
exit 0
