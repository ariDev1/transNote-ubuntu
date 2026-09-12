import hashlib
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
    device_id,
    sync_dir,
    input_value=None,
):
    env = os.environ.copy()
    env["TRANSNOTE_DATA_DIR"] = str(data_dir)

    args = [
        "node",
        str(HELPER),
        command,
        "--device-id",
        device_id,
        "--sync-dir",
        str(sync_dir),
        "--allow-list",
        "",
    ]

    stdin = None
    if input_value is not None:
        stdin = json.dumps(input_value)

    return subprocess.run(
        args,
        cwd=ROOT,
        env=env,
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )


def result_json(result):
    raw = result.stdout if result.returncode == 0 else result.stderr
    return json.loads(raw)


class AttachmentIntegrationTests(unittest.TestCase):
    def create_note(self, data_dir, sync_dir, device_id="desktop"):
        result = run_helper(
            "note-create",
            data_dir=data_dir,
            device_id=device_id,
            sync_dir=sync_dir,
            input_value={
                "title": "Attachment test",
                "body": "body",
            },
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return result_json(result)["note"]

    def test_owner_attachment_persists_metadata_and_private_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            source = root / "report final?.txt"
            source_bytes = b"attachment payload\n"
            source.write_bytes(source_bytes)

            note = self.create_note(data_dir, sync_dir)

            result = run_helper(
                "attachment-add",
                data_dir=data_dir,
                device_id="desktop",
                sync_dir=sync_dir,
                input_value={
                    "noteId": note["id"],
                    "sourcePath": str(source),
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            value = result_json(result)
            attachment = value["attachment"]

            self.assertEqual(
                attachment["name"],
                "report_final_.txt",
            )
            self.assertEqual(
                attachment["size"],
                len(source_bytes),
            )
            self.assertEqual(
                attachment["sha256"],
                hashlib.sha256(source_bytes).hexdigest(),
            )

            state = json.loads(
                (data_dir / "notes.json").read_text()
            )
            stored = state["notes"][0]

            self.assertEqual(
                stored["attachments"],
                [attachment],
            )

            local_path = (
                data_dir
                / "attachments"
                / note["id"]
                / f'{attachment["id"]}-{attachment["name"]}'
            )

            self.assertEqual(
                local_path.read_bytes(),
                source_bytes,
            )
            self.assertEqual(
                local_path.stat().st_mode & 0o777,
                0o600,
            )

    def test_non_owner_cannot_attach(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            source = root / "file.txt"
            source.write_text("payload")

            note = self.create_note(
                data_dir,
                sync_dir,
                device_id="desktop-a",
            )

            result = run_helper(
                "attachment-add",
                data_dir=data_dir,
                device_id="desktop-b",
                sync_dir=sync_dir,
                input_value={
                    "noteId": note["id"],
                    "sourcePath": str(source),
                },
            )

            self.assertNotEqual(result.returncode, 0)

            error = result_json(result)
            self.assertEqual(
                error["error"]["code"],
                "NOT_OWNER",
            )

            state = json.loads(
                (data_dir / "notes.json").read_text()
            )
            self.assertEqual(
                state["notes"][0]["attachments"],
                [],
            )

    def test_attachment_on_shared_note_is_mirrored_before_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            source = root / "shared.txt"
            source_bytes = b"shared bytes\n"
            source.write_bytes(source_bytes)

            note = self.create_note(data_dir, sync_dir)

            shared = run_helper(
                "note-share",
                data_dir=data_dir,
                device_id="desktop",
                sync_dir=sync_dir,
                input_value={
                    "id": note["id"],
                    "shared": True,
                },
            )
            self.assertEqual(
                shared.returncode,
                0,
                msg=shared.stderr,
            )

            result = run_helper(
                "attachment-add",
                data_dir=data_dir,
                device_id="desktop",
                sync_dir=sync_dir,
                input_value={
                    "noteId": note["id"],
                    "sourcePath": str(source),
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            attachment = result_json(result)["attachment"]

            mirror = (
                sync_dir
                / ".attachments"
                / note["id"]
                / f'{attachment["id"]}-{attachment["name"]}'
            )

            self.assertEqual(
                mirror.read_bytes(),
                source_bytes,
            )

            snapshot = json.loads(
                (sync_dir / "desktop.json").read_text()
            )

            self.assertEqual(
                snapshot["notes"][0]["attachments"],
                [attachment],
            )

    def test_failed_source_does_not_change_note_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"

            note = self.create_note(data_dir, sync_dir)

            result = run_helper(
                "attachment-add",
                data_dir=data_dir,
                device_id="desktop",
                sync_dir=sync_dir,
                input_value={
                    "noteId": note["id"],
                    "sourcePath": str(root / "missing.txt"),
                },
            )

            self.assertNotEqual(result.returncode, 0)

            error = result_json(result)
            self.assertEqual(
                error["error"]["code"],
                "ENOENT",
            )

            state = json.loads(
                (data_dir / "notes.json").read_text()
            )

            self.assertEqual(
                state["notes"][0]["attachments"],
                [],
            )

    def test_sharing_note_mirrors_existing_attachment(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            source = root / "before-share.txt"
            source_bytes = b"attached before sharing\n"
            source.write_bytes(source_bytes)

            note = self.create_note(data_dir, sync_dir)

            attached = run_helper(
                "attachment-add",
                data_dir=data_dir,
                device_id="desktop",
                sync_dir=sync_dir,
                input_value={
                    "noteId": note["id"],
                    "sourcePath": str(source),
                },
            )
            self.assertEqual(
                attached.returncode,
                0,
                msg=attached.stderr,
            )
            attachment = result_json(attached)["attachment"]

            shared = run_helper(
                "note-share",
                data_dir=data_dir,
                device_id="desktop",
                sync_dir=sync_dir,
                input_value={
                    "id": note["id"],
                    "shared": True,
                },
            )
            self.assertEqual(
                shared.returncode,
                0,
                msg=shared.stderr,
            )

            mirror = (
                sync_dir
                / ".attachments"
                / note["id"]
                / f'{attachment["id"]}-{attachment["name"]}'
            )

            self.assertEqual(
                mirror.read_bytes(),
                source_bytes,
            )


if __name__ == "__main__":
    unittest.main()
