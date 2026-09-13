import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu
  from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {NotesMenuView} from './notesMenu.js';

export const TransNoteIndicator = GObject.registerClass(
class TransNoteIndicator extends PanelMenu.Button {
  constructor({helper, cancellable, settings, version, revision, repositoryUrl}) {
    super(0.0, 'TransNote', false);

    const iconBox = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
    });

    iconBox.add_child(new St.Icon({
      icon_name: 'document-edit-symbolic',
      style_class: 'system-status-icon',
    }));

    this._unreadDot = new St.Widget({
      style_class: 'transnote-unread-dot',
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.START,
      visible: false,
    });

    iconBox.add_child(this._unreadDot);
    this.add_child(iconBox);

    this._view = new NotesMenuView({
      helper,
      cancellable,
      settings,
      version,
      revision,
      repositoryUrl,
      onUnreadChanged: unread => {
        if (unread && this.menu.isOpen)
          return;

        this._setUnread(unread);
      },
    });

    this.menu.box.add_child(this._view.actor);

    this._openChangedId = this.menu.connect(
      'open-state-changed',
      (_menu, open) => {
        if (open) {
          this._setUnread(false);
          this._view?.refresh();
        }
      }
    );
  }

  _setUnread(unread) {
    if (this._unreadDot)
      this._unreadDot.visible = unread === true;
  }

  destroy() {
    if (this._openChangedId) {
      this.menu.disconnect(this._openChangedId);
      this._openChangedId = 0;
    }

    this._view?.destroy();
    this._view = null;
    this._unreadDot = null;

    super.destroy();
  }
});
