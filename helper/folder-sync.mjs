import {
  chmod,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';

import {
  filterDeletedNotes,
  mergeDeleted,
  sanitizeDeleted,
} from './tombstones.mjs';

const require = createRequire(import.meta.url);
const Store = require('../core/Store.js');

function syncError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateDeviceId(value) {
  const deviceId = Store.normalizeText(value);

  if (deviceId === '')
    return '';

  if (
    deviceId === '.' ||
    deviceId === '..' ||
    deviceId.startsWith('.') ||
    deviceId.includes('/') ||
    deviceId.includes('\\') ||
    deviceId.includes('\0')
  ) {
    throw syncError('BAD_DEVICE_ID', 'device id is not safe for a snapshot filename');
  }

  return deviceId;
}

export function normalizeSyncConfig({
  deviceId,
  syncDir,
  allowList,
  home = homedir(),
} = {}) {
  const cleanDeviceId = validateDeviceId(deviceId);
  let cleanDir = Store.normalizeText(syncDir);

  if (cleanDir.startsWith('~'))
    cleanDir = `${home}${cleanDir.slice(1)}`;

  return {
    deviceId: cleanDeviceId,
    syncDir: cleanDir,
    allowList: Store.parseAllowList(allowList),
    configured: cleanDeviceId !== '' && cleanDir !== '',
  };
}

export function buildSnapshot({
  deviceId,
  notes,
  outbox,
  deletedIds,
  updatedAt = Store.nowIso(),
}) {
  const cleanDeviceId = validateDeviceId(deviceId);
  if (cleanDeviceId === '')
    throw syncError('BAD_DEVICE_ID', 'device id is required for folder sync');

  const shared = (Array.isArray(notes) ? notes : [])
    .map(value => Store.sanitizeNote(value))
    .filter(value => value && value.shared === true);

  return {
    version: 2,
    deviceId: cleanDeviceId,
    updatedAt,
    notes: shared,
    noteComments: Store.sanitizeOutbox(outbox),
    deletedIds: sanitizeDeleted(deletedIds),
  };
}

export async function writeSnapshot({
  syncDir,
  deviceId,
  notes,
  outbox,
  deletedIds,
  updatedAt,
}) {
  const config = normalizeSyncConfig({deviceId, syncDir, allowList: []});
  if (!config.configured)
    throw syncError('SYNC_NOT_CONFIGURED', 'device id and sync folder are required');

  const snapshot = buildSnapshot({
    deviceId: config.deviceId,
    notes,
    outbox,
    deletedIds,
    updatedAt,
  });

  const path = join(config.syncDir, `${config.deviceId}.json`);
  const temp = join(
    config.syncDir,
    `.${config.deviceId}.json.tmp-${process.pid}-${Date.now()}`
  );

  try {
    const raw = `${JSON.stringify(snapshot, null, 2)}\n`;
    await writeFile(temp, raw, {encoding: 'utf8', mode: 0o600});
    await chmod(temp, 0o600);
    await rename(temp, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temp, {force: true});
  }

  return snapshot;
}

export async function readPeerSnapshots({
  syncDir,
  deviceId,
  allowList,
}) {
  const config = normalizeSyncConfig({deviceId, syncDir, allowList});
  const diagnostics = {
    files: 0,
    fetched: 0,
    snapNotes: 0,
    peerNotes: 0,
    errors: 0,
  };

  if (!config.configured)
    return {notes: [], pairs: [], deletedIds: {}, diagnostics};

  let entries;
  try {
    entries = await readdir(config.syncDir, {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT')
      return {notes: [], pairs: [], deletedIds: {}, diagnostics};
    throw error;
  }

  const ownName = `${config.deviceId}.json`;
  const files = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith('.json'))
    .filter(name => name !== ownName)
    .filter(name => !Store.isSyncArtifact(name))
    .sort();

  diagnostics.files = files.length;

  const allNotes = [];
  const allPairs = [];
  let deletedIds = {};

  for (const name of files) {
    try {
      const raw = await readFile(join(config.syncDir, name), 'utf8');
      const parsed = JSON.parse(raw);
      diagnostics.fetched++;

      deletedIds = mergeDeleted(
        deletedIds,
        parsed?.deletedIds ?? parsed?.deleted
      );

      const rawNotes = parsed && Array.isArray(parsed.notes)
        ? parsed.notes
        : [];

      for (const value of rawNotes) {
        const clean = Store.sanitizeNote(value);
        if (!clean || clean.shared !== true)
          continue;
        if (
          clean.author !== config.deviceId &&
          !Store.isQualified(clean.author, config.allowList)
        ) {
          continue;
        }
        allNotes.push(clean);
      }

      allPairs.push(...Store.sanitizeOutbox(parsed?.noteComments));
    } catch {
      diagnostics.errors++;
    }
  }

  const visibleNotes = filterDeletedNotes(allNotes, deletedIds);
  const visiblePairs = allPairs.filter(
    entry => entry && !Object.prototype.hasOwnProperty.call(
      deletedIds,
      Store.normalizeText(entry.noteId)
    )
  );

  diagnostics.snapNotes = visibleNotes.length;

  const notes = Store.mergeNotes(
    [],
    visibleNotes,
    config.allowList,
    config.deviceId
  );

  diagnostics.peerNotes = notes.length;

  return {
    notes: Store.sortNotes(notes),
    pairs: visiblePairs,
    deletedIds,
    diagnostics,
  };
}
