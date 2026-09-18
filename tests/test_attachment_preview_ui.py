import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_model(script):
    return subprocess.run(
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


class AttachmentPreviewUiTests(unittest.TestCase):
    def test_preview_model_accepts_only_usable_raster_images(self):
        result = run_model("""
import {
  canPreviewAttachment,
} from './attachmentUiModel.js';

const cases = [
  {
    attachment: {kind: 'image', mime: 'image/png'},
    state: 'local',
  },
  {
    attachment: {kind: 'image', mime: 'image/jpeg'},
    state: 'verified',
  },
  {
    attachment: {kind: 'image', mime: 'image/png'},
    state: 'waiting',
  },
  {
    attachment: {kind: 'text', mime: 'text/plain'},
    state: 'verified',
  },
  {
    attachment: {kind: 'image', mime: 'image/svg+xml'},
    state: 'verified',
  },
];

console.log(JSON.stringify(
  cases.map(value => canPreviewAttachment(
    value.attachment,
    value.state
  ))
));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            [True, True, False, False, False],
        )

    def test_helper_client_exposes_preview_action(self):
        source = (ROOT / "helperClient.js").read_text()

        self.assertIn("'attachment-preview'", source)
        self.assertIn("async previewAttachment(", source)
        self.assertIn(
            "this._run(\n      'attachment-preview'",
            source,
        )

    def test_helper_preview_uses_existing_verified_resolver(self):
        source = (ROOT / "helper" / "transnote-helper.mjs").read_text()

        start = source.index("async function attachmentPreview")
        end = source.index("async function attachmentOpen", start)
        block = source[start:end]

        self.assertIn("resolveAttachmentActionTarget(", block)
        self.assertIn("target.attachment.kind !== 'image'", block)
        self.assertIn(
            "target.attachment.mime === 'image/svg+xml'",
            block,
        )
        self.assertIn("path: target.path", block)
        self.assertIn(
            "command === 'attachment-preview'",
            source,
        )

    def test_notes_menu_wires_image_preview(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("canPreviewAttachment,", source)
        self.assertIn(
            "this._attachmentPreviewPaths = new Map();",
            source,
        )
        self.assertIn(
            "this._attachmentPreviewPending = new Set();",
            source,
        )
        self.assertIn(
            "this._helper.previewAttachment(",
            source,
        )
        self.assertIn("Gio.File.new_for_path(", source)
        self.assertIn("Gio.FileIcon.new(", source)
        self.assertIn(
            "style_class: 'transnote-attachment-preview'",
            source,
        )
        self.assertIn(
            "style_class: 'transnote-attachment-preview-button'",
            source,
        )

    def test_stylesheet_contains_preview_classes(self):
        source = (ROOT / "stylesheet.css").read_text()

        self.assertIn(
            ".transnote-attachment-preview-button",
            source,
        )
        self.assertIn(
            ".transnote-attachment-preview",
            source,
        )


if __name__ == "__main__":
    unittest.main()
