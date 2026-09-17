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
    sync_dir,
    home,
    input_value,
    extra_env=None,
):
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["TRANSNOTE_DATA_DIR"] = str(data_dir)

    if extra_env:
        env.update(extra_env)

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
        input=json.dumps(input_value),
        capture_output=True,
        text=True,
        check=False,
    )


class AttachmentVerifiedUseTests(unittest.TestCase):
    def test_open_uses_verified_bytes_after_sync_source_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"

            sync_dir.mkdir()
            home.mkdir()

            verified_payload = b"verified\n"
            changed_payload = b"tampered\n"

            attachment = {
                "id": "peer-att",
                "name": "peer.txt",
                "size": len(verified_payload),
                "sha256": hashlib.sha256(
                    verified_payload
                ).hexdigest(),
            }

            note = {
                "id": "peer-note",
                "title": "Peer",
                "body": "body",
                "author": "laptop",
                "createdAt": "2026-09-17T09:00:00.000Z",
                "updatedAt": "2026-09-17T09:00:00.000Z",
                "shared": True,
                "comments": [],
                "attachments": [attachment],
            }

            (sync_dir / "laptop.json").write_text(
                json.dumps({
                    "version": 2,
                    "deviceId": "laptop",
                    "notes": [note],
                    "noteComments": [],
                    "deletedIds": {},
                }),
                encoding="utf-8",
            )

            source = (
                sync_dir
                / ".attachments"
                / "peer-note"
                / "peer-att-peer.txt"
            )
            source.parent.mkdir(parents=True)
            source.write_bytes(verified_payload)

            observed = root / "opened-bytes.bin"
            opened_path = root / "opened-path.txt"
            opener = root / "fake-xdg-open"

            opener.write_text(
                "#!/bin/sh\n"
                f"printf 'tampered\\n' > '{source}'\n"
                f"cat \"$1\" > '{observed}'\n"
                f"printf '%s' \"$1\" > '{opened_path}'\n",
                encoding="utf-8",
            )
            opener.chmod(0o755)

            result = run_helper(
                "attachment-open",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={
                    "noteId": "peer-note",
                    "attachmentId": "peer-att",
                },
                extra_env={
                    "TRANSNOTE_XDG_OPEN_BIN": str(opener),
                },
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=result.stderr,
            )

            self.assertEqual(
                source.read_bytes(),
                changed_payload,
            )

            trusted_path = Path(opened_path.read_text())

            self.assertEqual(
                trusted_path,
                (
                    data_dir
                    / "verified-attachments"
                    / "peer-note"
                    / "peer-att-peer.txt"
                ),
            )

            self.assertTrue(trusted_path.exists())

            self.assertEqual(
                trusted_path.read_bytes(),
                verified_payload,
            )

            self.assertEqual(
                observed.read_bytes(),
                verified_payload,
                "opened bytes changed after verification",
            )


    def test_changed_metadata_replaces_stale_trusted_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"

            sync_dir.mkdir()
            home.mkdir()

            payload = b"current verified bytes\n"

            attachment = {
                "id": "peer-att",
                "name": "peer.txt",
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }

            note = {
                "id": "peer-note",
                "title": "Peer",
                "body": "body",
                "author": "laptop",
                "createdAt": "2026-09-17T09:00:00.000Z",
                "updatedAt": "2026-09-17T09:00:00.000Z",
                "shared": True,
                "comments": [],
                "attachments": [attachment],
            }

            (sync_dir / "laptop.json").write_text(
                json.dumps({
                    "version": 2,
                    "deviceId": "laptop",
                    "notes": [note],
                    "noteComments": [],
                    "deletedIds": {},
                }),
                encoding="utf-8",
            )

            source = (
                sync_dir
                / ".attachments"
                / "peer-note"
                / "peer-att-peer.txt"
            )
            source.parent.mkdir(parents=True)
            source.write_bytes(payload)

            trusted_dir = (
                data_dir
                / "verified-attachments"
                / "peer-note"
            )
            trusted_dir.mkdir(parents=True)

            stale = trusted_dir / "peer-att-old.txt"
            stale.write_bytes(b"stale trusted bytes\n")

            expected = trusted_dir / "peer-att-peer.txt"

            opened_path = root / "opened-path.txt"
            opener = root / "fake-xdg-open"
            opener.write_text(
                "#!/bin/sh\n"
                f"printf '%s' \"$1\" > '{opened_path}'\n",
                encoding="utf-8",
            )
            opener.chmod(0o755)

            result = run_helper(
                "attachment-open",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={
                    "noteId": "peer-note",
                    "attachmentId": "peer-att",
                },
                extra_env={
                    "TRANSNOTE_XDG_OPEN_BIN": str(opener),
                },
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=result.stderr,
            )

            self.assertFalse(
                stale.exists(),
                "stale trusted copy was not removed",
            )

            self.assertTrue(expected.exists())

            self.assertEqual(
                expected.read_bytes(),
                payload,
            )

            self.assertEqual(
                Path(opened_path.read_text()),
                expected,
            )


    def test_notes_list_prunes_cache_when_peer_attachment_is_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"

            sync_dir.mkdir()
            home.mkdir()

            note = {
                "id": "peer-note",
                "title": "Peer",
                "body": "body",
                "author": "laptop",
                "createdAt": "2026-09-17T09:00:00.000Z",
                "updatedAt": "2026-09-17T09:00:00.000Z",
                "shared": True,
                "comments": [],
                "attachments": [],
            }

            (sync_dir / "laptop.json").write_text(
                json.dumps({
                    "version": 2,
                    "deviceId": "laptop",
                    "notes": [note],
                    "noteComments": [],
                    "deletedIds": {},
                }),
                encoding="utf-8",
            )

            stale = (
                data_dir
                / "verified-attachments"
                / "peer-note"
                / "peer-att-peer.txt"
            )
            stale.parent.mkdir(parents=True)
            stale.write_bytes(b"stale trusted bytes\n")

            result = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={},
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=result.stderr,
            )

            self.assertFalse(
                stale.exists(),
                "trusted file survived attachment removal",
            )

    def test_notes_list_prunes_cache_when_peer_note_is_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"

            sync_dir.mkdir()
            home.mkdir()

            (sync_dir / "laptop.json").write_text(
                json.dumps({
                    "version": 2,
                    "deviceId": "laptop",
                    "notes": [],
                    "noteComments": [],
                    "deletedIds": {},
                }),
                encoding="utf-8",
            )

            stale = (
                data_dir
                / "verified-attachments"
                / "peer-note"
                / "peer-att-peer.txt"
            )
            stale.parent.mkdir(parents=True)
            stale.write_bytes(b"orphan trusted bytes\n")

            result = run_helper(
                "notes-list",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={},
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=result.stderr,
            )

            self.assertFalse(
                stale.exists(),
                "trusted file survived peer-note removal",
            )


if __name__ == "__main__":
    unittest.main()
