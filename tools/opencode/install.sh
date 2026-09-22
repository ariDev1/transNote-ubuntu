#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

version="$(opencode_current_version)"
opencode_require_supported_major "$version"
opencode_require_cli

profile_source="$(opencode_profile_source)"
tool_source="$(opencode_tool_source)"
agent_dir="$(opencode_agent_dir)"
tool_dir="$(opencode_tool_dir)"
profile_dest="$(opencode_profile_dest)"
tool_dest="$(opencode_tool_dest)"

mkdir -p -- "$agent_dir" "$tool_dir"

if [[ -e "$profile_dest" ]] && ! cmp -s -- "$profile_source" "$profile_dest"; then
    printf '%s\n' "ERROR: refusing to replace existing foreign OpenCode agent: $profile_dest" >&2
    exit 1
fi

if [[ -e "$tool_dest" ]] && ! cmp -s -- "$tool_source" "$tool_dest"; then
    printf '%s\n' "ERROR: refusing to replace existing foreign OpenCode tool: $tool_dest" >&2
    exit 1
fi

if [[ ! -e "$profile_dest" ]]; then
    tmp_profile="$(mktemp "$agent_dir/.transnote.md.XXXXXX")"
    cp -- "$profile_source" "$tmp_profile"
    chmod 600 "$tmp_profile"
    mv -- "$tmp_profile" "$profile_dest"
fi

if [[ ! -e "$tool_dest" ]]; then
    tmp_tool="$(mktemp "$tool_dir/.transnote.ts.XXXXXX")"
    cp -- "$tool_source" "$tmp_tool"
    chmod 600 "$tmp_tool"
    mv -- "$tmp_tool" "$tool_dest"
fi

opencode_require_discovery

printf '%s\n' "installed profile: $profile_dest"
printf '%s\n' "installed tool   : $tool_dest"
printf '%s\n' "OpenCode version : $version"
printf '%s\n' "SECURITY_RETEST_REQUIRED"
printf '%s\n' "Run tools/opencode/security-test.txt with a tool-capable model."
printf '%s\n' "After PASS, run: tools/opencode/mark-tested.sh --accept-security-test"
