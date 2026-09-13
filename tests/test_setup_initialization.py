import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SetupInitializationTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / 'extension.js').read_text()

    def test_extension_initializes_first_run_before_helper(self):
        self.assertIn("import GLib from 'gi://GLib';", self.source)
        self.assertIn("import {setupDefaults} from './setupDefaults.js';", self.source)
        self.assertIn("Gio.File.new_for_path('/etc/machine-id')", self.source)
        self.assertIn('setupDefaults({', self.source)
        self.assertLess(
            self.source.index('ensureSetupDefaults(this._settings);'),
            self.source.index('new HelperClient('),
        )

    def test_existing_settings_are_only_written_when_initialized(self):
        self.assertIn('if (!defaults.initialized)', self.source)
        self.assertIn("settings.set_string('device-id', defaults.deviceId);", self.source)
        self.assertIn("settings.set_string('sync-dir', defaults.syncDir);", self.source)


if __name__ == '__main__':
    unittest.main()
