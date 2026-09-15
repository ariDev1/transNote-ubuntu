# TransNote Ubuntu Release Acceptance

Use this procedure for a release candidate from clean Ubuntu user
environments.

Do not record PASS without direct evidence.

Record:

- Candidate tag or commit:
- Test date:
- Tester:
- Machine A Ubuntu version:
- Machine A GNOME Shell version:
- Machine B Ubuntu version:
- Machine B GNOME Shell version:

## 1. Automated evidence

Run from the candidate repository root:

```bash
git status --short
git rev-parse HEAD
python3 -m unittest discover -s tests -v
```

Acceptance requires:

- clean repository state before the test
- the expected candidate commit
- test command exit status `0`
- no failed unit tests

The unit suite includes the protected-file SHA-256 integrity check for:

- `core/Store.js`
- `nostr/sync.mjs`

Record the fresh test output. Do not reuse an earlier PASS result.

## 2. Field evidence

Use two clean Ubuntu user environments. Label them **A** and **B**.

For the two pairing directions, use independent clean pairing runs.
Do not infer one direction from the other.

### Clean install and activation

On each test machine:

- [ ] Clone or install the exact candidate.
- [ ] Confirm `transnote@aridev1` is recognized by GNOME.
- [ ] Enable the extension.
- [ ] Confirm the extension state is `ACTIVE`.
- [ ] Confirm the machine name is initialized.
- [ ] Confirm the machine name remains stable.
- [ ] Confirm the default sync folder is `$HOME/transnote-lan`.

### Pairing A -> B

- [ ] Select **Start new sync** on A.
- [ ] Confirm that A generates a setup code.
- [ ] Paste the A setup code into **Join existing sync** on B.
- [ ] Complete the connection from inside TransNote.
- [ ] Confirm that A and B use the same established TransNote folder ID.

### Pairing B -> A

Repeat from a clean pairing state.

- [ ] Select **Start new sync** on B.
- [ ] Confirm that B generates a setup code.
- [ ] Paste the B setup code into **Join existing sync** on A.
- [ ] Complete the connection from inside TransNote.
- [ ] Confirm that A and B use the same established TransNote folder ID.

### Pending Syncthing states

At least one pairing run must exercise each state.

- [ ] A pending computer connection appears in TransNote.
- [ ] Accept the pending computer connection inside TransNote.
- [ ] A pending TransNote folder appears in TransNote.
- [ ] Accept the pending TransNote folder inside TransNote.
- [ ] Confirm that an established TransNote share remains authoritative.
- [ ] Confirm that a fresh provisional `tn-*` folder can join the established share.

### Notes and synchronization

- [ ] Create a local note.
- [ ] Share the note.
- [ ] Confirm that the remote computer displays the shared note.
- [ ] Add a remote comment.
- [ ] Confirm that the comment appears on the other computer.
- [ ] Confirm repeated polling does not duplicate the comment.

### Attachments

- [ ] Add an attachment to a shared note.
- [ ] Confirm that the attachment reaches the remote computer.
- [ ] Confirm that the received attachment passes TransNote verification.
- [ ] Open the received attachment.
- [ ] Save a copy of the received attachment.
- [ ] For text attachments, test **Copy**.
- [ ] Compare the source and saved-copy SHA-256 values when applicable.

Example:

```bash
sha256sum /path/to/source /path/to/saved-copy
```

The two hashes must be equal.

### Hide and Unhide

- [ ] Hide a peer note.
- [ ] Confirm that it is not displayed.
- [ ] Unhide the peer note.
- [ ] Confirm that it is displayed again.

### Delete and tombstone behavior

Use a shared test note.

- [ ] Delete the note from its owning computer.
- [ ] Confirm that it disappears from the peer.
- [ ] Allow additional peer polling.
- [ ] Confirm that the deleted note does not return.
- [ ] Restart or log out and log in.
- [ ] Confirm that the deleted note still does not return.

### Unshare and tombstone behavior

Use a second shared test note.

- [ ] Unshare the note from its owning computer.
- [ ] Confirm that it disappears from the peer.
- [ ] Allow additional peer polling.
- [ ] Confirm that the unshared note does not return.
- [ ] Restart or log out and log in.
- [ ] Confirm that the unshared note still does not return.

### Persistence

- [ ] Log out and log in again.
- [ ] Confirm that TransNote loads and becomes active.
- [ ] Confirm local-note persistence.
- [ ] Confirm sync configuration persistence.
- [ ] Confirm machine-name persistence.
- [ ] Confirm Hide / Unhide state as applicable.
- [ ] Confirm tombstone behavior remains correct.

A release is accepted only when all required automated and field checks
have direct evidence.

## 3. Optional diagnostics

These commands collect evidence. They do not replace field acceptance.

GNOME:

```bash
gnome-shell --version
gnome-extensions info transnote@aridev1
gnome-extensions list --enabled
```

Syncthing service:

```bash
systemctl --user status syncthing.service --no-pager
```

Syncthing state:

```bash
syncthing cli show system
syncthing cli show connections
syncthing cli show pending devices
syncthing cli show pending folders
syncthing cli config dump-json
```

TransNote-related journal messages:

```bash
journalctl --user -b --no-pager | grep -i transnote
```

Record diagnostic output only when it is relevant to the acceptance
result or to a failure investigation.
