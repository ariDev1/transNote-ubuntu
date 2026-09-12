import {resolve, sep} from 'node:path';


function unsafePath() {
  const error = new Error('attachment path contains an unsafe component');
  error.code = 'UNSAFE_ATTACHMENT_PATH';
  return error;
}

function requirePathComponent(value) {
  const text = String(value ?? '');

  if (
    text === '' ||
    text === '.' ||
    text === '..' ||
    text.includes('/') ||
    text.includes('\\') ||
    text.includes('\0')
  ) {
    throw unsafePath();
  }

  return text;
}

export function resolveAttachmentPath(
  attachmentRoot,
  noteId,
  attachmentId,
  fileName
) {
  const root = resolve(String(attachmentRoot ?? ''));
  const note = requirePathComponent(noteId);
  const attachment = requirePathComponent(attachmentId);
  const name = requirePathComponent(fileName);

  const noteRoot = resolve(root, note);
  const path = resolve(noteRoot, `${attachment}-${name}`);

  if (!path.startsWith(`${noteRoot}${sep}`))
    throw unsafePath();

  return path;
}
