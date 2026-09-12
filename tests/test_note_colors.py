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

    return subprocess.run(
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


def write_state(data_dir, *, author="desktop", color="red", shared=True):
    data_dir.mkdir(parents=True, exist_ok=True)

    note = {
        "id": "color-note",
        "title": "Color note",
        "body": "body",
        "author": author,
        "createdAt": "2026-09-12T12:00:00.000Z",
        "updatedAt": "2026-09-12T12:00:00.000Z",
        "shared": shared,
        "comments": [],
        "attachments": [],
        "color": color,
    }

    state = {
        "version": 1,
        "deviceId": "desktop",
        "notes": [note],
        "outbox": [],
    }

    (data_dir / "notes.json").write_text(json.dumps(state))


class NoteColorIntegrationTests(unittest.TestCase):
    def test_color_cycle_persists_and_publishes_existing_note_color(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_state(data_dir, color="red", shared=True)

            result = run_helper(
                "note-color-cycle",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={"id": "color-note"},
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            value = json.loads(result.stdout)
            self.assertEqual(value["note"]["color"], "orange")

            state = json.loads((data_dir / "notes.json").read_text())
            self.assertEqual(state["notes"][0]["color"], "orange")

            snapshot = json.loads(
                (sync_dir / "desktop.json").read_text()
            )
            self.assertEqual(
                snapshot["notes"][0]["color"],
                "orange",
            )

    def test_color_cycle_rejects_non_owner(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            write_state(
                data_dir,
                author="laptop",
                color="red",
                shared=False,
            )

            result = run_helper(
                "note-color-cycle",
                data_dir=data_dir,
                sync_dir=sync_dir,
                input_value={"id": "color-note"},
            )

            self.assertNotEqual(result.returncode, 0)

            value = json.loads(result.stderr)
            self.assertEqual(
                value["error"]["code"],
                "NOT_OWNER",
            )


class NoteColorUiTests(unittest.TestCase):
    def test_helper_client_exposes_color_cycle(self):
        source = (ROOT / "helperClient.js").read_text()

        self.assertIn("'note-color-cycle'", source)
        self.assertIn("async cycleColor(", source)

    def test_notes_menu_uses_existing_note_color_and_owner_action(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn(
            "transnote-note-color-${note.color}",
            source,
        )
        self.assertIn("label: 'Color'", source)
        self.assertIn("this._helper.cycleColor(", source)

    def test_color_styles_are_structured_for_all_store_colors(self):
        source = (ROOT / "stylesheet.css").read_text()

        for color in (
            "red",
            "orange",
            "yellow",
            "green",
            "blue",
            "violet",
        ):
            self.assertIn(
                f".transnote-note-color-{color}",
                source,
            )


if __name__ == "__main__":
    unittest.main()
