import unittest

from agent.contract import (
    MAX_PROVENANCE_IDS,
    PROTOCOL_VERSION,
    capabilities,
    has_provenance,
    mark_provenance,
    sanitize_provenance,
    search_notes,
    serialize_note,
)


class AgentContractTests(unittest.TestCase):
    def test_protocol_version_is_one(self):
        self.assertEqual(PROTOCOL_VERSION, 1)

    def test_note_serialization_exposes_only_agent_fields(self):
        note = {
            "id": "note-1",
            "title": "Title",
            "body": "Body",
            "author": "ubuntu",
            "createdAt": "2026-09-22T00:00:00Z",
            "updatedAt": "2026-09-22T00:00:00Z",
            "shared": True,
            "comments": [{
                "id": "c-1",
                "author": "omaThink",
                "text": "ok",
                "createdAt": "2026-09-22T00:01:00Z",
                "ignored": "value",
            }],
            "attachments": [{"id": "att-1", "path": "/tmp/private"}],
            "color": "red",
        }

        clean = serialize_note(note, "local")

        self.assertEqual(
            clean,
            {
                "id": "note-1",
                "title": "Title",
                "body": "Body",
                "author": "ubuntu",
                "createdAt": "2026-09-22T00:00:00Z",
                "updatedAt": "2026-09-22T00:00:00Z",
                "shared": True,
                "source": "local",
                "comments": [{
                    "id": "c-1",
                    "author": "omaThink",
                    "text": "ok",
                    "createdAt": "2026-09-22T00:01:00Z",
                }],
            },
        )
        self.assertNotIn("attachments", clean)
        self.assertNotIn("color", clean)

    def test_unknown_source_is_not_serialized(self):
        self.assertIsNone(serialize_note({"id": "note-1"}, "filesystem"))

    def test_search_uses_only_title_and_body(self):
        notes = [
            {"id": "1", "title": "Measurement", "body": "done", "author": "x"},
            {"id": "2", "title": "Other", "body": "negative power", "author": "y"},
            {"id": "3", "title": "Other", "body": "none", "author": "Measurement"},
        ]

        self.assertEqual([n["id"] for n in search_notes(notes, "measurement")], ["1"])
        self.assertEqual([n["id"] for n in search_notes(notes, "POWER")], ["2"])

    def test_provenance_is_bounded_deduplicated_and_validated(self):
        values = ["note-1", "note-1", "../bad", ""]
        values.extend(f"n-{i}" for i in range(MAX_PROVENANCE_IDS + 20))

        clean = sanitize_provenance({"notes": values, "comments": ["c-1"]})

        self.assertLessEqual(len(clean["notes"]), MAX_PROVENANCE_IDS)
        self.assertEqual(clean["notes"][0], "note-1")
        self.assertNotIn("../bad", clean["notes"])
        self.assertEqual(clean["comments"], ["c-1"])

    def test_mark_and_check_provenance(self):
        value = mark_provenance(None, "note", "note-abc")
        self.assertTrue(has_provenance(value, "note", "note-abc"))
        self.assertFalse(has_provenance(value, "comment", "note-abc"))

    def test_capabilities_are_restricted(self):
        value = capabilities()
        self.assertEqual(
            set(value["commands"]),
            {"status", "capabilities", "list", "get", "search", "create", "comment", "share"},
        )
        for forbidden in (
            "delete",
            "unshare",
            "hide",
            "pairing",
            "syncAdministration",
            "attachmentMutation",
            "filesystemAccess",
            "commandForwarding",
            "identityOverride",
        ):
            self.assertIn(forbidden, value["unsupported"])


if __name__ == "__main__":
    unittest.main()
