#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

profile_source="$(opencode_profile_source)"
tool_source="$(opencode_tool_source)"
profile_dest="$(opencode_profile_dest)"
tool_dest="$(opencode_tool_dest)"
marker="$(opencode_tested_marker)"

if [[ -e "$profile_dest" ]] && ! cmp -s -- "$profile_source" "$profile_dest"; then
    printf '%s\n' "ERROR: refusing to remove foreign OpenCode agent: $profile_dest" >&2
    exit 1
fi

if [[ -e "$tool_dest" ]] && ! cmp -s -- "$tool_source" "$tool_dest"; then
    printf '%s\n' "ERROR: refusing to remove foreign OpenCode tool: $tool_dest" >&2
    exit 1
fi

rm -f -- "$profile_dest" "$tool_dest" "$marker"

printf '%s\n' "TransNote OpenCode adapter removed"
