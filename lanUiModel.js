const ERROR_MESSAGES = new Map([
  ['SYNCTHING_NOT_FOUND', 'Syncthing is not installed.'],
  ['SYNCTHING_NOT_RUNNING', 'Syncthing is not running.'],
  ['SYNCTHING_TIMEOUT', 'Syncthing did not respond.'],
  ['SYNCTHING_COMMAND_FAILED', 'Syncthing could not complete the request.'],
  ['SYNCTHING_BAD_RESPONSE', 'Syncthing returned an invalid response.'],
  ['BAD_PAIRING_CODE', 'That TransNote pairing code is invalid.'],
  ['PAIR_SELF', 'You cannot pair this machine with itself.'],
  ['PAIR_CONFLICT', 'This machine is already paired with different identity data.'],
  ['FOLDER_ID_CONFLICT', 'This folder is already linked to a different Syncthing share.'],
  ['FOLDER_PATH_CONFLICT', 'That TransNote share already exists at another local path.'],
  ['FOLDER_PAUSED', 'The TransNote Syncthing folder is paused.'],
  ['FOLDER_NOT_SENDRECEIVE', 'The TransNote Syncthing folder must use Send & Receive.'],
  ['PENDING_OFFER_MISMATCH', 'A pending Syncthing offer does not match this pairing code.'],
  ['PENDING_TRANSNOTE_OFFER', 'A TransNote folder offer is waiting. Accept it first.'],
  ['PENDING_OFFER_NOT_FOUND', 'That TransNote folder offer is no longer available.'],
  ['PENDING_OFFER_NOT_TRANSNOTE', 'The selected folder offer is not a TransNote folder.'],
  ['PENDING_DEVICE_NOT_FOUND', 'That pending computer connection is no longer available.'],
  ['PENDING_DEVICE_NOT_CONFIGURED', 'The offering Syncthing device is not configured locally.'],
]);

export function addQualifiedPeer(raw, peerName) {
  const current = String(raw ?? '');
  const peer = String(peerName ?? '').trim();
  if (peer === '')
    return current;

  const entries = current
    .split(',')
    .map(value => value.trim())
    .filter(value => value !== '');

  if (entries.includes(peer))
    return current;

  return current.trim() === ''
    ? peer
    : `${current.replace(/\s+$/, '')},${peer}`;
}

export function operatorLanErrorMessage(error) {
  const code = String(error?.code ?? '');
  if (ERROR_MESSAGES.has(code))
    return ERROR_MESSAGES.get(code);
  return String(error?.detail || error?.message || 'LAN operation failed.');
}
