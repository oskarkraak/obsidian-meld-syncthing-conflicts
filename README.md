# Obsidian Plugin: Meld Syncthing Conflicts

Resolve [Syncthing](https://syncthing.net) sync conflicts in your Obsidian vault with [Meld](https://meldmerge.org).

One command collects every `*.sync-conflict-*` file in the vault and opens each one next to its original as a tab in a single Meld window. When you close Meld, you choose which conflict files to delete.

## Requirements

- **Desktop only.** The plugin starts an external program and reads and deletes files, so it does not work on mobile.
- **Meld must be installed separately.** Download it from [meldmerge.org](https://meldmerge.org).
- If Meld is not on the PATH that Obsidian sees (common on Windows, macOS, Flatpak and Snap installs), set its full path in the plugin settings. See [Settings](#settings).

## Usage

1. Open the command palette and run **Open sync conflicts in Meld**.
2. Meld opens with one tab per conflict. Several conflicts for the same file are ordered by timestamp.
3. Merge what you want in each tab. Edits to the original file need to be saved.
4. Close Meld when you are done, or when you want to stop early.
5. A checklist lists every conflict file. Tick the ones to delete and click **Delete selected**, or click **Keep all**.

### Which files are pre-checked?

The plugin cannot know which tabs you actually merged, so it guesses. A conflict file is pre-checked when it is now identical to the original, or when the original was edited while Meld was open. Everything else is unchecked and stays on disk unless you tick it. Dismissing the dialog keeps everything.

### Stopping midway

Close Meld at any point. Nothing is deleted without the checklist. Conflicts you leave on disk are picked up the next time you run the command.

## Settings

| Setting | Description |
| --- | --- |
| Meld path | Leave as `meld` if Meld is on your PATH. Otherwise enter the full path to the executable. |

Example paths:

- Windows: `C:\Program Files\Meld\Meld.exe`
- macOS: `/Applications/Meld.app/Contents/MacOS/Meld`
- Linux: `/usr/bin/meld`

## Notes and limitations

- Originals that no longer exist (deleted on another device) are skipped.
- Folders `.git`, `.trash` and `node_modules` are not scanned. Conflicts inside `.obsidian` are included, though often meaningless.
- On Windows, a very large number of conflicts at once could exceed the command-line length limit.
- The plugin only deletes files matching Syncthing's conflict naming pattern, and only the ones you confirm in the checklist.

## Manual installation

1. Create the folder `<vault>/.obsidian/plugins/syncthing-meld/`.
2. Clone the git repository into it.
3. Reload Obsidian and enable **Meld merge Syncthing Conflicts** under Settings → Community plugins.
