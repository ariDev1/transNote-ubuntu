import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin" / "transnote-agent"
INSTALL = ROOT / "tools" / "install-agent-cli.sh"
UNINSTALL = ROOT / "tools" / "uninstall-agent-cli.sh"


class AgentInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.bin_dir = self.home / ".local" / "bin"
        self.command = self.bin_dir / "transnote-agent"
        self.env = os.environ.copy()
        self.env["HOME"] = str(self.home)

    def run_script(self, script):
        return subprocess.run(
            [str(script)],
            cwd=ROOT,
            env=self.env,
            capture_output=True,
            text=True,
        )

    def test_install_creates_user_level_symlink(self):
        result = self.run_script(INSTALL)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.command.is_symlink())
        self.assertEqual(self.command.resolve(), CLI.resolve())

    def test_install_is_idempotent(self):
        self.assertEqual(self.run_script(INSTALL).returncode, 0)
        self.assertEqual(self.run_script(INSTALL).returncode, 0)
        self.assertEqual(self.command.resolve(), CLI.resolve())

    def test_install_does_not_replace_foreign_file(self):
        self.bin_dir.mkdir(parents=True)
        self.command.write_text("foreign\n", encoding="utf-8")
        result = self.run_script(INSTALL)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.command.read_text(encoding="utf-8"), "foreign\n")

    def test_uninstall_removes_only_own_symlink(self):
        self.assertEqual(self.run_script(INSTALL).returncode, 0)
        result = self.run_script(UNINSTALL)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.command.exists())
        self.assertFalse(self.command.is_symlink())

    def test_uninstall_does_not_remove_foreign_symlink(self):
        self.bin_dir.mkdir(parents=True)
        foreign = self.home / "foreign"
        foreign.write_text("foreign\n", encoding="utf-8")
        self.command.symlink_to(foreign)
        result = self.run_script(UNINSTALL)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.command.resolve(), foreign.resolve())

    def test_scripts_do_not_modify_shell_configuration_or_plugin_data(self):
        combined = INSTALL.read_text(encoding="utf-8") + UNINSTALL.read_text(encoding="utf-8")
        for token in (
            "sudo",
            ".bashrc",
            ".zshrc",
            ".profile",
            "/etc/",
            "notes.json",
            "transnote-lan",
            "syncthing",
            "pairing",
        ):
            with self.subTest(token=token):
                self.assertNotIn(token, combined)


if __name__ == "__main__":
    unittest.main()
