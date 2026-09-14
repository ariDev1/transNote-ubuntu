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


def peer_note(updated_at="2026-09-14T12:00:00.000Z"):
    return {
        "id": "peer-note",
        "title": "Peer note",
        "body": "peer body",
        "author": "laptop",
        "createdAt": "2026-09-14T10:00:00.000Z",
        "updatedAt": updated_at,
        "shared": True,
        "comments": [],
        "attachments": [],
    }


def write_peer_snapshot(
    sync_dir,
    *,
    version=1,
    notes=None,
    deleted_ids=None,
    note_comments=None,
):
    snapshot = {
        "version": version,
        "deviceId": "laptop",
        "updatedAt": "2026-09-14T12:00:00.000Z",
        "notes": list(notes or []),
        "noteComments": list(note_comments or []),
    }

    if deleted_ids is not None:
        snapshot["deletedIds"] = deleted_ids

    (sync_dir / "laptop.json").write_text(json.dumps(snapshot))


class TombstoneSyncTests(unittest.TestCase):
    def create_local_note(self, data_dir, sync_dir):
        created = run_helper(
            "note-create",
            data_dir=data_dir,
            sync_dir=sync_dir,
            input_value={
                "title": "Local note",
                "body": "body",
            },
        )
        self.assertEqual(created.returncode, 0, msg=created.stderr)
        return result_json(created)["note"]

    def set_shared(self, data_dir, sync_dir, note_id, shared):
        result = run_helper(
            "note-share",
            data_dir=data_dir,
            sync_dir=sync_dir,
            input_value={
                "id": note_id,
                "shared": shared,
            },
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return result

    def test_version1_peer_snapshot_remains_readable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()
            write_peer_snapshot(sync_dir, notes=[peer_note()])

            listed = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )

            self.assertEqual(listed.returncode, 0, msg=listed.stderr)
            ids = {note["id"] for note in result_json(listed)["notes"]}
            self.assertIn("peer-note", ids)

    def test_delete_writes_version2_tombstone_to_state_and_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            note = self.create_local_note(data_dir, sync_dir)
            self.set_shared(data_dir, sync_dir, note["id"], True)

            deleted = run_helper(
                "note-delete",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={"id": note["id"]},
            )
            self.assertEqual(deleted.returncode, 0, msg=deleted.stderr)

            state = json.loads((data_dir / "notes.json").read_text())
            snapshot = json.loads((sync_dir / "desktop.json").read_text())

            self.assertEqual(state["version"], 2)
            self.assertIn(note["id"], state["deletedIds"])
            self.assertEqual(snapshot["version"], 2)
            self.assertIn(note["id"], snapshot["deletedIds"])
            self.assertNotIn(
                note["id"],
                {item["id"] for item in snapshot["notes"]},
            )

    def test_unshare_keeps_local_note_and_publishes_tombstone(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            note = self.create_local_note(data_dir, sync_dir)
            self.set_shared(data_dir, sync_dir, note["id"], True)
            self.set_shared(data_dir, sync_dir, note["id"], False)

            state = json.loads((data_dir / "notes.json").read_text())
            snapshot = json.loads((sync_dir / "desktop.json").read_text())

            local = next(item for item in state["notes"] if item["id"] == note["id"])
            self.assertFalse(local["shared"])
            self.assertIn(note["id"], state["deletedIds"])
            self.assertIn(note["id"], snapshot["deletedIds"])
            self.assertNotIn(
                note["id"],
                {item["id"] for item in snapshot["notes"]},
            )

    def test_reshare_clears_tombstone_and_republishes_note(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            note = self.create_local_note(data_dir, sync_dir)
            self.set_shared(data_dir, sync_dir, note["id"], True)
            self.set_shared(data_dir, sync_dir, note["id"], False)
            self.set_shared(data_dir, sync_dir, note["id"], True)

            state = json.loads((data_dir / "notes.json").read_text())
            snapshot = json.loads((sync_dir / "desktop.json").read_text())

            self.assertNotIn(note["id"], state["deletedIds"])
            self.assertNotIn(note["id"], snapshot["deletedIds"])
            self.assertIn(
                note["id"],
                {item["id"] for item in snapshot["notes"]},
            )

    def test_peer_tombstone_hides_stale_note_and_is_persisted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()
            deleted_at = "2026-09-14T12:30:00.000Z"

            write_peer_snapshot(
                sync_dir,
                version=2,
                notes=[peer_note("2026-09-14T12:00:00.000Z")],
                deleted_ids={"peer-note": deleted_at},
            )

            listed = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(listed.returncode, 0, msg=listed.stderr)

            ids = {note["id"] for note in result_json(listed)["notes"]}
            self.assertNotIn("peer-note", ids)

            state = json.loads((data_dir / "notes.json").read_text())
            self.assertEqual(state["deletedIds"]["peer-note"], deleted_at)

    def test_persisted_tombstone_blocks_later_stale_version1_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_peer_snapshot(
                sync_dir,
                version=2,
                notes=[peer_note("2026-09-14T12:00:00.000Z")],
                deleted_ids={
                    "peer-note": "2026-09-14T12:30:00.000Z",
                },
            )
            first = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)

            write_peer_snapshot(
                sync_dir,
                version=1,
                notes=[peer_note("2026-09-14T12:00:00.000Z")],
            )
            second = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(second.returncode, 0, msg=second.stderr)

            ids = {note["id"] for note in result_json(second)["notes"]}
            self.assertNotIn("peer-note", ids)

    def test_newer_live_peer_note_clears_persisted_tombstone(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_peer_snapshot(
                sync_dir,
                version=2,
                notes=[peer_note("2026-09-14T12:00:00.000Z")],
                deleted_ids={
                    "peer-note": "2026-09-14T12:30:00.000Z",
                },
            )
            first = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)

            write_peer_snapshot(
                sync_dir,
                version=2,
                notes=[peer_note("2026-09-14T13:00:00.000Z")],
                deleted_ids={},
            )
            second = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(second.returncode, 0, msg=second.stderr)

            ids = {note["id"] for note in result_json(second)["notes"]}
            self.assertIn("peer-note", ids)

            state = json.loads((data_dir / "notes.json").read_text())
            self.assertNotIn("peer-note", state["deletedIds"])

    def test_peer_tombstone_prunes_local_comment_outbox(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_peer_snapshot(sync_dir, notes=[peer_note()])
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

            write_peer_snapshot(
                sync_dir,
                version=2,
                notes=[peer_note()],
                deleted_ids={
                    "peer-note": "2026-09-14T12:30:00.000Z",
                },
            )
            listed = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(listed.returncode, 0, msg=listed.stderr)

            state = json.loads((data_dir / "notes.json").read_text())
            self.assertEqual(state["outbox"], [])


if __name__ == "__main__":
    unittest.main()
