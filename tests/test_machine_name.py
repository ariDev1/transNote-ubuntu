import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MachineNameTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ['node', '--input-type=module', '--eval', source],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_same_seed_returns_stable_enterprise_name(self):
        result = self.run_node("""
import {ENTERPRISE_MACHINE_NAMES, machineNameForSeed} from './machineName.js';
const first = machineNameForSeed('0123456789abcdef');
const second = machineNameForSeed('0123456789abcdef');
if (first !== second) process.exit(2);
if (!ENTERPRISE_MACHINE_NAMES.includes(first)) process.exit(3);
console.log(first);
""")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.strip())

    def test_pool_is_large_fun_and_machine_safe(self):
        result = self.run_node("""
import {ENTERPRISE_MACHINE_NAMES} from './machineName.js';
if (ENTERPRISE_MACHINE_NAMES.length < 40) process.exit(2);
if (!ENTERPRISE_MACHINE_NAMES.includes('QDidIt')) process.exit(3);
if (!ENTERPRISE_MACHINE_NAMES.includes('TeaEarlGreyHot')) process.exit(4);
if (!ENTERPRISE_MACHINE_NAMES.includes('TribbleContainment')) process.exit(5);
for (const name of ENTERPRISE_MACHINE_NAMES) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) process.exit(6);
}
console.log(ENTERPRISE_MACHINE_NAMES.length);
""")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_empty_seed_still_returns_valid_name(self):
        result = self.run_node("""
import {ENTERPRISE_MACHINE_NAMES, machineNameForSeed} from './machineName.js';
const value = machineNameForSeed('');
if (!ENTERPRISE_MACHINE_NAMES.includes(value)) process.exit(2);
console.log(value);
""")
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
