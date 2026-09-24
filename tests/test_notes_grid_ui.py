import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class NotesGridUiTests(unittest.TestCase):
    def test_notes_use_two_column_box_rows(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("this._viewMode = 'list';", source)
        self.assertIn("_setViewMode('list')", source)
        self.assertIn("_setViewMode('grid')", source)
        self.assertIn("const addGridTile = tile => {", source)
        self.assertIn("style_class: 'transnote-grid-row'", source)
        self.assertIn("gridRows[Math.floor(gridIndex / 2)].add_child(tile);", source)
        self.assertIn("_createGridTile(note)", source)
        self.assertIn("this._notesBox.insert_child_at_index(box, rowPosition);", source)

    def test_scroll_view_keeps_scrollable_box_layout_child(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("this._notesBox = new St.BoxLayout({", source)
        self.assertIn("this._scrollView.set_child(this._notesBox);", source)
        self.assertIn("this._notesBox.add_child(row);", source)

    def test_grid_styles_are_defined(self):
        source = (ROOT / "stylesheet.css").read_text()

        self.assertIn(".transnote-grid-row", source)
        self.assertIn(".transnote-layout-button", source)
        self.assertIn(".transnote-note {\n  min-width: 0;", source)

    def test_notes_viewport_height_tracks_monitor_geometry(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("global.display.get_monitor_geometry(monitor)", source)
        self.assertIn("monitorHeight * 0.75 - 175", source)
        self.assertIn("this._scrollView.set_style(", source)

    def test_view_mode_buttons_use_neutral_spacious_style(self):
        source = (ROOT / "stylesheet.css").read_text()

        self.assertIn(".transnote-status-row {\n  spacing: 8px;", source)
        self.assertIn("min-width: 0;\n  padding: 4px 9px;", source)
        self.assertIn(".transnote-layout-active {\n  background-color: rgba(255, 255, 255, 0.08);\n  box-shadow: none;", source)


if __name__ == "__main__":
    unittest.main()
