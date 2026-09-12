import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {createRequire} from 'node:module';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import {
  dirname,
  extname,
  join,
  resolve,
  sep,
} from 'node:path';

const require = createRequire(import.meta.url);
const Store = require('../core/Store.js');


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

export async function verifyStagedAttachment(path) {
  const staged = await stat(path);

  if (staged.size > Store.MAX_ATTACHMENT_BYTES) {
    await rm(path, {force: true});

    const error = new Error('attachment exceeds maximum size');
    error.code = 'ATTACHMENT_TOO_LARGE';
    throw error;
  }

  const bytes = await readFile(path);

  if (bytes.length > Store.MAX_ATTACHMENT_BYTES) {
    await rm(path, {force: true});

    const error = new Error('attachment exceeds maximum size');
    error.code = 'ATTACHMENT_TOO_LARGE';
    throw error;
  }

  return {
    size: bytes.length,
    sha256: createHash('sha256')
      .update(bytes)
      .digest('hex'),
  };
}

export async function stageAttachment({
  attachmentRoot,
  noteId,
  attachmentId,
  fileName,
  sourcePath,
}) {
  const cleanFileName = Store.sanitizeFileName(fileName);

  if (cleanFileName === '')
    throw unsafePath();

  const path = resolveAttachmentPath(
    attachmentRoot,
    noteId,
    attachmentId,
    cleanFileName
  );

  const source = await stat(sourcePath);

  if (source.size > Store.MAX_ATTACHMENT_BYTES) {
    const error = new Error('attachment exceeds maximum size');
    error.code = 'ATTACHMENT_TOO_LARGE';
    throw error;
  }

  await mkdir(dirname(path), {
    recursive: true,
    mode: 0o700,
  });

  await copyFile(sourcePath, path);
  await chmod(path, 0o600);

  const verified = await verifyStagedAttachment(path);

  return {
    path,
    size: verified.size,
    sha256: verified.sha256,
  };
}

function invalidAttachment(message = 'attachment metadata or bytes are invalid') {
  const error = new Error(message);
  error.code = 'ATTACHMENT_INVALID';
  return error;
}

export async function mirrorAttachment({
  dataDir,
  syncDir,
  noteId,
  attachment,
}) {
  const clean = Store.sanitizeAttachment(attachment);

  if (!clean)
    throw invalidAttachment();

  const source = resolveAttachmentPath(
    join(dataDir, 'attachments'),
    noteId,
    clean.id,
    clean.name
  );

  const sourceVerified = await verifyStagedAttachment(source);

  if (
    sourceVerified.size !== clean.size ||
    sourceVerified.sha256 !== clean.sha256
  ) {
    throw invalidAttachment(
      'private attachment bytes do not match metadata'
    );
  }

  const target = resolveAttachmentPath(
    join(syncDir, '.attachments'),
    noteId,
    clean.id,
    clean.name
  );

  await mkdir(dirname(target), {
    recursive: true,
    mode: 0o700,
  });

  await copyFile(source, target);
  await chmod(target, 0o600);

  const targetVerified = await verifyStagedAttachment(target);

  if (
    targetVerified.size !== clean.size ||
    targetVerified.sha256 !== clean.sha256
  ) {
    await rm(target, {force: true});
    throw invalidAttachment(
      'mirrored attachment bytes do not match metadata'
    );
  }

  return target;
}

export async function mirrorSharedAttachments({
  dataDir,
  syncDir,
  note,
}) {
  const clean = Store.sanitizeNote(note);

  if (!clean || clean.shared !== true)
    return [];

  const mirrored = [];

  for (const attachment of clean.attachments) {
    mirrored.push(await mirrorAttachment({
      dataDir,
      syncDir,
      noteId: clean.id,
      attachment,
    }));
  }

  return mirrored;
}

export async function inspectReceivedAttachment({
  syncDir,
  noteId,
  attachment,
}) {
  const root = join(String(syncDir ?? ''), '.attachments');

  try {
    await stat(root);
  } catch (error) {
    if (error.code === 'ENOENT')
      return {state: 'waiting'};
    throw error;
  }

  const clean = Store.sanitizeAttachment(attachment);

  if (!clean)
    return {state: 'invalid'};

  let path;
  try {
    path = resolveAttachmentPath(
      root,
      noteId,
      clean.id,
      clean.name
    );
  } catch {
    return {state: 'invalid'};
  }

  let staged;
  try {
    staged = await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT')
      return {state: 'missing'};
    throw error;
  }

  if (
    staged.size < 0 ||
    staged.size > Store.MAX_ATTACHMENT_BYTES ||
    staged.size !== clean.size
  ) {
    return {
      state: 'invalid',
      path,
    };
  }

  const bytes = await readFile(path);

  if (bytes.length !== clean.size) {
    return {
      state: 'invalid',
      path,
    };
  }

  const sha256 = createHash('sha256')
    .update(bytes)
    .digest('hex');

  if (sha256 !== clean.sha256) {
    return {
      state: 'invalid',
      path,
    };
  }

  return {
    state: 'verified',
    path,
  };
}

export async function inspectStoredAttachment({
  path,
  attachment,
}) {
  const clean = Store.sanitizeAttachment(attachment);

  if (!clean)
    return {state: 'invalid'};

  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT')
      return {state: 'missing'};
    throw error;
  }

  if (
    info.size < 0 ||
    info.size > Store.MAX_ATTACHMENT_BYTES ||
    info.size !== clean.size
  ) {
    return {
      state: 'invalid',
      path,
    };
  }

  const bytes = await readFile(path);

  if (bytes.length !== clean.size) {
    return {
      state: 'invalid',
      path,
    };
  }

  const sha256 = createHash('sha256')
    .update(bytes)
    .digest('hex');

  if (sha256 !== clean.sha256) {
    return {
      state: 'invalid',
      path,
    };
  }

  return {
    state: 'verified',
    path,
  };
}

export async function saveAttachmentCopy({
  sourcePath,
  fileName,
  destinationDir,
}) {
  const cleanName = Store.sanitizeFileName(fileName);

  if (cleanName === '')
    throw invalidAttachment('attachment filename is invalid');

  await mkdir(destinationDir, {
    recursive: true,
    mode: 0o700,
  });

  const extension = extname(cleanName);
  const stem = extension === ''
    ? cleanName
    : cleanName.slice(0, -extension.length);

  for (let index = 1; index <= 10000; index++) {
    const name = index === 1
      ? cleanName
      : `${stem}.${index}${extension}`;

    const target = join(destinationDir, name);

    try {
      await copyFile(
        sourcePath,
        target,
        fsConstants.COPYFILE_EXCL
      );
      await chmod(target, 0o600);
      return target;
    } catch (error) {
      if (error.code !== 'EEXIST')
        throw error;
    }
  }

  const error = new Error('no free attachment save filename');
  error.code = 'ATTACHMENT_SAVE_FAILED';
  throw error;
}
