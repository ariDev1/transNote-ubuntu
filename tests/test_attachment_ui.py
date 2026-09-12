import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_model(script):
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            script,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    return result


class AttachmentUiTests(unittest.TestCase):
    def test_local_attachment_is_usable(self):
        result = run_model("""
import {
  attachmentStateFor,
  attachmentStateLabel,
  canUseAttachment,
} from './attachmentUiModel.js';

const state = attachmentStateFor({
  isLocal: true,
  noteId: 'note-1',
  attachmentId: 'att-1',
  attachmentStates: {},
});

console.log(JSON.stringify({
  state,
  label: attachmentStateLabel(state),
  usable: canUseAttachment(state),
}));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)

        value = json.loads(result.stdout)
        self.assertEqual(value["state"], "local")
        self.assertEqual(value["label"], "on this machine")
        self.assertTrue(value["usable"])

    def test_verified_peer_attachment_is_usable(self):
        result = run_model("""
import {
  attachmentStateFor,
  canUseAttachment,
} from './attachmentUiModel.js';

const state = attachmentStateFor({
  isLocal: false,
  noteId: 'note-1',
  attachmentId: 'att-1',
  attachmentStates: {
    'note-1': {
      'att-1': 'verified',
    },
  },
});

console.log(JSON.stringify({
  state,
  usable: canUseAttachment(state),
}));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)

        value = json.loads(result.stdout)
        self.assertEqual(value["state"], "verified")
        self.assertTrue(value["usable"])

    def test_unverified_peer_states_are_not_usable(self):
        result = run_model("""
import {
  attachmentStateFor,
  canUseAttachment,
} from './attachmentUiModel.js';

const states = ['waiting', 'missing', 'invalid', 'unknown'];

const result = states.map(value => {
  const state = attachmentStateFor({
    isLocal: false,
    noteId: 'note-1',
    attachmentId: 'att-1',
    attachmentStates: {
      'note-1': {
        'att-1': value,
      },
    },
  });

  return {
    input: value,
    state,
    usable: canUseAttachment(state),
  };
});

console.log(JSON.stringify(result));
""")

        self.assertEqual(result.returncode, 0, msg=result.stderr)

        value = json.loads(result.stdout)

        self.assertEqual(
            value,
            [
                {
                    "input": "waiting",
                    "state": "waiting",
                    "usable": False,
                },
                {
                    "input": "missing",
                    "state": "missing",
                    "usable": False,
                },
                {
                    "input": "invalid",
                    "state": "invalid",
                    "usable": False,
                },
                {
                    "input": "unknown",
                    "state": "invalid",
                    "usable": False,
                },
            ],
        )

    def test_helper_client_exposes_attachment_actions(self):
        source = (ROOT / "helperClient.js").read_text()

        for command in (
            "attachment-add-dialog",
            "attachment-open",
            "attachment-save",
            "attachment-copy-text",
        ):
            self.assertIn(f"'{command}'", source)

        self.assertIn("async addAttachment(", source)
        self.assertIn("async openAttachment(", source)
        self.assertIn("async saveAttachment(", source)
        self.assertIn("async copyAttachmentText(", source)

    def test_notes_menu_wires_attachment_ui(self):
        menu = (ROOT / "notesMenu.js").read_text()
        css = (ROOT / "stylesheet.css").read_text()

        self.assertIn(
            "from './attachmentUiModel.js'",
            menu,
        )
        self.assertIn(
            "_renderNotes(notes, attachmentStates",
            menu,
        )
        self.assertIn(
            "this._helper.addAttachment(",
            menu,
        )
        self.assertIn(
            "this._helper.openAttachment(",
            menu,
        )
        self.assertIn(
            "this._helper.saveAttachment(",
            menu,
        )
        self.assertIn(
            "this._helper.copyAttachmentText(",
            menu,
        )
        self.assertIn(
            "_copyAttachmentText(",
            menu,
        )

        self.assertIn(".transnote-attachments", css)
        self.assertIn(".transnote-attachment-row", css)
        self.assertIn(".transnote-attachment-state", css)


if __name__ == "__main__":
    unittest.main()
