import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_model(body):
    script = f"""
import {{advancePeerNoteKnowledge}} from './unreadUiModel.js';
{body}
"""
    return subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class UnreadModelTests(unittest.TestCase):
    def test_first_peer_snapshot_primes_without_unread(self):
        result = run_model("""
const value = advancePeerNoteKnowledge({
  notes: [{id: 'peer-1'}],
  localIds: new Set(),
  knownIds: new Set(),
  primed: false,
});
console.log(JSON.stringify({
  primed: value.primed,
  unread: value.hasNewPeerNote,
  knownIds: [...value.knownIds],
}));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)

        value = json.loads(result.stdout)
        self.assertTrue(value["primed"])
        self.assertFalse(value["unread"])
        self.assertEqual(value["knownIds"], ["peer-1"])

    def test_new_peer_note_triggers_unread_but_local_note_does_not(self):
        result = run_model("""
let value = advancePeerNoteKnowledge({
  notes: [{id: 'peer-1'}],
  localIds: new Set(),
  knownIds: new Set(['peer-1']),
  primed: true,
});

value = advancePeerNoteKnowledge({
  notes: [
    {id: 'peer-1'},
    {id: 'peer-2'},
    {id: 'local-1'},
  ],
  localIds: new Set(['local-1']),
  knownIds: value.knownIds,
  primed: value.primed,
});

console.log(JSON.stringify({
  unread: value.hasNewPeerNote,
  knownIds: [...value.knownIds].sort(),
}));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)

        value = json.loads(result.stdout)
        self.assertTrue(value["unread"])
        self.assertEqual(
            value["knownIds"],
            ["peer-1", "peer-2"],
        )

    def test_peer_reappearance_does_not_trigger_again(self):
        result = run_model("""
let knownIds = new Set(['peer-1']);

let value = advancePeerNoteKnowledge({
  notes: [],
  localIds: new Set(),
  knownIds,
  primed: true,
});

value = advancePeerNoteKnowledge({
  notes: [{id: 'peer-1'}],
  localIds: new Set(),
  knownIds: value.knownIds,
  primed: value.primed,
});

console.log(JSON.stringify({
  unread: value.hasNewPeerNote,
  knownIds: [...value.knownIds],
}));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)

        value = json.loads(result.stdout)
        self.assertFalse(value["unread"])
        self.assertEqual(value["knownIds"], ["peer-1"])


class UnreadIndicatorUiTests(unittest.TestCase):
    def test_indicator_keeps_existing_icon_and_adds_unread_dot(self):
        source = (ROOT / "indicator.js").read_text()

        self.assertIn(
            "icon_name: 'document-edit-symbolic'",
            source,
        )
        self.assertIn(
            "style_class: 'transnote-unread-dot'",
            source,
        )
        self.assertIn(
            "_setUnread(",
            source,
        )
        self.assertIn(
            "this._setUnread(false)",
            source,
        )

    def test_notes_menu_reports_new_peer_notes(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn(
            "advancePeerNoteKnowledge",
            source,
        )
        self.assertIn(
            "onUnreadChanged",
            source,
        )
        self.assertIn(
            "hasNewPeerNote",
            source,
        )

    def test_notes_menu_primes_unread_state_immediately(self):
        source = (ROOT / "notesMenu.js").read_text()

        constructor = source[
            source.index("  constructor({"):
            source.index("  _buildFooter()")
        ]

        refresh_index = constructor.find(
            "    this.refresh();"
        )
        poll_index = constructor.find(
            "    this._pollId = GLib.timeout_add_seconds"
        )

        self.assertNotEqual(refresh_index, -1)
        self.assertNotEqual(poll_index, -1)
        self.assertLess(refresh_index, poll_index)

    def test_unread_dot_has_structured_css(self):
        source = (ROOT / "stylesheet.css").read_text()

        self.assertIn(".transnote-unread-dot", source)
        self.assertIn("background-color:", source)
        self.assertIn("border-radius:", source)


if __name__ == "__main__":
    unittest.main()
