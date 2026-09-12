export function advancePeerNoteKnowledge({
  notes,
  localIds,
  knownIds,
  primed,
}) {
  const local = localIds instanceof Set
    ? localIds
    : new Set();

  const nextKnownIds = knownIds instanceof Set
    ? new Set(knownIds)
    : new Set();

  let hasNewPeerNote = false;

  for (const note of Array.isArray(notes) ? notes : []) {
    const id = String(note?.id ?? '').trim();

    if (id === '' || local.has(id))
      continue;

    if (primed === true && !nextKnownIds.has(id))
      hasNewPeerNote = true;

    nextKnownIds.add(id);
  }

  return {
    knownIds: nextKnownIds,
    primed: true,
    hasNewPeerNote,
  };
}
