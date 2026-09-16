import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "noteUiModel.js"


def run_model(body):
    script = f"""
import {{
  compactNotePreview,
  compactNoteSummary,
}} from './noteUiModel.js';
{body}
"""
    return subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class CompactNoteModelTests(unittest.TestCase):
    def setUp(self):
        if not MODEL.exists():
            self.skipTest("noteUiModel.js is not implemented yet")

    def test_preview_is_single_line_and_bounded(self):
        result = run_model("""
const value = compactNotePreview(
  'alpha\\n beta   gamma ' + 'x'.repeat(180),
  80
);
console.log(JSON.stringify(value));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        value = json.loads(result.stdout)

        self.assertNotIn("\\n", value)
        self.assertLessEqual(len(value), 80)
        self.assertTrue(value.endswith("…"))

    def test_summary_reports_comments_and_attachments(self):
        result = run_model("""
console.log(JSON.stringify(compactNoteSummary({
  comments: [{id: 'c1'}, {id: 'c2'}],
  attachments: [{id: 'a1'}],
})));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            "2 comments · 1 attachment",
        )


class CompactNoteUiTests(unittest.TestCase):
    def test_note_ui_model_exists(self):
        self.assertTrue(MODEL.exists())

    def test_notes_are_expandable_and_hoverable(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("_expandedNoteId", source)
        self.assertIn("track_hover: true", source)
        self.assertIn("transnote-note-toggle", source)
        self.assertIn(
            """const toggleContent = new St.BoxLayout({
        x_expand: true,
        style_class: 'transnote-note-toggle-content',
      });""",
            source,
        )
        self.assertIn("_toggleNoteExpanded(", source)
        self.assertIn("compactNotePreview(", source)
        self.assertIn("compactNoteSummary(", source)

    def test_hover_and_expanded_states_have_css(self):
        source = (ROOT / "stylesheet.css").read_text()

        self.assertIn(".transnote-note:hover", source)
        self.assertIn(".transnote-note.transnote-note-expanded", source)
        self.assertIn(".transnote-note-preview", source)
        self.assertIn(".transnote-note-summary", source)


if __name__ == "__main__":
    unittest.main()
