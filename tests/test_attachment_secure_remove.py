import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AttachmentSecureRemoveTests(unittest.TestCase):
    def test_remove_does_not_follow_symlinked_attachment_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            sync_dir = root / "sync"
            sync_dir.mkdir()

            outside = root / "outside"
            outside_note = outside / "note-1"
            outside_note.mkdir(parents=True)

            sentinel = outside_note / "must-survive.txt"
            sentinel.write_text("outside data", encoding="utf-8")

            attachment_root = sync_dir / ".attachments"
            attachment_root.symlink_to(outside, target_is_directory=True)

            script = f"""
import {{removeAttachmentNoteDirectory}} from './helper/attachments.mjs';

try {{
  await removeAttachmentNoteDirectory({{
    attachmentRoot: {json.dumps(str(attachment_root))},
    noteId: 'note-1',
  }});
  console.log('REMOVED');
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

            self.assertTrue(
                sentinel.exists(),
                "recursive removal followed the symlinked attachment root",
            )


    def test_remove_does_not_follow_symlinked_note_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            attachment_root = root / "sync" / ".attachments"
            attachment_root.mkdir(parents=True)

            outside_note = root / "outside-note"
            outside_note.mkdir()

            sentinel = outside_note / "must-survive.txt"
            sentinel.write_text("outside data", encoding="utf-8")

            note_link = attachment_root / "note-1"
            note_link.symlink_to(outside_note, target_is_directory=True)

            script = f"""
import {{removeAttachmentNoteDirectory}} from './helper/attachments.mjs';

try {{
  await removeAttachmentNoteDirectory({{
    attachmentRoot: {json.dumps(str(attachment_root))},
    noteId: 'note-1',
  }});
  console.log('REMOVED');
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

            self.assertTrue(
                sentinel.exists(),
                "recursive removal followed the symlinked note directory",
            )


    def test_remove_deletes_normal_note_directory_only(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)

            attachment_root = root / "sync" / ".attachments"
            note_dir = attachment_root / "note-1"
            note_dir.mkdir(parents=True)

            (note_dir / "attachment.txt").write_text(
                "attachment data",
                encoding="utf-8",
            )

            other_note = attachment_root / "note-2"
            other_note.mkdir()
            sentinel = other_note / "must-survive.txt"
            sentinel.write_text("other note", encoding="utf-8")

            script = f"""
import {{removeAttachmentNoteDirectory}} from './helper/attachments.mjs';

await removeAttachmentNoteDirectory({{
  attachmentRoot: {json.dumps(str(attachment_root))},
  noteId: 'note-1',
}});
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
            self.assertFalse(note_dir.exists())
            self.assertTrue(attachment_root.exists())
            self.assertTrue(sentinel.exists())


if __name__ == "__main__":
    unittest.main()
