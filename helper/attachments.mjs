import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {createRequire} from 'node:module';
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
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

async function openNoFollowDirectory(path) {
  try {
    return await open(
      path,
      fsConstants.O_RDONLY |
        fsConstants.O_DIRECTORY |
        fsConstants.O_NOFOLLOW
    );
  } catch (error) {
    if (error.code === 'ELOOP' || error.code === 'ENOTDIR')
      throw unsafePath();

    throw error;
  }
}

async function verifyOpenAttachment(handle) {
  const before = await handle.stat();
  const size = Number(before.size);

  if (!before.isFile())
    throw invalidAttachment('attachment is not a regular file');

  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > Store.MAX_ATTACHMENT_BYTES
  ) {
    throw invalidAttachment('mirrored attachment size is invalid');
  }

  const bytes = Buffer.alloc(size);
  let offset = 0;

  while (offset < size) {
    const result = await handle.read(
      bytes,
      offset,
      size - offset,
      offset
    );

    if (result.bytesRead === 0)
      throw invalidAttachment('mirrored attachment changed during verification');

    offset += result.bytesRead;
  }

  const after = await handle.stat();

  if (after.size !== size)
    throw invalidAttachment('mirrored attachment changed during verification');

  return {
    bytes,
    size,
    sha256: createHash('sha256')
      .update(bytes)
      .digest('hex'),
  };
}

async function writeMirroredAttachment({
  syncDir,
  noteId,
  attachment,
  bytes,
}) {
  const root = join(String(syncDir ?? ''), '.attachments');
  const note = requirePathComponent(noteId);
  const attachmentId = requirePathComponent(attachment.id);
  const name = requirePathComponent(attachment.name);
  const targetName = `${attachmentId}-${name}`;

  await mkdir(root, {
    recursive: true,
    mode: 0o700,
  });

  let rootHandle;
  let noteHandle;
  let tempHandle;
  let tempPath = '';

  try {
    rootHandle = await openNoFollowDirectory(root);

    const notePath = `/proc/self/fd/${rootHandle.fd}/${note}`;

    try {
      await mkdir(notePath, {
        mode: 0o700,
      });
    } catch (error) {
      if (error.code !== 'EEXIST')
        throw error;
    }

    noteHandle = await openNoFollowDirectory(notePath);

    const targetPath =
      `/proc/self/fd/${noteHandle.fd}/${targetName}`;

    const tempName =
      `.${targetName}.tmp-${process.pid}-${Date.now()}`;

    tempPath =
      `/proc/self/fd/${noteHandle.fd}/${tempName}`;

    tempHandle = await open(
      tempPath,
      fsConstants.O_RDWR |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600
    );

    await tempHandle.writeFile(bytes);
    await tempHandle.chmod(0o600);

    const verified = await verifyOpenAttachment(tempHandle);

    if (
      verified.size !== attachment.size ||
      verified.sha256 !== attachment.sha256
    ) {
      throw invalidAttachment(
        'mirrored attachment bytes do not match metadata'
      );
    }

    await tempHandle.close();
    tempHandle = null;

    await rename(tempPath, targetPath);
    tempPath = '';

    return resolveAttachmentPath(
      root,
      note,
      attachmentId,
      name
    );
  } finally {
    if (tempHandle)
      await tempHandle.close();

    if (tempPath)
      await rm(tempPath, {force: true});

    if (noteHandle)
      await noteHandle.close();

    if (rootHandle)
      await rootHandle.close();
  }
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

  const sourceBytes = await readFile(source);
  const sourceBytesHash = createHash('sha256')
    .update(sourceBytes)
    .digest('hex');

  if (
    sourceBytes.length !== clean.size ||
    sourceBytesHash !== clean.sha256
  ) {
    throw invalidAttachment(
      'private attachment bytes changed during mirror'
    );
  }

  return writeMirroredAttachment({
    syncDir,
    noteId,
    attachment: clean,
    bytes: sourceBytes,
  });
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

export async function removeAttachmentNoteDirectory({
  attachmentRoot,
  noteId,
}) {
  const root = resolve(String(attachmentRoot ?? ''));
  const note = requirePathComponent(noteId);

  let rootHandle;

  try {
    rootHandle = await open(
      root,
      fsConstants.O_RDONLY |
        fsConstants.O_DIRECTORY |
        fsConstants.O_NOFOLLOW
    );
  } catch (error) {
    if (error.code === 'ENOENT')
      return;

    if (error.code === 'ELOOP' || error.code === 'ENOTDIR')
      throw unsafePath();

    throw error;
  }

  try {
    const directory = `/proc/self/fd/${rootHandle.fd}/${note}`;

    await rm(directory, {
      recursive: true,
      force: true,
    });
  } finally {
    await rootHandle.close();
  }
}

async function readReceivedAttachmentBytes({
  syncDir,
  noteId,
  attachment,
}) {
  const root = join(String(syncDir ?? ''), '.attachments');
  const clean = Store.sanitizeAttachment(attachment);

  if (!clean)
    return {state: 'invalid'};

  let note;
  let attachmentId;
  let name;
  let path;

  try {
    note = requirePathComponent(noteId);
    attachmentId = requirePathComponent(clean.id);
    name = requirePathComponent(clean.name);

    path = resolveAttachmentPath(
      root,
      note,
      attachmentId,
      name
    );
  } catch {
    return {state: 'invalid'};
  }

  const targetName = `${attachmentId}-${name}`;

  let rootHandle;
  let noteHandle;
  let fileHandle;

  try {
    try {
      rootHandle = await openNoFollowDirectory(root);
    } catch (error) {
      if (error.code === 'ENOENT')
        return {state: 'waiting'};

      if (error.code === 'UNSAFE_ATTACHMENT_PATH')
        return {state: 'invalid'};

      throw error;
    }

    const notePath =
      `/proc/self/fd/${rootHandle.fd}/${note}`;

    try {
      noteHandle = await openNoFollowDirectory(notePath);
    } catch (error) {
      if (error.code === 'ENOENT')
        return {state: 'missing'};

      if (error.code === 'UNSAFE_ATTACHMENT_PATH')
        return {state: 'invalid', path};

      throw error;
    }

    const sourcePath =
      `/proc/self/fd/${noteHandle.fd}/${targetName}`;

    try {
      fileHandle = await open(
        sourcePath,
        fsConstants.O_RDONLY |
          fsConstants.O_NOFOLLOW
      );
    } catch (error) {
      if (error.code === 'ENOENT')
        return {state: 'missing'};

      if (error.code === 'ELOOP' || error.code === 'ENOTDIR')
        return {state: 'invalid', path};

      throw error;
    }

    let verified;

    try {
      verified = await verifyOpenAttachment(fileHandle);
    } catch (error) {
      if (error.code === 'ATTACHMENT_INVALID')
        return {state: 'invalid', path};

      throw error;
    }

    if (
      verified.size !== clean.size ||
      verified.sha256 !== clean.sha256
    ) {
      return {
        state: 'invalid',
        path,
      };
    }

    return {
      state: 'verified',
      path,
      bytes: verified.bytes,
    };
  } finally {
    if (fileHandle)
      await fileHandle.close();

    if (noteHandle)
      await noteHandle.close();

    if (rootHandle)
      await rootHandle.close();
  }
}

function trustedAttachmentNames(attachments) {
  const names = new Set();

  for (
    const value of Array.isArray(attachments)
      ? attachments
      : []
  ) {
    const clean = Store.sanitizeAttachment(value);

    if (!clean)
      continue;

    try {
      const attachmentId = requirePathComponent(clean.id);
      const name = requirePathComponent(clean.name);

      names.add(`${attachmentId}-${name}`);
    } catch {
      continue;
    }
  }

  return names;
}

async function pruneTrustedAttachmentDirectory({
  noteDir,
  validAttachments,
}) {
  if (!Array.isArray(validAttachments))
    return;

  const expected = trustedAttachmentNames(validAttachments);

  let names;

  try {
    names = await readdir(noteDir);
  } catch (error) {
    if (error.code === 'ENOENT')
      return;

    throw error;
  }

  for (const name of names) {
    if (expected.has(name))
      continue;

    await rm(join(noteDir, name), {
      recursive: true,
      force: true,
    });
  }
}

export async function inspectReceivedAttachment({
  syncDir,
  noteId,
  attachment,
}) {
  const result = await readReceivedAttachmentBytes({
    syncDir,
    noteId,
    attachment,
  });

  if (result.state !== 'verified')
    return result;

  return {
    state: 'verified',
    path: result.path,
  };
}

export async function materializeVerifiedReceivedAttachment({
  dataDir,
  syncDir,
  noteId,
  attachment,
  validAttachments = null,
}) {
  const clean = Store.sanitizeAttachment(attachment);

  if (!clean)
    return {state: 'invalid'};

  const received = await readReceivedAttachmentBytes({
    syncDir,
    noteId,
    attachment: clean,
  });

  if (received.state !== 'verified')
    return received;

  const root = join(
    String(dataDir ?? ''),
    'verified-attachments'
  );

  let target;

  try {
    target = resolveAttachmentPath(
      root,
      noteId,
      clean.id,
      clean.name
    );
  } catch {
    return {state: 'invalid'};
  }

  const noteDir = dirname(target);

  await mkdir(noteDir, {
    recursive: true,
    mode: 0o700,
  });

  await pruneTrustedAttachmentDirectory({
    noteDir,
    validAttachments,
  });

  const existing = await inspectStoredAttachment({
    path: target,
    attachment: clean,
  });

  if (existing.state === 'verified')
    return existing;

  const tempPath =
    `${target}.tmp-${process.pid}-${Date.now()}`;

  let tempHandle;

  try {
    tempHandle = await open(
      tempPath,
      fsConstants.O_RDWR |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600
    );

    await tempHandle.writeFile(received.bytes);
    await tempHandle.chmod(0o600);

    const verified = await verifyOpenAttachment(tempHandle);

    if (
      verified.size !== clean.size ||
      verified.sha256 !== clean.sha256
    ) {
      throw invalidAttachment(
        'trusted attachment bytes do not match metadata'
      );
    }

    await tempHandle.close();
    tempHandle = null;

    await rename(tempPath, target);

    return {
      state: 'verified',
      path: target,
    };
  } finally {
    if (tempHandle)
      await tempHandle.close();

    await rm(tempPath, {force: true});
  }
}

export async function pruneVerifiedReceivedAttachments({
  dataDir,
  notes,
}) {
  const root = join(
    String(dataDir ?? ''),
    'verified-attachments'
  );

  const expected = new Map();

  for (const value of Array.isArray(notes) ? notes : []) {
    const clean = Store.sanitizeNote(value);

    if (!clean)
      continue;

    let noteId;

    try {
      noteId = requirePathComponent(clean.id);
    } catch {
      continue;
    }

    expected.set(
      noteId,
      Array.isArray(clean.attachments)
        ? clean.attachments
        : []
    );
  }

  let entries;

  try {
    entries = await readdir(root, {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === 'ENOENT')
      return;

    throw error;
  }

  for (const entry of entries) {
    const noteDir = join(root, entry.name);
    const validAttachments = expected.get(entry.name);

    if (
      validAttachments === undefined ||
      !entry.isDirectory()
    ) {
      await rm(noteDir, {
        recursive: true,
        force: true,
      });
      continue;
    }

    await pruneTrustedAttachmentDirectory({
      noteDir,
      validAttachments,
    });
  }
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
