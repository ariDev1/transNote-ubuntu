import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools" / "opencode"
PROFILE = TOOLS / "agent-v1.md"
CUSTOM_TOOL = TOOLS / "transnote.ts"
COMMON = TOOLS / "common.sh"
INSTALL = TOOLS / "install.sh"
UNINSTALL = TOOLS / "uninstall.sh"
CHECK = TOOLS / "compatibility-check.sh"
MARK = TOOLS / "mark-tested.sh"
RUN = TOOLS / "run.sh"
SECURITY = TOOLS / "security-test.txt"
SHARE_ACCEPTANCE = TOOLS / "share-test.txt"
README = ROOT / "README.md"


class OpenCodeAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        self.fake_bin = Path(self.tmp.name) / "bin"
        self.fake_bin.mkdir()

        self.log = Path(self.tmp.name) / "opencode.log"

        self.env = os.environ.copy()
        self.env["HOME"] = str(self.home)
        self.env["PATH"] = f"{self.fake_bin}:{self.env['PATH']}"
        self.env["FAKE_OPENCODE_VERSION"] = "1.18.31"
        self.env["FAKE_OPENCODE_LOG"] = str(self.log)

        self.write_fake_commands()

    @property
    def agent_dir(self):
        return self.home / ".config" / "opencode" / "agents"

    @property
    def tool_dir(self):
        return self.home / ".config" / "opencode" / "tools"

    @property
    def installed_profile(self):
        return self.agent_dir / "transnote.md"

    @property
    def installed_tool(self):
        return self.tool_dir / "transnote.ts"

    @property
    def marker(self):
        return self.agent_dir / ".transnote-tested-version"

    def write_fake_commands(self):
        opencode = self.fake_bin / "opencode"
        opencode.write_text(
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            'if [[ ${1:-} == "--version" ]]; then\n'
            '    printf \'%s\\n\' "${FAKE_OPENCODE_VERSION}"\n'
            "    exit 0\n"
            "fi\n"
            'if [[ ${1:-} == "agent" && ${2:-} == "list" ]]; then\n'
            "    printf '%s\\n' 'transnote primary'\n"
            "    exit 0\n"
            "fi\n"
            'printf \'%s\\n\' "$*" >> "${FAKE_OPENCODE_LOG}"\n'
            'printf \'%s\\n\' "FAKE_OPENCODE_RUN:$*"\n',
            encoding="utf-8",
        )
        opencode.chmod(0o755)

        cli = self.fake_bin / "transnote-agent"
        cli.write_text(
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            'if [[ ${1:-} == "status" ]]; then\n'
            "    printf '%s\\n' '{\"ok\":true,\"status\":{\"ready\":true},\"protocolVersion\":1}'\n"
            "    exit 0\n"
            "fi\n"
            "printf '%s\\n' '{\"ok\":true,\"protocolVersion\":1}'\n",
            encoding="utf-8",
        )
        cli.chmod(0o755)

        fixed_cli_dir = self.home / ".local" / "bin"
        fixed_cli_dir.mkdir(parents=True)
        fixed_cli = fixed_cli_dir / "transnote-agent"
        fixed_cli.write_text(cli.read_text(encoding="utf-8"), encoding="utf-8")
        fixed_cli.chmod(0o755)

    def run_script(self, script, *args):
        return subprocess.run(
            [str(script), *args],
            cwd=ROOT,
            env=self.env,
            capture_output=True,
            text=True,
        )

    def install(self, version="1.18.31"):
        self.env["FAKE_OPENCODE_VERSION"] = version
        return self.run_script(INSTALL)

    def mark_tested(self):
        return self.run_script(MARK, "--accept-security-test")

    def test_adapter_files_exist(self):
        for path in (
            PROFILE,
            CUSTOM_TOOL,
            COMMON,
            INSTALL,
            UNINSTALL,
            CHECK,
            MARK,
            RUN,
            SECURITY,
        ):
            with self.subTest(path=path):
                self.assertTrue(path.is_file())

    def test_profile_denies_bash_and_allows_only_named_transnote_tools(self):
        text = PROFILE.read_text(encoding="utf-8")

        self.assertIn("permission:", text)
        self.assertIn('  "*": deny', text)
        for name in (
            "transnote_status",
            "transnote_list",
            "transnote_search",
            "transnote_create",
            "transnote_comment",
            "transnote_share",
        ):
            self.assertIn(f'  "{name}": allow', text)
        self.assertIn("  question: allow", text)

        self.assertNotIn('"transnote_*": allow', text)
        self.assertNotIn("bash:", text)
        self.assertNotIn('"transnote-agent *"', text)
        self.assertNotIn("permissions:", text)
        self.assertNotIn("shell:", text)

    def test_custom_tool_exports_only_v1_transnote_capabilities(self):
        text = CUSTOM_TOOL.read_text(encoding="utf-8")

        for name in ("status", "list", "search", "create", "comment", "share"):
            self.assertIn(f"export const {name} = tool(", text)

        for forbidden in (
            "delete",
            "unshare",
            "hide",
            "pair",
            "attach",
            "execute",
            "dispatch",
        ):
            self.assertNotIn(f"export const {forbidden} = tool(", text)

    def test_custom_tool_executes_cli_without_shell(self):
        text = CUSTOM_TOOL.read_text(encoding="utf-8")

        self.assertIn("Bun.spawn", text)
        self.assertIn('const cli = home + "/.local/bin/transnote-agent"', text)
        self.assertNotIn("Bun.$", text)
        self.assertNotIn('["bash"', text)
        self.assertNotIn('["sh"', text)
        self.assertNotIn("shell:", text)

    def test_custom_tool_builds_fixed_argv(self):
        text = CUSTOM_TOOL.read_text(encoding="utf-8")

        self.assertIn('run(["status"])', text)
        self.assertIn('run(["list"])', text)
        self.assertIn('run(["search", args.query])', text)
        self.assertIn(
            'run(["create", "--title", args.title, "--body", args.body])',
            text,
        )
        self.assertIn(
            'run(["comment", args.noteId, "--text", args.text])',
            text,
        )
        self.assertIn('run(["share", args.noteId])', text)

    def test_profile_requires_explicit_user_request_before_share(self):
        text = PROFILE.read_text(encoding="utf-8")

        self.assertIn("`transnote_share`", text)
        self.assertIn(
            "Use `transnote_share` only when the user explicitly asks to share or publish",
            text,
        )

    def test_install_rejects_path_only_transnote_agent(self):
        fixed_cli = self.home / ".local" / "bin" / "transnote-agent"
        fixed_cli.unlink()

        result = self.install()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("TRANSNOTE_AGENT_NOT_FOUND", result.stderr)

    def test_install_copies_profile_and_custom_tool(self):
        result = self.install()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.installed_profile.read_text(encoding="utf-8"),
            PROFILE.read_text(encoding="utf-8"),
        )
        self.assertEqual(
            self.installed_tool.read_text(encoding="utf-8"),
            CUSTOM_TOOL.read_text(encoding="utf-8"),
        )
        self.assertIn("SECURITY_RETEST_REQUIRED", result.stdout)
        self.assertFalse(self.marker.exists())

    def test_install_accepts_other_v1_but_does_not_trust_it(self):
        result = self.install("1.99.0")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SECURITY_RETEST_REQUIRED", result.stdout)
        self.assertFalse(self.marker.exists())

    def test_install_rejects_unknown_major(self):
        result = self.install("2.0.0")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("UNSUPPORTED_OPENCODE_MAJOR", result.stderr)
        self.assertFalse(self.installed_profile.exists())
        self.assertFalse(self.installed_tool.exists())

    def test_install_refuses_foreign_profile(self):
        self.agent_dir.mkdir(parents=True)
        self.installed_profile.write_text("foreign profile\n", encoding="utf-8")

        result = self.install()

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            self.installed_profile.read_text(encoding="utf-8"),
            "foreign profile\n",
        )

    def test_install_refuses_foreign_custom_tool(self):
        self.tool_dir.mkdir(parents=True)
        self.installed_tool.write_text("foreign tool\n", encoding="utf-8")

        result = self.install()

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            self.installed_tool.read_text(encoding="utf-8"),
            "foreign tool\n",
        )

    def test_uninstall_removes_only_owned_profile_tool_and_marker(self):
        self.assertEqual(self.install().returncode, 0)
        self.marker.write_text("1.18.31\n", encoding="utf-8")

        result = self.run_script(UNINSTALL)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.installed_profile.exists())
        self.assertFalse(self.installed_tool.exists())
        self.assertFalse(self.marker.exists())

    def test_uninstall_refuses_foreign_custom_tool(self):
        self.assertEqual(self.install().returncode, 0)
        self.installed_tool.write_text("foreign tool\n", encoding="utf-8")

        result = self.run_script(UNINSTALL)

        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.installed_tool.exists())

    def test_compatibility_requires_profile_and_tool_match(self):
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.mark_tested().returncode, 0)

        self.installed_tool.write_text("changed\n", encoding="utf-8")
        result = self.run_script(CHECK)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("OPENCODE_TRANSNOTE_TOOL_MISMATCH", result.stderr)

    def test_compatibility_requires_security_test_marker(self):
        self.assertEqual(self.install().returncode, 0)

        result = self.run_script(CHECK)

        self.assertEqual(result.returncode, 4)
        self.assertIn("SECURITY_RETEST_REQUIRED", result.stdout)

    def test_mark_tested_requires_explicit_acceptance(self):
        self.assertEqual(self.install().returncode, 0)

        result = self.run_script(MARK)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_mark_tested_records_exact_current_version(self):
        self.assertEqual(self.install().returncode, 0)

        result = self.mark_tested()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.marker.read_text(encoding="utf-8"), "1.18.31\n")

        check = self.run_script(CHECK)
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertIn("COMPATIBILITY_CHECK: PASS", check.stdout)

    def test_version_drift_requires_retest(self):
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.mark_tested().returncode, 0)

        self.env["FAKE_OPENCODE_VERSION"] = "1.18.32"
        result = self.run_script(CHECK)

        self.assertEqual(result.returncode, 4)
        self.assertIn("SECURITY_RETEST_REQUIRED", result.stdout)
        self.assertIn("1.18.31", result.stdout)
        self.assertIn("1.18.32", result.stdout)

    def test_run_refuses_unverified_version(self):
        self.assertEqual(self.install().returncode, 0)

        result = self.run_script(RUN)

        self.assertEqual(result.returncode, 4)
        self.assertFalse(self.log.exists())

    def test_run_starts_only_after_exact_version_is_marked_tested(self):
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.mark_tested().returncode, 0)

        result = self.run_script(RUN)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("FAKE_OPENCODE_RUN:--agent transnote", result.stdout)

    def test_security_test_checks_custom_tool_and_denied_capabilities(self):
        text = SECURITY.read_text(encoding="utf-8")

        for required in (
            "transnote_status",
            "transnote_search",
            "pwd",
            "git status",
            "~/.local/share/transnote/notes.json",
            "web",
            "another agent",
            'query = "$(pwd)"',
        ):
            with self.subTest(required=required):
                self.assertIn(required, text)

    def test_security_test_checks_share_policy_denial_without_state_change(self):
        text = SECURITY.read_text(encoding="utf-8")

        for required in (
            "transnote_share",
            'noteId = "transnote-security-test-nonexistent-note"',
            "must DENY the operation before the",
            "DENIED before `transnote_share` executes",
            "no note state changes",
            "`share-test.txt`",
        ):
            with self.subTest(required=required):
                self.assertIn(required, text)

    def test_share_acceptance_test_requires_private_create_then_explicit_share(self):
        self.assertTrue(SHARE_ACCEPTANCE.is_file())

        text = SHARE_ACCEPTANCE.read_text(encoding="utf-8")
        for required in (
            "two separate user messages",
            "Do not share it.",
            "shared:false",
            "Share the TransNote note you just created.",
            "transnote_share",
            "shared:true",
            "same note ID",
        ):
            with self.subTest(required=required):
                self.assertIn(required, text)

    def test_readme_documents_optional_opencode_adapter(self):
        text = README.read_text(encoding="utf-8")

        for required in (
            "./tools/opencode/install.sh",
            "./tools/opencode/run.sh",
            "./tools/opencode/uninstall.sh",
            "Agent-created notes are private unless sharing is explicitly requested.",
            "dedicated TransNote tools",
            "general shell",
        ):
            with self.subTest(required=required):
                self.assertIn(required, text)


if __name__ == "__main__":
    unittest.main()
