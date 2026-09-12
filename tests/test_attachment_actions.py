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
    input_value=None,
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
        input=None if input_value is None else json.dumps(input_value),
        capture_output=True,
        text=True,
        check=False,
    )


def peer_snapshot(sync_dir, payload, *, bad_hash=False):
    expected = b"different\n" if bad_hash else payload
    sha256 = hashlib.sha256(expected).hexdigest()

    note = {
        "id": "peer-note",
        "title": "Peer",
        "body": "body",
        "author": "laptop",
        "createdAt": "2026-09-12T12:00:00.000Z",
        "updatedAt": "2026-09-12T12:00:00.000Z",
        "shared": True,
        "comments": [],
        "attachments": [
            {
                "id": "peer-att",
                "name": "peer.txt",
                "size": len(expected),
                "sha256": sha256,
            }
        ],
    }

    (sync_dir / "laptop.json").write_text(json.dumps({
        "version": 1,
        "deviceId": "laptop",
        "notes": [note],
        "noteComments": [],
    }))

    sidecar = (
        sync_dir /
        ".attachments" /
        "peer-note" /
        "peer-att-peer.txt"
    )
    sidecar.parent.mkdir(parents=True)
    sidecar.write_bytes(payload)


class AttachmentActionTests(unittest.TestCase):
    def test_open_rejects_unverified_peer_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"
            sync_dir.mkdir()
            home.mkdir()

            peer_snapshot(
                sync_dir,
                b"wrong bytes\n",
                bad_hash=True,
            )

            opener_log = root / "opened.txt"
            opener = root / "fake-xdg-open"
            opener.write_text(
                "#!/bin/sh\n"
                f"printf '%s' \"$1\" > '{opener_log}'\n"
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

            self.assertNotEqual(result.returncode, 0)
            error = json.loads(result.stderr)
            self.assertEqual(
                error["error"]["code"],
                "ATTACHMENT_NOT_VERIFIED",
            )
            self.assertFalse(opener_log.exists())

    def test_open_verified_peer_bytes_uses_xdg_open(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"
            sync_dir.mkdir()
            home.mkdir()

            peer_snapshot(sync_dir, b"verified\n")

            opener_log = root / "opened.txt"
            opener = root / "fake-xdg-open"
            opener.write_text(
                "#!/bin/sh\n"
                f"printf '%s' \"$1\" > '{opener_log}'\n"
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

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue(opener_log.exists())
            self.assertTrue(
                opener_log.read_text().endswith(
                    "/.attachments/peer-note/peer-att-peer.txt"
                )
            )

    def test_save_verified_peer_bytes_to_downloads(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"
            sync_dir.mkdir()
            home.mkdir()

            payload = b"save me\n"
            peer_snapshot(sync_dir, payload)

            result = run_helper(
                "attachment-save",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={
                    "noteId": "peer-note",
                    "attachmentId": "peer-att",
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            value = json.loads(result.stdout)

            saved = Path(value["savedPath"])
            self.assertEqual(
                saved,
                home / "Downloads" / "peer.txt",
            )
            self.assertEqual(saved.read_bytes(), payload)

    def test_attach_dialog_uses_selected_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"
            home.mkdir()

            created = run_helper(
                "note-create",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={
                    "title": "Local",
                    "body": "body",
                },
            )
            self.assertEqual(created.returncode, 0, msg=created.stderr)
            note = json.loads(created.stdout)["note"]

            source = root / "picked.txt"
            source.write_bytes(b"picked attachment\n")

            zenity = root / "fake-zenity"
            zenity.write_text(
                "#!/bin/sh\n"
                f"printf '%s\\n' '{source}'\n"
            )
            zenity.chmod(0o755)

            result = run_helper(
                "attachment-add-dialog",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={"noteId": note["id"]},
                extra_env={
                    "TRANSNOTE_ZENITY_BIN": str(zenity),
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            value = json.loads(result.stdout)
            self.assertEqual(
                value["attachment"]["name"],
                "picked.txt",
            )


    def test_open_blocks_verified_risky_attachment(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"
            sync_dir.mkdir()
            home.mkdir()

            payload = b"#!/bin/sh\necho unsafe\n"
            sha256 = hashlib.sha256(payload).hexdigest()

            snapshot = {
                "version": 1,
                "deviceId": "laptop",
                "notes": [{
                    "id": "peer-note",
                    "title": "Peer",
                    "body": "body",
                    "author": "laptop",
                    "createdAt": "2026-09-12T12:00:00.000Z",
                    "updatedAt": "2026-09-12T12:00:00.000Z",
                    "shared": True,
                    "comments": [],
                    "attachments": [{
                        "id": "peer-att",
                        "name": "unsafe.sh",
                        "size": len(payload),
                        "sha256": sha256,
                    }],
                }],
                "noteComments": [],
            }

            (sync_dir / "laptop.json").write_text(
                json.dumps(snapshot)
            )

            sidecar = (
                sync_dir /
                ".attachments" /
                "peer-note" /
                "peer-att-unsafe.sh"
            )
            sidecar.parent.mkdir(parents=True)
            sidecar.write_bytes(payload)

            opener_log = root / "opened.txt"
            opener = root / "fake-xdg-open"
            opener.write_text(
                "#!/bin/sh\n"
                f"printf '%s' \"$1\" > '{opener_log}'\n"
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

            self.assertNotEqual(result.returncode, 0)
            error = json.loads(result.stderr)
            self.assertEqual(
                error["error"]["code"],
                "RISKY_ATTACHMENT",
            )
            self.assertFalse(opener_log.exists())

    def test_save_does_not_overwrite_existing_download(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            home = root / "home"
            downloads = home / "Downloads"

            sync_dir.mkdir()
            downloads.mkdir(parents=True)

            payload = b"new attachment\n"
            peer_snapshot(sync_dir, payload)

            existing = downloads / "peer.txt"
            existing.write_bytes(b"existing file\n")

            result = run_helper(
                "attachment-save",
                data_dir=data_dir,
                sync_dir=sync_dir,
                home=home,
                input_value={
                    "noteId": "peer-note",
                    "attachmentId": "peer-att",
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            value = json.loads(result.stdout)
            saved = Path(value["savedPath"])

            self.assertEqual(
                existing.read_bytes(),
                b"existing file\n",
            )
            self.assertEqual(
                saved,
                downloads / "peer.2.txt",
            )
            self.assertEqual(
                saved.read_bytes(),
                payload,
            )


if __name__ == "__main__":
    unittest.main()
