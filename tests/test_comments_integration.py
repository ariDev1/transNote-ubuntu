import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "helper" / "transnote-helper.mjs"


def run_helper(
    command,
    *,
    data_dir,
    sync_dir,
    device_id="desktop",
    allow_list="laptop",
    input_value=None,
):
    env = os.environ.copy()
    env["TRANSNOTE_DATA_DIR"] = str(data_dir)

    result = subprocess.run(
        [
            "node",
            str(HELPER),
            command,
            "--device-id",
            device_id,
            "--sync-dir",
            str(sync_dir),
            "--allow-list",
            allow_list,
        ],
        cwd=ROOT,
        env=env,
        input=None if input_value is None else json.dumps(input_value),
        capture_output=True,
        text=True,
        check=False,
    )

    return result


def result_json(result):
    raw = result.stdout if result.returncode == 0 else result.stderr
    return json.loads(raw)


def write_peer_note(
    sync_dir,
    *,
    comments=None,
    note_comments=None,
    author="laptop",
):
    note = {
        "id": "peer-note",
        "title": "Peer note",
        "body": "peer body",
        "author": author,
        "createdAt": "2026-09-12T12:00:00.000Z",
        "updatedAt": "2026-09-12T12:00:00.000Z",
        "shared": True,
        "comments": comments or [],
        "attachments": [],
    }

    snapshot = {
        "version": 1,
        "deviceId": author,
        "updatedAt": "2026-09-12T12:00:00.000Z",
        "notes": [note],
        "noteComments": note_comments or [],
    }

    (sync_dir / f"{author}.json").write_text(
        json.dumps(snapshot)
    )


class CommentIntegrationTests(unittest.TestCase):
    def create_local_note(self, data_dir, sync_dir):
        result = run_helper(
            "note-create",
            data_dir=data_dir,
            sync_dir=sync_dir,
            input_value={
                "title": "Local note",
                "body": "body",
            },
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return result_json(result)["note"]

    def test_local_note_comment_is_persisted_inline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            note = self.create_local_note(data_dir, sync_dir)

            result = run_helper(
                "comment-add",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={
                    "noteId": note["id"],
                    "text": "local comment",
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            state = json.loads(
                (data_dir / "notes.json").read_text()
            )

            comments = state["notes"][0]["comments"]

            self.assertEqual(len(comments), 1)
            self.assertEqual(comments[0]["author"], "desktop")
            self.assertEqual(comments[0]["text"], "local comment")
            self.assertEqual(state["outbox"], [])

    def test_peer_note_comment_is_persisted_in_outbox_and_published(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_peer_note(sync_dir)

            result = run_helper(
                "comment-add",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={
                    "noteId": "peer-note",
                    "text": "reply from desktop",
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            state = json.loads(
                (data_dir / "notes.json").read_text()
            )

            self.assertEqual(len(state["outbox"]), 1)

            entry = state["outbox"][0]
            self.assertEqual(entry["noteId"], "peer-note")
            self.assertEqual(
                entry["comment"]["author"],
                "desktop",
            )
            self.assertEqual(
                entry["comment"]["text"],
                "reply from desktop",
            )

            snapshot = json.loads(
                (sync_dir / "desktop.json").read_text()
            )

            self.assertEqual(
                snapshot["noteComments"],
                state["outbox"],
            )

    def test_own_outbox_comment_is_visible_immediately_on_peer_note(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_peer_note(sync_dir)

            added = run_helper(
                "comment-add",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={
                    "noteId": "peer-note",
                    "text": "visible now",
                },
            )
            self.assertEqual(added.returncode, 0, msg=added.stderr)

            listed = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(listed.returncode, 0, msg=listed.stderr)

            value = result_json(listed)
            note = next(
                item
                for item in value["notes"]
                if item["id"] == "peer-note"
            )

            self.assertEqual(len(note["comments"]), 1)
            self.assertEqual(
                note["comments"][0]["text"],
                "visible now",
            )

    def test_qualified_incoming_comment_is_displayed_once(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            local = self.create_local_note(data_dir, sync_dir)

            incoming = {
                "noteId": local["id"],
                "comment": {
                    "id": "comment-1",
                    "author": "laptop",
                    "text": "hello desktop",
                    "createdAt": "2026-09-12T12:01:00.000Z",
                },
            }

            write_peer_note(
                sync_dir,
                note_comments=[incoming],
            )

            first = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            second = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )

            self.assertEqual(first.returncode, 0, msg=first.stderr)
            self.assertEqual(second.returncode, 0, msg=second.stderr)

            for result in (first, second):
                value = result_json(result)
                note = next(
                    item
                    for item in value["notes"]
                    if item["id"] == local["id"]
                )

                matches = [
                    comment
                    for comment in note["comments"]
                    if comment["id"] == "comment-1"
                ]

                self.assertEqual(len(matches), 1)
                self.assertEqual(
                    matches[0]["text"],
                    "hello desktop",
                )

    def test_qualified_comment_is_kept_and_unqualified_comment_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            local = self.create_local_note(data_dir, sync_dir)

            qualified = {
                "noteId": local["id"],
                "comment": {
                    "id": "comment-good",
                    "author": "laptop",
                    "text": "qualified",
                    "createdAt": "2026-09-12T12:01:00.000Z",
                },
            }

            unqualified = {
                "noteId": local["id"],
                "comment": {
                    "id": "comment-bad",
                    "author": "stranger",
                    "text": "not qualified",
                    "createdAt": "2026-09-12T12:02:00.000Z",
                },
            }

            write_peer_note(
                sync_dir,
                note_comments=[qualified, unqualified],
            )

            listed = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )

            self.assertEqual(listed.returncode, 0, msg=listed.stderr)

            value = result_json(listed)
            note = next(
                item
                for item in value["notes"]
                if item["id"] == local["id"]
            )

            ids = {
                comment["id"]
                for comment in note["comments"]
            }

            self.assertIn("comment-good", ids)
            self.assertNotIn("comment-bad", ids)

    def test_peer_comment_requires_existing_qualified_peer_note(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            result = run_helper(
                "comment-add",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={
                    "noteId": "missing-note",
                    "text": "must fail",
                },
            )

            self.assertNotEqual(result.returncode, 0)

            error = result_json(result)
            self.assertEqual(
                error["error"]["code"],
                "NOTE_NOT_FOUND",
            )

    def test_outbox_is_pruned_when_peer_note_disappears(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_peer_note(sync_dir)

            added = run_helper(
                "comment-add",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={
                    "noteId": "peer-note",
                    "text": "temporary reply",
                },
            )
            self.assertEqual(added.returncode, 0, msg=added.stderr)

            before = json.loads(
                (data_dir / "notes.json").read_text()
            )
            self.assertEqual(len(before["outbox"]), 1)

            (sync_dir / "laptop.json").unlink()

            listed = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(listed.returncode, 0, msg=listed.stderr)

            after = json.loads(
                (data_dir / "notes.json").read_text()
            )

            self.assertEqual(after["outbox"], [])


if __name__ == "__main__":
    unittest.main()
