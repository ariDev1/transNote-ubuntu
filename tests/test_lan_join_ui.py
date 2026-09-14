import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class LanJoinUiTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / "notesMenu.js").read_text()
        self.client = (ROOT / "helperClient.js").read_text()

    def test_normal_setup_separates_create_from_join(self):
        self.assertIn("label: 'Start new sync'", self.source)
        self.assertIn("text: 'Join existing sync'", self.source)
        self.assertNotIn("label: 'Enable device sync'", self.source)

    def test_existing_tn1_join_remains_available(self):
        self.assertIn("hint_text: 'Paste TransNote setup code'", self.source)
        self.assertIn("this._helper.pairLan(", self.source)

    def test_advanced_manual_join_is_available_for_omarchy(self):
        for text in (
            "text: 'Join existing Omarchy or manual share'",
            "hint_text: 'Remote TransNote machine name'",
            "hint_text: 'Syncthing device ID'",
            "hint_text: 'Existing folder ID'",
            "label: 'Join existing share'",
            "this._helper.joinExistingLan(",
        ):
            self.assertIn(text, self.source)

    def test_helper_client_exposes_manual_existing_share_join(self):
        self.assertIn("'lan-join-existing'", self.client)
        self.assertIn("async joinExistingLan(", self.client)


if __name__ == "__main__":
    unittest.main()
