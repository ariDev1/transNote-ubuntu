export function advancePeerNoteKnowledge({
  notes,
  localIds,
  localDeviceId = '',
  knownIds,
  knownCommentIds,
  primed,
}) {
  const local = localIds instanceof Set
    ? localIds
    : new Set();

  const nextKnownIds = knownIds instanceof Set
    ? new Set(knownIds)
    : new Set();

  const nextKnownCommentIds = knownCommentIds instanceof Set
    ? new Set(knownCommentIds)
    : new Set();

  const deviceId = String(localDeviceId ?? '').trim();

  let hasNewPeerNote = false;
  let hasNewPeerComment = false;

  for (const note of Array.isArray(notes) ? notes : []) {
    const noteId = String(note?.id ?? '').trim();

    if (noteId === '')
      continue;

    if (!local.has(noteId)) {
      if (primed === true && !nextKnownIds.has(noteId))
        hasNewPeerNote = true;

      nextKnownIds.add(noteId);
    }

    const comments = Array.isArray(note?.comments)
      ? note.comments
      : [];

    for (const comment of comments) {
      const commentId = String(comment?.id ?? '').trim();
      const author = String(comment?.author ?? '').trim();

      if (
        commentId === '' ||
        author === '' ||
        (deviceId !== '' && author === deviceId)
      ) {
        continue;
      }

      const identity = JSON.stringify([noteId, commentId]);

      if (
        primed === true &&
        !nextKnownCommentIds.has(identity)
      ) {
        hasNewPeerComment = true;
      }

      nextKnownCommentIds.add(identity);
    }
  }

  return {
    knownIds: nextKnownIds,
    knownCommentIds: nextKnownCommentIds,
    primed: true,
    hasNewPeerNote,
    hasNewPeerComment,
    hasUnread: hasNewPeerNote || hasNewPeerComment,
  };
}
