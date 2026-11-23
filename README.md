# Chrome Notepad Sync

Send a one-way copy of your Obsidian vault's Markdown notes to a folder in your personal [Chrome Notepad](https://chromenotepad.com) account.

Each vault maps to one folder in Chrome Notepad. Existing web edits are preserved when the source Markdown is unchanged, newer changes from Obsidian replace the synced copy, and deleting a file in Obsidian leaves the copy in Chrome Notepad intact.

## Requirements

- Obsidian **1.11.4** or newer
- A Chrome Notepad personal account with **recoverable encryption** enabled

## Setup

1. Install and enable **Chrome Notepad Sync** in **Settings → Community plugins**.
2. In Chrome Notepad, open **Account Settings → Obsidian sync** and generate a sync token.
3. In Obsidian, open **Settings → Chrome Notepad Sync**, add the token as an Obsidian secret, and select it in **Sync token**.

## Usage

- **Manual sync:** Run **Chrome Notepad Sync: Sync vault** from the command palette, or click **Sync now** in the plugin settings.
- **Automatic sync:** Enable **Automatic sync** in the plugin settings to upload changed Markdown files every 5 minutes while the vault is open.

## How syncing works

- **Per-vault folders:** The plugin syncs only the active vault, creating a folder named after the vault on the first successful upload. Subfolders in your vault are synced into the same Chrome Notepad folder.
- **Supported files:** Markdown files up to **512 KiB** each. Attachments remain in your vault, and Obsidian-specific links, embeds, and frontmatter are preserved as plain Markdown text.
- **Checkpoints & recovery:** File IDs, sync timestamps, and your automatic-sync preference are backed up encrypted on the server (your sync token is never sent in the backup). If local plugin data is lost, select your sync secret and choose the previously synced vault to restore your mappings.
- **Token lifetime:** Sync tokens can upload notes, back up encrypted vault metadata, and read vault names, synced file paths, and metadata backups (they cannot read note contents). Tokens expire after **90 days**, and revoking or replacing a token invalidates it for all vaults using it.

## License

[MIT](./LICENSE)
