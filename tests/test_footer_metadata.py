import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FooterMetadataTests(unittest.TestCase):
    def test_extension_passes_metadata_to_indicator(self):
        source = (ROOT / "extension.js").read_text()

        self.assertIn(
            "version: this.metadata.version",
            source,
        )
        self.assertIn(
            "repositoryUrl: this.metadata.url",
            source,
        )

    def test_indicator_passes_metadata_to_notes_view(self):
        source = (ROOT / "indicator.js").read_text()

        self.assertIn(
            "constructor({helper, cancellable, settings, version, repositoryUrl})",
            source,
        )
        self.assertIn(
            "version,",
            source,
        )
        self.assertIn(
            "repositoryUrl,",
            source,
        )

    def test_notes_menu_renders_version_and_repository_footer(self):
        source = (ROOT / "notesMenu.js").read_text()

        for parameter in (
            "helper,",
            "cancellable,",
            "settings,",
            "version,",
            "repositoryUrl,",
        ):
            self.assertIn(parameter, source)
        self.assertIn(
            "transnote-footer",
            source,
        )
        self.assertIn(
            "transnote-version",
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
        self.assertIn(".transnote-repository-link", source)


if __name__ == "__main__":
    unittest.main()
