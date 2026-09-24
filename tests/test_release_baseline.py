import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

PROTECTED_SHA256 = {
    "core/Store.js": (
        "7b1cbb50717dad0d07fe73a7db46ceea"
        "77290a0557bd86106dd1e29759fa0abb"
    ),
    "nostr/sync.mjs": (
        "b2c4cb8b1bb16c3518b750b729c2ca"
        "26144c57319f04f4e3c43d25c370330705"
    ),
}

REQUIRED_RUNTIME_FILES = (
    "core/package.json",
    "core/Store.js",
    "extension.js",
    "helper/folder-sync.mjs",
    "helper/lan-pairing.mjs",
    "helper/storage.mjs",
    "helper/syncthing-control.mjs",
    "helper/transnote-helper.mjs",
    "helperClient.js",
    "helperProtocol.js",
    "indicator.js",
    "lanUiModel.js",
    "metadata.json",
    "nostr/sync.mjs",
    "notesMenu.js",
    "schemas/gschemas.compiled",
    "schemas/org.gnome.shell.extensions.transnote.gschema.xml",
    "stylesheet.css",
)


class ReleaseBaselineTests(unittest.TestCase):
    def test_metadata_identifies_release_version_8(self):
        metadata = json.loads((ROOT / "metadata.json").read_text())

        self.assertEqual(metadata["uuid"], "transnote@aridev1")
        self.assertEqual(metadata["version"], 8)
        self.assertEqual(metadata["version-name"], "0.7.0")
        self.assertEqual(metadata["shell-version"], ["46", "50"])
        self.assertEqual(
            metadata["url"],
            "https://github.com/ariDev1/transNote-ubuntu",
        )

    def test_readme_has_user_facing_features_and_install_instructions(self):
        readme = (ROOT / "README.md").read_text()

        for text in (
            "Switch between List and two-column Grid views",
            "## Installation",
            "git clone --branch main --single-branch",
            "## Device sync setup",
        ):
            self.assertIn(text, readme)

        self.assertNotIn("## Development", readme)

    def test_required_runtime_files_exist(self):
        missing = [
            relative
            for relative in REQUIRED_RUNTIME_FILES
            if not (ROOT / relative).is_file()
        ]

        self.assertEqual(missing, [])

    def test_protected_files_match_trusted_sha256(self):
        for relative, expected in PROTECTED_SHA256.items():
            with self.subTest(path=relative):
                digest = hashlib.sha256(
                    (ROOT / relative).read_bytes()
                ).hexdigest()

                self.assertEqual(digest, expected)

    def test_metadata_is_valid_json_object(self):
        metadata = json.loads((ROOT / "metadata.json").read_text())

        self.assertIsInstance(metadata, dict)


if __name__ == "__main__":
    unittest.main()
