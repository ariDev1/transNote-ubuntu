import {
  chmod,
  open,
  opendir,
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

const MAX_PEER_FILES = 32;
const MAX_PEER_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PEER_AGGREGATE_BYTES = 8 * 1024 * 1024;
const SAFE_SYNC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isSafeSyncId(value) {
  return SAFE_SYNC_ID_RE.test(Store.normalizeText(value));
}

function syncError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPeerSnapshotName(name, ownName) {
  return name.endsWith('.json') &&
    name !== ownName &&
    !Store.isSyncArtifact(name);
}

async function openPeerSnapshot(path) {
  const handle = await open(path, 'r');

  try {
    const info = await handle.stat();
    const size = Number(info.size);

    if (
      !info.isFile() ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      throw syncError('PEER_FILE_INVALID', 'peer snapshot is not a regular file');
    }

    if (size > MAX_PEER_FILE_BYTES) {
      throw syncError('PEER_FILE_TOO_LARGE', 'peer snapshot exceeds byte limit');
    }

    return {handle, size};
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readPeerSnapshotBytes(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;

  while (offset < size) {
    const result = await handle.read(
      bytes,
      offset,
      size - offset,
      offset
    );

    if (result.bytesRead === 0) {
      throw syncError('PEER_FILE_CHANGED', 'peer snapshot changed during read');
    }

    offset += result.bytesRead;
  }

  const after = await handle.stat();
  if (after.size !== size) {
    throw syncError('PEER_FILE_CHANGED', 'peer snapshot changed during read');
  }

  return bytes.toString('utf8');
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

  const ownName = `${config.deviceId}.json`;
  const files = [];
  let directory;

  try {
    directory = await opendir(config.syncDir);

    for await (const entry of directory) {
      if (!entry.isFile() || !isPeerSnapshotName(entry.name, ownName))
        continue;

      diagnostics.files++;
      if (diagnostics.files > MAX_PEER_FILES) {
        diagnostics.errors++;
        return {notes: [], pairs: [], deletedIds: {}, diagnostics};
      }

      files.push(entry.name);
    }
  } catch (error) {
    if (error.code === 'ENOENT')
      return {notes: [], pairs: [], deletedIds: {}, diagnostics};
    throw error;
  }

  files.sort();

  const allNotes = [];
  const allPairs = [];
  let deletedIds = {};
  let acceptedBytes = 0;

  for (const name of files) {
    let peerFile;

    try {
      peerFile = await openPeerSnapshot(join(config.syncDir, name));

      if (acceptedBytes + peerFile.size > MAX_PEER_AGGREGATE_BYTES) {
        throw syncError(
          'PEER_AGGREGATE_TOO_LARGE',
          'peer snapshot aggregate exceeds byte limit'
        );
      }

      acceptedBytes += peerFile.size;
      const raw = await readPeerSnapshotBytes(
        peerFile.handle,
        peerFile.size
      );
      const parsed = JSON.parse(raw);
      diagnostics.fetched++;

      const peerDeletedIds = sanitizeDeleted(
        parsed?.deletedIds ?? parsed?.deleted
      );
      const safePeerDeletedIds = Object.fromEntries(
        Object.entries(peerDeletedIds)
          .filter(([id]) => isSafeSyncId(id))
      );

      deletedIds = mergeDeleted(
        deletedIds,
        safePeerDeletedIds
      );

      const rawNotes = parsed && Array.isArray(parsed.notes)
        ? parsed.notes
        : [];

      for (const value of rawNotes) {
        const clean = Store.sanitizeNote(value);
        if (!clean || !isSafeSyncId(clean.id) || clean.shared !== true)
          continue;

        clean.attachments = clean.attachments.filter(
          attachment => attachment && isSafeSyncId(attachment.id)
        );

        if (
          clean.author !== config.deviceId &&
          !Store.isQualified(clean.author, config.allowList)
        ) {
          continue;
        }
        allNotes.push(clean);
      }

      const peerPairs = Store.sanitizeOutbox(parsed?.noteComments)
        .filter(entry => entry && isSafeSyncId(entry.noteId));

      allPairs.push(...peerPairs);
    } catch {
      diagnostics.errors++;
    } finally {
      if (peerFile)
        await peerFile.handle.close();
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
