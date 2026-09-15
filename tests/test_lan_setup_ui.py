import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class LanSetupUiTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / "notesMenu.js").read_text()
        self.client = (ROOT / "helperClient.js").read_text()
        self.styles = (ROOT / "stylesheet.css").read_text()

    def test_normal_setup_focuses_on_device_pairing(self):
        for text in (
            "text: 'Device sync'",
            "text: 'This computer'",
            "label: 'Start new sync'",
            "text: 'Your setup code'",
            "text: 'Join existing sync'",
            "text: 'Connected computers'",
        ):
            self.assertIn(text, self.source)

    def test_technical_fields_are_hidden_in_advanced_section(self):
        self.assertIn("this._advancedSetup = new St.BoxLayout({", self.source)
        self.assertIn("visible: false", self.source)
        self.assertIn("label: 'Advanced'", self.source)
        self.assertIn("text: 'Machine name'", self.source)
        self.assertIn("text: 'Shared folder'", self.source)
        self.assertIn("text: 'Trusted peers'", self.source)

    def test_advanced_button_has_real_toggle_method(self):
        self.assertIn("_toggleAdvancedSetup()", self.source)
        self.assertIn(
            "this._advancedSetup.visible = !this._advancedSetup.visible;",
            self.source,
        )

    def test_pairing_still_qualifies_trusted_peer(self):
        self.assertIn(
            "const updated = addQualifiedPeer(current, peerName);",
            self.source,
        )
        self.assertIn(
            "this._settings.set_string('allow-list', updated);",
            self.source,
        )

    def test_pending_folder_acceptance_remains_available(self):
        self.assertIn("text: 'Pending TransNote folders'", self.source)
        self.assertIn("this._renderPendingOffers([]);", self.source)
        self.assertIn("label: 'Accept'", self.source)

    def test_primary_wording_hides_transport_details(self):
        self.assertNotIn("text: 'LAN connection'", self.source)
        self.assertNotIn("label: 'Set up Syncthing'", self.source)
        self.assertNotIn("text: 'Your Syncthing setup code'", self.source)
        self.assertIn(
            "Existing synchronized folders remain supported.",
            self.source,
        )

    def test_machine_name_label_tracks_advanced_edit(self):
        self.assertIn("this._machineNameLabel.text = deviceId;", self.source)
        self.assertIn("this._machineNameLabel.text =", self.source)
        self.assertIn(
            "this._settings.get_string('device-id');",
            self.source,
        )

    def test_pending_device_acceptance_is_visible_in_setup(self):
        for text in (
            "text: 'Pending computer connections'",
            "this._renderPendingDevices([]);",
            "this._helper.acceptPendingDeviceLan(",
            "const pendingDevices = Array.isArray(result.pendingDevices)",
        ):
            self.assertIn(text, self.source)

        self.assertIn("'lan-accept-pending-device'", self.client)
        self.assertIn("async acceptPendingDeviceLan(", self.client)

    def test_sync_service_state_is_visible_without_advanced(self):
        for text in (
            "this._syncStatus = new St.Label({",
            "text: 'Sync service: checking…'",
            "this._syncStatus.text = 'Syncthing is not installed.';",
            "this._syncStatus.text = 'Syncthing is not running.';",
            "this._syncStatus.text = 'Sync service: ready';",
            "const message = operatorLanErrorMessage(error);",
            "this._syncStatus.text = message;",
        ):
            self.assertIn(text, self.source)

    def test_pending_transnote_folder_offer_is_visible_before_unprepared_state(self):
        source = " ".join(self.source.split())
        pending_check = "result.folder?.configured !== true && pendingOffers.length > 0"
        pending_message = "this._syncStatus.text = 'A TransNote folder is waiting for acceptance.';"
        unprepared_message = "this._syncStatus.text = 'The TransNote sync folder is not prepared yet.';"

        self.assertIn(pending_check, source)
        self.assertIn(pending_message, source)
        self.assertLess(
            source.index(pending_message),
            source.index(unprepared_message),
        )

    def test_unprepared_transnote_folder_is_visible_before_paused_state(self):
        source = " ".join(self.source.split())
        unprepared_branch = (
            "else if (result.folder?.configured !== true) "
            "this._syncStatus.text = 'The TransNote sync folder is not prepared yet.';"
        )
        paused_check = "result.folder?.configured === true && result.folder.paused === true"

        self.assertIn(unprepared_branch, source)
        self.assertIn(paused_check, source)
        self.assertLess(
            source.index(unprepared_branch),
            source.index(paused_check),
        )

    def test_paused_transnote_folder_is_reported_before_peer_disconnect(self):
        source = " ".join(self.source.split())
        paused_check = "result.folder?.configured === true && result.folder.paused === true"
        paused_message = "this._syncStatus.text = 'The TransNote sync folder is paused.';"
        peer_check = "peer.configured === true && peer.connected !== true"

        self.assertIn(paused_check, source)
        self.assertIn(paused_message, source)
        self.assertLess(
            source.index(paused_check),
            source.index(peer_check),
        )

    def test_configured_disconnected_peer_is_reported_in_visible_status(self):
        self.assertIn(
            "peer.configured === true && peer.connected !== true",
            self.source,
        )
        self.assertIn(
            "this._syncStatus.text = 'A paired computer is not connected.';",
            self.source,
        )

    def test_setup_styles_keep_advanced_controls_structured(self):
        for selector in (
            ".transnote-machine-name",
            ".transnote-advanced-button",
            ".transnote-advanced-setup",
        ):
            self.assertIn(selector, self.styles)


if __name__ == "__main__":
    unittest.main()
