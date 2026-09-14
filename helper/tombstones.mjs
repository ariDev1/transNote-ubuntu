function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeTimestamp(value) {
  const text = normalizeText(value);
  if (text === '')
    return '';

  const time = Date.parse(text);
  if (!Number.isFinite(time))
    return '';

  return new Date(time).toISOString();
}

export function sanitizeDeleted(raw) {
  const out = {};

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object')
        continue;

      const id = normalizeText(entry.id ?? entry.noteId);
      const deletedAt = normalizeTimestamp(entry.deletedAt);
      if (id !== '' && deletedAt !== '')
        out[id] = deletedAt;
    }

    return out;
  }

  if (!raw || typeof raw !== 'object')
    return out;

  for (const [key, value] of Object.entries(raw)) {
    const id = normalizeText(key);
    const deletedAt = normalizeTimestamp(
      typeof value === 'string' ? value : value?.deletedAt
    );

    if (id !== '' && deletedAt !== '')
      out[id] = deletedAt;
  }

  return out;
}

export function mergeDeleted(...maps) {
  const out = {};

  for (const value of maps) {
    const clean = sanitizeDeleted(value);

    for (const [id, deletedAt] of Object.entries(clean)) {
      if (!(id in out) || deletedAt > out[id])
        out[id] = deletedAt;
    }
  }

  return out;
}

export function addTombstone(
  deletedIds,
  noteId,
  deletedAt = new Date().toISOString()
) {
  const out = mergeDeleted(deletedIds);
  const id = normalizeText(noteId);
  const stamp = normalizeTimestamp(deletedAt);

  if (id !== '' && stamp !== '')
    out[id] = stamp;

  return out;
}

export function removeTombstone(deletedIds, noteId) {
  const out = mergeDeleted(deletedIds);
  const id = normalizeText(noteId);

  if (id !== '')
    delete out[id];

  return out;
}

export function isDeleted(deletedIds, noteId) {
  const id = normalizeText(noteId);
  if (id === '')
    return false;

  return Object.prototype.hasOwnProperty.call(
    sanitizeDeleted(deletedIds),
    id
  );
}

export function filterDeletedNotes(notes, deletedIds) {
  const cleanDeleted = sanitizeDeleted(deletedIds);
  return (Array.isArray(notes) ? notes : []).filter(
    note => note && !Object.prototype.hasOwnProperty.call(cleanDeleted, normalizeText(note.id))
  );
}

export function reconcileDeleted(deletedIds, liveNotes) {
  const out = mergeDeleted(deletedIds);

  for (const note of Array.isArray(liveNotes) ? liveNotes : []) {
    if (!note || note.shared !== true)
      continue;

    const id = normalizeText(note.id);
    const updatedAt = normalizeTimestamp(note.updatedAt);
    const deletedAt = out[id];

    if (
      id !== '' &&
      updatedAt !== '' &&
      deletedAt &&
      updatedAt > deletedAt
    ) {
      delete out[id];
    }
  }

  return out;
}
