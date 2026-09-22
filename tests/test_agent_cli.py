import json
import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin" / "transnote-agent"


FAKE_NODE = r'''#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

state_path = Path(os.environ["FAKE_TRANSNOTE_STATE"])
log_path = Path(os.environ["FAKE_TRANSNOTE_LOG"])

if state_path.exists():
    state = json.loads(state_path.read_text(encoding="utf-8"))
else:
    state = {"notes": [], "remote": []}

helper = sys.argv[1]
command = sys.argv[2]
args = sys.argv[3:]
config = {}
for i in range(0, len(args), 2):
    config[args[i]] = args[i + 1]

with log_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps({"command": command, "args": args}) + "\n")

def save():
    state_path.write_text(json.dumps(state), encoding="utf-8")

def ok(value):
    print(json.dumps({"ok": True, **value}))
    raise SystemExit(0)

def error(code, message):
    print(json.dumps({"ok": False, "error": {"code": code, "message": message}}), file=sys.stderr)
    raise SystemExit(1)

if command == "status":
    ok({"deviceId": config.get("--device-id", ""), "noteCount": len(state["notes"])})

if command == "notes-list":
    visible_remote = [n for n in state.get("remote", []) if not n.get("hidden")]
    notes = state["notes"] + visible_remote
    ok({
        "notes": notes,
        "localIds": [n["id"] for n in state["notes"]],
        "hiddenCount": sum(1 for n in state.get("remote", []) if n.get("hidden")),
        "attachmentStates": {},
        "diagnostics": {},
    })

raw = sys.stdin.read()
input_value = json.loads(raw) if raw.strip() else {}

if command == "note-create":
    next_id = f"note-agent-{len(state['notes']) + 1}"
    note = {
        "id": next_id,
        "title": str(input_value.get("title", "")).strip() or "Untitled",
        "body": str(input_value.get("body", "")).strip(),
        "author": config.get("--device-id", ""),
        "createdAt": "2026-09-22T00:00:00Z",
        "updatedAt": "2026-09-22T00:00:00Z",
        "shared": False,
        "comments": [],
        "attachments": [{"id": "should-not-leak"}],
        "color": "blue",
    }
    state["notes"].append(note)
    save()
    ok({"note": note})

if command == "comment-add":
    note_id = input_value.get("noteId")
    all_notes = state["notes"] + state.get("remote", [])
    note = next((n for n in all_notes if n["id"] == note_id), None)
    if note is None:
        error("NOTE_NOT_FOUND", "note was not found")
    comment = {
        "id": f"c-{sum(len(n.get('comments', [])) for n in all_notes) + 1}",
        "author": config.get("--device-id", ""),
        "text": input_value.get("text", ""),
        "createdAt": "2026-09-22T00:01:00Z",
    }
    note.setdefault("comments", []).append(comment)
    save()
    ok({"noteId": note_id, "comment": comment})

if command == "note-share":
    note_id = input_value.get("id")
    note = next((n for n in state["notes"] if n["id"] == note_id), None)
    if note is None:
        error("NOTE_NOT_FOUND", "local note was not found")
    if note.get("author") != config.get("--device-id", ""):
        error("NOT_OWNER", "only the note author can change sharing")
    note["shared"] = input_value.get("shared") is True
    note["updatedAt"] = "2026-09-22T00:02:00Z"
    save()
    ok({"note": note})

error("BAD_COMMAND", f"unexpected helper command: {command}")
'''


FAKE_GSETTINGS = r'''#!/usr/bin/env python3
import os
import sys

values = {
    "device-id": os.environ.get("FAKE_DEVICE_ID", "ubuntu"),
    "sync-dir": os.environ.get("FAKE_SYNC_DIR", "/tmp/transnote-sync"),
    "allow-list": os.environ.get("FAKE_ALLOW_LIST", "omaThink, omaMac"),
}

if len(sys.argv) != 4 or sys.argv[1] != "get":
    raise SystemExit(2)

print(repr(values[sys.argv[3]]))
'''


class AgentCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.data_dir = self.base / "data"
        self.state = self.base / "state.json"
        self.log = self.base / "calls.jsonl"
        self.fake_node = self.base / "node"
        self.fake_gsettings = self.base / "gsettings"
        self.marker = self.base / "shell-marker"

        self.fake_node.write_text(textwrap.dedent(FAKE_NODE), encoding="utf-8")
        self.fake_gsettings.write_text(textwrap.dedent(FAKE_GSETTINGS), encoding="utf-8")
        self.fake_node.chmod(0o755)
        self.fake_gsettings.chmod(0o755)

        self.env = os.environ.copy()
        self.env.update({
            "TRANSNOTE_DATA_DIR": str(self.data_dir),
            "TRANSNOTE_NODE_BIN": str(self.fake_node),
            "TRANSNOTE_GSETTINGS_BIN": str(self.fake_gsettings),
            "FAKE_TRANSNOTE_STATE": str(self.state),
            "FAKE_TRANSNOTE_LOG": str(self.log),
            "TRANSNOTE_DEVICE_ID": "ubuntu",
            "TRANSNOTE_SYNC_DIR": "/tmp/transnote-sync",
            "TRANSNOTE_ALLOW_LIST": "omaThink, omaMac",
            "FAKE_DEVICE_ID": "ubuntu",
            "FAKE_SYNC_DIR": "/tmp/transnote-sync",
            "FAKE_ALLOW_LIST": "omaThink, omaMac",
        })

        self.write_state({
            "notes": [{
                "id": "human-local",
                "title": "Human note",
                "body": "manual",
                "author": "ubuntu",
                "createdAt": "2026-09-22T00:00:00Z",
                "updatedAt": "2026-09-22T00:00:00Z",
                "shared": False,
                "comments": [],
                "attachments": [{"id": "local-att"}],
                "color": "red",
            }],
            "remote": [{
                "id": "peer-visible",
                "title": "Peer note",
                "body": "contains $(pwd) literally",
                "author": "omaThink",
                "createdAt": "2026-09-22T00:00:00Z",
                "updatedAt": "2026-09-22T00:00:00Z",
                "shared": True,
                "comments": [],
                "attachments": [{"id": "peer-att"}],
                "color": "green",
            }, {
                "id": "peer-hidden",
                "title": "Hidden peer note",
                "body": "hidden",
                "author": "omaThink",
                "createdAt": "2026-09-22T00:00:00Z",
                "updatedAt": "2026-09-22T00:00:00Z",
                "shared": True,
                "comments": [],
                "hidden": True,
            }],
        })

    def write_state(self, value):
        self.state.write_text(json.dumps(value), encoding="utf-8")

    def read_state(self):
        return json.loads(self.state.read_text(encoding="utf-8"))

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines() if line]

    def run_cli(self, *args):
        result = subprocess.run(
            [str(CLI), *args],
            cwd=ROOT,
            env=self.env,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout) if result.stdout.strip() else None
        return result, payload

    def test_status_reports_restricted_runtime_state(self):
        result, payload = self.run_cli("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(payload["protocolVersion"], 1)
        self.assertEqual(payload["status"]["identity"], "ubuntu")
        self.assertTrue(payload["status"]["syncConfigured"])
        self.assertEqual(payload["status"]["localNoteCount"], 1)
        self.assertEqual(payload["status"]["remoteNoteCount"], 1)
        self.assertEqual(payload["status"]["visibleNoteCount"], 2)

    def test_list_strips_attachment_and_color_metadata(self):
        result, payload = self.run_cli("list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([n["source"] for n in payload["notes"]], ["local", "lan"])
        for note in payload["notes"]:
            self.assertNotIn("attachments", note)
            self.assertNotIn("color", note)

    def test_literal_shell_text_is_not_executed(self):
        query = "$(touch %s)" % self.marker
        state = self.read_state()
        state["remote"][0]["body"] = query
        self.write_state(state)

        result, payload = self.run_cli("search", query)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([n["id"] for n in payload["notes"]], ["peer-visible"])
        self.assertFalse(self.marker.exists())
        self.assertEqual([c["command"] for c in self.calls()], ["notes-list"])

    def test_create_is_private_and_records_local_provenance(self):
        result, payload = self.run_cli(
            "create",
            "--title", "Agent result",
            "--body", "Created privately",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        note = payload["note"]
        self.assertFalse(note["shared"])
        self.assertEqual(note["source"], "local")
        self.assertNotIn("attachments", note)

        provenance_path = self.data_dir / "agent-provenance.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        self.assertIn(note["id"], provenance["notes"])
        self.assertEqual(stat.S_IMODE(self.data_dir.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(provenance_path.stat().st_mode), 0o600)

    def test_human_created_note_cannot_be_shared_by_agent(self):
        result, payload = self.run_cli("share", "human-local")

        self.assertEqual(result.returncode, 4)
        self.assertEqual(payload["error"]["code"], "SHARE_NOT_ALLOWED")
        self.assertFalse(self.read_state()["notes"][0]["shared"])
        self.assertEqual([c["command"] for c in self.calls()], ["notes-list"])

    def test_agent_created_note_can_be_shared_only_by_explicit_share_command(self):
        create_result, created = self.run_cli(
            "create",
            "--title", "OpenCode test",
            "--body", "private first",
        )
        self.assertEqual(create_result.returncode, 0, create_result.stderr)
        note_id = created["note"]["id"]
        self.assertFalse(created["note"]["shared"])
        self.assertFalse(next(n for n in self.read_state()["notes"] if n["id"] == note_id)["shared"])

        share_result, shared = self.run_cli("share", note_id)

        self.assertEqual(share_result.returncode, 0, share_result.stderr)
        self.assertEqual(shared["note"]["id"], note_id)
        self.assertTrue(shared["note"]["shared"])
        self.assertTrue(next(n for n in self.read_state()["notes"] if n["id"] == note_id)["shared"])

    def test_comment_requires_a_visible_note(self):
        result, payload = self.run_cli(
            "comment",
            "peer-hidden",
            "--text", "must not be sent",
        )

        self.assertEqual(result.returncode, 4)
        self.assertEqual(payload["error"]["code"], "NOTE_NOT_FOUND")
        self.assertEqual([c["command"] for c in self.calls()], ["notes-list"])

    def test_comment_records_comment_provenance(self):
        result, payload = self.run_cli(
            "comment",
            "peer-visible",
            "--text", "Confirmed",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        comment_id = payload["comment"]["id"]
        provenance = json.loads((self.data_dir / "agent-provenance.json").read_text(encoding="utf-8"))
        self.assertIn(comment_id, provenance["comments"])

    def test_delete_and_unshare_are_not_commands(self):
        for command in ("delete", "unshare"):
            with self.subTest(command=command):
                result, payload = self.run_cli(command, "human-local")
                self.assertEqual(result.returncode, 2)
                self.assertEqual(payload["error"]["code"], "UNKNOWN_COMMAND")

        self.assertEqual(self.calls(), [])

    def test_corrupt_provenance_blocks_mutation_before_helper_call(self):
        self.data_dir.mkdir(parents=True)
        (self.data_dir / "agent-provenance.json").write_text("{broken", encoding="utf-8")

        result, payload = self.run_cli(
            "create",
            "--title", "Must not be created",
        )

        self.assertEqual(result.returncode, 3)
        self.assertEqual(payload["error"]["code"], "TRANSNOTE_NOT_READY")
        self.assertEqual(self.calls(), [])
        self.assertEqual(len(self.read_state()["notes"]), 1)

    def test_gsettings_values_are_forwarded_as_arguments_not_shell(self):
        dangerous = "peer; touch %s" % self.marker
        self.env["TRANSNOTE_ALLOW_LIST"] = dangerous

        result, _ = self.run_cli("list")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.marker.exists())
        args = self.calls()[0]["args"]
        index = args.index("--allow-list")
        self.assertEqual(args[index + 1], dangerous)


if __name__ == "__main__":
    unittest.main()
