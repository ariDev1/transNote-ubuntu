#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

version="$(opencode_basic_check)"
marker="$(opencode_tested_marker)"

tested=""
if [[ -f "$marker" ]]; then
    tested="$(head -n1 -- "$marker" | tr -d '[:space:]')"
fi

if [[ "$tested" != "$version" ]]; then
    printf '%s\n' "SECURITY_RETEST_REQUIRED"
    printf '%s\n' "tested_version=${tested:-none}"
    printf '%s\n' "current_version=$version"
    exit 4
fi

printf '%s\n' "OpenCode version: $version"
printf '%s\n' "tested version: $tested"
printf '%s\n' "COMPATIBILITY_CHECK: PASS"
