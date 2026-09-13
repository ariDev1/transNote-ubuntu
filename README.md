# TransNote for Ubuntu

TransNote is a GNOME Shell extension for small shared text notes between workstations.

This repository is the Ubuntu GNOME port of the original [TransNote](https://github.com/ariDev1/transNote) plugin for Omarchy Linux.

The Ubuntu port keeps the existing TransNote note model and LAN folder-sync format. The original Omarchy project remains unchanged.

## Current baseline

- TransNote 0.3.0
- GNOME Shell 46
- Extension UUID: `transnote@aridev1`
- Footer build information: `0.3.0 · <revision> · GitHub`
- Ubuntu ↔ Omarchy LAN sync supported

## Features

- Create local notes
- Copy and delete notes
- Share and unshare notes
- Comments
- Attachments
- Note background colors
- LAN folder synchronization
- Syncthing pairing from TransNote
- Acceptance of pending TransNote folders
- Automatic peer polling
- LAN diagnostics
- Red unread indicator for new peer notes

Opening TransNote clears the unread indicator. Existing notes do not create a false unread state after extension startup.

## Requirements

- Ubuntu with GNOME Shell 46
- Node.js
- Git
- Syncthing for the built-in LAN setup, or another tool that synchronizes the shared folder

Install the required packages:

```bash
sudo apt update
sudo apt install git nodejs syncthing
systemctl --user enable --now syncthing.service
```

## Installation

```bash
mkdir -p ~/.local/share/gnome-shell/extensions

git clone \
  https://github.com/ariDev1/transNote-ubuntu.git \
  ~/.local/share/gnome-shell/extensions/transnote@aridev1

git -C ~/.local/share/gnome-shell/extensions/transnote@aridev1 \
  rev-parse --short=8 HEAD \
  > ~/.local/share/gnome-shell/extensions/transnote@aridev1/.transnote-revision

gnome-extensions enable transnote@aridev1
```

The local `.transnote-revision` file supplies the short Git revision shown in the footer. It is not committed to the repository.

If GNOME does not detect the extension immediately, log out and log in again.

## Updating

```bash
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/transnote@aridev1"

git -C "$EXTENSION_DIR" pull --ff-only

git -C "$EXTENSION_DIR" rev-parse --short=8 HEAD \
  > "$EXTENSION_DIR/.transnote-revision"
```

After an update, log out and log in again if GNOME Shell does not reload the extension.

## LAN setup

Open **TransNote → Setup**.

1. Set a stable machine name.
2. Set the shared folder, for example `~/transnote-lan`.
3. Add the trusted TransNote machine names.
4. Select **Save**.

If that folder is already synchronized between the machines, setup is complete. TransNote reads compatible peer snapshots directly from the folder.

If the folder is not synchronized yet, use the built-in Syncthing helper:

1. Select **Set up Syncthing**.
2. Copy the setup code to the other machine.
3. Paste the code there and select **Connect**.
4. Accept a pending `transnote-lan` folder in TransNote if one appears.

The Syncthing-assisted setup does not require manual Syncthing device IDs, folder IDs, the Syncthing web interface, or terminal commands during TransNote setup.

Only notes marked as shared are written to the LAN snapshot.

## Data

Local TransNote data is stored in:

```text
~/.local/share/transnote/
```

The main local note file is:

```text
~/.local/share/transnote/notes.json
```

A backup is kept as:

```text
~/.local/share/transnote/notes.json.bak
```

LAN-shared notes are stored as JSON snapshots in the configured synchronization folder.

## Compatibility

The Ubuntu port does not create a second TransNote LAN protocol.

It preserves the existing compatible note and snapshot architecture so that Ubuntu and Omarchy systems can exchange shared notes.

Original Omarchy project:

https://github.com/ariDev1/transNote

Ubuntu project:

https://github.com/ariDev1/transNote-ubuntu

## Development

- `main` is the verified release baseline.
- `development` is used for new work before promotion.

Run the test suite with:

```bash
python3 -m unittest discover -s tests -v
```

Project changes should remain deterministic, minimal, measurable, reversible, and supported by evidence.
