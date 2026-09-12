import {createHash} from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
} from 'node:fs/promises';
import {
  dirname,
  resolve,
  sep,
} from 'node:path';


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

export async function stageAttachment({
  attachmentRoot,
  noteId,
  attachmentId,
  fileName,
  sourcePath,
}) {
  const path = resolveAttachmentPath(
    attachmentRoot,
    noteId,
    attachmentId,
    fileName
  );

  await mkdir(dirname(path), {
    recursive: true,
    mode: 0o700,
  });

  await copyFile(sourcePath, path);

  const bytes = await readFile(path);
  const sha256 = createHash('sha256')
    .update(bytes)
    .digest('hex');

  return {
    path,
    size: bytes.length,
    sha256,
  };
}
