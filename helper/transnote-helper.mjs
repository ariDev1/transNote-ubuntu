#!/usr/bin/env node

import {execFile} from 'node:child_process';
import {mkdir, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {homedir, hostname} from 'node:os';

import {
  normalizeSyncConfig,
  readPeerSnapshots,
  writeSnapshot,
} from './folder-sync.mjs';
import {
  inspectReceivedAttachment,
  inspectStoredAttachment,
  mirrorAttachment,
  mirrorSharedAttachments,
  removeAttachmentNoteDirectory,
  resolveAttachmentPath,
  saveAttachmentCopy,
  stageAttachment,
} from './attachments.mjs';
import {
  loadState,
  resolveDataDir,
  sanitizeHidden,
  saveState,
} from './storage.mjs';
import {decodePairingCode, loadLanPeers, saveLanPeer} from './lan-pairing.mjs';
import {createExecFileRunner, createSyncthingControl} from './syncthing-control.mjs';
import {
  addTombstone,
  isDeleted,
  mergeDeleted,
  reconcileDeleted,
  removeTombstone,
} from './tombstones.mjs';

const require = createRequire(import.meta.url);
const Store = require('../core/Store.js');
const execFileAsync = promisify(execFile);

const OPTION_KEYS = new Map([
  ['--device-id', 'deviceId'],
  ['--sync-dir', 'syncDir'],
  ['--allow-list', 'allowList'],
]);

function helperError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

async function readStdinJson() {
  let raw = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin)
    raw += chunk;

  if (Store.normalizeText(raw) === '')
    return {};

  try {
    return JSON.parse(raw);
  } catch (cause) {
    const error = new Error('stdin is not valid JSON', {cause});
    error.code = 'BAD_INPUT';
    throw error;
  }
}

function parseOptions(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const key = OPTION_KEYS.get(argv[i]);
    if (!key)
      throw helperError('BAD_OPTION', `unsupported option: ${argv[i]}`);

    if (i + 1 >= argv.length || OPTION_KEYS.has(argv[i + 1]))
      throw helperError('BAD_OPTION', `missing value for ${argv[i]}`);

    options[key] = argv[++i];
  }

  return options;
}

function resolveDeviceId(options) {
  return Store.normalizeText(options.deviceId) ||
    Store.normalizeText(process.env.TRANSNOTE_DEVICE_ID) ||
    Store.normalizeText(hostname()) ||
    'local';
}

function resolveSyncConfig(options) {
  return normalizeSyncConfig({
    deviceId: resolveDeviceId(options),
    syncDir: options.syncDir ?? process.env.TRANSNOTE_SYNC_DIR ?? '',
    allowList: options.allowList ?? process.env.TRANSNOTE_ALLOW_LIST ?? '',
  });
}

function emptyDiagnostics(configured = false) {
  return {
    configured,
    files: 0,
    fetched: 0,
    snapNotes: 0,
    peerNotes: 0,
    shown: 0,
    errors: 0,
  };
}

async function status(dataDir) {
  const state = await loadState(dataDir);
  return {
    ok: true,
    deviceId: state.deviceId,
    noteCount: state.notes.length,
  };
}

async function notesList(dataDir, config) {
  const state = await loadState(dataDir);
  const localIds = state.notes.map(note => note.id);
  const mine = new Set(localIds);

  let peers = {
    notes: [],
    pairs: [],
    deletedIds: {},
    diagnostics: emptyDiagnostics(config.configured),
  };

  if (config.configured) {
    peers = await readPeerSnapshots({
      syncDir: config.syncDir,
      deviceId: config.deviceId,
      allowList: config.allowList,
    });
  }

  const livePeerNotes = peers.notes.filter(note => !mine.has(note.id));
  const deletedIds = reconcileDeleted(
    mergeDeleted(state.deletedIds, peers.deletedIds),
    livePeerNotes
  );
  const peerNotes = livePeerNotes.filter(
    note => !isDeleted(deletedIds, note.id)
  );
  const hiddenIds = new Set(sanitizeHidden(state.hiddenIds));
  const visiblePeerNotes = peerNotes.filter(
    note => !hiddenIds.has(note.id)
  );
  const peerPairs = peers.pairs.filter(
    entry => entry && !isDeleted(deletedIds, entry.noteId)
  );
  let stateChanged =
    JSON.stringify(deletedIds) !== JSON.stringify(state.deletedIds);
  state.deletedIds = deletedIds;

  if (config.configured) {
    const prunedOutbox = Store.pruneOutbox(
      state.outbox,
      state.notes,
      peerNotes
    );

    if (
      JSON.stringify(prunedOutbox) !==
      JSON.stringify(Store.sanitizeOutbox(state.outbox))
    ) {
      state.outbox = prunedOutbox;
      stateChanged = true;
    }
  }

  if (stateChanged)
    await saveState(dataDir, state);

  const foreignComments = Store.mergeForeignComments(
    {},
    peerPairs.concat(state.outbox),
    config.allowList,
    config.deviceId
  );

  const displayNotes = state.notes
    .concat(visiblePeerNotes)
    .map(note => {
      const clean = Store.sanitizeNote(note);

      if (!clean)
        return null;

      const extra = Array.isArray(foreignComments[clean.id])
        ? foreignComments[clean.id]
        : [];

      const known = new Set(
        clean.comments.map(comment => comment.id)
      );

      for (const comment of extra) {
        if (!known.has(comment.id)) {
          clean.comments.push(comment);
          known.add(comment.id);
        }
      }

      clean.comments.sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : 1
      );

      return clean;
    })
    .filter(Boolean);

  const notes = Store.sortNotes(displayNotes);
  const attachmentStates = {};

  if (config.configured) {
    for (const note of visiblePeerNotes) {
      const attachments = Array.isArray(note.attachments)
        ? note.attachments
        : [];

      if (attachments.length === 0)
        continue;

      const noteStates = {};

      for (const attachment of attachments) {
        const result = await inspectReceivedAttachment({
          syncDir: config.syncDir,
          noteId: note.id,
          attachment,
        });

        noteStates[attachment.id] = result.state;
      }

      attachmentStates[note.id] = noteStates;
    }
  }

  return {
    ok: true,
    notes,
    localIds,
    hiddenCount: sanitizeHidden(state.hiddenIds).length,
    attachmentStates,
    diagnostics: {
      configured: config.configured,
      files: peers.diagnostics.files,
      fetched: peers.diagnostics.fetched,
      snapNotes: peers.diagnostics.snapNotes,
      peerNotes: visiblePeerNotes.length,
      shown: notes.length,
      errors: peers.diagnostics.errors,
    },
  };
}

async function commentAdd(dataDir, config) {
  const input = await readStdinJson();
  const noteId = Store.normalizeText(input.noteId);
  const commentText = Store.normalizeText(input.text);

  if (noteId === '' || commentText === '') {
    throw helperError(
      'BAD_INPUT',
      'note id and comment text are required'
    );
  }

  const state = await loadState(dataDir);
  const localNote = state.notes.find(
    note => note && note.id === noteId
  );

  let comment;

  if (localNote) {
    comment = Store.addComment(
      localNote,
      config.deviceId,
      commentText
    );

    if (!comment) {
      throw helperError(
        'BAD_INPUT',
        'comment could not be created'
      );
    }
  } else {
    if (!config.configured) {
      throw helperError(
        'NOTE_NOT_FOUND',
        'note was not found'
      );
    }

    const peers = await readPeerSnapshots({
      syncDir: config.syncDir,
      deviceId: config.deviceId,
      allowList: config.allowList,
    });

    const effectiveDeleted = reconcileDeleted(
      mergeDeleted(state.deletedIds, peers.deletedIds),
      peers.notes
    );
    const deletedChanged =
      JSON.stringify(effectiveDeleted) !== JSON.stringify(state.deletedIds);
    state.deletedIds = effectiveDeleted;

    const peerNote = peers.notes.find(
      note => note &&
        note.id === noteId &&
        !isDeleted(effectiveDeleted, note.id)
    );

    if (!peerNote) {
      if (deletedChanged)
        await saveState(dataDir, state);
      throw helperError(
        'NOTE_NOT_FOUND',
        'qualified peer note was not found'
      );
    }

    comment = Store.createComment(
      config.deviceId,
      commentText
    );

    if (!comment) {
      throw helperError(
        'BAD_INPUT',
        'comment could not be created'
      );
    }

    state.outbox = Store.sanitizeOutbox(
      state.outbox.concat([{
        noteId,
        comment,
      }])
    );
  }

  state.version = 2;
  state.deviceId = config.deviceId;
  state.notes = Store.sortNotes(state.notes);

  await saveState(dataDir, state);

  if (config.configured) {
    await writeSnapshot({
      syncDir: config.syncDir,
      deviceId: config.deviceId,
      notes: state.notes,
      outbox: state.outbox,
      deletedIds: state.deletedIds,
    });
  }

  return {
    ok: true,
    noteId,
    comment,
  };
}

async function noteCreate(dataDir, config) {
  const input = await readStdinJson();
  const state = await loadState(dataDir);
  const note = Store.createNote(input.title, input.body, config.deviceId);

  state.version = 2;
  state.deviceId = config.deviceId;
  state.notes.push(note);
  state.notes = Store.sortNotes(state.notes);

  await saveState(dataDir, state);

  return {
    ok: true,
    note,
  };
}

async function addAttachmentFromSource(
  dataDir,
  config,
  noteId,
  sourcePath
) {
  const cleanNoteId = Store.normalizeText(noteId);
  const cleanSourcePath = Store.normalizeText(sourcePath);

  if (cleanNoteId === '' || cleanSourcePath === '') {
    throw helperError(
      'BAD_INPUT',
      'note id and source path are required'
    );
  }

  const state = await loadState(dataDir);
  const note = state.notes.find(
    value => value && value.id === cleanNoteId
  );

  if (!note)
    throw helperError('NOTE_NOT_FOUND', 'local note was not found');

  if (
    config.deviceId === '' ||
    note.author !== config.deviceId
  ) {
    throw helperError(
      'NOT_OWNER',
      'only the note author can add attachments'
    );
  }

  if (note.shared === true && !config.configured) {
    throw helperError(
      'SYNC_NOT_CONFIGURED',
      'shared note attachments require folder sync'
    );
  }

  const fileName = Store.sanitizeFileName(cleanSourcePath);

  if (fileName === '')
    throw helperError('BAD_INPUT', 'attachment filename is not usable');

  const attachmentId = Store.uid('att');

  const staged = await stageAttachment({
    attachmentRoot: join(dataDir, 'attachments'),
    noteId: cleanNoteId,
    attachmentId,
    fileName,
    sourcePath: cleanSourcePath,
  });

  const attachment = Store.createAttachment(
    fileName,
    staged.size,
    staged.sha256,
    attachmentId
  );

  if (!attachment) {
    await rm(staged.path, {force: true});
    throw helperError(
      'ATTACHMENT_INVALID',
      'attachment metadata is invalid'
    );
  }

  try {
    if (note.shared === true) {
      await mirrorAttachment({
        dataDir,
        syncDir: config.syncDir,
        noteId: cleanNoteId,
        attachment,
      });
    }

    note.attachments = (
      Array.isArray(note.attachments)
        ? note.attachments
        : []
    ).concat([attachment]);

    note.updatedAt = Store.nowIso();

    state.version = 2;
    state.deviceId = config.deviceId;
    state.notes = Store.sortNotes(state.notes);

    await saveState(dataDir, state);

    if (note.shared === true) {
      await writeSnapshot({
        syncDir: config.syncDir,
        deviceId: config.deviceId,
        notes: state.notes,
        outbox: state.outbox,
        deletedIds: state.deletedIds,
      });
    }
  } catch (error) {
    await rm(staged.path, {force: true});
    throw error;
  }

  return {
    ok: true,
    note,
    attachment,
  };
}

async function attachmentAdd(dataDir, config) {
  const input = await readStdinJson();

  return addAttachmentFromSource(
    dataDir,
    config,
    input.noteId,
    input.sourcePath
  );
}

async function attachmentAddDialog(dataDir, config) {
  const input = await readStdinJson();
  const picker = process.env.TRANSNOTE_ZENITY_BIN || 'zenity';

  let stdout;
  try {
    ({stdout} = await execFileAsync(
      picker,
      [
        '--file-selection',
        '--title=Attach file',
      ]
    ));
  } catch (error) {
    if (error.code === 1) {
      return {
        ok: true,
        cancelled: true,
      };
    }

    throw helperError(
      'FILE_PICKER_FAILED',
      'attachment file picker failed'
    );
  }

  const sourcePath = Store.normalizeText(stdout);

  if (sourcePath === '') {
    return {
      ok: true,
      cancelled: true,
    };
  }

  return addAttachmentFromSource(
    dataDir,
    config,
    input.noteId,
    sourcePath
  );
}

async function resolveAttachmentActionTarget(
  dataDir,
  config,
  noteId,
  attachmentId
) {
  const cleanNoteId = Store.normalizeText(noteId);
  const cleanAttachmentId = Store.normalizeText(attachmentId);

  if (cleanNoteId === '' || cleanAttachmentId === '') {
    throw helperError(
      'BAD_INPUT',
      'note id and attachment id are required'
    );
  }

  const state = await loadState(dataDir);
  const local = state.notes.find(
    note => note && note.id === cleanNoteId
  );

  if (local) {
    const attachment = (
      Array.isArray(local.attachments)
        ? local.attachments
        : []
    )
      .map(value => Store.sanitizeAttachment(value))
      .filter(Boolean)
      .find(value => value.id === cleanAttachmentId);

    if (!attachment) {
      throw helperError(
        'ATTACHMENT_NOT_FOUND',
        'attachment was not found'
      );
    }

    let path;
    try {
      path = resolveAttachmentPath(
        join(dataDir, 'attachments'),
        cleanNoteId,
        attachment.id,
        attachment.name
      );
    } catch {
      throw helperError(
        'ATTACHMENT_NOT_VERIFIED',
        'attachment path is unsafe'
      );
    }

    const inspected = await inspectStoredAttachment({
      path,
      attachment,
    });

    if (inspected.state !== 'verified') {
      throw helperError(
        'ATTACHMENT_NOT_VERIFIED',
        'attachment bytes are not verified'
      );
    }

    return {
      attachment,
      path,
    };
  }

  if (!config.configured) {
    throw helperError(
      'ATTACHMENT_NOT_FOUND',
      'attachment was not found'
    );
  }

  const peers = await readPeerSnapshots({
    syncDir: config.syncDir,
    deviceId: config.deviceId,
    allowList: config.allowList,
  });

  const effectiveDeleted = reconcileDeleted(
    mergeDeleted(state.deletedIds, peers.deletedIds),
    peers.notes
  );

  const peerNote = peers.notes.find(
    note => note &&
      note.id === cleanNoteId &&
      !isDeleted(effectiveDeleted, note.id)
  );

  if (!peerNote) {
    throw helperError(
      'ATTACHMENT_NOT_FOUND',
      'attachment was not found'
    );
  }

  const attachment = (
    Array.isArray(peerNote.attachments)
      ? peerNote.attachments
      : []
  ).find(value => value && value.id === cleanAttachmentId);

  if (!attachment) {
    throw helperError(
      'ATTACHMENT_NOT_FOUND',
      'attachment was not found'
    );
  }

  const inspected = await inspectReceivedAttachment({
    syncDir: config.syncDir,
    noteId: cleanNoteId,
    attachment,
  });

  if (inspected.state !== 'verified') {
    throw helperError(
      'ATTACHMENT_NOT_VERIFIED',
      'attachment bytes are not verified'
    );
  }

  return {
    attachment,
    path: inspected.path,
  };
}

async function attachmentOpen(dataDir, config) {
  const input = await readStdinJson();
  const target = await resolveAttachmentActionTarget(
    dataDir,
    config,
    input.noteId,
    input.attachmentId
  );

  if (Store.isRiskyExecutable(target.attachment.name)) {
    throw helperError(
      'RISKY_ATTACHMENT',
      'this attachment type is save-only'
    );
  }

  const opener = process.env.TRANSNOTE_XDG_OPEN_BIN || 'xdg-open';

  try {
    await execFileAsync(opener, [target.path]);
  } catch {
    throw helperError(
      'ATTACHMENT_OPEN_FAILED',
      'could not open attachment'
    );
  }

  return {
    ok: true,
  };
}

async function attachmentSave(dataDir, config) {
  const input = await readStdinJson();
  const target = await resolveAttachmentActionTarget(
    dataDir,
    config,
    input.noteId,
    input.attachmentId
  );

  const home = process.env.HOME || homedir();
  const savedPath = await saveAttachmentCopy({
    sourcePath: target.path,
    fileName: target.attachment.name,
    destinationDir: join(home, 'Downloads'),
  });

  return {
    ok: true,
    savedPath,
  };
}

async function attachmentCopyText(dataDir, config) {
  const input = await readStdinJson();

  const target = await resolveAttachmentActionTarget(
    dataDir,
    config,
    input.noteId,
    input.attachmentId
  );

  if (target.attachment.kind !== 'text') {
    throw helperError(
      'ATTACHMENT_NOT_TEXT',
      'only text attachments can be copied as text'
    );
  }

  let value;
  try {
    value = await readFile(target.path, 'utf8');
  } catch {
    throw helperError(
      'ATTACHMENT_READ_FAILED',
      'could not read attachment'
    );
  }

  return {
    ok: true,
    text: value,
  };
}


async function noteColorCycle(dataDir, config) {
  const input = await readStdinJson();
  const id = Store.normalizeText(input.id);

  if (id === '')
    throw helperError('BAD_INPUT', 'note id is required');

  const state = await loadState(dataDir);
  const note = state.notes.find(
    value => value && value.id === id
  );

  if (!note)
    throw helperError('NOTE_NOT_FOUND', 'local note was not found');

  const current = Store.sanitizeColor(note.color);
  const index = Store.NOTE_COLORS.indexOf(current);

  let nextColor = Store.NOTE_COLORS[0];

  if (current !== '') {
    nextColor = index >= 0 && index < Store.NOTE_COLORS.length - 1
      ? Store.NOTE_COLORS[index + 1]
      : '';
  }

  if (!Store.setColor(note, nextColor, config.deviceId)) {
    throw helperError(
      'NOT_OWNER',
      'only the note author can change color'
    );
  }

  state.version = 2;
  state.deviceId = config.deviceId;
  state.notes = Store.sortNotes(state.notes);

  await saveState(dataDir, state);

  if (config.configured) {
    await writeSnapshot({
      syncDir: config.syncDir,
      deviceId: config.deviceId,
      notes: state.notes,
      outbox: state.outbox,
      deletedIds: state.deletedIds,
    });
  }

  return {
    ok: true,
    note,
  };
}


async function noteShare(dataDir, config) {
  const input = await readStdinJson();
  const id = Store.normalizeText(input.id);

  if (id === '')
    throw helperError('BAD_INPUT', 'note id is required');

  const state = await loadState(dataDir);
  const note = state.notes.find(value => value && value.id === id);

  if (!note)
    throw helperError('NOTE_NOT_FOUND', 'local note was not found');

  const shared = input.shared === true;
  if (!Store.setShared(note, shared, config.deviceId))
    throw helperError('NOT_OWNER', 'only the note author can change sharing');

  state.deletedIds = shared
    ? removeTombstone(state.deletedIds, id)
    : addTombstone(state.deletedIds, id);

  if (
    shared &&
    config.configured
  ) {
    await mirrorSharedAttachments({
      dataDir,
      syncDir: config.syncDir,
      note,
    });
  }

  state.version = 2;
  state.deviceId = config.deviceId;
  state.notes = Store.sortNotes(state.notes);
  await saveState(dataDir, state);

  if (
    !shared &&
    config.configured
  ) {
    await removeAttachmentNoteDirectory({
      attachmentRoot: join(config.syncDir, '.attachments'),
      noteId: id,
    });
  }

  if (config.configured) {
    await writeSnapshot({
      syncDir: config.syncDir,
      deviceId: config.deviceId,
      notes: state.notes,
      outbox: state.outbox,
      deletedIds: state.deletedIds,
    });
  }

  return {
    ok: true,
    note,
  };
}

async function noteDelete(dataDir, config) {
  const input = await readStdinJson();
  const id = Store.normalizeText(input.id);

  if (id === '')
    throw helperError('BAD_INPUT', 'note id is required');

  const state = await loadState(dataDir);
  const index = state.notes.findIndex(value => value && value.id === id);

  if (index < 0)
    throw helperError('NOTE_NOT_FOUND', 'local note was not found');

  state.notes.splice(index, 1);
  state.deletedIds = addTombstone(state.deletedIds, id);
  state.outbox = Store.sanitizeOutbox(state.outbox).filter(
    entry => entry && entry.noteId !== id
  );
  state.version = 2;
  state.deviceId = config.deviceId;
  state.notes = Store.sortNotes(state.notes);
  await saveState(dataDir, state);

  await removeAttachmentNoteDirectory({
    attachmentRoot: join(dataDir, 'attachments'),
    noteId: id,
  });

  if (config.configured) {
    await removeAttachmentNoteDirectory({
      attachmentRoot: join(config.syncDir, '.attachments'),
      noteId: id,
    });

    await writeSnapshot({
      syncDir: config.syncDir,
      deviceId: config.deviceId,
      notes: state.notes,
      outbox: state.outbox,
      deletedIds: state.deletedIds,
    });
  }

  return {
    ok: true,
    deletedId: id,
  };
}

async function noteHide(dataDir, config) {
  const input = await readStdinJson();
  const id = Store.normalizeText(input.id);

  if (id === '')
    throw helperError('BAD_INPUT', 'note id is required');

  const state = await loadState(dataDir);

  if (state.notes.some(note => note && note.id === id)) {
    throw helperError(
      'LOCAL_NOTE',
      'local notes must use delete instead of hide'
    );
  }

  if (!config.configured)
    throw helperError('NOTE_NOT_FOUND', 'qualified peer note was not found');

  const peers = await readPeerSnapshots({
    syncDir: config.syncDir,
    deviceId: config.deviceId,
    allowList: config.allowList,
  });
  const effectiveDeleted = reconcileDeleted(
    mergeDeleted(state.deletedIds, peers.deletedIds),
    peers.notes
  );
  const peerNote = peers.notes.find(
    note => note &&
      note.id === id &&
      !isDeleted(effectiveDeleted, note.id)
  );

  state.deletedIds = effectiveDeleted;

  if (!peerNote) {
    await saveState(dataDir, state);
    throw helperError(
      'NOTE_NOT_FOUND',
      'qualified peer note was not found'
    );
  }

  state.hiddenIds = sanitizeHidden(
    state.hiddenIds.concat([id])
  );
  state.version = 2;
  state.deviceId = config.deviceId;
  await saveState(dataDir, state);

  return {
    ok: true,
    hiddenId: id,
  };
}

async function notesUnhideAll(dataDir, config) {
  const state = await loadState(dataDir);
  const hiddenCount = sanitizeHidden(state.hiddenIds).length;

  state.hiddenIds = [];
  state.version = 2;
  state.deviceId = config.deviceId;
  await saveState(dataDir, state);

  return {
    ok: true,
    unhidden: hiddenCount,
  };
}

async function syncNow(dataDir, config) {
  if (!config.configured)
    throw helperError('SYNC_NOT_CONFIGURED', 'device id and sync folder are required');

  const state = await loadState(dataDir);

  await writeSnapshot({
    syncDir: config.syncDir,
    deviceId: config.deviceId,
    notes: state.notes,
    outbox: state.outbox,
    deletedIds: state.deletedIds,
  });

  return notesList(dataDir, config);
}


function requireLanConfig(config) {
  if (!config.configured)
    throw helperError('SYNC_NOT_CONFIGURED', 'device id and sync folder are required');
}

function makeSyncthingControl() {
  return createSyncthingControl({
    run: createExecFileRunner({
      binary: process.env.TRANSNOTE_SYNCTHING_BIN || 'syncthing',
    }),
  });
}

async function lanPrepare(config) {
  requireLanConfig(config);
  await mkdir(config.syncDir, {recursive: true, mode: 0o700});

  const result = await makeSyncthingControl().prepare({
    transnoteDeviceId: config.deviceId,
    syncDir: config.syncDir,
  });

  return {
    ok: true,
    pairingCode: result.pairingCode,
    syncthingDeviceId: result.localDeviceId,
    folderId: result.folderId,
    folderPath: result.folderPath,
  };
}

async function lanPair(dataDir, config) {
  requireLanConfig(config);
  await mkdir(config.syncDir, {recursive: true, mode: 0o700});
  const input = await readStdinJson();
  const remote = decodePairingCode(input.pairingCode);

  const result = await makeSyncthingControl().pair({
    localTransnoteDeviceId: config.deviceId,
    syncDir: config.syncDir,
    remote,
  });

  await saveLanPeer(dataDir, result.peer);

  return {
    ok: true,
    peer: result.peer,
  };
}

async function lanJoinExisting(dataDir, config) {
  requireLanConfig(config);
  await mkdir(config.syncDir, {recursive: true, mode: 0o700});
  const input = await readStdinJson();

  const result = await makeSyncthingControl().pair({
    localTransnoteDeviceId: config.deviceId,
    syncDir: config.syncDir,
    remote: {
      version: 1,
      transnoteDeviceId: input.transnoteDeviceId,
      syncthingDeviceId: input.syncthingDeviceId,
      folderId: input.folderId,
    },
  });

  await saveLanPeer(dataDir, result.peer);

  return {
    ok: true,
    peer: result.peer,
  };
}

async function lanAcceptPendingDevice(config) {
  requireLanConfig(config);
  const input = await readStdinJson();

  const result = await makeSyncthingControl().acceptPendingDevice({
    syncthingDeviceId: input.syncthingDeviceId,
  });

  return {
    ok: true,
    ...result,
  };
}

async function lanAcceptPending(config) {
  requireLanConfig(config);
  await mkdir(config.syncDir, {recursive: true, mode: 0o700});
  const input = await readStdinJson();

  const result = await makeSyncthingControl().acceptPending({
    syncDir: config.syncDir,
    folderId: input.folderId,
    syncthingDeviceId: input.syncthingDeviceId,
  });

  return {
    ok: true,
    ...result,
  };
}

async function lanStatus(dataDir, config) {
  const store = await loadLanPeers(dataDir);
  const result = await makeSyncthingControl().status({
    syncDir: config.syncDir,
    peers: store.peers,
  });

  return {
    ok: true,
    ...result,
  };
}
async function folderCreate(config) {
  if (config.syncDir === '')
    throw helperError('SYNC_DIR_REQUIRED', 'sync folder is required');

  await mkdir(config.syncDir, {recursive: true, mode: 0o700});

  return {
    ok: true,
    path: config.syncDir,
  };
}

const command = process.argv[2] || '';
const dataDir = resolveDataDir();

try {
  const options = parseOptions(process.argv.slice(3));
  const config = resolveSyncConfig(options);
  let result;

  if (command === 'status')
    result = await status(dataDir);
  else if (command === 'notes-list')
    result = await notesList(dataDir, config);
  else if (command === 'note-create')
    result = await noteCreate(dataDir, config);
  else if (command === 'note-share')
    result = await noteShare(dataDir, config);
  else if (command === 'note-color-cycle')
    result = await noteColorCycle(dataDir, config);
  else if (command === 'comment-add')
    result = await commentAdd(dataDir, config);
  else if (command === 'note-hide')
    result = await noteHide(dataDir, config);
  else if (command === 'notes-unhide-all')
    result = await notesUnhideAll(dataDir, config);
  else if (command === 'attachment-add')
    result = await attachmentAdd(dataDir, config);
  else if (command === 'attachment-add-dialog')
    result = await attachmentAddDialog(dataDir, config);
  else if (command === 'attachment-open')
    result = await attachmentOpen(dataDir, config);
  else if (command === 'attachment-save')
    result = await attachmentSave(dataDir, config);
  else if (command === 'attachment-copy-text')
    result = await attachmentCopyText(dataDir, config);
  else if (command === 'note-delete')
    result = await noteDelete(dataDir, config);
  else if (command === 'sync-now')
    result = await syncNow(dataDir, config);
  else if (command === 'folder-create')
    result = await folderCreate(config);
  else if (command === 'lan-prepare')
    result = await lanPrepare(config);
  else if (command === 'lan-pair')
    result = await lanPair(dataDir, config);
  else if (command === 'lan-join-existing')
    result = await lanJoinExisting(dataDir, config);
  else if (command === 'lan-accept-pending-device')
    result = await lanAcceptPendingDevice(config);
  else if (command === 'lan-accept-pending')
    result = await lanAcceptPending(config);
  else if (command === 'lan-status')
    result = await lanStatus(dataDir, config);
  else
    throw helperError('BAD_COMMAND', `unsupported command: ${command}`);

  writeJson(process.stdout, result);
} catch (error) {
  writeJson(process.stderr, {
    ok: false,
    error: {
      code: error.code || 'HELPER_FAILED',
      message: String(error.message || 'helper failed'),
    },
  });
  process.exitCode = 1;
}
