import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ReceivedAttachmentTests(unittest.TestCase):
    def inspect(self, sync_dir, note_id, attachment):
        script = f"""
import {{inspectReceivedAttachment}} from './helper/attachments.mjs';

const result = await inspectReceivedAttachment({{
  syncDir: {json.dumps(str(sync_dir))},
  noteId: {json.dumps(note_id)},
  attachment: {json.dumps(attachment)}
}});

console.log(JSON.stringify(result));
"""

        result = subprocess.run(
            ['node', '--input-type=module', '--eval', script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return json.loads(result.stdout)

    def test_verified_when_bytes_match_metadata(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            sync_dir = Path(temp)
            data = b"verified attachment\n"
            sha = hashlib.sha256(data).hexdigest()

            path = (
                sync_dir /
                ".attachments" /
                "note-1" /
                "att-1-file.txt"
            )
            path.parent.mkdir(parents=True)
            path.write_bytes(data)

            result = self.inspect(
                sync_dir,
                "note-1",
                {
                    "id": "att-1",
                    "name": "file.txt",
                    "size": len(data),
                    "sha256": sha,
                },
            )

            self.assertEqual(result["state"], "verified")

    def test_invalid_when_hash_does_not_match(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            sync_dir = Path(temp)
            data = b"wrong bytes\n"
            expected = hashlib.sha256(b"expected bytes\n").hexdigest()

            path = (
                sync_dir /
                ".attachments" /
                "note-1" /
                "att-1-file.txt"
            )
            path.parent.mkdir(parents=True)
            path.write_bytes(data)

            result = self.inspect(
                sync_dir,
                "note-1",
                {
                    "id": "att-1",
                    "name": "file.txt",
                    "size": len(b"expected bytes\n"),
                    "sha256": expected,
                },
            )

            self.assertEqual(result["state"], "invalid")

            # Verification must not destroy peer bytes.
            self.assertEqual(path.read_bytes(), data)

    def test_missing_when_attachment_root_exists_but_file_does_not(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            sync_dir = Path(temp)
            (sync_dir / ".attachments").mkdir()

            result = self.inspect(
                sync_dir,
                "note-1",
                {
                    "id": "att-1",
                    "name": "file.txt",
                    "size": 4,
                    "sha256": hashlib.sha256(b"test").hexdigest(),
                },
            )

            self.assertEqual(result["state"], "missing")

    def test_waiting_when_attachment_sync_root_has_not_arrived(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            sync_dir = Path(temp)

            result = self.inspect(
                sync_dir,
                "note-1",
                {
                    "id": "att-1",
                    "name": "file.txt",
                    "size": 4,
                    "sha256": hashlib.sha256(b"test").hexdigest(),
                },
            )

            self.assertEqual(result["state"], "waiting")


    def test_invalid_when_attachment_root_is_symlink(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            sync_dir = base / "sync"
            outside = base / "outside"
            sync_dir.mkdir()
            outside.mkdir()

            data = b"outside bytes\n"
            sha = hashlib.sha256(data).hexdigest()

            outside_path = (
                outside
                / "note-1"
                / "att-1-file.txt"
            )
            outside_path.parent.mkdir()
            outside_path.write_bytes(data)

            (sync_dir / ".attachments").symlink_to(
                outside,
                target_is_directory=True,
            )

            result = self.inspect(
                sync_dir,
                "note-1",
                {
                    "id": "att-1",
                    "name": "file.txt",
                    "size": len(data),
                    "sha256": sha,
                },
            )

            self.assertEqual(result["state"], "invalid")
            self.assertEqual(outside_path.read_bytes(), data)

    def test_invalid_when_attachment_note_directory_is_symlink(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            sync_dir = base / "sync"
            attachment_root = sync_dir / ".attachments"
            outside = base / "outside-note"

            attachment_root.mkdir(parents=True)
            outside.mkdir()

            data = b"outside bytes\n"
            sha = hashlib.sha256(data).hexdigest()

            outside_path = outside / "att-1-file.txt"
            outside_path.write_bytes(data)

            (attachment_root / "note-1").symlink_to(
                outside,
                target_is_directory=True,
            )

            result = self.inspect(
                sync_dir,
                "note-1",
                {
                    "id": "att-1",
                    "name": "file.txt",
                    "size": len(data),
                    "sha256": sha,
                },
            )

            self.assertEqual(result["state"], "invalid")
            self.assertEqual(outside_path.read_bytes(), data)

    def test_invalid_when_attachment_file_is_symlink(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            sync_dir = base / "sync"
            note_dir = (
                sync_dir
                / ".attachments"
                / "note-1"
            )
            note_dir.mkdir(parents=True)

            outside_path = base / "outside.txt"
            data = b"outside bytes\n"
            outside_path.write_bytes(data)

            (note_dir / "att-1-file.txt").symlink_to(
                outside_path
            )

            result = self.inspect(
                sync_dir,
                "note-1",
                {
                    "id": "att-1",
                    "name": "file.txt",
                    "size": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                },
            )

            self.assertEqual(result["state"], "invalid")
            self.assertEqual(outside_path.read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
