import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FooterMetadataTests(unittest.TestCase):
    def test_metadata_separates_gnome_and_product_versions(self):
        metadata = json.loads((ROOT / "metadata.json").read_text())

        self.assertEqual(metadata["version"], 6)
        self.assertEqual(metadata["version-name"], "0.5.1")

    def test_extension_passes_metadata_to_indicator(self):
        source = (ROOT / "extension.js").read_text()

        self.assertIn(
            "version: this.metadata['version-name']",
            source,
        )
        self.assertIn(
            "revision: readRevision(this.path)",
            source,
        )
        self.assertIn(
            "repositoryUrl: this.metadata.url",
            source,
        )

    def test_revision_stamp_is_fail_closed(self):
        source = (ROOT / "extension.js").read_text()

        self.assertIn(
            "const REVISION_FILE = '.transnote-revision';",
            source,
        )
        self.assertIn(
            "/^[0-9a-f]{7,40}$/i",
            source,
        )
        self.assertIn(
            "revision.slice(0, 8).toLowerCase()",
            source,
        )
        self.assertIn(
            "catch {",
            source,
        )

    def test_indicator_passes_metadata_to_notes_view(self):
        source = (ROOT / "indicator.js").read_text()

        self.assertIn(
            "constructor({helper, cancellable, settings, version, revision, repositoryUrl})",
            source,
        )
        self.assertIn(
            "version,",
            source,
        )
        self.assertIn(
            "revision,",
            source,
        )
        self.assertIn(
            "repositoryUrl,",
            source,
        )

    def test_notes_menu_renders_version_revision_and_repository_footer(self):
        source = (ROOT / "notesMenu.js").read_text()

        for parameter in (
            "helper,",
            "cancellable,",
            "settings,",
            "version,",
            "revision,",
            "repositoryUrl,",
        ):
            self.assertIn(parameter, source)

        self.assertIn(
            "this._revision = String(revision ?? '').trim();",
            source,
        )
        self.assertIn(
            "text: this._version",
            source,
        )
        self.assertNotIn(
            "text: `v${this._version}`",
            source,
        )
        self.assertIn(
            "text: this._revision",
            source,
        )
        self.assertIn(
            "transnote-revision",
            source,
        )
        self.assertIn(
            "transnote-footer",
            source,
        )
        self.assertIn(
            "label: 'GitHub'",
            source,
        )
        self.assertIn(
            "transnote-repository-link",
            source,
        )
        self.assertIn(
            "_openRepository(",
            source,
        )

    def test_footer_uses_async_default_uri_handler(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn(
            "launch_default_for_uri_async",
            source,
        )
        self.assertIn(
            "this._repositoryUrl",
            source,
        )

    def test_footer_styles_are_structured(self):
        source = (ROOT / "stylesheet.css").read_text()

        self.assertIn(".transnote-footer", source)
        self.assertIn(".transnote-version", source)
        self.assertIn(".transnote-revision", source)
        self.assertIn(".transnote-repository-link", source)

    def test_revision_stamp_is_not_committed(self):
        source = (ROOT / ".gitignore").read_text()

        self.assertIn(
            ".transnote-revision",
            source.splitlines(),
        )


if __name__ == "__main__":
    unittest.main()
