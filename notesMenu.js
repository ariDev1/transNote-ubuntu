import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {addQualifiedPeer, operatorLanErrorMessage} from './lanUiModel.js';
import {
  attachmentStateFor,
  attachmentStateLabel,
  canUseAttachment,
} from './attachmentUiModel.js';
import {advancePeerNoteKnowledge} from './unreadUiModel.js';

const POLL_SECONDS = 15;

export class NotesMenuView {
  constructor({
    helper,
    cancellable,
    settings,
    version,
    revision,
    repositoryUrl,
    onUnreadChanged,
  }) {
    this._helper = helper;
    this._cancellable = cancellable;
    this._settings = settings;
    this._version = String(version ?? '').trim();
    this._revision = String(revision ?? '').trim();
    this._repositoryUrl = String(repositoryUrl ?? '').trim();
    this._onUnreadChanged =
      typeof onUnreadChanged === 'function'
        ? onUnreadChanged
        : null;
    this._knownPeerNoteIds = new Set();
    this._peerNotesPrimed = false;
    this._busy = false;
    this._destroyed = false;
    this._refreshBusy = false;
    this._refreshPending = false;
    this._localIds = new Set();
    this._commentDrafts = new Map();
    this._commentFocusedNoteId = '';
    this._commentSubmitNoteId = '';
    this._diagnosticState = null;
    this._lanStatusBusy = false;
    this._clipboard = St.Clipboard.get_default();

    this.actor = new St.BoxLayout({
      vertical: true,
      style_class: 'transnote-popup',
    });

    this._toolbar = new St.BoxLayout({
      style_class: 'transnote-toolbar',
    });

    this._notesTab = new St.Button({
      label: 'Notes',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-view-button',
    });
    this._newNoteButton = new St.Button({
      label: 'New note',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-new-note-button',
    });
    this._setupTab = new St.Button({
      label: 'Setup',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-settings-button',
    });

    this._notesTab.connect('clicked', () => this._showView('notes'));
    this._newNoteButton.connect(
      'clicked',
      () => this._setComposerVisible(true)
    );
    this._setupTab.connect('clicked', () => this._showView('setup'));

    this._toolbar.add_child(this._notesTab);
    this._toolbar.add_child(new St.Widget({
      x_expand: true,
    }));
    this._toolbar.add_child(this._newNoteButton);
    this._toolbar.add_child(this._setupTab);
    this._notesTab.add_style_class_name('transnote-tab-active');

    this._notesView = this._buildNotesView();
    this._setupView = this._buildSetupView();
    this._setupScrollView = new St.ScrollView({
      style_class: 'transnote-setup-scroll',
      overlay_scrollbars: false,
      x_expand: true,
    });
    this._setupScrollView.set_policy(
      St.PolicyType.NEVER,
      St.PolicyType.AUTOMATIC
    );
    this._setupScrollView.set_child(this._setupView);
    this._setupScrollView.visible = false;
    this._footer = this._buildFooter();

    this.actor.add_child(this._toolbar);
    this.actor.add_child(this._notesView);
    this.actor.add_child(this._setupScrollView);
    this.actor.add_child(this._footer);

    this.refresh();

    this._pollId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      POLL_SECONDS,
      () => {
        if (this._destroyed)
          return GLib.SOURCE_REMOVE;

        this.refresh();
        if (this._setupScrollView?.visible)
          this._refreshLanStatus();
        return GLib.SOURCE_CONTINUE;
      }
    );
  }

  _buildFooter() {
    const footer = new St.BoxLayout({
      style_class: 'transnote-footer',
      x_expand: true,
      opacity: 160,
    });

    footer.add_child(new St.Widget({
      x_expand: true,
    }));

    if (this._version !== '') {
      footer.add_child(new St.Label({
        text: this._version,
        style_class: 'transnote-version',
      }));
    }

    if (
      this._version !== '' &&
      this._revision !== ''
    ) {
      footer.add_child(new St.Label({
        text: '·',
        style_class: 'transnote-version',
      }));
    }

    if (this._revision !== '') {
      footer.add_child(new St.Label({
        text: this._revision,
        style_class: 'transnote-revision',
      }));
    }

    if (
      (this._version !== '' || this._revision !== '') &&
      this._repositoryUrl !== ''
    ) {
      footer.add_child(new St.Label({
        text: '·',
        style_class: 'transnote-version',
      }));
    }

    if (this._repositoryUrl !== '') {
      const repositoryButton = new St.Button({
        label: 'GitHub',
        can_focus: true,
        reactive: true,
        style_class: 'transnote-repository-link',
      });

      repositoryButton.connect(
        'clicked',
        () => this._openRepository()
      );

      footer.add_child(repositoryButton);
    }

    return footer;
  }

  _buildNotesView() {
    const view = new St.BoxLayout({
      vertical: true,
      style_class: 'transnote-notes-view',
    });

    this._status = new St.Label({
      text: 'Ready',
      style_class: 'transnote-status',
    });

    const statusRow = new St.BoxLayout();
    statusRow.add_child(this._status);
    statusRow.add_child(new St.Widget({x_expand: true}));

    this._unhideAllButton = new St.Button({
      label: 'Unhide all',
      can_focus: true,
      reactive: true,
      visible: false,
      style_class: 'button transnote-note-action',
    });
    this._unhideAllButton.connect(
      'clicked',
      () => this._unhideAll()
    );
    statusRow.add_child(this._unhideAllButton);

    this._notesBox = new St.BoxLayout({
      vertical: true,
      style_class: 'transnote-section',
    });

    this._scrollView = new St.ScrollView({
      style_class: 'transnote-scroll',
      overlay_scrollbars: false,
    });
    this._scrollView.set_policy(
      St.PolicyType.NEVER,
      St.PolicyType.AUTOMATIC
    );
    this._scrollView.set_child(this._notesBox);

    this._composer = new St.BoxLayout({
      vertical: true,
      style_class: 'transnote-composer',
      visible: false,
    });

    this._titleEntry = new St.Entry({
      hint_text: 'Title',
      can_focus: true,
      style_class: 'transnote-entry',
    });

    this._bodyEntry = new St.Entry({
      hint_text: 'Note',
      can_focus: true,
      style_class: 'transnote-entry transnote-body-entry',
    });
    this._bodyEntry.clutter_text.single_line_mode = false;
    this._bodyEntry.clutter_text.line_wrap = true;
    this._bodyEntry.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

    const composerActions = new St.BoxLayout({
      style_class: 'transnote-composer-actions',
    });
    const cancelButton = new St.Button({
      label: 'Cancel',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-cancel-button',
    });
    this._addButton = new St.Button({
      label: 'Add note',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-add-button',
    });

    cancelButton.connect('clicked', () => this._cancelComposer());
    this._addButton.connect('clicked', () => this._createNote());

    composerActions.add_child(cancelButton);
    composerActions.add_child(new St.Widget({
      x_expand: true,
    }));
    composerActions.add_child(this._addButton);

    this._composer.add_child(this._titleEntry);
    this._composer.add_child(this._bodyEntry);
    this._composer.add_child(composerActions);

    view.add_child(this._composer);
    view.add_child(statusRow);
    view.add_child(this._scrollView);
    return view;
  }

  _buildSetupView() {
    const view = new St.BoxLayout({
      vertical: true,
      style_class: 'transnote-setup',
    });

    view.add_child(new St.Label({
      text: 'Device sync',
      style_class: 'transnote-setup-title',
    }));

    view.add_child(new St.Label({
      text: 'This computer',
      style_class: 'transnote-field-label',
    }));
    this._machineNameLabel = new St.Label({
      text: this._settings.get_string('device-id'),
      style_class: 'transnote-machine-name',
    });
    view.add_child(this._machineNameLabel);

    this._prepareLanButton = new St.Button({
      label: 'Start new sync',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-lan-button',
    });
    this._prepareLanButton.connect('clicked', () => this._prepareLan());
    view.add_child(this._prepareLanButton);

    view.add_child(new St.Label({
      text: 'Your setup code',
      style_class: 'transnote-field-label',
    }));

    const codeRow = new St.BoxLayout({
      style_class: 'transnote-pair-row',
    });
    this._pairingCodeEntry = new St.Entry({
      hint_text: 'Select Start new sync first',
      can_focus: true,
      x_expand: true,
      style_class: 'transnote-entry transnote-pair-code',
    });
    this._pairingCodeEntry.clutter_text.editable = false;
    this._copyPairingButton = new St.Button({
      label: 'Copy code',
      can_focus: true,
      reactive: true,
      style_class: 'button',
    });
    this._copyPairingButton.connect('clicked', () => this._copyPairingCode());
    codeRow.add_child(this._pairingCodeEntry);
    codeRow.add_child(this._copyPairingButton);
    view.add_child(codeRow);

    view.add_child(new St.Label({
      text: 'Join existing sync',
      style_class: 'transnote-field-label',
    }));
    this._incomingPairingEntry = new St.Entry({
      hint_text: 'Paste TransNote setup code',
      can_focus: true,
      style_class: 'transnote-entry',
    });
    view.add_child(this._incomingPairingEntry);

    this._pairLanButton = new St.Button({
      label: 'Connect',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-lan-button',
    });
    this._pairLanButton.connect('clicked', () => this._pairLan());
    view.add_child(this._pairLanButton);

    view.add_child(new St.Label({
      text: 'Pending computer connections',
      style_class: 'transnote-field-label',
    }));
    this._pendingDevicesBox = new St.BoxLayout({
      vertical: true,
      style_class: 'transnote-pending-list',
    });
    view.add_child(this._pendingDevicesBox);
    this._renderPendingDevices([]);

    view.add_child(new St.Label({
      text: 'Pending TransNote folders',
      style_class: 'transnote-field-label',
    }));
    this._pendingOffersBox = new St.BoxLayout({
      vertical: true,
      style_class: 'transnote-pending-list',
    });
    view.add_child(this._pendingOffersBox);
    this._renderPendingOffers([]);

    view.add_child(new St.Label({
      text: 'Connected computers',
      style_class: 'transnote-field-label',
    }));
    this._pairedMachines = new St.Label({
      text: 'No computers connected yet.',
      style_class: 'transnote-paired-list',
    });
    this._pairedMachines.clutter_text.line_wrap = true;
    view.add_child(this._pairedMachines);

    this._setupStatus = new St.Label({
      text: 'Device sync is ready to configure.',
      style_class: 'transnote-status',
    });
    view.add_child(this._setupStatus);

    this._syncStatus = new St.Label({
      text: 'Sync service: checking…',
      style_class: 'transnote-status',
    });
    view.add_child(this._syncStatus);

    this._advancedButton = new St.Button({
      label: 'Advanced',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-advanced-button',
    });
    this._advancedButton.connect(
      'clicked',
      () => this._toggleAdvancedSetup()
    );
    view.add_child(this._advancedButton);

    this._advancedSetup = new St.BoxLayout({
      vertical: true,
      visible: false,
      style_class: 'transnote-advanced-setup',
    });

    this._advancedSetup.add_child(new St.Label({
      text: 'Machine name',
      style_class: 'transnote-field-label',
    }));
    this._deviceEntry = new St.Entry({
      hint_text: 'WarpCoreCoffee',
      can_focus: true,
      style_class: 'transnote-entry',
      text: this._settings.get_string('device-id'),
    });
    this._advancedSetup.add_child(this._deviceEntry);
    this._advancedSetup.add_child(new St.Label({
      text: 'Keep this name stable after sharing notes.',
      style_class: 'transnote-hint',
    }));

    this._advancedSetup.add_child(new St.Label({
      text: 'Shared folder',
      style_class: 'transnote-field-label',
    }));
    this._syncDirEntry = new St.Entry({
      hint_text: '~/transnote-lan',
      can_focus: true,
      style_class: 'transnote-entry',
      text: this._settings.get_string('sync-dir'),
    });
    this._advancedSetup.add_child(this._syncDirEntry);

    this._advancedSetup.add_child(new St.Label({
      text: 'Trusted peers',
      style_class: 'transnote-field-label',
    }));
    this._allowListEntry = new St.Entry({
      hint_text: 'QDidIt,TeaEarlGreyHot',
      can_focus: true,
      style_class: 'transnote-entry',
      text: this._settings.get_string('allow-list'),
    });
    this._advancedSetup.add_child(this._allowListEntry);
    this._advancedSetup.add_child(new St.Label({
      text: 'Pairing updates this list automatically.',
      style_class: 'transnote-hint',
    }));

    this._advancedSetup.add_child(new St.Label({
      text: 'Join existing Omarchy or manual share',
      style_class: 'transnote-field-label',
    }));
    this._manualPeerNameEntry = new St.Entry({
      hint_text: 'Remote TransNote machine name',
      can_focus: true,
      style_class: 'transnote-entry',
    });
    this._advancedSetup.add_child(this._manualPeerNameEntry);

    this._manualSyncthingIdEntry = new St.Entry({
      hint_text: 'Syncthing device ID',
      can_focus: true,
      style_class: 'transnote-entry',
    });
    this._advancedSetup.add_child(this._manualSyncthingIdEntry);

    this._manualFolderIdEntry = new St.Entry({
      hint_text: 'Existing folder ID',
      can_focus: true,
      style_class: 'transnote-entry',
    });
    this._advancedSetup.add_child(this._manualFolderIdEntry);

    this._manualJoinButton = new St.Button({
      label: 'Join existing share',
      can_focus: true,
      reactive: true,
      style_class: 'button transnote-lan-button',
    });
    this._manualJoinButton.connect(
      'clicked',
      () => this._joinExistingLan()
    );
    this._advancedSetup.add_child(this._manualJoinButton);
    this._advancedSetup.add_child(new St.Label({
      text: 'Use this only when the existing TransNote share has no setup code.',
      style_class: 'transnote-hint',
    }));

    const actions = new St.BoxLayout({
      style_class: 'transnote-setup-actions',
    });

    this._createFolderButton = new St.Button({
      label: 'Create folder',
      can_focus: true,
      reactive: true,
      style_class: 'button',
    });
    this._saveSetupButton = new St.Button({
      label: 'Save',
      can_focus: true,
      reactive: true,
      style_class: 'button',
    });
    this._checkNowButton = new St.Button({
      label: 'Check now',
      can_focus: true,
      reactive: true,
      style_class: 'button',
    });

    this._createFolderButton.connect('clicked', () => this._createFolder());
    this._saveSetupButton.connect('clicked', () => this._saveSetup());
    this._checkNowButton.connect('clicked', () => this._checkNow());

    actions.add_child(this._createFolderButton);
    actions.add_child(this._saveSetupButton);
    actions.add_child(this._checkNowButton);
    this._advancedSetup.add_child(actions);

    this._diagnostics = new St.Label({
      text: 'LAN: not configured',
      style_class: 'transnote-diagnostics',
    });
    this._advancedSetup.add_child(this._diagnostics);

    this._lanRuntimeStatus = new St.Label({
      text: 'Syncthing: not checked',
      style_class: 'transnote-diagnostics',
    });
    this._advancedSetup.add_child(this._lanRuntimeStatus);
    this._advancedSetup.add_child(new St.Label({
      text: 'Existing synchronized folders remain supported.',
      style_class: 'transnote-hint',
    }));

    view.add_child(this._advancedSetup);
    return view;
  }

  _setComposerVisible(visible) {
    if (this._destroyed || !this._composer)
      return;

    this._composer.visible = visible === true;
  }

  _cancelComposer() {
    if (this._destroyed)
      return;

    this._titleEntry.set_text('');
    this._bodyEntry.set_text('');
    this._setComposerVisible(false);
  }

  _toggleAdvancedSetup() {
    if (this._destroyed || !this._advancedSetup)
      return;

    this._advancedSetup.visible = !this._advancedSetup.visible;
  }

  _showView(name) {
    if (this._destroyed)
      return;

    const setup = name === 'setup';
    this._notesView.visible = !setup;
    this._setupScrollView.visible = setup;
    this._newNoteButton.visible = !setup;

    this._notesTab.remove_style_class_name('transnote-tab-active');
    this._setupTab.remove_style_class_name('transnote-tab-active');
    (setup ? this._setupTab : this._notesTab)
      .add_style_class_name('transnote-tab-active');

    if (setup) {
      this._machineNameLabel.text =
        this._settings.get_string('device-id');
      this._deviceEntry.set_text(this._settings.get_string('device-id'));
      this._syncDirEntry.set_text(this._settings.get_string('sync-dir'));
      this._allowListEntry.set_text(this._settings.get_string('allow-list'));
      this._updateDiagnostics(this._diagnosticState);
      this._refreshLanStatus();
    } else {
      this.refresh();
    }
  }

  async refresh() {
    if (this._destroyed)
      return;

    if (this._refreshBusy) {
      this._refreshPending = true;
      return;
    }

    this._refreshBusy = true;
    this._status.text = 'Loading…';

    try {
      const result = await this._helper.loadNotes(this._cancellable);

      if (this._destroyed)
        return;

      const notes = Array.isArray(result.notes) ? result.notes : [];
      this._localIds = new Set(
        Array.isArray(result.localIds) ? result.localIds : []
      );

      const peerKnowledge = advancePeerNoteKnowledge({
        notes,
        localIds: this._localIds,
        knownIds: this._knownPeerNoteIds,
        primed: this._peerNotesPrimed,
      });

      this._knownPeerNoteIds = peerKnowledge.knownIds;
      this._peerNotesPrimed = peerKnowledge.primed;

      if (peerKnowledge.hasNewPeerNote)
        this._onUnreadChanged?.(true);

      this._diagnosticState = result.diagnostics || null;

      const attachmentStates =
        result.attachmentStates &&
        typeof result.attachmentStates === 'object'
          ? result.attachmentStates
          : {};

      const hiddenCount = Number.isInteger(result.hiddenCount)
        ? result.hiddenCount
        : 0;
      this._unhideAllButton.visible = hiddenCount > 0;

      if (
        this._commentFocusedNoteId === '' &&
        this._commentSubmitNoteId === ''
      ) {
        this._renderNotes(notes, attachmentStates);
      }

      this._updateDiagnostics(this._diagnosticState);
      this._status.text = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._refreshBusy = false;

      if (this._refreshPending && !this._destroyed) {
        this._refreshPending = false;
        this.refresh();
      }
    }
  }

  _renderNotes(notes, attachmentStates = {}) {
    for (const child of this._notesBox.get_children())
      child.destroy();

    if (notes.length === 0) {
      this._notesBox.add_child(new St.Label({
        text: 'No notes yet.',
        style_class: 'transnote-empty',
      }));
      return;
    }

    const deviceId = this._settings.get_string('device-id').trim();

    for (const note of notes) {
      const noteColorClass = note.color
        ? ` transnote-note-color-${note.color}`
        : '';

      const box = new St.BoxLayout({
        vertical: true,
        style_class: `transnote-note${noteColorClass}`,
      });
      const header = new St.BoxLayout({
        style_class: 'transnote-note-header',
      });

      const title = new St.Label({
        text: String(note.title || 'Untitled'),
        style_class: 'transnote-note-title',
        x_expand: true,
      });
      title.clutter_text.line_wrap = true;
      title.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
      header.add_child(title);

      const isLocal = this._localIds.has(note.id);
      const canShare = isLocal && deviceId !== '' && note.author === deviceId;

      if (canShare) {
        const shareButton = new St.Button({
          label: note.shared === true ? 'Unshare' : 'Share',
          can_focus: true,
          reactive: true,
          style_class: 'button transnote-share-button',
        });
        shareButton.connect(
          'clicked',
          () => this._setShared(note.id, note.shared !== true)
        );
        header.add_child(shareButton);
      }

      box.add_child(header);

      if (!isLocal) {
        box.add_child(new St.Label({
          text: `from ${String(note.author || 'unknown')}`,
          style_class: 'transnote-note-meta',
        }));
      } else if (!canShare && deviceId !== '') {
        box.add_child(new St.Label({
          text: `local note by ${String(note.author || 'unknown')}`,
          style_class: 'transnote-note-meta',
        }));
      }

      const body = new St.Label({
        text: String(note.body || ''),
        style_class: 'transnote-note-body',
        x_expand: true,
      });
      body.clutter_text.line_wrap = true;
      body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
      body.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

      box.add_child(body);

      const attachments = Array.isArray(note.attachments)
        ? note.attachments
        : [];

      if (attachments.length > 0) {
        const attachmentBox = new St.BoxLayout({
          vertical: true,
          style_class: 'transnote-attachments',
        });

        for (const attachment of attachments) {
          const state = attachmentStateFor({
            isLocal,
            noteId: note.id,
            attachmentId: attachment.id,
            attachmentStates,
          });

          const usable = canUseAttachment(state);

          const row = new St.BoxLayout({
            style_class: 'transnote-attachment-row',
          });

          const name = new St.Label({
            text: String(attachment.name || 'attachment'),
            x_expand: true,
            style_class: 'transnote-attachment-name',
          });

          const stateLabel = new St.Label({
            text: attachmentStateLabel(state),
            style_class: 'transnote-attachment-state',
          });

          const saveButton = new St.Button({
            label: 'Save',
            can_focus: usable,
            reactive: usable,
            style_class: 'button transnote-attachment-action',
          });

          saveButton.connect(
            'clicked',
            () => this._saveAttachment(
              note.id,
              attachment.id
            )
          );

          const openButton = new St.Button({
            label: 'Open',
            can_focus: usable,
            reactive: usable,
            style_class: 'button transnote-attachment-action',
          });

          openButton.connect(
            'clicked',
            () => this._openAttachment(
              note.id,
              attachment.id
            )
          );

          row.add_child(name);
          row.add_child(stateLabel);

          if (usable && attachment.kind === 'text') {
            const copyAttachmentButton = new St.Button({
              label: 'Copy',
              can_focus: true,
              reactive: true,
              style_class: 'button transnote-attachment-action',
            });

            copyAttachmentButton.connect(
              'clicked',
              () => this._copyAttachmentText(
                note.id,
                attachment.id
              )
            );

            row.add_child(copyAttachmentButton);
          }

          row.add_child(saveButton);
          row.add_child(openButton);

          attachmentBox.add_child(row);
        }

        box.add_child(attachmentBox);
      }

      const comments = Array.isArray(note.comments)
        ? note.comments
        : [];

      const commentsBox = new St.BoxLayout({
        vertical: true,
        style_class: 'transnote-comments',
      });

      for (const comment of comments) {
        const row = new St.BoxLayout({
          vertical: true,
          style_class: 'transnote-comment-row',
        });

        const author = new St.Label({
          text: String(comment.author || 'unknown'),
          style_class: 'transnote-comment-author',
        });

        const body = new St.Label({
          text: String(comment.text || ''),
          x_expand: true,
          style_class: 'transnote-comment-text',
        });

        body.clutter_text.line_wrap = true;
        body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        row.add_child(author);
        row.add_child(body);
        commentsBox.add_child(row);
      }

      const commentEntry = new St.Entry({
        hint_text: 'Add comment',
        can_focus: true,
        x_expand: true,
        style_class: 'transnote-entry transnote-comment-entry',
      });

      const draft = this._commentDrafts.get(note.id);
      if (typeof draft === 'string' && draft !== '')
        commentEntry.set_text(draft);

      commentEntry.clutter_text.connect('text-changed', () => {
        const value = commentEntry.get_text();
        if (value === '')
          this._commentDrafts.delete(note.id);
        else
          this._commentDrafts.set(note.id, value);
      });
      commentEntry.clutter_text.connect('key-focus-in', () => {
        this._commentFocusedNoteId = note.id;
      });
      commentEntry.clutter_text.connect('key-focus-out', () => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (this._commentFocusedNoteId === note.id)
            this._commentFocusedNoteId = '';
          return GLib.SOURCE_REMOVE;
        });
      });

      const commentButton = new St.Button({
        label: 'Comment',
        can_focus: true,
        reactive: true,
        style_class: 'button transnote-comment-button',
      });

      commentButton.connect(
        'clicked',
        () => this._addComment(
          note.id,
          commentEntry
        )
      );

      const commentInputRow = new St.BoxLayout({
        style_class: 'transnote-comment-input-row',
      });

      commentInputRow.add_child(commentEntry);
      commentInputRow.add_child(commentButton);

      commentsBox.add_child(commentInputRow);
      box.add_child(commentsBox);

      const actions = new St.BoxLayout({
        style_class: 'transnote-note-actions',
      });

      const copyButton = new St.Button({
        label: 'Copy',
        can_focus: true,
        reactive: true,
        style_class: 'button transnote-note-action',
      });
      copyButton.connect('clicked', () => this._copyNote(note));
      actions.add_child(copyButton);

      if (canShare) {
        const colorButton = new St.Button({
          label: 'Color',
          can_focus: true,
          reactive: true,
          style_class: 'button transnote-note-action',
        });

        colorButton.connect(
          'clicked',
          () => this._cycleColor(note.id)
        );

        actions.add_child(colorButton);

        const attachButton = new St.Button({
          label: 'Attach',
          can_focus: true,
          reactive: true,
          style_class: 'button transnote-note-action',
        });

        attachButton.connect(
          'clicked',
          () => this._attachFile(note.id)
        );

        actions.add_child(attachButton);
      }

      if (isLocal) {
        const deleteButton = new St.Button({
          label: 'Delete',
          can_focus: true,
          reactive: true,
          style_class: 'button transnote-note-action',
        });
        deleteButton.connect('clicked', () => this._deleteNote(note.id));
        actions.add_child(deleteButton);
      } else {
        const hideButton = new St.Button({
          label: 'Hide',
          can_focus: true,
          reactive: true,
          style_class: 'button transnote-note-action',
        });
        hideButton.connect('clicked', () => this._hideNote(note.id));
        actions.add_child(hideButton);
      }

      box.add_child(actions);
      this._notesBox.add_child(box);
    }
  }

  _openRepository() {
    if (
      this._destroyed ||
      this._repositoryUrl === ''
    ) {
      return;
    }

    Gio.AppInfo.launch_default_for_uri_async(
      this._repositoryUrl,
      null,
      this._cancellable,
      (_source, result) => {
        try {
          Gio.AppInfo.launch_default_for_uri_finish(result);
        } catch (error) {
          if (
            !this._destroyed &&
            !this._cancellable.is_cancelled()
          ) {
            console.error(
              'TransNote failed to open repository',
              error
            );
          }
        }
      }
    );
  }

  _copyNote(note) {
    if (this._destroyed || !note)
      return;

    const text = String(note.body ?? '').replace(/\r\n/g, '\n');
    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    this._status.text = 'Copied.';
  }

  async _addComment(noteId, entry) {
    if (this._destroyed || this._busy)
      return;

    this._commentSubmitNoteId = noteId;
    this._commentFocusedNoteId = '';

    const draft = this._commentDrafts.get(noteId);
    const text = typeof draft === 'string'
      ? draft
      : entry.get_text();

    if (text.trim() === '') {
      this._commentSubmitNoteId = '';
      this._status.text = 'Enter a comment.';
      return;
    }

    this._busy = true;
    this._status.text = 'Adding comment…';

    try {
      await this._helper.addComment(
        noteId,
        text,
        this._cancellable
      );

      if (this._destroyed)
        return;

      entry.set_text('');
      this._commentDrafts.delete(noteId);
      this._commentSubmitNoteId = '';
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._commentSubmitNoteId = '';
      this._busy = false;
    }
  }

  async _attachFile(noteId) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Selecting attachment…';

    try {
      const result = await this._helper.addAttachment(
        noteId,
        this._cancellable
      );

      if (this._destroyed)
        return;

      if (result.cancelled === true) {
        this._status.text = 'Attachment selection cancelled.';
        return;
      }

      this._status.text = 'Attachment added.';
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _copyAttachmentText(noteId, attachmentId) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Copying attachment…';

    try {
      const value = await this._helper.copyAttachmentText(
        noteId,
        attachmentId,
        this._cancellable
      );

      if (this._destroyed)
        return;

      this._clipboard.set_text(
        St.ClipboardType.CLIPBOARD,
        value
      );
      this._status.text = 'Attachment copied.';
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _openAttachment(noteId, attachmentId) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Opening attachment…';

    try {
      await this._helper.openAttachment(
        noteId,
        attachmentId,
        this._cancellable
      );

      if (!this._destroyed)
        this._status.text = 'Attachment opened.';
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _saveAttachment(noteId, attachmentId) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Saving attachment…';

    try {
      const result = await this._helper.saveAttachment(
        noteId,
        attachmentId,
        this._cancellable
      );

      if (!this._destroyed)
        this._status.text =
          `Saved: ${String(result.savedPath || '')}`;
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _hideNote(noteId) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Hiding…';

    try {
      await this._helper.hideNote(noteId, this._cancellable);
      this._commentDrafts.delete(noteId);
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _unhideAll() {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Restoring hidden notes…';

    try {
      await this._helper.unhideAll(this._cancellable);
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _deleteNote(noteId) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Deleting…';

    try {
      await this._helper.deleteNote(noteId, this._cancellable);
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _prepareLan() {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    try {
      const config = this._saveDraftSettings();
      if (config.syncDir === '')
        throw new Error('Enter a shared folder first.');

      this._setupStatus.text = 'Enabling device sync…';
      const result = await this._helper.prepareLan(this._cancellable);
      if (this._destroyed)
        return;

      this._pairingCodeEntry.set_text(String(result.pairingCode || ''));
      this._setupStatus.text =
        'Device sync is ready. Share this setup code with the other computer.';
      await this._refreshLanStatus();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = operatorLanErrorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  _copyPairingCode() {
    if (this._destroyed)
      return;

    const code = this._pairingCodeEntry.get_text().trim();
    if (code === '') {
      this._setupStatus.text = 'Select Start new sync first.';
      return;
    }

    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, code);
    this._setupStatus.text = 'Pairing code copied.';
  }

  async _pairLan() {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    try {
      const config = this._saveDraftSettings();
      if (config.syncDir === '')
        throw new Error('Enter a shared folder first.');

      const pairingCode = this._incomingPairingEntry.get_text().trim();
      if (pairingCode === '')
        throw new Error('Paste a TransNote setup code first.');

      this._setupStatus.text = 'Connecting…';
      const result = await this._helper.pairLan(
        pairingCode,
        this._cancellable
      );
      if (this._destroyed)
        return;

      const peerName = String(result.peer?.transnoteDeviceId || '').trim();
      if (peerName === '')
        throw new Error('Pairing returned no TransNote machine name.');

      const current = this._settings.get_string('allow-list');
      const updated = addQualifiedPeer(current, peerName);
      if (updated !== current)
        this._settings.set_string('allow-list', updated);
      this._allowListEntry.set_text(updated);

      const prepared = await this._helper.prepareLan(this._cancellable);
      if (this._destroyed)
        return;
      this._pairingCodeEntry.set_text(String(prepared.pairingCode || ''));
      this._incomingPairingEntry.set_text('');
      this._setupStatus.text = `Connected to ${peerName}.`;
      await this._refreshLanStatus();
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = operatorLanErrorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  async _joinExistingLan() {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    try {
      const config = this._saveDraftSettings();
      if (config.syncDir === '')
        throw new Error('Enter a shared folder first.');

      const peerName = this._manualPeerNameEntry.get_text().trim();
      const syncthingDeviceId =
        this._manualSyncthingIdEntry.get_text().trim();
      const folderId = this._manualFolderIdEntry.get_text().trim();

      if (peerName === '')
        throw new Error('Enter the remote TransNote machine name.');
      if (syncthingDeviceId === '')
        throw new Error('Enter the Syncthing device ID.');
      if (folderId === '')
        throw new Error('Enter the existing folder ID.');

      this._setupStatus.text = 'Joining existing share…';
      const result = await this._helper.joinExistingLan(
        peerName,
        syncthingDeviceId,
        folderId,
        this._cancellable
      );
      if (this._destroyed)
        return;

      const joinedPeer = String(
        result.peer?.transnoteDeviceId || ''
      ).trim();
      if (joinedPeer === '')
        throw new Error('Join returned no TransNote machine name.');

      const current = this._settings.get_string('allow-list');
      const updated = addQualifiedPeer(current, joinedPeer);
      if (updated !== current)
        this._settings.set_string('allow-list', updated);
      this._allowListEntry.set_text(updated);

      this._manualPeerNameEntry.set_text('');
      this._manualSyncthingIdEntry.set_text('');
      this._manualFolderIdEntry.set_text('');
      this._setupStatus.text = `Connected to ${joinedPeer}.`;
      await this._refreshLanStatus();
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = operatorLanErrorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  _renderPendingDevices(devices) {
    if (this._destroyed || !this._pendingDevicesBox)
      return;

    for (const child of this._pendingDevicesBox.get_children())
      child.destroy();

    const pending = Array.isArray(devices) ? devices : [];

    if (pending.length === 0) {
      this._pendingDevicesBox.add_child(new St.Label({
        text: 'No pending computer connections.',
        style_class: 'transnote-hint',
      }));
      return;
    }

    for (const device of pending) {
      const syncthingDeviceId = String(
        device?.syncthingDeviceId || ''
      ).trim();

      if (syncthingDeviceId === '')
        continue;

      const row = new St.BoxLayout({
        style_class: 'transnote-pending-row',
      });

      const deviceName = String(device?.deviceName || '').trim();
      const displayName = deviceName !== ''
        ? deviceName
        : `${syncthingDeviceId.slice(0, 7)}…`;

      const label = new St.Label({
        text: displayName,
        x_expand: true,
        style_class: 'transnote-pending-label',
      });

      const acceptButton = new St.Button({
        label: 'Accept',
        can_focus: true,
        reactive: true,
        style_class: 'button',
      });

      acceptButton.connect(
        'clicked',
        () => this._acceptPendingDevice({syncthingDeviceId})
      );

      row.add_child(label);
      row.add_child(acceptButton);
      this._pendingDevicesBox.add_child(row);
    }
  }

  async _acceptPendingDevice(device) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;

    try {
      const config = this._saveDraftSettings();

      if (config.syncDir === '')
        throw new Error('Enter a shared folder first.');

      this._setupStatus.text = 'Accepting computer connection…';

      const result = await this._helper.acceptPendingDeviceLan(
        device.syncthingDeviceId,
        this._cancellable
      );

      if (this._destroyed)
        return;

      const deviceName = String(result.deviceName || '').trim();
      const displayName = deviceName !== ''
        ? deviceName
        : `${String(result.syncthingDeviceId || '').slice(0, 7)}…`;

      this._setupStatus.text =
        `Computer accepted: ${displayName}. Waiting for folder offer…`;

      await this._refreshLanStatus();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = operatorLanErrorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  _renderPendingOffers(offers) {
    if (this._destroyed || !this._pendingOffersBox)
      return;

    for (const child of this._pendingOffersBox.get_children())
      child.destroy();

    const pending = Array.isArray(offers) ? offers : [];
    if (pending.length === 0) {
      this._pendingOffersBox.add_child(new St.Label({
        text: 'No pending TransNote folders.',
        style_class: 'transnote-hint',
      }));
      return;
    }

    for (const offer of pending) {
      const folderId = String(offer?.folderId || '').trim();
      const syncthingDeviceId = String(offer?.syncthingDeviceId || '').trim();
      if (folderId === '' || syncthingDeviceId === '')
        continue;

      const row = new St.BoxLayout({
        style_class: 'transnote-pending-row',
      });
      const remoteName = String(offer?.deviceName || '').trim();
      const remoteLabel = remoteName !== ''
        ? remoteName
        : `${syncthingDeviceId.slice(0, 7)}…`;
      const label = new St.Label({
        text: `${remoteLabel} · ${folderId}`,
        x_expand: true,
        style_class: 'transnote-pending-label',
      });
      const acceptButton = new St.Button({
        label: 'Accept',
        can_focus: true,
        reactive: true,
        style_class: 'button',
      });
      acceptButton.connect(
        'clicked',
        () => this._acceptPendingOffer({folderId, syncthingDeviceId})
      );
      row.add_child(label);
      row.add_child(acceptButton);
      this._pendingOffersBox.add_child(row);
    }
  }

  async _acceptPendingOffer(offer) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    try {
      const config = this._saveDraftSettings();
      if (config.syncDir === '')
        throw new Error('Enter a shared folder first.');

      this._setupStatus.text = 'Accepting TransNote folder…';
      const result = await this._helper.acceptPendingLan(
        offer.folderId,
        offer.syncthingDeviceId,
        this._cancellable
      );
      if (this._destroyed)
        return;

      this._setupStatus.text = `Folder accepted: ${String(result.folderId || '')}`;
      await this._helper.syncNow(this._cancellable);
      await this._refreshLanStatus();
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = operatorLanErrorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  async _refreshLanStatus() {
    if (this._destroyed || this._lanStatusBusy)
      return;

    this._lanStatusBusy = true;
    try {
      const result = await this._helper.lanStatus(this._cancellable);
      if (this._destroyed)
        return;

      const pendingDevices = Array.isArray(result.pendingDevices)
        ? result.pendingDevices
        : [];
      const pendingOffers = Array.isArray(result.pendingOffers)
        ? result.pendingOffers
        : [];

      this._renderPendingDevices(pendingDevices);
      this._renderPendingOffers(pendingOffers);

      if (result.installed !== true)
        this._syncStatus.text = 'Syncthing is not installed.';
      else if (result.running !== true)
        this._syncStatus.text = 'Syncthing is not running.';
      else
        this._syncStatus.text = 'Sync service: ready';

      let syncthingText;
      if (result.installed !== true)
        syncthingText = 'Syncthing: not installed';
      else if (result.running !== true)
        syncthingText = 'Syncthing: not running';
      else if (
        Array.isArray(result.peers) &&
        result.peers.some(peer => peer.connected === true)
      )
        syncthingText = 'Syncthing: connected';
      else if (pendingDevices.length > 0)
        syncthingText = 'Syncthing: connection waiting';
      else
        syncthingText = 'Syncthing: running';

      let folderText = pendingOffers.length > 0
        ? 'Folder: offer waiting'
        : 'Folder: not prepared';
      if (result.folder?.configured === true) {
        if (result.folder.paused === true)
          folderText = 'Folder: paused';
        else if (result.folder.type === 'sendreceive')
          folderText = 'Folder: ready';
        else
          folderText = 'Folder: check required';
      }
      this._lanRuntimeStatus.text = `${syncthingText}\n${folderText}`;

      const peers = Array.isArray(result.peers) ? result.peers : [];
      if (peers.length === 0) {
        this._pairedMachines.text = 'No computers connected yet.';
      } else {
        this._pairedMachines.text = peers.map(peer => {
          const state = peer.connected === true
            ? 'connected'
            : peer.configured === true
              ? 'configured'
              : 'not configured';
          return `${peer.connected === true ? '●' : '○'} ${peer.transnoteDeviceId} — ${state}`;
        }).join('\n');
      }
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled()) {
        this._renderPendingDevices([]);
        this._renderPendingOffers([]);
        const message = operatorLanErrorMessage(error);
        this._lanRuntimeStatus.text = message;
        this._syncStatus.text = message;
      }
    } finally {
      this._lanStatusBusy = false;
    }
  }

  _saveDraftSettings() {
    const deviceId = this._deviceEntry.get_text().trim();
    const syncDir = this._syncDirEntry.get_text().trim();
    const allowList = this._allowListEntry.get_text().trim();

    if (syncDir !== '' && deviceId === '')
      throw new Error('Give this machine a name before enabling LAN sync.');

    this._settings.set_string('device-id', deviceId);
    this._settings.set_string('sync-dir', syncDir);
    this._settings.set_string('allow-list', allowList);

    this._machineNameLabel.text = deviceId;

    return {deviceId, syncDir, allowList};
  }

  async _saveSetup() {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    try {
      const config = this._saveDraftSettings();
      if (config.syncDir === '') {
        this._setupStatus.text = 'Saved. LAN sync is off.';
        await this.refresh();
        return;
      }

      this._setupStatus.text = 'Saving and checking…';
      const result = await this._helper.syncNow(this._cancellable);
      if (this._destroyed)
        return;

      this._diagnosticState = result.diagnostics || null;
      this._updateDiagnostics(this._diagnosticState);
      this._setupStatus.text = 'Saved. LAN sync is on.';
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _createFolder() {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    try {
      const config = this._saveDraftSettings();
      if (config.syncDir === '')
        throw new Error('Enter a shared folder first.');

      this._setupStatus.text = 'Creating folder…';
      const result = await this._helper.createFolder(this._cancellable);
      if (!this._destroyed)
        this._setupStatus.text = `Folder ready: ${result.path}`;
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _checkNow() {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    try {
      this._setupStatus.text = 'Checking peers…';
      const result = await this._helper.syncNow(this._cancellable);
      if (this._destroyed)
        return;

      this._diagnosticState = result.diagnostics || null;
      this._updateDiagnostics(this._diagnosticState);
      this._setupStatus.text = 'Check complete.';
      await this._refreshLanStatus();
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._setupStatus.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _cycleColor(noteId) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = 'Changing color…';

    try {
      await this._helper.cycleColor(
        noteId,
        this._cancellable
      );

      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  async _setShared(noteId, shared) {
    if (this._destroyed || this._busy)
      return;

    this._busy = true;
    this._status.text = shared ? 'Sharing…' : 'Unsharing…';

    try {
      await this._helper.setShared(
        noteId,
        shared,
        this._cancellable
      );
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
    }
  }

  _updateDiagnostics(diagnostics) {
    if (!this._diagnostics)
      return;

    if (!diagnostics || diagnostics.configured !== true) {
      this._diagnostics.text = 'LAN: not configured';
      return;
    }

    const errors = Number(diagnostics.errors || 0);
    this._diagnostics.text =
      `files=${Number(diagnostics.files || 0)} ` +
      `fetched=${Number(diagnostics.fetched || 0)} ` +
      `snapNotes=${Number(diagnostics.snapNotes || 0)} ` +
      `peerNotes=${Number(diagnostics.peerNotes || 0)} ` +
      `shown=${Number(diagnostics.shown || 0)}` +
      (errors > 0 ? ` errors=${errors}` : '');
  }

  async _createNote() {
    if (this._destroyed || this._busy)
      return;

    const title = this._titleEntry.get_text();
    const body = this._bodyEntry.get_text();

    if (title.trim() === '' && body.trim() === '') {
      this._status.text = 'Enter a title or note.';
      return;
    }

    this._busy = true;
    this._addButton.reactive = false;
    this._status.text = 'Saving…';

    try {
      await this._helper.createNote(
        title,
        body,
        this._cancellable
      );

      if (this._destroyed)
        return;

      this._titleEntry.set_text('');
      this._bodyEntry.set_text('');
      this._setComposerVisible(false);
      await this.refresh();
    } catch (error) {
      if (!this._destroyed && !this._cancellable.is_cancelled())
        this._status.text = `Error: ${error.message}`;
    } finally {
      this._busy = false;
      if (!this._destroyed)
        this._addButton.reactive = true;
    }
  }

  destroy() {
    if (this._destroyed)
      return;

    this._destroyed = true;
    this._refreshPending = false;

    if (this._pollId) {
      GLib.Source.remove(this._pollId);
      this._pollId = 0;
    }

    this.actor?.destroy();
    this.actor = null;
    this._settings = null;
    this._status = null;
    this._notesBox = null;
    this._scrollView = null;
    this._titleEntry = null;
    this._bodyEntry = null;
    this._addButton = null;
    this._notesView = null;
    this._setupView = null;
    this._machineNameLabel = null;
    this._deviceEntry = null;
    this._syncDirEntry = null;
    this._allowListEntry = null;
    this._advancedButton = null;
    this._advancedSetup = null;
    this._setupStatus = null;
    this._syncStatus = null;
    this._diagnostics = null;
    this._lanRuntimeStatus = null;
    this._pendingDevicesBox = null;
    this._pendingOffersBox = null;
    this._pairingCodeEntry = null;
    this._copyPairingButton = null;
    this._incomingPairingEntry = null;
    this._pairLanButton = null;
    this._prepareLanButton = null;
    this._manualPeerNameEntry = null;
    this._manualSyncthingIdEntry = null;
    this._manualFolderIdEntry = null;
    this._manualJoinButton = null;
    this._pairedMachines = null;
    this._footer = null;
    this._clipboard = null;
    this._knownPeerNoteIds.clear();
    this._knownPeerNoteIds = null;
    this._onUnreadChanged = null;
    this._repositoryUrl = '';
    this._version = '';
  }
}
