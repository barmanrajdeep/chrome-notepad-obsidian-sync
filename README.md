# Chrome Notepad Sync

Send a one-way copy of your vault's Markdown notes to a folder in your personal Chrome Notepad account. Each vault maps to one folder. Existing web edits are preserved when the source Markdown is unchanged. A newer change from Obsidian replaces the synced copy. Deleting a file in Obsidian leaves the copy in Chrome Notepad.

## Test locally

The plugin is a self-contained JavaScript entry point. There is no npm install or compilation step.

From the monorepo root, run the automated test and create a ZIP containing the two files Obsidian loads:

```bash
node --test obsidian-plugin/main.test.cjs
mkdir -p /tmp/chrome-notepad-sync-1.0.0
cp obsidian-plugin/main.js obsidian-plugin/manifest.json /tmp/chrome-notepad-sync-1.0.0/
zip -j /tmp/chrome-notepad-sync-1.0.0.zip \
  /tmp/chrome-notepad-sync-1.0.0/main.js \
  /tmp/chrome-notepad-sync-1.0.0/manifest.json
unzip -t /tmp/chrome-notepad-sync-1.0.0.zip
```

The ZIP is a release artifact. Obsidian does not install a ZIP directly for local development. Extract or copy the files into the vault's plugin directory instead.

The files in `obsidian-plugin/` and the files inside the ZIP are equivalent at the time the ZIP is created. Use the project files for quick edit-and-reload cycles. Use the extracted ZIP files when you want to test exactly what will be distributed as a release.

1. Open the vault you want to use for testing in Obsidian.
2. Open **Settings → About** and confirm that the app is version 1.11.4 or newer.
3. Open the vault folder in Finder or your terminal. If the vault is at `/path/to/MyVault`, create the plugin directory and copy the files with:

   ```bash
   vault_path="/Users/ankitabarman/Documents/risc"
   mkdir -p "$vault_path/.obsidian/plugins/chrome-notepad-sync"
   cp obsidian-plugin/main.js obsidian-plugin/manifest.json "$vault_path/.obsidian/plugins/chrome-notepad-sync/"
   ```

   Replace `/path/to/MyVault` with the actual vault path. The folder must contain `main.js` and `manifest.json` directly.

   To install the packaged ZIP instead, use the same destination and extract both files directly into it:

   ```bash
   unzip -j /tmp/chrome-notepad-sync-1.0.0.zip \
     -d "/path/to/MyVault/.obsidian/plugins/chrome-notepad-sync"
   ```
4. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if necessary, enable **Chrome Notepad Sync**, and reload Obsidian if it does not appear.
5. Open **Settings → Chrome Notepad Sync**. Add the token generated in Chrome Notepad as an Obsidian secret, then select that secret in **Sync token**. The published plugin always uses the production Chrome Notepad API.
6. Run **Chrome Notepad Sync: Sync vault** from the command palette. Confirm that a folder named after the vault and one note per Markdown file appear in the personal Chrome Notepad account.

For a faster edit cycle, install the current source with the installer, then disable and re-enable the plugin or use Obsidian's **Reload app without saving** command. The installer writes the selected API URL only into the vault’s plugin copy and leaves `obsidian-plugin/main.js` unchanged:

```bash
./obsidian-plugin/install-local.sh dev "/Users/ankitabarman/Documents/risc"
```

Supported environments are `production`, `demo`, and `dev`. The `dev` environment uses `http://localhost:8080/notes`, so the local backend must be running on port 8080. During a manual sync, Obsidian shows a live report with changed-file progress, successful uploads, and failures. Keep the plugin directory outside the vault's synced note content if the vault itself is synchronized by another service.

The plugin syncs the active Obsidian vault only. Install it in another vault to sync that vault as a separate Chrome Notepad folder. A first sync processes the active vault in chronological batches of 25 files, ordered by modification time, with a short pause between batches. Each successful file is checkpointed in the vault’s plugin data. After an interruption or restart, completed files are skipped and unsynced files resume. Every five minutes, automatic sync compares each Markdown file’s modification timestamp with that checkpoint and sends only changed files.

The plugin backs up its file mappings, sync checkpoints and automatic-sync preference encrypted on the server. It never sends the sync secret or its local secret name as part of the backup. If plugin data is missing, select the sync secret and choose the previously synced vault to restore its metadata. A sync requested during recovery waits for the selection and then continues. Files are checked once after recovery because their modification timestamps can differ between installations. The server needs an earlier sync and metadata backup to recover this information. Files renamed or moved after the last backup may need the original plugin data to identify them.

The local test flow should include a Markdown file with a table, inline math such as `$x^2$`, a display block such as `$$x^2$$`, and a file in a subfolder. Run sync twice to verify that the second run does not create duplicate notes. Change one file and sync again to verify that its existing cloud note is updated. Revoke the token in Chrome Notepad and verify that the plugin reports an authentication failure.

## Install

1. Use Obsidian 1.11.4 or newer and a Chrome Notepad personal account using recoverable encryption. The selected Chrome Notepad environment needs the Obsidian sync API deployed.
2. Copy `main.js` and `manifest.json` to `.obsidian/plugins/chrome-notepad-sync/` in your vault, then enable **Chrome Notepad Sync** in Obsidian's Community Plugins settings. Restart Obsidian if the plugin does not appear.
3. In Chrome Notepad, open **Account Settings → Obsidian sync**, then generate a token. In Obsidian, add the token as a secret and select it in the plugin's **Sync token** setting. The published plugin uses production automatically.
4. Run **Chrome Notepad Sync: Sync vault** from the command palette, or choose **Sync now** in the plugin settings. Enable automatic sync to upload changed notes every five minutes while the vault is open.

The token can upload notes only through the Obsidian sync endpoint. It expires after 90 days. Generating a replacement or revoking the current token invalidates it for every vault that uses it. The plugin stores the name of the Obsidian secret and a mapping of file paths to stable IDs in its settings. Keep that mapping if you reinstall or move the vault.

Sync includes Markdown files up to 512 KiB each. Markdown text is preserved on import. Attachments stay in your vault, and Obsidian-specific links, embeds and frontmatter do not gain their Obsidian behavior in the web editor. Vault subfolders share the same Chrome Notepad folder. A vault folder appears on the first successful upload.

## Release and publish

`main.js` is both the plugin source and the installable entry point. It loads the Obsidian API at runtime and has no build dependencies.

### 1. Verify before release

1. Run the test suite from the monorepo root:
   ```bash
   node --test obsidian-plugin/main.test.cjs
   ```
2. Confirm `API_BASE_URL` in `obsidian-plugin/main.js` points to `https://api.chromenotepad.com/notes`.
3. Update `"version"` (and `"minAppVersion"` if needed) in `obsidian-plugin/manifest.json`.
4. Ensure `obsidian-plugin/LICENSE` and `obsidian-plugin/README.public.md` are up to date (use `README.public.md` as `README.md` in the public repository so internal dev notes stay private).

### 2. Sync to the public plugin repository

To push only the `obsidian-plugin/` folder from this private monorepo to the separate public plugin repository without manual copying:

- **`git subtree push` (simplest):**
  ```bash
  git remote add plugin-public https://github.com/<your-org>/<public-plugin-repo>.git
  git subtree push --prefix=obsidian-plugin plugin-public main
  ```
  Re-run `git subtree push --prefix=obsidian-plugin plugin-public main` whenever `obsidian-plugin/` changes.
- **GitHub Action (automated):** Alternatively, add a workflow in this monorepo triggered on `obsidian-plugin/**` that pushes the subfolder to the public repo using a deploy key or PAT.

### 3. Create the GitHub Release (UI)

1. Open the public plugin repository on GitHub.
2. Click **Releases** (right sidebar) → **Draft a new release**.
3. **Choose a tag:** Enter the exact version from `manifest.json` (e.g. `1.0.0`, **no `v` prefix**) and select **Create new tag on publish**.
4. **Target:** Leave as `main` (or your release branch).
5. **Release title:** e.g. `1.0.0`.
6. **Attach binaries:** Drag and drop `main.js` and `manifest.json` directly into **"Attach binaries by dropping them here or selecting them"**.
7. Click **Publish release**.

For Community Plugins submission, see the [Obsidian release and submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin).

## Remove artifacts
```bash
rm -rf /tmp/chrome-notepad-sync-1.0.0
rm -f /tmp/chrome-notepad-sync-1.0.0.zip
```
