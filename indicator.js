import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu
  from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {NotesMenuView} from './notesMenu.js';

export const TransNoteIndicator = GObject.registerClass(
class TransNoteIndicator extends PanelMenu.Button {
  constructor({helper, cancellable, settings}) {
    super(0.0, 'TransNote', false);

    this.add_child(new St.Icon({
      icon_name: 'document-edit-symbolic',
      style_class: 'system-status-icon',
    }));

    this._view = new NotesMenuView({
      helper,
      cancellable,
      settings,
    });

    this.menu.box.add_child(this._view.actor);

    this._openChangedId = this.menu.connect(
      'open-state-changed',
      (_menu, open) => {
        if (open)
          this._view?.refresh();
      }
    );
  }

  destroy() {
    if (this._openChangedId) {
      this.menu.disconnect(this._openChangedId);
      this._openChangedId = 0;
    }

    this._view?.destroy();
    this._view = null;

    super.destroy();
  }
});
