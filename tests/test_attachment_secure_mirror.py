import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AttachmentSecureMirrorTests(unittest.TestCase):
    def test_mirror_does_not_follow_symlinked_attachment_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            data_dir = root / "data"
            source = (
                data_dir
                / "attachments"
                / "note-1"
                / "att-1-document.txt"
            )
            source.parent.mkdir(parents=True)

            payload = b"trusted private attachment\n"
            source.write_bytes(payload)

            sync_dir = root / "sync"
            sync_dir.mkdir()

            outside = root / "outside"
            outside_target = (
                outside
                / "note-1"
                / "att-1-document.txt"
            )
            outside_target.parent.mkdir(parents=True)

            sentinel = b"must survive\n"
            outside_target.write_bytes(sentinel)

            (sync_dir / ".attachments").symlink_to(
                outside,
                target_is_directory=True,
            )

            attachment = {
                "id": "att-1",
                "name": "document.txt",
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }

            script = f"""
import {{mirrorAttachment}} from './helper/attachments.mjs';

try {{
  await mirrorAttachment({{
    dataDir: {json.dumps(str(data_dir))},
    syncDir: {json.dumps(str(sync_dir))},
    noteId: 'note-1',
    attachment: {json.dumps(attachment)},
  }});
  console.log('MIRRORED');
}} catch (error) {{
  console.log(error.code || error.message);
}}
"""

            result = subprocess.run(
                [
                    "node",
                    "--input-type=module",
                    "--eval",
                    script,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            self.assertEqual(
                outside_target.read_bytes(),
                sentinel,
                "mirror followed the symlinked attachment root",
            )


    def test_mirror_does_not_follow_symlinked_note_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            data_dir = root / "data"
            source = (
                data_dir
                / "attachments"
                / "note-1"
                / "att-1-document.txt"
            )
            source.parent.mkdir(parents=True)

            payload = b"trusted private attachment\n"
            source.write_bytes(payload)

            sync_dir = root / "sync"
            attachment_root = sync_dir / ".attachments"
            attachment_root.mkdir(parents=True)

            outside_note = root / "outside-note"
            outside_note.mkdir()

            outside_target = outside_note / "att-1-document.txt"
            sentinel = b"must survive\n"
            outside_target.write_bytes(sentinel)

            (attachment_root / "note-1").symlink_to(
                outside_note,
                target_is_directory=True,
            )

            attachment = {
                "id": "att-1",
                "name": "document.txt",
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }

            script = f"""
import {{mirrorAttachment}} from './helper/attachments.mjs';

try {{
  await mirrorAttachment({{
    dataDir: {json.dumps(str(data_dir))},
    syncDir: {json.dumps(str(sync_dir))},
    noteId: 'note-1',
    attachment: {json.dumps(attachment)},
  }});
  console.log('MIRRORED');
}} catch (error) {{
  console.log(error.code || error.message);
}}
"""

            result = subprocess.run(
                [
                    "node",
                    "--input-type=module",
                    "--eval",
                    script,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            self.assertEqual(
                outside_target.read_bytes(),
                sentinel,
                "mirror followed the symlinked note directory",
            )


    def test_mirror_does_not_follow_symlinked_target_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            data_dir = root / "data"
            source = (
                data_dir
                / "attachments"
                / "note-1"
                / "att-1-document.txt"
            )
            source.parent.mkdir(parents=True)

            payload = b"trusted private attachment\n"
            source.write_bytes(payload)

            sync_dir = root / "sync"
            note_dir = sync_dir / ".attachments" / "note-1"
            note_dir.mkdir(parents=True)

            outside_target = root / "outside.txt"
            sentinel = b"must survive\n"
            outside_target.write_bytes(sentinel)

            target = note_dir / "att-1-document.txt"
            target.symlink_to(outside_target)

            attachment = {
                "id": "att-1",
                "name": "document.txt",
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }

            script = f"""
import {{mirrorAttachment}} from './helper/attachments.mjs';

try {{
  await mirrorAttachment({{
    dataDir: {json.dumps(str(data_dir))},
    syncDir: {json.dumps(str(sync_dir))},
    noteId: 'note-1',
    attachment: {json.dumps(attachment)},
  }});
  console.log('MIRRORED');
}} catch (error) {{
  console.log(error.code || error.message);
}}
"""

            result = subprocess.run(
                [
                    "node",
                    "--input-type=module",
                    "--eval",
                    script,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            self.assertEqual(
                outside_target.read_bytes(),
                sentinel,
                "mirror followed the symlinked target file",
            )


if __name__ == "__main__":
    unittest.main()
