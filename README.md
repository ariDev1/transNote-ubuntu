# TransNote for Ubuntu

TransNote is a GNOME Shell extension for small shared notes between trusted workstations.

This repository is the Ubuntu GNOME port of the original [TransNote](https://github.com/ariDev1/transNote) plugin for Omarchy Linux.

The Ubuntu port keeps the existing TransNote note model and compatible folder-sync architecture. The original Omarchy project remains unchanged.

![TransNote Ubuntu preview](preview.png)

## Current baseline

- TransNote 0.3.0
- GNOME Shell 46
- Extension UUID: `transnote@aridev1`
- Extension version: `4`
- Footer build information: `0.3.0 · <revision> · GitHub`
- Ubuntu ↔ Omarchy folder sync supported

## Features

- Create local notes
- Copy and delete notes
- Share and unshare notes
- Comments
- Attachments
- Note background colors
- Red unread indicator for new peer notes
- Automatic peer polling
- Compatible folder synchronization
- Built-in Syncthing-assisted device pairing
- Setup-code pairing between computers
- Automatic trusted-peer updates after pairing
- Acceptance of pending TransNote folders
- Automatic first-run machine name
- Automatic default sync folder on first run
- Advanced controls for machine name, shared folder, trusted peers, and diagnostics

Opening TransNote clears the unread indicator. Existing notes do not create a false unread state after extension startup.

## Requirements

- Ubuntu with GNOME Shell 46
- Node.js
- Git
- Syncthing for the built-in device-sync setup, or another tool that synchronizes the shared folder

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

## Device sync setup

Open **TransNote → Setup**.

On a new installation, TransNote creates a machine name and the default sync folder automatically. The generated machine name remains stored as the local TransNote identity.

For normal setup:

1. Select **Enable device sync**.
2. Copy **Your setup code**.
3. Open TransNote on the other computer.
4. Paste the code under **Connect another computer**.
5. Select **Connect**.
6. Accept a pending TransNote folder in TransNote if one appears.

Pairing updates the trusted-peer list automatically.

Normal setup does not require manual Syncthing device IDs, folder IDs, the Syncthing web interface, or terminal commands.

The **Advanced** section keeps the technical controls available when they are required:

- Machine name
- Shared folder
- Trusted peers
- Folder creation
- Manual save and status check
- LAN and Syncthing diagnostics

Keep the machine name stable after you start to share notes.

If the shared folder is already synchronized by another supported method, TransNote can continue to use that folder without creating a second sync protocol.

Only notes marked as shared are written to the shared snapshot.

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

Shared notes are stored as JSON snapshots in the configured synchronization folder.

## Compatibility

The Ubuntu port does not create a second TransNote folder-sync protocol.

It preserves the compatible note and snapshot architecture so that Ubuntu and Omarchy systems can exchange shared notes.

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
