"""Pure protocol helpers for the restricted TransNote Agent interface."""

from __future__ import annotations

import re
from typing import Any


PROTOCOL_VERSION = 1
MAX_PROVENANCE_IDS = 2000
SAFE_PROVENANCE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
PUBLIC_SOURCES = frozenset({"local", "lan"})


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def provenance_ids(value: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    values = value if isinstance(value, list) else []

    for raw in values:
        note_id = text(raw).strip()
        if not SAFE_PROVENANCE_ID_RE.fullmatch(note_id):
            continue
        if note_id in seen:
            continue

        seen.add(note_id)
        out.append(note_id)

        if len(out) >= MAX_PROVENANCE_IDS:
            break

    return out


def sanitize_provenance(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    return {
        "version": 1,
        "notes": provenance_ids(source.get("notes")),
        "comments": provenance_ids(source.get("comments")),
    }


def mark_provenance(raw: Any, kind: str, object_id: Any) -> dict[str, Any]:
    clean = sanitize_provenance(raw)
    candidate = provenance_ids([object_id])
    if not candidate:
        return clean

    if kind == "note":
        key = "notes"
    elif kind == "comment":
        key = "comments"
    else:
        return clean

    object_id = candidate[0]
    if object_id not in clean[key]:
        clean[key].insert(0, object_id)
        clean[key] = clean[key][:MAX_PROVENANCE_IDS]

    return clean


def has_provenance(raw: Any, kind: str, object_id: Any) -> bool:
    clean = sanitize_provenance(raw)
    candidate = provenance_ids([object_id])
    if not candidate:
        return False

    if kind == "note":
        values = clean["notes"]
    elif kind == "comment":
        values = clean["comments"]
    else:
        return False

    return candidate[0] in values


def serialize_comment(comment: Any) -> dict[str, str] | None:
    if not isinstance(comment, dict):
        return None

    return {
        "id": text(comment.get("id")),
        "author": text(comment.get("author")),
        "text": text(comment.get("text")),
        "createdAt": text(comment.get("createdAt")),
    }


def serialize_note(note: Any, source: str) -> dict[str, Any] | None:
    if not isinstance(note, dict) or source not in PUBLIC_SOURCES:
        return None

    comments = []
    raw_comments = note.get("comments")
    if isinstance(raw_comments, list):
        for raw_comment in raw_comments:
            clean = serialize_comment(raw_comment)
            if clean is not None:
                comments.append(clean)

    return {
        "id": text(note.get("id")),
        "title": text(note.get("title")),
        "body": text(note.get("body")),
        "author": text(note.get("author")),
        "createdAt": text(note.get("createdAt")),
        "updatedAt": text(note.get("updatedAt")),
        "shared": note.get("shared") is True,
        "source": source,
        "comments": comments,
    }


def search_notes(notes: Any, query: Any) -> list[dict[str, Any]]:
    if not isinstance(notes, list):
        return []

    needle = text(query).strip().lower()
    if needle == "":
        return []

    out = []
    for note in notes:
        if not isinstance(note, dict):
            continue
        title = text(note.get("title")).lower()
        body = text(note.get("body")).lower()
        if needle in title or needle in body:
            out.append(note)
    return out


def capabilities() -> dict[str, Any]:
    return {
        "commands": {
            "status": {
                "mutates": False,
                "arguments": [],
                "errors": [],
            },
            "capabilities": {
                "mutates": False,
                "arguments": [],
                "errors": [],
            },
            "list": {
                "mutates": False,
                "arguments": [],
                "errors": ["TRANSNOTE_NOT_READY"],
            },
            "get": {
                "mutates": False,
                "arguments": [{
                    "name": "noteId",
                    "kind": "positional",
                    "required": True,
                    "nonEmpty": True,
                }],
                "errors": ["TRANSNOTE_NOT_READY", "NOTE_NOT_FOUND"],
            },
            "search": {
                "mutates": False,
                "arguments": [{
                    "name": "query",
                    "kind": "positional",
                    "required": True,
                    "nonEmpty": True,
                }],
                "errors": ["TRANSNOTE_NOT_READY", "INVALID_ARGUMENT"],
            },
            "create": {
                "mutates": True,
                "arguments": [
                    {
                        "name": "title",
                        "kind": "option",
                        "flag": "--title",
                        "required": False,
                    },
                    {
                        "name": "body",
                        "kind": "option",
                        "flag": "--body",
                        "required": False,
                    },
                ],
                "constraints": [{
                    "kind": "atLeastOneNonEmpty",
                    "arguments": ["title", "body"],
                }],
                "errors": ["TRANSNOTE_NOT_READY", "EMPTY_NOTE"],
            },
            "comment": {
                "mutates": True,
                "arguments": [
                    {
                        "name": "noteId",
                        "kind": "positional",
                        "required": True,
                        "nonEmpty": True,
                    },
                    {
                        "name": "text",
                        "kind": "option",
                        "flag": "--text",
                        "required": True,
                        "nonEmpty": True,
                    },
                ],
                "errors": [
                    "TRANSNOTE_NOT_READY",
                    "NOTE_NOT_FOUND",
                    "EMPTY_COMMENT",
                ],
            },
            "share": {
                "mutates": True,
                "arguments": [{
                    "name": "noteId",
                    "kind": "positional",
                    "required": True,
                    "nonEmpty": True,
                }],
                "errors": [
                    "TRANSNOTE_NOT_READY",
                    "NOTE_NOT_FOUND",
                    "SHARE_NOT_ALLOWED",
                ],
            },
        },
        "errorExitCodes": {
            "MISSING_ARGUMENT": 2,
            "INVALID_ARGUMENT": 2,
            "UNKNOWN_OPTION": 2,
            "UNKNOWN_COMMAND": 2,
            "EMPTY_NOTE": 2,
            "EMPTY_COMMENT": 2,
            "TRANSNOTE_NOT_READY": 3,
            "TRANSNOTE_UNAVAILABLE": 3,
            "NOTE_NOT_FOUND": 4,
            "SHARE_NOT_ALLOWED": 4,
            "PROTOCOL_ERROR": 5,
        },
        "unsupported": [
            "delete",
            "unshare",
            "hide",
            "pairing",
            "syncAdministration",
            "attachmentMutation",
            "filesystemAccess",
            "commandForwarding",
            "identityOverride",
        ],
    }
