import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "helper" / "transnote-helper.mjs"


def run_helper(command, *, data_dir, sync_dir, input_value=None):
    env = os.environ.copy()
    env["TRANSNOTE_DATA_DIR"] = str(data_dir)

    return subprocess.run(
        [
            "node",
            str(HELPER),
            command,
            "--device-id",
            "desktop",
            "--sync-dir",
            str(sync_dir),
            "--allow-list",
            "laptop",
        ],
        cwd=ROOT,
        env=env,
        input=None if input_value is None else json.dumps(input_value),
        capture_output=True,
        text=True,
        check=False,
    )


def result_json(result):
    raw = result.stdout if result.returncode == 0 else result.stderr
    return json.loads(raw)


def write_peer_snapshot(sync_dir):
    note = {
        "id": "peer-note",
        "title": "Peer note",
        "body": "visible on desktop",
        "author": "laptop",
        "createdAt": "2026-09-14T12:00:00.000Z",
        "updatedAt": "2026-09-14T12:00:00.000Z",
        "shared": True,
        "comments": [],
        "attachments": [],
    }
    snapshot = {
        "version": 2,
        "deviceId": "laptop",
        "updatedAt": "2026-09-14T12:00:00.000Z",
        "notes": [note],
        "noteComments": [],
        "deletedIds": {},
    }
    path = sync_dir / "laptop.json"
    path.write_text(json.dumps(snapshot))
    return path


class HideNoteIntegrationTests(unittest.TestCase):
    def test_peer_note_hide_is_local_only_and_persistent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            peer_path = write_peer_snapshot(sync_dir)
            peer_before = peer_path.read_bytes()

            visible = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(visible.returncode, 0, msg=visible.stderr)
            self.assertEqual(
                [n["id"] for n in result_json(visible)["notes"]],
                ["peer-note"],
            )

            hidden = run_helper(
                "note-hide",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={"id": "peer-note"},
            )
            self.assertEqual(hidden.returncode, 0, msg=hidden.stderr)

            state = json.loads((data_dir / "notes.json").read_text())
            self.assertEqual(state["hiddenIds"], ["peer-note"])

            listed = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(listed.returncode, 0, msg=listed.stderr)
            value = result_json(listed)
            self.assertEqual(value["notes"], [])
            self.assertEqual(value["hiddenCount"], 1)

            synced = run_helper(
                "sync-now",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(synced.returncode, 0, msg=synced.stderr)

            own_snapshot = json.loads(
                (sync_dir / "desktop.json").read_text()
            )
            self.assertNotIn("hiddenIds", own_snapshot)
            self.assertNotIn("hidden", own_snapshot)
            self.assertEqual(peer_path.read_bytes(), peer_before)

            unhidden = run_helper(
                "notes-unhide-all",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={},
            )
            self.assertEqual(unhidden.returncode, 0, msg=unhidden.stderr)
            self.assertEqual(result_json(unhidden)["unhidden"], 1)

            listed_again = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
            )
            self.assertEqual(
                [n["id"] for n in result_json(listed_again)["notes"]],
                ["peer-note"],
            )
            self.assertEqual(
                result_json(listed_again)["hiddenCount"],
                0,
            )

    def test_local_note_cannot_use_hide(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            created = run_helper(
                "note-create",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={"title": "Mine", "body": "local"},
            )
            self.assertEqual(created.returncode, 0, msg=created.stderr)
            note_id = result_json(created)["note"]["id"]

            hidden = run_helper(
                "note-hide",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={"id": note_id},
            )
            self.assertNotEqual(hidden.returncode, 0)
            self.assertEqual(
                result_json(hidden)["error"]["code"],
                "LOCAL_NOTE",
            )


class HideUiTests(unittest.TestCase):
    def test_helper_client_exposes_hide_actions(self):
        source = (ROOT / "helperClient.js").read_text()

        self.assertIn("'note-hide'", source)
        self.assertIn("'notes-unhide-all'", source)
        self.assertIn("async hideNote(", source)
        self.assertIn("async unhideAll(", source)

    def test_notes_menu_has_hide_and_unhide_actions(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("label: 'Hide'", source)
        self.assertIn("label: 'Unhide all'", source)
        self.assertIn("this._helper.hideNote(", source)
        self.assertIn("this._helper.unhideAll(", source)


if __name__ == "__main__":
    unittest.main()
