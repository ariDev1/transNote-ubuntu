#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != "--accept-security-test" || $# -ne 1 ]]; then
    printf '%s\n' "Usage: $0 --accept-security-test" >&2
    printf '%s\n' \
        "Use this only after the restricted-agent security acceptance test passes." >&2
    exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

version="$(opencode_basic_check)"
marker="$(opencode_tested_marker)"
agent_dir="$(opencode_agent_dir)"

mkdir -p -- "$agent_dir"

tmp="$(mktemp "$agent_dir/.transnote-tested-version.XXXXXX")"
trap 'rm -f -- "$tmp"' EXIT

printf '%s\n' "$version" > "$tmp"
chmod 600 "$tmp"
mv -- "$tmp" "$marker"
trap - EXIT

printf '%s\n' "recorded tested OpenCode version: $version"
