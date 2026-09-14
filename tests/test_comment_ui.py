import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CommentUiTests(unittest.TestCase):
    def test_helper_client_exposes_comment_add(self):
        source = (ROOT / "helperClient.js").read_text()

        self.assertIn("'comment-add'", source)
        self.assertIn("async addComment(", source)

    def test_notes_menu_renders_and_submits_comments(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("note.comments", source)
        self.assertIn("transnote-comments", source)
        self.assertIn("transnote-comment-row", source)
        self.assertIn("transnote-comment-entry", source)
        self.assertIn("this._helper.addComment(", source)
        self.assertIn("_addComment(", source)

    def test_comment_draft_survives_poll_refresh_while_editing(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("this._commentDrafts = new Map()", source)
        self.assertIn("this._commentFocusedNoteId = ''", source)
        self.assertIn("this._commentSubmitNoteId = ''", source)
        self.assertIn("'key-focus-in'", source)
        self.assertIn("'key-focus-out'", source)
        self.assertIn("this._commentDrafts.get(note.id)", source)
        self.assertIn("this._commentFocusedNoteId === ''", source)
        self.assertIn("this._commentSubmitNoteId === ''", source)
        load_at = source.index("const result = await this._helper.loadNotes")
        render_guard_at = source.index("this._commentFocusedNoteId === ''")
        self.assertLess(load_at, render_guard_at)

    def test_comment_styles_are_structured(self):
        source = (ROOT / "stylesheet.css").read_text()

        self.assertIn(".transnote-comments", source)
        self.assertIn(".transnote-comment-row", source)
        self.assertIn(".transnote-comment-author", source)
        self.assertIn(".transnote-comment-entry", source)


if __name__ == "__main__":
    unittest.main()
