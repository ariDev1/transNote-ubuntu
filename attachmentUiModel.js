const PEER_STATES = new Set([
  'waiting',
  'verified',
  'invalid',
  'missing',
]);


export function attachmentStateFor({
  isLocal,
  noteId,
  attachmentId,
  attachmentStates,
}) {
  if (isLocal)
    return 'local';

  const raw = attachmentStates?.[noteId]?.[attachmentId];
  const state = String(raw ?? 'waiting');

  return PEER_STATES.has(state)
    ? state
    : 'invalid';
}

export function attachmentStateLabel(state) {
  if (state === 'local')
    return 'on this machine';

  if (state === 'verified')
    return 'verified';

  if (state === 'invalid')
    return 'invalid';

  if (state === 'missing')
    return 'missing';

  return 'waiting';
}

export function canUseAttachment(state) {
  return state === 'local' || state === 'verified';
}
