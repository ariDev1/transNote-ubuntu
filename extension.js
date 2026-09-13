import Gio from 'gi://Gio';

import {Extension}
  from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main
  from 'resource:///org/gnome/shell/ui/main.js';

import {HelperClient} from './helperClient.js';
import {TransNoteIndicator} from './indicator.js';

const REVISION_FILE = '.transnote-revision';

function readRevision(path) {
  const file = Gio.File.new_for_path(`${path}/${REVISION_FILE}`);

  try {
    const [, contents] = file.load_contents(null);
    const revision = new TextDecoder('utf-8').decode(contents).trim();

    if (!/^[0-9a-f]{7,40}$/i.test(revision))
      return '';

    return revision.slice(0, 8).toLowerCase();
  } catch {
    return '';
  }
}


export default class TransNoteExtension extends Extension {
  enable() {
    this._cancellable = new Gio.Cancellable();
    this._settings = this.getSettings();
    this._helper = new HelperClient(this.path, this._settings);
    this._indicator = new TransNoteIndicator({
      helper: this._helper,
      cancellable: this._cancellable,
      settings: this._settings,
      version: this.metadata['version-name'],
      revision: readRevision(this.path),
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
