import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseHelperResponse} from './helperProtocol.js';

Gio._promisify(
  Gio.Subprocess.prototype,
  'communicate_utf8_async'
);

const COMMANDS = new Set([
  'notes-list',
  'note-create',
  'note-share',
  'note-delete',
  'attachment-add-dialog',
  'attachment-open',
  'attachment-save',
  'sync-now',
  'folder-create',
  'lan-prepare',
  'lan-pair',
  'lan-accept-pending',
  'lan-status',
]);

export class HelperClient {
  constructor(extensionPath, settings) {
    this._extensionPath = extensionPath;
    this._settings = settings;
    this._node = GLib.find_program_in_path('node');
    this._active = new Set();
  }

  _settingsArgs() {
    return [
      '--device-id', this._settings.get_string('device-id'),
      '--sync-dir', this._settings.get_string('sync-dir'),
      '--allow-list', this._settings.get_string('allow-list'),
    ];
  }

  async _run(command, input, cancellable = null) {
    if (!this._node)
      throw new Error('Node.js was not found');

    if (!COMMANDS.has(command))
      throw new Error(`Unsupported helper command: ${command}`);

    const helperPath = GLib.build_filenamev([
      this._extensionPath,
      'helper',
      'transnote-helper.mjs',
    ]);

    let flags = Gio.SubprocessFlags.STDOUT_PIPE |
      Gio.SubprocessFlags.STDERR_PIPE;

    if (input !== null)
      flags |= Gio.SubprocessFlags.STDIN_PIPE;

    const proc = Gio.Subprocess.new(
      [
        this._node,
        helperPath,
        command,
        ...this._settingsArgs(),
      ],
      flags
    );

    this._active.add(proc);

    let cancelId = 0;
    if (cancellable instanceof Gio.Cancellable) {
      cancelId = cancellable.connect(() => {
        try {
          proc.force_exit();
        } catch (error) {
          console.error('TransNote failed to stop helper process', error);
        }
      });

      if (cancellable.is_cancelled())
        proc.force_exit();
    }

    const stdin = input === null
      ? null
      : JSON.stringify(input);

    try {
      const [stdout, stderr] =
        await proc.communicate_utf8_async(stdin, null);

      if (!proc.get_successful()) {
        if (String(stderr ?? '').trim() !== '') {
          try {
            parseHelperResponse(stderr);
          } catch (error) {
            throw error;
          }
        }
        throw new Error(`helper exited with status ${proc.get_exit_status()}`);
      }

      return parseHelperResponse(stdout);
    } finally {
      if (cancelId > 0)
        cancellable.disconnect(cancelId);
      this._active.delete(proc);
    }
  }

  async loadNotes(cancellable = null) {
    return this._run('notes-list', null, cancellable);
  }

  async listNotes(cancellable = null) {
    const result = await this.loadNotes(cancellable);
    return Array.isArray(result.notes)
      ? result.notes
      : [];
  }

  async createNote(title, body, cancellable = null) {
    const result = await this._run(
      'note-create',
      {title, body},
      cancellable
    );

    if (!result.note || typeof result.note !== 'object')
      throw new Error('helper returned no note');

    return result.note;
  }

  async setShared(id, shared, cancellable = null) {
    const result = await this._run(
      'note-share',
      {id, shared},
      cancellable
    );

    return result.note;
  }

  async deleteNote(id, cancellable = null) {
    return this._run(
      'note-delete',
      {id},
      cancellable
    );
  }

  async addAttachment(noteId, cancellable = null) {
    return this._run(
      'attachment-add-dialog',
      {noteId},
      cancellable
    );
  }

  async openAttachment(noteId, attachmentId, cancellable = null) {
    return this._run(
      'attachment-open',
      {noteId, attachmentId},
      cancellable
    );
  }

  async saveAttachment(noteId, attachmentId, cancellable = null) {
    return this._run(
      'attachment-save',
      {noteId, attachmentId},
      cancellable
    );
  }

  async syncNow(cancellable = null) {
    return this._run('sync-now', null, cancellable);
  }

  async createFolder(cancellable = null) {
    return this._run('folder-create', null, cancellable);
  }

  async prepareLan(cancellable = null) {
    return this._run('lan-prepare', null, cancellable);
  }

  async pairLan(pairingCode, cancellable = null) {
    return this._run(
      'lan-pair',
      {pairingCode},
      cancellable
    );
  }

  async acceptPendingLan(folderId, syncthingDeviceId, cancellable = null) {
    return this._run(
      'lan-accept-pending',
      {folderId, syncthingDeviceId},
      cancellable
    );
  }

  async lanStatus(cancellable = null) {
    return this._run('lan-status', null, cancellable);
  }

  destroy() {
    for (const proc of this._active) {
      try {
        proc.force_exit();
      } catch (error) {
        logError(error, 'TransNote failed to stop helper process');
      }
    }

    this._active.clear();
    this._settings = null;
  }
}
