import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ScrollbarUiTests(unittest.TestCase):
    def test_scroll_views_use_normal_scrollbar_gutters(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertNotIn("overlay_scrollbars: true", source)
        self.assertEqual(
            source.count("overlay_scrollbars: false"),
            2,
        )


if __name__ == "__main__":
    unittest.main()
