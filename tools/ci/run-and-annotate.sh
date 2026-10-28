#!/usr/bin/env bash
# Runs a command, mirrors its output, and on failure attaches the error lines
# (or the tail of the output) to the workflow run as an annotation, so the
# failure is readable from the run summary and the checks API.
set -uo pipefail
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
    excerpt="$(grep -n -i -E 'error|✘|failed|cannot find|not found' "$log" | grep -v -i 'warning' | head -n 60)"
    [ -z "$excerpt" ] && excerpt="$(tail -n 60 "$log")"
    excerpt="${excerpt//'%'/'%25'}"
    excerpt="${excerpt//$'\r'/}"
    excerpt="${excerpt//$'\n'/'%0A'}"
    echo "::error title=$1 failed::${excerpt:0:60000}"
fi
rm -f "$log"
exit "$status"
