import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';

import {sanitizeDeleted} from './tombstones.mjs';

const require = createRequire(import.meta.url);
const Store = require('../core/Store.js');

export const MAX_HIDDEN = 1000;

export function sanitizeHidden(raw) {
  const out = [];
  const seen = new Set();
  const values = Array.isArray(raw) ? raw : [];

  for (const entry of values) {
    const id = Store.normalizeText(
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? entry.id
          : ''
    );

    if (id === '' || seen.has(id))
      continue;

    seen.add(id);
    out.push(id);

    if (out.length >= MAX_HIDDEN)
      break;
  }

  return out;
}

export function resolveDataDir(env = process.env) {
  const base = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return env.TRANSNOTE_DATA_DIR || join(base, 'transnote');
}

function emptyState() {
  return {
    version: 2,
    deviceId: '',
    notes: [],
    outbox: [],
    deletedIds: {},
    peerDeletedIds: {},
    hiddenIds: [],
  };
}

function sanitizeState(parsed) {
  const rawNotes = parsed && Array.isArray(parsed.notes)
    ? parsed.notes
    : Array.isArray(parsed)
      ? parsed
      : [];

  const notes = rawNotes
    .map(note => Store.sanitizeNote(note))
    .filter(Boolean);

  return {
    version: 2,
    deviceId: Store.normalizeText(parsed?.deviceId),
    notes,
    outbox: Store.sanitizeOutbox(parsed?.outbox),
    deletedIds: sanitizeDeleted(parsed?.deletedIds ?? parsed?.deleted),
    peerDeletedIds: sanitizeDeleted(parsed?.peerDeletedIds),
    hiddenIds: sanitizeHidden(parsed?.hiddenIds ?? parsed?.hidden),
  };
}

export async function loadState(dataDir = resolveDataDir()) {
  const path = join(dataDir, 'notes.json');

  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT')
      return emptyState();
    throw error;
  }

  try {
    return sanitizeState(JSON.parse(raw));
  } catch (cause) {
    const error = new Error('notes.json is corrupt', {cause});
    error.code = 'STORE_CORRUPT';
    throw error;
  }
}

export async function saveState(dataDir, state) {
  await mkdir(dataDir, {recursive: true, mode: 0o700});
  await chmod(dataDir, 0o700);

  const path = join(dataDir, 'notes.json');
  const backup = join(dataDir, 'notes.json.bak');
  const temp = join(dataDir, `.notes.json.tmp-${process.pid}`);

  try {
    try {
      const previous = await readFile(path);
      if (previous.length > 0) {
        await copyFile(path, backup);
        await chmod(backup, 0o600);
      }
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw error;
    }

    const clean = sanitizeState(state);
    const raw = `${JSON.stringify(clean, null, 2)}\n`;

    await writeFile(temp, raw, {encoding: 'utf8', mode: 0o600});
    await chmod(temp, 0o600);
    await rename(temp, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temp, {force: true});
  }
}
