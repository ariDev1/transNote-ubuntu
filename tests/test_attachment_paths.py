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


if __name__ == '__main__':
    unittest.main()
