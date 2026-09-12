import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "helper" / "transnote-helper.mjs"


def run_notes_list(data_dir, sync_dir):
    env = os.environ.copy()
    env["TRANSNOTE_DATA_DIR"] = str(data_dir)

    return subprocess.run(
        [
            "node",
            str(HELPER),
            "notes-list",
            "--device-id",
            "desktop",
            "--sync-dir",
            str(sync_dir),
            "--allow-list",
            "laptop",
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


class AttachmentStateIntegrationTests(unittest.TestCase):
    def test_notes_list_reports_verified_peer_attachment(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data_dir = root / "data"
            sync_dir = root / "sync"
            sync_dir.mkdir()

            payload = b"peer attachment\n"
            sha256 = hashlib.sha256(payload).hexdigest()

            snapshot = {
                "version": 1,
                "deviceId": "laptop",
                "updatedAt": "2026-09-12T12:00:00.000Z",
                "notes": [
                    {
                        "id": "note-peer",
                        "title": "Peer note",
                        "body": "body",
                        "author": "laptop",
                        "createdAt": "2026-09-12T12:00:00.000Z",
                        "updatedAt": "2026-09-12T12:00:00.000Z",
                        "shared": True,
                        "comments": [],
                        "attachments": [
                            {
                                "id": "att-peer",
                                "name": "file.txt",
                                "size": len(payload),
                                "sha256": sha256,
                            }
                        ],
                    }
                ],
                "noteComments": [],
            }

            (sync_dir / "laptop.json").write_text(
                json.dumps(snapshot)
            )

            sidecar = (
                sync_dir
                / ".attachments"
                / "note-peer"
                / "att-peer-file.txt"
            )
            sidecar.parent.mkdir(parents=True)
            sidecar.write_bytes(payload)

            result = run_notes_list(data_dir, sync_dir)

            self.assertEqual(
                result.returncode,
                0,
                msg=result.stderr,
            )

            value = json.loads(result.stdout)

            self.assertEqual(
                value["attachmentStates"],
                {
                    "note-peer": {
                        "att-peer": "verified",
                    }
                },
            )


if __name__ == "__main__":
    unittest.main()
