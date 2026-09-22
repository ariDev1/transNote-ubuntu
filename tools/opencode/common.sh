#!/usr/bin/env bash

OPENCODE_ADAPTER_MAJOR=1
OPENCODE_AGENT_NAME="transnote"

opencode_adapter_dir() {
    cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd
}

opencode_profile_source() {
    printf '%s/agent-v1.md\n' "$(opencode_adapter_dir)"
}

opencode_tool_source() {
    printf '%s/transnote.ts\n' "$(opencode_adapter_dir)"
}

opencode_agent_dir() {
    printf '%s/.config/opencode/agents\n' "${HOME:?HOME is required}"
}

opencode_tool_dir() {
    printf '%s/.config/opencode/tools\n' "${HOME:?HOME is required}"
}

opencode_profile_dest() {
    printf '%s/%s.md\n' "$(opencode_agent_dir)" "$OPENCODE_AGENT_NAME"
}

opencode_tool_dest() {
    printf '%s/transnote.ts\n' "$(opencode_tool_dir)"
}

opencode_tested_marker() {
    printf '%s/.transnote-tested-version\n' "$(opencode_agent_dir)"
}

transnote_agent_cli() {
    printf '%s/.local/bin/transnote-agent\n' "${HOME:?HOME is required}"
}

opencode_current_version() {
    command -v opencode >/dev/null 2>&1 || {
        printf '%s\n' "OPENCODE_NOT_FOUND" >&2
        return 3
    }

    local version
    version="$(opencode --version 2>/dev/null | head -n1 | tr -d '[:space:]')"

    if [[ -z "$version" ]]; then
        printf '%s\n' "OPENCODE_VERSION_UNREADABLE" >&2
        return 3
    fi

    printf '%s\n' "$version"
}

opencode_require_supported_major() {
    local version="$1"
    local major="${version%%.*}"

    if [[ "$major" != "$OPENCODE_ADAPTER_MAJOR" ]]; then
        printf '%s\n' \
            "UNSUPPORTED_OPENCODE_MAJOR: version=$version supported_major=$OPENCODE_ADAPTER_MAJOR" >&2
        return 5
    fi
}

opencode_require_cli() {
    local cli
    cli="$(transnote_agent_cli)"

    if [[ ! -x "$cli" ]]; then
        printf '%s\n' "TRANSNOTE_AGENT_NOT_FOUND" >&2
        return 3
    fi

    "$cli" status >/dev/null 2>&1 || {
        printf '%s\n' "TRANSNOTE_AGENT_UNAVAILABLE" >&2
        return 3
    }
}

opencode_require_installed_adapter() {
    local profile_source profile_dest tool_source tool_dest
    profile_source="$(opencode_profile_source)"
    profile_dest="$(opencode_profile_dest)"
    tool_source="$(opencode_tool_source)"
    tool_dest="$(opencode_tool_dest)"

    if [[ ! -f "$profile_dest" ]]; then
        printf '%s\n' "OPENCODE_TRANSNOTE_PROFILE_NOT_INSTALLED" >&2
        return 3
    fi

    if ! cmp -s -- "$profile_source" "$profile_dest"; then
        printf '%s\n' "OPENCODE_TRANSNOTE_PROFILE_MISMATCH" >&2
        return 3
    fi

    if [[ ! -f "$tool_dest" ]]; then
        printf '%s\n' "OPENCODE_TRANSNOTE_TOOL_NOT_INSTALLED" >&2
        return 3
    fi

    if ! cmp -s -- "$tool_source" "$tool_dest"; then
        printf '%s\n' "OPENCODE_TRANSNOTE_TOOL_MISMATCH" >&2
        return 3
    fi
}

opencode_require_discovery() {
    if ! opencode agent list 2>/dev/null | grep -Eq '(^|[^[:alnum:]_-])transnote($|[^[:alnum:]_-])'; then
        printf '%s\n' "OPENCODE_TRANSNOTE_AGENT_NOT_DISCOVERED" >&2
        return 3
    fi
}

opencode_basic_check() {
    local version
    version="$(opencode_current_version)" || return $?

    opencode_require_supported_major "$version" || return $?
    opencode_require_cli || return $?
    opencode_require_installed_adapter || return $?
    opencode_require_discovery || return $?

    printf '%s\n' "$version"
}
