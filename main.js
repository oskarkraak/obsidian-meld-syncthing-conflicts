const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require('obsidian');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  meldPath: 'meld',
};

// Folders never scanned.
const SKIP_DIRS = new Set(['.git', '.trash', 'node_modules']);

// name.sync-conflict-20260101-120000-ABCDEFG.md  ->  name.md
const CONFLICT_RE = /^(.*)\.sync-conflict-\d{8}-\d{6}(?:-[A-Z0-9]+)?(\.[^.]*)?$/;

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else {
      const m = CONFLICT_RE.exec(e.name);
      if (m) {
        out.push({
          conflict: full,
          original: path.join(dir, m[1] + (m[2] || '')),
        });
      }
    }
  }
}

// Flat ordered list: files alphabetically, conflicts per file by timestamp.
function collectConflicts(base) {
  const found = [];
  walk(base, found);
  found.sort((a, b) =>
    a.original.localeCompare(b.original) || a.conflict.localeCompare(b.conflict)
  );
  return found;
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (e) {
    return 0;
  }
}

function sameContent(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch (e) {
    return false;
  }
}

function runMeld(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore' });
    } catch (e) {
      return resolve({ error: e });
    }
    child.on('error', (error) => resolve({ error }));
    child.on('close', (code) => resolve({ code }));
  });
}

// Checklist of conflict files. Resolves with the array of selected items,
// or [] if dismissed.
class SelectDeleteModal extends Modal {
  constructor(app, items, resolve) {
    super(app);
    this.items = items; // { label, hint, checked, pair }
    this.resolveChoice = resolve;
    this.chosen = false;
    this.boxes = [];
  }

  finish(selected) {
    this.chosen = true;
    this.resolveChoice(selected);
    this.close();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Which conflict files should be deleted?' });
    contentEl.createEl('p', {
      text:
        'Checked = looks merged (conflict is identical to the original, or the original was edited during this session). ' +
        'Unchecked files stay on disk.',
    });

    const list = contentEl.createDiv();
    list.style.maxHeight = '300px';
    list.style.overflowY = 'auto';
    list.style.marginBottom = '12px';

    this.items.forEach((it, i) => {
      const row = list.createDiv();
      row.style.display = 'flex';
      row.style.alignItems = 'baseline';
      row.style.gap = '8px';
      row.style.padding = '2px 0';

      const box = row.createEl('input', { type: 'checkbox' });
      box.checked = it.checked;
      this.boxes[i] = box;

      const label = row.createEl('label', { text: it.label });
      label.onclick = () => (box.checked = !box.checked);
      if (it.hint) {
        const hint = row.createEl('span', { text: it.hint });
        hint.style.opacity = '0.6';
        hint.style.fontSize = '0.85em';
      }
    });

    const row = contentEl.createDiv();
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.justifyContent = 'space-between';

    const left = row.createDiv();
    left.style.display = 'flex';
    left.style.gap = '8px';
    left.createEl('button', { text: 'Select all' }).onclick = () =>
      this.boxes.forEach((b) => (b.checked = true));
    left.createEl('button', { text: 'Select none' }).onclick = () =>
      this.boxes.forEach((b) => (b.checked = false));

    const right = row.createDiv();
    right.style.display = 'flex';
    right.style.gap = '8px';
    right.createEl('button', { text: 'Keep all' }).onclick = () => this.finish([]);
    right.createEl('button', { text: 'Delete selected', cls: 'mod-warning' }).onclick = () =>
      this.finish(this.items.filter((_, i) => this.boxes[i].checked).map((it) => it.pair));
  }

  onClose() {
    this.contentEl.empty();
    if (!this.chosen) this.resolveChoice([]);
  }
}

class MeldSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Meld path')
      .setDesc(
        'Leave as "meld" if Meld is on your PATH. Otherwise enter the full path to the executable, ' +
          'for example C:\\Program Files\\Meld\\Meld.exe, /usr/bin/meld or /Applications/Meld.app/Contents/MacOS/Meld.'
      )
      .addText((text) =>
        text
          .setPlaceholder('meld')
          .setValue(this.plugin.settings.meldPath)
          .onChange(async (value) => {
            this.plugin.settings.meldPath = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

module.exports = class SyncthingMeld extends Plugin {
  async onload() {
    this.running = false;
    await this.loadSettings();

    this.addSettingTab(new MeldSettingTab(this.app, this));

    this.addCommand({
      id: 'open-conflicts-in-meld',
      name: 'Open sync conflicts in Meld',
      callback: () => this.resolveAll(),
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Trimmed, surrounding quotes removed, falls back to "meld".
  meldCommand() {
    const raw = (this.settings.meldPath || '').trim().replace(/^["']|["']$/g, '');
    return raw || DEFAULT_SETTINGS.meldPath;
  }

  selectToDelete(items) {
    return new Promise((resolve) => {
      new SelectDeleteModal(this.app, items, resolve).open();
    });
  }

  async resolveAll() {
    if (this.running) return new Notice('Conflict resolution already running');

    const base = this.app.vault.adapter.getBasePath();
    const all = collectConflicts(base);
    if (!all.length) return new Notice('No sync conflicts found');

    // Skip pairs whose original no longer exists
    const pairs = all.filter((p) => fs.existsSync(p.original));
    const skipped = all.length - pairs.length;
    if (skipped) new Notice(`Skipping ${skipped} conflict(s) whose original file is missing`);
    if (!pairs.length) return;

    // Remember original mtimes so we can tell which ones were edited
    const before = new Map(pairs.map((p) => [p.original, mtime(p.original)]));

    // One --diff per pair => one tab per pair, in this exact order
    const args = [];
    for (const p of pairs) args.push('--diff', p.original, p.conflict);

    this.running = true;
    new Notice(
      `Opening ${pairs.length} conflict(s) in Meld tabs. Close Meld to stop; you then choose what to delete.`
    );

    try {
      const cmd = this.meldCommand();
      const res = await runMeld(cmd, args);

      if (res.error) {
        new Notice(
          `Could not start Meld (${res.error.message}). Is it installed? ` +
            'Set its path in the plugin settings. Conflict files kept.',
          10000
        );
        return;
      }

      // Whether Meld was closed normally or killed, let the user choose.
      const items = pairs.map((p) => {
        const identical = sameContent(p.original, p.conflict);
        const edited = mtime(p.original) !== before.get(p.original);
        const hint = identical ? 'identical to original' : edited ? 'original edited' : '';
        return {
          label: path.relative(base, p.conflict),
          hint,
          checked: identical || edited,
          pair: p,
        };
      });

      const toDelete = await this.selectToDelete(items);
      if (!toDelete.length) return new Notice('Conflict files kept.');

      let failed = 0;
      for (const p of toDelete) {
        try {
          fs.unlinkSync(p.conflict);
        } catch (e) {
          failed++;
        }
      }
      new Notice(
        failed
          ? `Deleted ${toDelete.length - failed}, failed to delete ${failed}.`
          : `Deleted ${toDelete.length} conflict file(s).`
      );
    } finally {
      this.running = false;
    }
  }
};