const { Modal, Notice, Plugin, PluginSettingTab, SecretComponent, Setting, requestUrl } = require('obsidian');

// The published plugin always talks to production. Developers can temporarily
// replace this with 'http://localhost:8080/notes' while working locally.
const API_BASE_URL = 'https://api.chromenotepad.com/notes';
const SYNC_BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 250;
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;

class ChromeNotepadSync extends Plugin {
  async onload() {
    const saved = (await this.loadData()) ?? {};
    this.settings = { secretName: '', automatic: false, ...saved };
    delete this.settings.server;
    this.fileIds = new Map(Object.entries(saved.fileIds ?? {}));
    this.syncedFiles = new Map(Object.entries(saved.syncedFiles ?? {}));
    this.syncedPaths = new Map(Object.entries(saved.syncedPaths ?? {}));
    this.settings.installationId ??= crypto.randomUUID();
    this.pendingSave = Promise.resolve();
    this.pendingBackup = Promise.resolve();
    this.recoveryPromise = null;
    this.syncRequested = false;
    this.running = false;
    this.active = true;
    this.recoveryRequired = !saved.vaultId || !saved.fileIds ||
      (this.fileIds.size === 0 && saved.mappingRecovered !== true);
    await this.persist();

    this.addSettingTab(new SyncSettings(this.app, this));
    this.addCommand({
      id: 'push-vault',
      name: 'Sync vault',
      callback: () => void this.syncVault(true),
    });
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      for (const [path, id] of [...this.fileIds]) {
        if (path === oldPath || path.startsWith(oldPath + '/')) {
          const newPath = file.path + path.slice(oldPath.length);
          this.fileIds.delete(path);
          this.fileIds.set(newPath, id);
        }
      }
      void this.persist().then(() => this.backupMetadata()).catch(() =>
        new Notice('Chrome Notepad could not back up renamed file mappings.'));
    }));
    this.registerInterval(window.setInterval(() => {
      if (this.syncRequested && this.currentToken()) {
        void this.syncVault(true);
      } else if (this.settings.automatic) {
        void this.syncVault(false);
      }
    }, 5 * 60_000));
    if (this.recoveryRequired && this.settings.secretName) {
      void this.beginRecovery().catch(error => new Notice(error.message));
    }
  }

  backupMetadata(token = this.currentToken()) {
    if (!token || !this.settings.vaultId || this.recoveryRequired || this.syncedFiles.size === 0) {
      return Promise.resolve();
    }
    const payload = {
      vaultId: this.settings.vaultId,
      installationId: this.settings.installationId,
      metadata: {
        automatic: this.settings.automatic,
        fileIds: Object.fromEntries(this.fileIds),
        syncedFiles: Object.fromEntries(this.syncedFiles),
        syncedPaths: Object.fromEntries(this.syncedPaths),
      },
    };
    this.pendingBackup = this.pendingBackup.catch(() => undefined).then(async () => {
      const response = await requestUrl({
        url: API_BASE_URL + '/public/obsidian/metadata',
        method: 'POST',
        headers: { 'X-Obsidian-Token': token },
        contentType: 'application/json',
        body: JSON.stringify(payload),
        throw: false,
      });
      if (response.status !== 204) throw new Error('Chrome Notepad could not back up vault metadata.');
    });
    return this.pendingBackup;
  }

  currentToken() {
    const name = this.settings.secretName;
    const token = name ? this.app.secretStorage.getSecret(name)?.trim() : undefined;
    return token && tokenFormat.test(token) ? token : undefined;
  }

  beginRecovery() {
    if (this.recoveryPromise) return this.recoveryPromise;
    const token = this.currentToken();
    if (!token) return Promise.resolve(false);
    this.recoveryPromise = this.recoverMapping(token, true).finally(() => {
      this.recoveryPromise = null;
    });
    return this.recoveryPromise;
  }

  async connectSecret(name) {
    this.settings.secretName = name;
    await this.persist();
    if (!this.currentToken()) return;
    if (this.syncRequested) {
      this.syncRequested = false;
      await this.syncVault(true);
    } else if (this.recoveryRequired) {
      try {
        await this.beginRecovery();
      } catch (error) {
        new Notice(error.message);
      }
    }
  }

  onunload() {
    this.active = false;
  }

  persist() {
    const snapshot = {
      ...this.settings,
      fileIds: Object.fromEntries(this.fileIds),
      syncedFiles: Object.fromEntries(this.syncedFiles),
      syncedPaths: Object.fromEntries(this.syncedPaths),
    };
    this.pendingSave = this.pendingSave.catch(() => undefined).then(() => this.saveData(snapshot));
    return this.pendingSave;
  }

  async recoverMapping(token, manual) {
    const response = await requestUrl({
      url: API_BASE_URL + '/public/obsidian/vaults',
      method: 'GET',
      headers: { 'X-Obsidian-Token': token },
      throw: false,
    });
    if (response.status !== 200 || !Array.isArray(response.json)) {
      throw new Error('Could not load Chrome Notepad vault mappings. Check your token and server connection.');
    }
    const vaults = response.json;
    if (this.currentToken() !== token || !this.active) return false;
    let selected = this.settings.vaultId
      ? vaults.find(vault => vault.vaultId === this.settings.vaultId)
      : undefined;
    if (!this.settings.vaultId && vaults.length) {
      if (!manual) throw new Error('Run Sync now to choose the Chrome Notepad vault to restore.');
      selected = await new Promise(resolve => new VaultSelectionModal(this.app, vaults, resolve).open());
      if (selected === undefined) return false;
      if (this.currentToken() !== token || !this.active) return false;
    }
    if (selected) {
      const paths = new Map();
      const backupPathsById = new Map();
      const localPaths = new Set(this.app.vault.getMarkdownFiles().map(file => file.path));
      for (const [path, id] of Object.entries(selected.metadata?.fileIds ?? {})) {
        if (backupPathsById.has(id)) {
          throw new Error('This vault backup has duplicate file IDs. Restore its original plugin data.');
        }
        backupPathsById.set(id, path);
      }
      for (const file of selected.files) {
        const backupPath = backupPathsById.get(file.fileId);
        const path = backupPath && localPaths.has(backupPath) && !localPaths.has(file.path)
          ? backupPath : file.path || backupPath;
        if (!path || paths.has(path)) {
          throw new Error('This vault has missing or duplicate file paths. Restore its original plugin data and sync it first.');
        }
        paths.set(path, file.fileId);
      }
      this.settings.vaultId = selected.vaultId;
      if (selected.metadata) {
        this.settings.automatic = selected.metadata.automatic === true;
        const knownIds = new Set(paths.values());
        for (const [path, id] of Object.entries(selected.metadata.fileIds ?? {})) {
          if (!paths.has(path) && !knownIds.has(id)) {
            paths.set(path, id);
            knownIds.add(id);
          }
        }
      }
      this.fileIds = paths;
      // File timestamps can differ on a fresh installation, so recheck contents.
      this.syncedFiles.clear();
      this.syncedPaths.clear();
    } else {
      this.settings.vaultId ??= crypto.randomUUID();
    }
    this.settings.mappingRecovered = true;
    await this.persist();
    this.recoveryRequired = false;
    return true;
  }

  async syncVault(manual) {
    if (this.running) {
      if (manual) new Notice('Chrome Notepad sync is already running.');
      return;
    }
    const token = this.currentToken();
    if (!token) {
      if (manual) {
        this.syncRequested = true;
        new Notice('Select a Chrome Notepad sync token in plugin settings. Sync will continue after it is connected.');
      }
      return;
    }
    this.running = true;
    let checked = 0;
    let failed = 0;
    let stopped = '';
    let progressNotice;
    try {
      const { vault } = this.app;
      if (this.recoveryRequired) {
        if (manual) new Notice('Restoring vault metadata. Sync will continue when it is ready.');
        try {
          if (!await this.beginRecovery()) {
            this.syncRequested = false;
            return;
          }
        } catch (error) {
          if (manual) this.syncRequested = true;
          throw error;
        }
      }
      this.syncRequested = false;
      if (this.currentToken() !== token || !this.active) return;
      const vaultId = this.settings.vaultId;
      const files = vault.getMarkdownFiles();
      const uploads = files.map(file => {
        let fileId = this.fileIds.get(file.path);
        if (!fileId) {
          fileId = crypto.randomUUID();
          this.fileIds.set(file.path, fileId);
        }
        return { file, fileId, modifiedAt: file.stat.mtime };
      }).filter(({ file, fileId, modifiedAt }) =>
        Number(this.syncedFiles.get(fileId)) !== modifiedAt || this.syncedPaths.get(fileId) !== file.path)
        .sort((a, b) => a.modifiedAt - b.modifiedAt || a.file.path.localeCompare(b.file.path));
      let processed = 0;
      const reportProgress = () => {
        progressNotice?.setMessage(
          `Syncing ${vault.getName()}: ${processed} of ${uploads.length} changed files. ${checked} uploaded, ${failed} failed.`,
        );
      };
      if (manual && uploads.length > 0) {
        progressNotice = new Notice('', 0);
        reportProgress();
      }
      // Save ids before sending. Retrying after a crash uses the same ids.
      await this.persist();
      for (let start = 0; start < uploads.length && !stopped; start += SYNC_BATCH_SIZE) {
        const batch = uploads.slice(start, start + SYNC_BATCH_SIZE);
        for (const { file, fileId, modifiedAt } of batch) {
          if (!this.active) return;
          try {
            const markdown = await vault.read(file);
            if (!this.active) return;
            if (file.stat.mtime !== modifiedAt) {
              failed++;
              continue;
            }
            const response = await requestUrl({
              url: API_BASE_URL + '/public/obsidian/push',
              method: 'POST',
              headers: { 'X-Obsidian-Token': token },
              contentType: 'application/json',
              body: JSON.stringify({ vaultId, vaultName: vault.getName(), fileId, markdown, modifiedAt, filePath: file.path }),
              throw: false,
            });
            if ([401, 403, 409].includes(response.status)) {
              stopped = response.status === 409
                ? 'Obsidian sync requires a Chrome Notepad account with recoverable encryption.'
                : 'Chrome Notepad rejected the sync token. Generate a new token in Account Settings.';
              break;
            }
            if (response.status !== 200) {
              failed++;
              continue;
            }
            if (response.json?.result === 'stale') {
              failed++;
              continue;
            }
            // This durable checkpoint lets a later run skip completed files.
            this.syncedFiles.set(fileId, modifiedAt);
            this.syncedPaths.set(fileId, file.path);
            await this.persist();
            checked++;
          } catch {
            failed++;
          } finally {
            processed++;
            reportProgress();
          }
        }
        if (this.syncedFiles.size > 0) {
          try {
            await this.backupMetadata(token);
          } catch {
            new Notice('Chrome Notepad could not back up vault metadata. Sync again to retry.');
          }
        }
        if (start + SYNC_BATCH_SIZE < uploads.length && !stopped) {
          await new Promise(resolve => window.setTimeout(resolve, BATCH_PAUSE_MS));
        }
      }
      if (uploads.length === 0 && this.syncedFiles.size > 0) {
        try {
          await this.backupMetadata(token);
        } catch {
          new Notice('Chrome Notepad could not back up vault metadata. Sync again to retry.');
        }
      }
      if (stopped) {
        new Notice(stopped);
      } else if (manual || failed) {
        const upToDate = files.length - uploads.length;
        new Notice(`${vault.getName()}: ${checked} changed files uploaded, ${failed} failed, ${upToDate} already up to date.`);
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Chrome Notepad could not sync the vault. Try again.');
    } finally {
      progressNotice?.hide();
      this.running = false;
    }
  }
}

class VaultSelectionModal extends Modal {
  constructor(app, vaults, resolve) {
    super(app);
    this.vaults = vaults;
    this.resolve = resolve;
  }

  onOpen() {
    this.titleEl.setText('Choose a Chrome Notepad vault');
    this.contentEl.createEl('p', { text: 'Select the vault previously synced from this Obsidian vault, or start a new one.' });
    for (const vault of this.vaults) {
      new Setting(this.contentEl)
        .setName(vault.vaultName)
        .setDesc(`${vault.files.length} notes · ${vault.vaultId}`)
        .addButton(button => button.setButtonText('Restore').onClick(() => {
          this.resolve(vault);
          this.close();
        }));
    }
    new Setting(this.contentEl).setName('Start a new vault')
      .addButton(button => button.setButtonText('Create').onClick(() => {
        this.resolve(null);
        this.close();
      }));
  }

  onClose() {
    this.resolve(undefined);
    this.contentEl.empty();
  }
}

class SyncSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl, plugin } = this;
    containerEl.empty();
    const persist = () => plugin.persist().catch(() => new Notice('Chrome Notepad sync settings could not be saved.'));
    new Setting(containerEl)
      .setName('Sync token')
      .setDesc('Generate a token in Chrome Notepad Account Settings. Add it as an Obsidian secret and select it here.')
      .addComponent(el => new SecretComponent(this.app, el)
        .setValue(plugin.settings.secretName)
        .onChange(value => plugin.connectSecret(value).catch(() =>
          new Notice('Chrome Notepad could not save the sync token selection.'))));
    new Setting(containerEl)
      .setName('Vault scope')
      .setDesc(`This plugin syncs every Markdown file in the open vault, “${this.app.vault.getName()}”. Each vault has its own Chrome Notepad folder.`);
    new Setting(containerEl)
      .setName('Automatic sync')
      .setDesc('Send changed Markdown notes every five minutes while this vault is open.')
      .addToggle(toggle => toggle.setValue(plugin.settings.automatic)
        .onChange(async value => {
          plugin.settings.automatic = value;
          await persist();
          await plugin.backupMetadata().catch(() => new Notice('Chrome Notepad could not back up vault metadata.'));
        }));
    new Setting(containerEl)
      .setName('Sync vault')
      .addButton(button => button.setButtonText('Sync now').onClick(() => plugin.syncVault(true)));
  }
}

module.exports = ChromeNotepadSync;
