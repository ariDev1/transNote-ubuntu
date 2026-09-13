import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class NotesToolbarUiTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / "notesMenu.js").read_text()
        self.styles = (ROOT / "stylesheet.css").read_text()

    def test_toolbar_prioritizes_new_note_and_keeps_setup_secondary(self):
        self.assertIn("style_class: 'transnote-toolbar'", self.source)
        self.assertIn("label: 'New note'", self.source)
        self.assertIn("label: 'Setup'", self.source)
        self.assertIn(
            "style_class: 'button transnote-new-note-button'",
            self.source,
        )
        self.assertIn(
            "style_class: 'button transnote-settings-button'",
            self.source,
        )
        self.assertLess(
            self.source.index("this._newNoteButton"),
            self.source.index("this._setupTab"),
        )

    def test_note_composer_is_hidden_until_requested(self):
        self.assertIn("style_class: 'transnote-composer'", self.source)
        self.assertIn("visible: false", self.source)
        self.assertIn("label: 'Cancel'", self.source)
        self.assertIn(
            "() => this._setComposerVisible(true)",
            self.source,
        )

    def test_setup_hides_new_note_action_and_marks_active_view(self):
        self.assertIn(
            "this._newNoteButton.visible = !setup;",
            self.source,
        )
        self.assertIn(
            "this._notesTab.remove_style_class_name("
            "'transnote-tab-active');",
            self.source,
        )
        self.assertIn(
            "this._setupTab.remove_style_class_name("
            "'transnote-tab-active');",
            self.source,
        )

    def test_cancel_and_successful_create_close_composer(self):
        self.assertIn("_cancelComposer()", self.source)
        self.assertIn(
            "this._titleEntry.set_text('');",
            self.source,
        )
        self.assertIn(
            "this._bodyEntry.set_text('');",
            self.source,
        )
        self.assertGreaterEqual(
            self.source.count(
                "this._setComposerVisible(false);"
            ),
            2,
        )

    def test_toolbar_and_composer_styles_are_structured(self):
        for selector in (
            ".transnote-toolbar",
            ".transnote-new-note-button",
            ".transnote-settings-button",
            ".transnote-composer",
            ".transnote-composer-actions",
        ):
            self.assertIn(selector, self.styles)


if __name__ == "__main__":
    unittest.main()
