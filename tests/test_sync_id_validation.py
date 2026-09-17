import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FOLDER_SYNC = ROOT / "helper" / "folder-sync.mjs"


def read_peer_snapshots(sync_dir):
    env = os.environ.copy()
    env["TRANSNOTE_TEST_FOLDER_SYNC"] = str(FOLDER_SYNC)
    env["TRANSNOTE_TEST_SYNC_DIR"] = str(sync_dir)

    script = r"""
import {pathToFileURL} from 'node:url';

const moduleUrl = pathToFileURL(
  process.env.TRANSNOTE_TEST_FOLDER_SYNC
).href;

const FolderSync = await import(moduleUrl);

const result = await FolderSync.readPeerSnapshots({
  syncDir: process.env.TRANSNOTE_TEST_SYNC_DIR,
  deviceId: "desktop",
  allowList: ["laptop"],
});

process.stdout.write(JSON.stringify(result));
"""

    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        raise AssertionError(result.stderr)

    return json.loads(result.stdout)


class SyncIdValidationTests(unittest.TestCase):
    def test_peer_snapshot_rejects_unsafe_note_id(self):
        unsafe_ids = [
            "../outside",
            "..",
            ".",
            "a/b",
            "a\\b",
            "note.good",
        ]

        for note_id in unsafe_ids:
            with self.subTest(note_id=note_id):
                with tempfile.TemporaryDirectory() as temp:
                    sync_dir = Path(temp)

                    snapshot = {
                        "version": 2,
                        "deviceId": "laptop",
                        "updatedAt": "2026-09-17T09:00:00.000Z",
                        "notes": [
                            {
                                "id": note_id,
                                "title": "Peer note",
                                "body": "body",
                                "author": "laptop",
                                "createdAt": "2026-09-17T09:00:00.000Z",
                                "updatedAt": "2026-09-17T09:00:00.000Z",
                                "shared": True,
                                "comments": [],
                                "attachments": [],
                            }
                        ],
                        "noteComments": [],
                        "deletedIds": {},
                    }

                    (sync_dir / "laptop.json").write_text(
                        json.dumps(snapshot),
                        encoding="utf-8",
                    )

                    result = read_peer_snapshots(sync_dir)

                    self.assertEqual(result["diagnostics"]["fetched"], 1)
                    self.assertEqual(result["notes"], [])


    def test_peer_snapshot_rejects_unsafe_attachment_id(self):
        unsafe_ids = [
            "../outside",
            "..",
            ".",
            "a/b",
            "a\\\\b",
            "att.good",
        ]

        for attachment_id in unsafe_ids:
            with self.subTest(attachment_id=attachment_id):
                with tempfile.TemporaryDirectory() as temp:
                    sync_dir = Path(temp)

                    snapshot = {
                        "version": 2,
                        "deviceId": "laptop",
                        "updatedAt": "2026-09-17T09:00:00.000Z",
                        "notes": [
                            {
                                "id": "peer-note",
                                "title": "Peer note",
                                "body": "body",
                                "author": "laptop",
                                "createdAt": "2026-09-17T09:00:00.000Z",
                                "updatedAt": "2026-09-17T09:00:00.000Z",
                                "shared": True,
                                "comments": [],
                                "attachments": [
                                    {
                                        "id": attachment_id,
                                        "name": "test.txt",
                                        "size": 4,
                                        "sha256": "0" * 64,
                                    }
                                ],
                            }
                        ],
                        "noteComments": [],
                        "deletedIds": {},
                    }

                    (sync_dir / "laptop.json").write_text(
                        json.dumps(snapshot),
                        encoding="utf-8",
                    )

                    result = read_peer_snapshots(sync_dir)

                    self.assertEqual(len(result["notes"]), 1)
                    self.assertEqual(result["notes"][0]["attachments"], [])


    def test_peer_snapshot_rejects_unsafe_comment_target_id(self):
        unsafe_ids = [
            "../outside",
            "..",
            ".",
            "a/b",
            "a\\\\b",
            "note.good",
        ]

        for note_id in unsafe_ids:
            with self.subTest(note_id=note_id):
                with tempfile.TemporaryDirectory() as temp:
                    sync_dir = Path(temp)

                    snapshot = {
                        "version": 2,
                        "deviceId": "laptop",
                        "updatedAt": "2026-09-17T09:00:00.000Z",
                        "notes": [],
                        "noteComments": [
                            {
                                "noteId": note_id,
                                "comment": {
                                    "id": "c-test",
                                    "author": "laptop",
                                    "text": "test",
                                    "createdAt": "2026-09-17T09:00:00.000Z",
                                },
                            }
                        ],
                        "deletedIds": {},
                    }

                    (sync_dir / "laptop.json").write_text(
                        json.dumps(snapshot),
                        encoding="utf-8",
                    )

                    result = read_peer_snapshots(sync_dir)

                    self.assertEqual(result["diagnostics"]["fetched"], 1)
                    self.assertEqual(result["pairs"], [])


    def test_peer_snapshot_rejects_unsafe_tombstone_id(self):
        unsafe_ids = [
            "../outside",
            "..",
            ".",
            "a/b",
            "a\\\\b",
            "note.good",
        ]

        for note_id in unsafe_ids:
            with self.subTest(note_id=note_id):
                with tempfile.TemporaryDirectory() as temp:
                    sync_dir = Path(temp)

                    snapshot = {
                        "version": 2,
                        "deviceId": "laptop",
                        "updatedAt": "2026-09-17T09:00:00.000Z",
                        "notes": [],
                        "noteComments": [],
                        "deletedIds": {
                            note_id: "2026-09-17T09:00:00.000Z",
                        },
                    }

                    (sync_dir / "laptop.json").write_text(
                        json.dumps(snapshot),
                        encoding="utf-8",
                    )

                    result = read_peer_snapshots(sync_dir)

                    self.assertEqual(result["diagnostics"]["fetched"], 1)
                    self.assertNotIn(note_id, result["deletedIds"])


if __name__ == "__main__":
    unittest.main()
