import Gio from 'gi://Gio';

import {Extension}
  from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main
  from 'resource:///org/gnome/shell/ui/main.js';

import {HelperClient} from './helperClient.js';
import {TransNoteIndicator} from './indicator.js';


export default class TransNoteExtension extends Extension {
  enable() {
    this._cancellable = new Gio.Cancellable();
    this._settings = this.getSettings();
    this._helper = new HelperClient(this.path, this._settings);
    this._indicator = new TransNoteIndicator({
      helper: this._helper,
      cancellable: this._cancellable,
      settings: this._settings,
      version: this.metadata.version,
      repositoryUrl: this.metadata.url,
    });

    Main.panel.addToStatusArea(
      this.uuid,
      this._indicator
    );
  }

  disable() {
    this._cancellable?.cancel();
    this._cancellable = null;

    this._helper?.destroy();
    this._helper = null;

    this._indicator?.destroy();
    this._indicator = null;

    this._settings = null;
  }
}
