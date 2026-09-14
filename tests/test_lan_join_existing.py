import base64
import json
import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "helper" / "transnote-helper.mjs"

LOCAL_SYNCTHING_ID = (
    "VT4RDYA-YF7D47B-EA6KH4M-X2TNLGF-"
    "7VET7T7-QOUBZXD-76WCE7M-N2ABYQF"
)
REMOTE_SYNCTHING_ID = (
    "XAKQHZH-LBCD2KA-WFGNFGQ-XUV7HQU-"
    "UV23PME-BFYYBCR-S5MJXXR-RDTQTQK"
)
REMOTE_FOLDER_ID = "reye3-kwu5q"


def encode_pairing_code(payload):
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    code = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return f"TN1:{code}"


def write_fake_syncthing(path):
    path.write_text(
        textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import json
            import os
            import sys
            from pathlib import Path

            args = sys.argv[1:]
            log_path = Path(os.environ["FAKE_SYNCTHING_LOG"])
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(args) + "\\n")

            if args == ["cli", "show", "system"]:
                print(json.dumps({"myID": os.environ["FAKE_LOCAL_ID"]}))
            elif args == ["cli", "config", "dump-json"]:
                print(os.environ["FAKE_CONFIG_JSON"])
            elif args == ["cli", "show", "pending", "folders"]:
                print(os.environ.get("FAKE_PENDING_JSON", "{}"))
            elif args == ["cli", "show", "connections"]:
                print(json.dumps({"connections": {}}))
            else:
                print("")
            """
        )
    )
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def read_commands(path):
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def run_helper(
    command,
    *,
    data_dir,
    sync_dir,
    fake_syncthing,
    log_path,
    config,
    input_value=None,
):
    env = os.environ.copy()
    env["TRANSNOTE_DATA_DIR"] = str(data_dir)
    env["TRANSNOTE_SYNCTHING_BIN"] = str(fake_syncthing)
    env["FAKE_SYNCTHING_LOG"] = str(log_path)
    env["FAKE_LOCAL_ID"] = LOCAL_SYNCTHING_ID
    env["FAKE_CONFIG_JSON"] = json.dumps(config)
    env["FAKE_PENDING_JSON"] = "{}"

    return subprocess.run(
        [
            "node",
            str(HELPER),
            command,
            "--device-id",
            "labor",
            "--sync-dir",
            str(sync_dir),
            "--allow-list",
            "omaMac,omaThink,ubuntu,cia",
        ],
        cwd=ROOT,
        env=env,
        input=None if input_value is None else json.dumps(input_value),
        capture_output=True,
        text=True,
        check=False,
    )


class LanJoinExistingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data_dir = self.root / "data"
        self.sync_dir = self.root / "transnote-lan"
        self.sync_dir.mkdir()
        self.fake_syncthing = self.root / "syncthing"
        self.log_path = self.root / "syncthing.log"
        write_fake_syncthing(self.fake_syncthing)

        self.local_snapshot = self.sync_dir / "labor.json"
        self.snapshot_bytes = b'{"deviceId":"labor","sentinel":"keep"}\n'
        self.local_snapshot.write_bytes(self.snapshot_bytes)

    def tearDown(self):
        self.temp.cleanup()

    def empty_config(self):
        return {"folders": [], "devices": []}

    def join_input(self):
        return {
            "transnoteDeviceId": "omaMac",
            "syncthingDeviceId": REMOTE_SYNCTHING_ID,
            "folderId": REMOTE_FOLDER_ID,
        }

    def test_join_existing_uses_remote_folder_id_without_random_precreation(self):
        result = run_helper(
            "lan-join-existing",
            data_dir=self.data_dir,
            sync_dir=self.sync_dir,
            fake_syncthing=self.fake_syncthing,
            log_path=self.log_path,
            config=self.empty_config(),
            input_value=self.join_input(),
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["peer"]["transnoteDeviceId"], "omaMac")
        self.assertEqual(
            value["peer"]["syncthingDeviceId"],
            REMOTE_SYNCTHING_ID,
        )
        self.assertEqual(value["peer"]["folderId"], REMOTE_FOLDER_ID)
        self.assertEqual(self.local_snapshot.read_bytes(), self.snapshot_bytes)

        commands = read_commands(self.log_path)
        expected_folder_add = [
            "cli",
            "config",
            "folders",
            "add",
            "--id",
            REMOTE_FOLDER_ID,
            "--label",
            "transnote-lan",
            "--path",
            str(self.sync_dir.resolve()),
        ]
        self.assertIn(expected_folder_add, commands)

        folder_adds = [
            command
            for command in commands
            if command[:4] == ["cli", "config", "folders", "add"]
        ]
        self.assertEqual(folder_adds, [expected_folder_add])

    def test_join_existing_fails_closed_on_path_folder_id_conflict(self):
        config = {
            "folders": [
                {
                    "id": "tn-conflicting-local-share",
                    "path": str(self.sync_dir.resolve()),
                    "type": "sendreceive",
                    "paused": False,
                    "devices": [],
                }
            ],
            "devices": [],
        }

        result = run_helper(
            "lan-join-existing",
            data_dir=self.data_dir,
            sync_dir=self.sync_dir,
            fake_syncthing=self.fake_syncthing,
            log_path=self.log_path,
            config=config,
            input_value=self.join_input(),
        )

        self.assertNotEqual(result.returncode, 0)
        value = json.loads(result.stderr)
        self.assertEqual(value["error"]["code"], "FOLDER_ID_CONFLICT")
        self.assertEqual(self.local_snapshot.read_bytes(), self.snapshot_bytes)

        commands = read_commands(self.log_path)
        mutating = [
            command
            for command in commands
            if command[:2] == ["cli", "config"]
            and "add" in command
        ]
        self.assertEqual(mutating, [])

    def test_create_new_sync_still_creates_new_folder_id(self):
        result = run_helper(
            "lan-prepare",
            data_dir=self.data_dir,
            sync_dir=self.sync_dir,
            fake_syncthing=self.fake_syncthing,
            log_path=self.log_path,
            config=self.empty_config(),
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        value = json.loads(result.stdout)
        self.assertTrue(value["folderId"].startswith("tn-"))
        self.assertEqual(self.local_snapshot.read_bytes(), self.snapshot_bytes)

        commands = read_commands(self.log_path)
        self.assertIn(
            [
                "cli",
                "config",
                "folders",
                "add",
                "--id",
                value["folderId"],
                "--label",
                "transnote-lan",
                "--path",
                str(self.sync_dir.resolve()),
            ],
            commands,
        )

    def test_existing_tn1_pairing_still_uses_remote_folder_id(self):
        pairing_code = encode_pairing_code(
            {
                "version": 1,
                "transnoteDeviceId": "omaMac",
                "syncthingDeviceId": REMOTE_SYNCTHING_ID,
                "folderId": REMOTE_FOLDER_ID,
            }
        )

        result = run_helper(
            "lan-pair",
            data_dir=self.data_dir,
            sync_dir=self.sync_dir,
            fake_syncthing=self.fake_syncthing,
            log_path=self.log_path,
            config=self.empty_config(),
            input_value={"pairingCode": pairing_code},
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["peer"]["folderId"], REMOTE_FOLDER_ID)
        self.assertEqual(self.local_snapshot.read_bytes(), self.snapshot_bytes)


if __name__ == "__main__":
    unittest.main()
