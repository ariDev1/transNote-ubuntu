import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SetupDefaultsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ['node', '--input-type=module', '--eval', source],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_first_run_gets_name_and_sync_folder(self):
        result = self.run_node("""
import {setupDefaults} from './setupDefaults.js';
const value = setupDefaults({
  deviceId: '',
  syncDir: '',
  seed: 'machine-123',
  homeDir: '/home/rene',
});
if (!value.deviceId) process.exit(2);
if (value.syncDir !== '/home/rene/transnote-lan') process.exit(3);
console.log(JSON.stringify(value));
""")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_existing_settings_are_not_replaced(self):
        result = self.run_node("""
import {setupDefaults} from './setupDefaults.js';
const value = setupDefaults({
  deviceId: 'ManualBridge',
  syncDir: '/data/transnote',
  seed: 'different-machine',
  homeDir: '/home/rene',
});
if (value.deviceId !== 'ManualBridge') process.exit(2);
if (value.syncDir !== '/data/transnote') process.exit(3);
""")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_existing_partial_setup_is_not_completed_automatically(self):
        result = self.run_node("""
import {setupDefaults} from './setupDefaults.js';
const value = setupDefaults({
  deviceId: 'ManualBridge',
  syncDir: '',
  seed: 'machine-123',
  homeDir: '/home/rene',
});
if (value.deviceId !== 'ManualBridge') process.exit(2);
if (value.syncDir !== '') process.exit(3);
""")
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
