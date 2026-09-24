# TransNote for Ubuntu

TransNote is a GNOME Shell extension for keeping and sharing small notes between trusted computers.

This is the Ubuntu GNOME version of [TransNote for Omarchy](https://github.com/ariDev1/transNote). Ubuntu and Omarchy computers can share notes through a synchronized folder.

![TransNote Ubuntu preview](preview.png)

## Features

- Create local notes
- Copy and delete notes
- Share and unshare notes
- Comments
- File attachments and image previews
- Note background colors
- Compact expandable note cards
- Switch between List and two-column Grid views; opening a grid note keeps its details next to that note
- Popup height adapts to the display
- Contextual note search by title, body, and author
- Red unread indicator for new peer notes and comments
- Automatic peer polling
- Share notes through a synchronized folder
- Deleted or unshared notes stay removed from other computers
- Built-in Syncthing-assisted device pairing
- Setup-code pairing between computers
- Pairing adds the other computer as trusted
- Approve new computer connections and shared-folder invitations
- Start setup-code pairing from either computer
- Automatic first-run machine name
- Automatic default sync folder on first run
- Advanced controls for machine name, shared folder, trusted peers, and diagnostics

## Requirements

- Ubuntu with GNOME Shell 46 or 50
- Git and Node.js
- Syncthing for built-in device pairing, or another tool to synchronize a shared folder

Install Git and Node.js:

```bash
sudo apt update
sudo apt install git nodejs
```

For built-in device pairing, also install and start Syncthing:

```bash
sudo apt install syncthing
systemctl --user enable --now syncthing.service
```

## Installation

```bash
mkdir -p ~/.local/share/gnome-shell/extensions

git clone --branch main --single-branch \
  https://github.com/ariDev1/transNote-ubuntu.git \
  ~/.local/share/gnome-shell/extensions/transnote@aridev1

gnome-extensions enable transnote@aridev1
```

If TransNote does not appear after installation, enable it from a terminal:

```bash
gnome-extensions enable transnote@aridev1
```

To reload the extension without logging out, toggle it off and on in
**Extensions**, or run:

```bash
gnome-extensions disable transnote@aridev1
gnome-extensions enable transnote@aridev1
```

On X11, **Alt+F2**, then `r`, also reloads GNOME Shell. That shortcut is not
available on Wayland.

## Updating

```bash
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/transnote@aridev1"

git -C "$EXTENSION_DIR" fetch origin main
git -C "$EXTENSION_DIR" switch main
git -C "$EXTENSION_DIR" pull --ff-only origin main

gnome-extensions disable transnote@aridev1
gnome-extensions enable transnote@aridev1
```

If Git reports local changes when switching branches, preserve or commit them
before updating.

## Device sync setup

Open **TransNote → Setup**.

On first launch, TransNote creates a name for the computer and a default shared-folder location. You can change these in **Setup**.

For normal setup:

1. Select **Start new sync** on either computer.
2. Copy **Your setup code**.
3. Open TransNote on the other computer.
4. Paste the code under **Join existing sync**.
5. Select **Connect**.
6. If the code came from a new computer and the receiving computer already has an established TransNote share, return to the new computer and accept the **Pending computer connection**.
7. Accept the **Pending TransNote folder** if it appears.

Pairing adds the other computer to the trusted list automatically. If either computer already has a TransNote shared folder, follow the in-app prompts to join that folder.

Normal setup does not require manual Syncthing device IDs, folder IDs, the Syncthing web interface, or terminal commands.

The **Advanced** section keeps the technical controls available when they are required:

- Machine name
- Shared folder
- Trusted peers
- Folder creation
- Manual save and status check
- LAN and Syncthing diagnostics

Keep the machine name stable after you start to share notes.

If you already synchronize a folder with Syncthing or another service, you can use it with TransNote without setting up an additional sync service.

Only notes you explicitly share are synchronized.

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

Shared notes are stored in the selected synchronized folder.

## Optional automation

An optional local Agent CLI can create and manage notes. Install or remove it
from the repository with:

```bash
./tools/install-agent-cli.sh
./tools/uninstall-agent-cli.sh
```

Agent-created notes are private unless sharing is explicitly requested. An
optional OpenCode adapter is available for users of OpenCode:

```bash
./tools/opencode/install.sh
./tools/opencode/run.sh
./tools/opencode/uninstall.sh
```

The adapter provides dedicated TransNote tools rather than general shell
access.

## Links

- [TransNote for Omarchy](https://github.com/ariDev1/transNote)
- [TransNote for Ubuntu](https://github.com/ariDev1/transNote-ubuntu)
