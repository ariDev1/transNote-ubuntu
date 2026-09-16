import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_model(body):
    script = "import {filterNotes} from './noteUiModel.js';\n" + body
    return subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class NoteSearchModelTests(unittest.TestCase):
    def test_search_matches_only_title_body_and_author_case_insensitive(self):
        body = (
            "const notes = ["
            "{id:'1',title:'Solar',body:'voltage',author:'labor',"
            "comments:[{text:'hidden word'}]},"
            "{id:'2',title:'Hello',body:'Different operating systems',author:'cia',"
            "comments:[{text:'solar'}]},"
            "{id:'3',title:'Other',body:'body',author:'remote',"
            "comments:[{text:'needle'}]}];"
            "const ids = q => filterNotes(notes, q).map(n => n.id);"
            "console.log(JSON.stringify({"
            "title:ids('SOLAR'),body:ids('operating'),author:ids('CIA'),"
            "comment:ids('needle')}));"
        )
        result = run_model(body)
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["title"], ["1"])
        self.assertEqual(value["body"], ["2"])
        self.assertEqual(value["author"], ["2"])
        self.assertEqual(value["comment"], [])

    def test_empty_search_keeps_all_notes_in_order(self):
        body = (
            "const notes=[{id:'1',title:'A'},{id:'2',title:'B'}];"
            "console.log(JSON.stringify(filterNotes(notes,'   ').map(n=>n.id)));"
        )
        result = run_model(body)
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(json.loads(result.stdout), ["1", "2"])


class NoteSearchUiTests(unittest.TestCase):
    def test_toolbar_has_contextual_search_controls(self):
        source = (ROOT / "notesMenu.js").read_text()

        self.assertIn("hint_text: 'Search notes…'", source)
        self.assertIn("transnote-search-entry", source)
        self.assertIn("this._notesTab.visible = setup;", source)
        self.assertIn("this._searchEntry.visible = !setup;", source)
        self.assertIn("this._setupTab.visible = !setup;", source)
        self.assertIn("this._applyNoteFilter()", source)

        search_index = source.index(
            "this._toolbar.add_child(this._searchEntry);"
        )
        new_note_index = source.index(
            "this._toolbar.add_child(this._newNoteButton);"
        )
        setup_index = source.index(
            "this._toolbar.add_child(this._setupTab);"
        )
        self.assertLess(search_index, new_note_index)
        self.assertLess(new_note_index, setup_index)

    def test_search_style_is_structured(self):
        source = (ROOT / "stylesheet.css").read_text()
        self.assertIn(
            ".transnote-entry.transnote-search-entry",
            source,
        )


if __name__ == "__main__":
    unittest.main()
