#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE="$PLUGIN_DIR/bin/transnote-agent"
DEST_DIR="$HOME/.local/bin"
DEST="$DEST_DIR/transnote-agent"

if [[ ! -f "$SOURCE" || ! -x "$SOURCE" ]]; then
    printf '%s\n' "transnote-agent source is missing or not executable" >&2
    exit 1
fi

mkdir -p -- "$DEST_DIR"
EXPECTED="$(readlink -f -- "$SOURCE")"

if [[ -L "$DEST" ]]; then
    CURRENT="$(readlink -f -- "$DEST" 2>/dev/null || true)"
    if [[ "$CURRENT" == "$EXPECTED" ]]; then
        printf '%s\n' "transnote-agent is already installed"
        exit 0
    fi
    printf '%s\n' "refusing to replace an existing foreign symlink: $DEST" >&2
    exit 1
fi

if [[ -e "$DEST" ]]; then
    printf '%s\n' "refusing to replace an existing file: $DEST" >&2
    exit 1
fi

ln -s -- "$SOURCE" "$DEST"
printf '%s\n' "installed: $DEST"
