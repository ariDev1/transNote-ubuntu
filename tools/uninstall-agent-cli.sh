#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE="$PLUGIN_DIR/bin/transnote-agent"
DEST="$HOME/.local/bin/transnote-agent"

if [[ ! -e "$DEST" && ! -L "$DEST" ]]; then
    printf '%s\n' "transnote-agent is not installed"
    exit 0
fi

if [[ ! -L "$DEST" ]]; then
    printf '%s\n' "refusing to remove an existing foreign file: $DEST" >&2
    exit 1
fi

EXPECTED="$(readlink -f -- "$SOURCE" 2>/dev/null || true)"
CURRENT="$(readlink -f -- "$DEST" 2>/dev/null || true)"

if [[ -z "$EXPECTED" || "$CURRENT" != "$EXPECTED" ]]; then
    printf '%s\n' "refusing to remove an existing foreign symlink: $DEST" >&2
    exit 1
fi

rm -- "$DEST"
printf '%s\n' "removed: $DEST"
