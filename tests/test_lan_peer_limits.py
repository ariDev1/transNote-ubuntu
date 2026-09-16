import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'helper' / 'folder-sync.mjs'
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_AGGREGATE_BYTES = 8 * 1024 * 1024


def padded_json(value, size):
    raw = json.dumps(value, separators=(',', ':')).encode('utf-8')
    if len(raw) > size:
        raise ValueError('JSON payload exceeds requested size')
    return raw + (b' ' * (size - len(raw)))


def run_reader(sync_dir):
    script = f"""
import {{readPeerSnapshots}} from {json.dumps(MODULE.as_uri())};
const result = await readPeerSnapshots({{
  syncDir: {json.dumps(str(sync_dir))},
  deviceId: 'local',
  allowList: ['peer'],
}});
console.log(JSON.stringify(result));
"""
    result = subprocess.run(
        ['node', '--input-type=module', '--eval', script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


class LanPeerLimitTests(unittest.TestCase):
    def test_rejects_peer_listing_after_32_files_before_parsing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index in range(33):
                payload = {
                    'version': 2,
                    'deviceId': 'peer',
                    'deletedIds': {'must-not-parse': '2026-09-16T00:00:00.000Z'},
                }
                (root / f'peer-{index:02d}.json').write_text(json.dumps(payload))

            result = run_reader(root)

            self.assertEqual(result['diagnostics']['files'], 33)
            self.assertEqual(result['diagnostics']['fetched'], 0)
            self.assertEqual(result['diagnostics']['errors'], 1)
            self.assertEqual(result['deletedIds'], {})

    def test_rejects_peer_file_above_2_mib_before_json_parse(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            payload = {
                'version': 2,
                'deviceId': 'peer',
                'deletedIds': {'must-not-parse': '2026-09-16T00:00:00.000Z'},
            }
            (root / 'peer.json').write_bytes(
                padded_json(payload, MAX_FILE_BYTES + 1)
            )

            result = run_reader(root)

            self.assertEqual(result['diagnostics']['files'], 1)
            self.assertEqual(result['diagnostics']['fetched'], 0)
            self.assertEqual(result['diagnostics']['errors'], 1)
            self.assertEqual(result['deletedIds'], {})

    def test_rejects_content_when_aggregate_would_exceed_8_mib(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index in range(4):
                (root / f'peer-{index:02d}.json').write_bytes(
                    padded_json({}, MAX_FILE_BYTES)
                )
            (root / 'peer-04.json').write_text('{}')

            result = run_reader(root)

            self.assertEqual(result['diagnostics']['files'], 5)
            self.assertEqual(result['diagnostics']['fetched'], 4)
            self.assertEqual(result['diagnostics']['errors'], 1)


    def test_accepts_32_peer_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index in range(32):
                (root / f'peer-{index:02d}.json').write_text('{}')

            result = run_reader(root)

            self.assertEqual(result['diagnostics']['files'], 32)
            self.assertEqual(result['diagnostics']['fetched'], 32)
            self.assertEqual(result['diagnostics']['errors'], 0)

    def test_accepts_peer_file_exactly_2_mib(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'peer.json').write_bytes(
                padded_json({}, MAX_FILE_BYTES)
            )

            result = run_reader(root)

            self.assertEqual(result['diagnostics']['files'], 1)
            self.assertEqual(result['diagnostics']['fetched'], 1)
            self.assertEqual(result['diagnostics']['errors'], 0)

    def test_accepts_aggregate_exactly_8_mib(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index in range(4):
                (root / f'peer-{index:02d}.json').write_bytes(
                    padded_json({}, MAX_FILE_BYTES)
                )

            result = run_reader(root)

            self.assertEqual(result['diagnostics']['files'], 4)
            self.assertEqual(result['diagnostics']['fetched'], 4)
            self.assertEqual(result['diagnostics']['errors'], 0)

    def test_peer_loader_does_not_use_unbounded_whole_file_read(self):
        source = MODULE.read_text()
        self.assertNotIn(
            "readFile(join(config.syncDir, name), 'utf8')",
            source,
        )
        self.assertIn('handle.read(', source)


if __name__ == '__main__':
    unittest.main()
