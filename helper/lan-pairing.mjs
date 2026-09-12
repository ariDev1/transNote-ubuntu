import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const Store = require('../core/Store.js');

const DEVICE_ID_RE = /^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/;
const FOLDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function pairingError(code, message, cause) {
  const error = new Error(message, cause ? {cause} : undefined);
  error.code = code;
  return error;
}

function cleanTransNoteDeviceId(value) {
  const id = Store.normalizeText(value);
  if (
    id === '' ||
    id === '.' ||
    id === '..' ||
    id.startsWith('.') ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0')
  ) {
    throw pairingError('BAD_PAIRING_CODE', 'TransNote device id is invalid');
  }
  return id;
}

function cleanSyncthingDeviceId(value) {
  const id = Store.normalizeText(value);
  if (!DEVICE_ID_RE.test(id))
    throw pairingError('BAD_PAIRING_CODE', 'Syncthing device id is invalid');
  return id;
}

function cleanFolderId(value) {
  const id = Store.normalizeText(value);
  if (!FOLDER_ID_RE.test(id))
    throw pairingError('BAD_PAIRING_CODE', 'Syncthing folder id is invalid');
  return id;
}

function cleanPeer(value) {
  if (!value || typeof value !== 'object')
    throw pairingError('BAD_PAIRING_CODE', 'pairing payload is invalid');

  if (value.version !== undefined && value.version !== 1)
    throw pairingError('BAD_PAIRING_CODE', 'pairing version is unsupported');

  return {
    version: 1,
    transnoteDeviceId: cleanTransNoteDeviceId(value.transnoteDeviceId),
    syncthingDeviceId: cleanSyncthingDeviceId(value.syncthingDeviceId),
    folderId: cleanFolderId(value.folderId),
  };
}

export function encodePairingCode(value) {
  const peer = cleanPeer(value);
  const raw = JSON.stringify(peer);
  return `TN1:${Buffer.from(raw, 'utf8').toString('base64url')}`;
}

export function decodePairingCode(code) {
  const text = String(code ?? '').trim();
  if (!text.startsWith('TN1:') || text.length <= 4)
    throw pairingError('BAD_PAIRING_CODE', 'pairing code prefix is invalid');

  let parsed;
  try {
    const raw = Buffer.from(text.slice(4), 'base64url').toString('utf8');
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw pairingError('BAD_PAIRING_CODE', 'pairing code payload is invalid', cause);
  }

  if (parsed?.version !== 1)
    throw pairingError('BAD_PAIRING_CODE', 'pairing version is unsupported');

  return cleanPeer(parsed);
}

export function validatePairingPeer({
  remote,
  localTransnoteDeviceId,
  localSyncthingDeviceId,
}) {
  const clean = cleanPeer(remote);
  const localName = cleanTransNoteDeviceId(localTransnoteDeviceId);
  const localSyncthing = cleanSyncthingDeviceId(localSyncthingDeviceId);

  if (
    clean.transnoteDeviceId === localName ||
    clean.syncthingDeviceId === localSyncthing
  ) {
    throw pairingError('PAIR_SELF', 'cannot pair a machine with itself');
  }

  return clean;
}

function sanitizeStoredPeer(value) {
  try {
    const clean = cleanPeer(value);
    const pairedAt = Store.normalizeText(value?.pairedAt);
    if (pairedAt === '')
      throw new Error('pairedAt is required');
    return {
      transnoteDeviceId: clean.transnoteDeviceId,
      syncthingDeviceId: clean.syncthingDeviceId,
      folderId: clean.folderId,
      pairedAt,
    };
  } catch (cause) {
    throw pairingError('PAIR_STORE_CORRUPT', 'lan_peers.json is corrupt', cause);
  }
}

export async function loadLanPeers(dataDir) {
  const path = join(dataDir, 'lan_peers.json');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT')
      return {version: 1, peers: []};
    throw error;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.peers))
      throw new Error('invalid peer store envelope');
    return {
      version: 1,
      peers: parsed.peers.map(sanitizeStoredPeer),
    };
  } catch (cause) {
    if (cause?.code === 'PAIR_STORE_CORRUPT')
      throw cause;
    throw pairingError('PAIR_STORE_CORRUPT', 'lan_peers.json is corrupt', cause);
  }
}

export async function saveLanPeer(dataDir, value, pairedAt = new Date().toISOString()) {
  const clean = cleanPeer(value);
  const store = await loadLanPeers(dataDir);

  for (const peer of store.peers) {
    const sameSyncthing = peer.syncthingDeviceId === clean.syncthingDeviceId;
    const sameName = peer.transnoteDeviceId === clean.transnoteDeviceId;

    if (sameSyncthing || sameName) {
      if (
        peer.syncthingDeviceId !== clean.syncthingDeviceId ||
        peer.transnoteDeviceId !== clean.transnoteDeviceId ||
        peer.folderId !== clean.folderId
      ) {
        throw pairingError('PAIR_CONFLICT', 'paired machine identity conflicts with existing record');
      }
      return peer;
    }
  }

  const saved = {
    transnoteDeviceId: clean.transnoteDeviceId,
    syncthingDeviceId: clean.syncthingDeviceId,
    folderId: clean.folderId,
    pairedAt: String(pairedAt),
  };
  store.peers.push(saved);
  store.peers.sort((a, b) => a.transnoteDeviceId.localeCompare(b.transnoteDeviceId));

  await mkdir(dataDir, {recursive: true, mode: 0o700});
  await chmod(dataDir, 0o700);

  const path = join(dataDir, 'lan_peers.json');
  const temp = join(dataDir, `.lan_peers.json.tmp-${process.pid}`);
  try {
    const raw = `${JSON.stringify(store, null, 2)}\n`;
    await writeFile(temp, raw, {encoding: 'utf8', mode: 0o600});
    await chmod(temp, 0o600);
    await rename(temp, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temp, {force: true});
  }

  return saved;
}
