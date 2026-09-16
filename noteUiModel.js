const DEFAULT_PREVIEW_CHARS = 140;


export function compactNotePreview(value, maxChars = DEFAULT_PREVIEW_CHARS) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  const limit = Number.isInteger(maxChars) && maxChars >= 16
    ? maxChars
    : DEFAULT_PREVIEW_CHARS;

  if (normalized.length <= limit)
    return normalized;

  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}


export function compactNoteSummary({comments, attachments} = {}) {
  const commentCount = Array.isArray(comments)
    ? comments.length
    : 0;

  const attachmentCount = Array.isArray(attachments)
    ? attachments.length
    : 0;

  const parts = [];

  if (commentCount > 0) {
    parts.push(
      `${commentCount} comment${commentCount === 1 ? '' : 's'}`
    );
  }

  if (attachmentCount > 0) {
    parts.push(
      `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`
    );
  }

  return parts.join(' · ');
}


export function filterNotes(notes, query) {
  const list = Array.isArray(notes) ? notes : [];
  const needle = String(query ?? '').trim().toLowerCase();

  if (needle === '')
    return list.slice();

  return list.filter(note => {
    const fields = [
      note?.title,
      note?.body,
      note?.author,
    ];

    return fields.some(value =>
      String(value ?? '').toLowerCase().includes(needle)
    );
  });
}
