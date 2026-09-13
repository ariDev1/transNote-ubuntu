import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class LanSetupUiTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / "notesMenu.js").read_text()

    def test_setup_explains_trusted_peer_filter(self):
        self.assertIn("text: 'Trusted peers'", self.source)
        self.assertIn(
            "Only notes from these machine names are accepted.",
            self.source,
        )

    def test_syncthing_setup_is_presented_as_optional_transport(self):
        self.assertIn("label: 'Set up Syncthing'", self.source)
        self.assertIn(
            "If this folder is already synchronized, no Syncthing setup is required.",
            self.source,
        )
        self.assertIn("text: 'Your Syncthing setup code'", self.source)
        self.assertIn("text: 'Connect another machine'", self.source)
        self.assertIn("label: 'Connect'", self.source)
        self.assertNotIn("label: 'Prepare LAN'", self.source)

    def test_no_pair_status_does_not_block_external_folder_sync(self):
        self.assertIn(
            "No Syncthing machines paired. Existing folder sync can still work.",
            self.source,
        )


if __name__ == "__main__":
    unittest.main()
