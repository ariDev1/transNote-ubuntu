import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AttachmentPathTests(unittest.TestCase):
    def test_rejects_note_id_path_traversal(self):
        script = r"""
import {resolveAttachmentPath} from './helper/attachments.mjs';

try {
  resolveAttachmentPath(
    '/tmp/transnote-data/attachments',
    '../escape',
    'att-1',
    'document.txt'
  );
  console.log('NO_ERROR');
} catch (error) {
  console.log(error.code || error.message);
}
"""

        result = subprocess.run(
            [
                'node',
                '--input-type=module',
                '--eval',
                script,
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            'UNSAFE_ATTACHMENT_PATH',
        )

    def test_rejects_attachment_id_path_traversal(self):
        script = r"""
import {resolveAttachmentPath} from './helper/attachments.mjs';

try {
  resolveAttachmentPath(
    '/tmp/transnote-data/attachments',
    'note-1',
    '../escape',
    'document.txt'
  );
  console.log('NO_ERROR');
} catch (error) {
  console.log(error.code || error.message);
}
"""

        result = subprocess.run(
            [
                'node',
                '--input-type=module',
                '--eval',
                script,
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=result.stderr,
        )
        self.assertEqual(
            result.stdout.strip(),
            'UNSAFE_ATTACHMENT_PATH',
        )


    def test_stages_bytes_and_reports_staged_sha256(self):
        import hashlib
        import json
        import tempfile

        source_bytes = b"TransNote attachment\n"
        expected_hash = hashlib.sha256(source_bytes).hexdigest()

        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            source = temp_path / "source.txt"
            root = temp_path / "attachments"
            source.write_bytes(source_bytes)

            script = f"""
import {{stageAttachment}} from './helper/attachments.mjs';

const result = await stageAttachment({{
  attachmentRoot: {json.dumps(str(root))},
  noteId: 'note-1',
  attachmentId: 'att-1',
  fileName: 'document.txt',
  sourcePath: {json.dumps(str(source))}
}});

console.log(JSON.stringify(result));
"""

            result = subprocess.run(
                [
                    'node',
                    '--input-type=module',
                    '--eval',
                    script,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            staged = json.loads(result.stdout)

            self.assertEqual(staged["size"], len(source_bytes))
            self.assertEqual(staged["sha256"], expected_hash)

            staged_path = Path(staged["path"])
            self.assertEqual(
                staged_path,
                root / "note-1" / "att-1-document.txt",
            )
            self.assertEqual(staged_path.read_bytes(), source_bytes)


    def test_rejects_oversized_source_without_staged_file(self):
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            source = temp_path / "oversized.bin"
            root = temp_path / "attachments"

            script = f"""
import {{open}} from 'node:fs/promises';
import {{createRequire}} from 'node:module';
import {{stageAttachment}} from './helper/attachments.mjs';

const require = createRequire(import.meta.url);
const Store = require('./core/Store.js');

const sourcePath = {json.dumps(str(source))};

const handle = await open(sourcePath, 'w');
await handle.truncate(Store.MAX_ATTACHMENT_BYTES + 1);
await handle.close();

try {{
  await stageAttachment({{
    attachmentRoot: {json.dumps(str(root))},
    noteId: 'note-1',
    attachmentId: 'att-1',
    fileName: 'document.bin',
    sourcePath,
  }});

  console.log('NO_ERROR');
}} catch (error) {{
  console.log(error.code || error.message);
}}
"""

            result = subprocess.run(
                [
                    'node',
                    '--input-type=module',
                    '--eval',
                    script,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertEqual(
                result.stdout.strip(),
                'ATTACHMENT_TOO_LARGE',
            )

            staged_path = (
                root /
                'note-1' /
                'att-1-document.bin'
            )
            self.assertFalse(staged_path.exists())


    def test_staging_uses_store_filename_sanitation(self):
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            source = temp_path / "source.txt"
            root = temp_path / "attachments"

            source.write_bytes(b"safe content\n")

            script = f"""
import {{stageAttachment}} from './helper/attachments.mjs';

const result = await stageAttachment({{
  attachmentRoot: {json.dumps(str(root))},
  noteId: 'note-1',
  attachmentId: 'att-1',
  fileName: '../../escape.txt',
  sourcePath: {json.dumps(str(source))}
}});

console.log(result.path);
"""

            result = subprocess.run(
                [
                    'node',
                    '--input-type=module',
                    '--eval',
                    script,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            expected = (
                root /
                'note-1' /
                'att-1-escape.txt'
            )

            self.assertEqual(
                Path(result.stdout.strip()),
                expected,
            )
            self.assertEqual(
                expected.read_bytes(),
                b"safe content\n",
            )


if __name__ == '__main__':
    unittest.main()
