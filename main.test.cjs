const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');

test('persists file identity before uploading and carries it through retries and renames', async () => {
  const notices = [];
  const uploads = [];
  let saved = { secretName: 'test-key' };
  const file = { path: 'Old/chapter.md', stat: { mtime: 10 } };
  let rename;
  let status = 503;
  const app = {
    secretStorage: { getSecret: () => 'a'.repeat(43) },
    vault: {
      on: (_, callback) => { rename = callback; },
      getMarkdownFiles: () => [file],
      read: async () => '# Algebra\n\n$x^2$',
      getName: () => 'Math',
    },
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(require.resolve('./main.js'), 'utf8'), {
    module, crypto: webcrypto, window: { setInterval: () => 1, setTimeout: callback => callback() },
    require: name => {
      assert.equal(name, 'obsidian');
      return {
        Notice: class {
          constructor(message) { notices.push(message); }
          setMessage(message) { notices.push(message); }
          hide() {}
        },
        Plugin: class {
          get app() { return app; }
          async loadData() { return saved; }
          async saveData(value) { saved = value; }
          addSettingTab() {}
          addCommand() {}
          registerEvent() {}
          registerInterval() {}
        },
        PluginSettingTab: class {},
        Modal: class {},
        requestUrl: async options => {
          if (options.method === 'GET') return { status: 200, json: [] };
          if (options.url.endsWith('/metadata')) return { status: 204 };
          const payload = JSON.parse(options.body);
          assert.equal(saved.fileIds[file.path], payload.fileId);
          assert.equal(options.method, 'POST');
          assert.equal(options.headers['X-Obsidian-Token'], 'a'.repeat(43));
          assert.equal(options.url, 'https://api.chromenotepad.com/notes/public/obsidian/push');
          uploads.push(payload);
          return { status };
        },
      };
    },
  });
  const plugin = new module.exports();
  await plugin.onload();
  await plugin.syncVault(true);
  assert.match(notices.at(-1), /1 failed/);
  status = 200;
  await plugin.syncVault(true);
  await plugin.syncVault(false);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].fileId, uploads[1].fileId);
  assert.equal(uploads[1].markdown, '# Algebra\n\n$x^2$');
  assert.equal(uploads[1].filePath, 'Old/chapter.md');
  assert.equal(saved.syncedFiles[uploads[1].fileId], 10);
  file.path = 'New/chapter.md';
  rename({ path: 'New' }, 'Old');
  await plugin.syncVault(false);
  assert.equal(uploads.length, 3);
  assert.equal(uploads[2].fileId, uploads[0].fileId);
  assert.equal(uploads[2].vaultId, uploads[0].vaultId);
  assert.equal(uploads[2].modifiedAt, 10);
  assert.equal(uploads[2].filePath, 'New/chapter.md');
  assert.equal(JSON.stringify(saved).includes('a'.repeat(43)), false);

  file.stat.mtime = 30;
  status = 401;
  await plugin.syncVault(true);
  assert.match(notices.at(-1), /rejected the sync token/);
});

test('persists batch checkpoints and scans only changed files after restart', async () => {
  const uploads = [];
  const notices = [];
  const files = Array.from({ length: 26 }, (_, index) => ({
    path: `notes/${String(index).padStart(2, '0')}.md`,
    stat: { mtime: index + 1 },
  }));
  let saved = { secretName: 'test-key' };
  const app = {
    secretStorage: { getSecret: () => 'a'.repeat(43) },
    vault: {
      on: () => {},
      getMarkdownFiles: () => files,
      read: async file => file.path,
      getName: () => 'Batch vault',
    },
  };
  const loadPlugin = () => {
    const module = { exports: {} };
    runInNewContext(readFileSync(require.resolve('./main.js'), 'utf8'), {
      module, crypto: webcrypto, window: { setInterval: () => 1, setTimeout: callback => callback() },
      require: name => {
        assert.equal(name, 'obsidian');
        return {
          Notice: class {
            constructor(message) { notices.push(message); }
            setMessage(message) { notices.push(message); }
            hide() {}
          },
          Plugin: class {
            get app() { return app; }
            async loadData() { return saved; }
            async saveData(value) { saved = value; }
            addSettingTab() {}
            addCommand() {}
            registerEvent() {}
            registerInterval() {}
          },
          PluginSettingTab: class {},
          Modal: class {},
          requestUrl: async options => {
            if (options.method === 'GET') return { status: 200, json: [] };
            if (options.url.endsWith('/metadata')) return { status: 204 };
            uploads.push(JSON.parse(options.body));
            return { status: 200 };
          },
        };
      },
    });
    return new module.exports();
  };

  const first = loadPlugin();
  await first.onload();
  await first.syncVault(true);
  assert.equal(uploads.length, 26);
  assert.equal(Object.keys(saved.syncedFiles).length, 26);
  assert.match(notices.join('\n'), /Syncing Batch vault: 25 of 26 changed files/);

  const resumed = loadPlugin();
  await resumed.onload();
  await resumed.syncVault(false);
  assert.equal(uploads.length, 26);

  files[25].stat.mtime = 99;
  await resumed.syncVault(false);
  assert.equal(uploads.length, 27);
  assert.equal(uploads.at(-1).modifiedAt, 99);
});

function recoveryFixture({ saved, vaults, choice = 0, status = 200 }) {
  const uploads = [];
  const backups = [];
  const choices = [];
  const notices = [];
  const file = { path: 'Plans/Hardware.md', stat: { mtime: 100 } };
  const app = {
    secretStorage: { getSecret: () => 'a'.repeat(43) },
    vault: {
      on: () => {},
      getMarkdownFiles: () => [file],
      read: async () => 'content',
      getName: () => 'My vault',
    },
  };
  let selectedButton = 0;
  let persisted = saved;
  const module = { exports: {} };
  runInNewContext(readFileSync(require.resolve('./main.js'), 'utf8'), {
    module, crypto: webcrypto, window: { setInterval: () => 1, setTimeout: callback => callback() },
    require: () => ({
      Notice: class { constructor(message) { notices.push(message); } setMessage() {} hide() {} },
      Plugin: class {
        get app() { return app; }
        async loadData() { return persisted; }
        async saveData(value) { persisted = value; }
        addSettingTab() {} addCommand() {} registerEvent() {} registerInterval() {}
      },
      PluginSettingTab: class {},
      Modal: class {
        constructor() {
          this.titleEl = { setText() {} };
          this.contentEl = { createEl() {}, empty() {} };
        }
        open() { this.onOpen(); if (choice === -1) this.close(); }
        close() { this.onClose(); }
      },
      Setting: class {
        setName() { return this; }
        setDesc() { return this; }
        addButton(callback) {
          const index = selectedButton++;
          callback({
            setButtonText() { return this; },
            onClick(fn) { choices[index] = fn; if (index === choice) fn(); return this; },
          });
          return this;
        }
      },
      requestUrl: async options => {
        if (options.method === 'GET') return { status, json: vaults };
        if (options.url.endsWith('/metadata')) {
          backups.push(JSON.parse(options.body));
          return { status: 204 };
        }
        uploads.push(JSON.parse(options.body));
        return { status: 200, json: { result: 'unchanged' } };
      },
    }),
  });
  return { plugin: new module.exports(), uploads, backups, notices, choices, getSaved: () => persisted };
}

test('restores a selected remote vault and reuses its file identity after plugin data loss', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [{ fileId: '76e05b51-8c8e-402c-8df9-7af09d8f42ab', noteId: 'existing-note', path: 'Plans/Hardware.md' }],
  };
  const fixture = recoveryFixture({ saved: { secretName: 'token' }, vaults: [mapping] });
  await fixture.plugin.onload();
  await fixture.plugin.syncVault(true);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.uploads[0].vaultId, mapping.vaultId);
  assert.equal(fixture.uploads[0].fileId, mapping.files[0].fileId);
  assert.equal(fixture.getSaved().fileIds['Plans/Hardware.md'], mapping.files[0].fileId);
  assert.equal(fixture.backups[0].metadata.fileIds['Plans/Hardware.md'], mapping.files[0].fileId);
  assert.equal(JSON.stringify(fixture.backups).includes('secretName'), false);
  assert.equal(JSON.stringify(fixture.backups).includes('a'.repeat(43)), false);
  await fixture.plugin.syncVault(true);
  assert.equal(fixture.uploads.length, 1);
});

test('never uploads when recovery is cancelled or paths are incomplete', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [{ fileId: '76e05b51-8c8e-402c-8df9-7af09d8f42ab', noteId: 'existing-note', path: null }],
  };
  const missing = recoveryFixture({ saved: { secretName: 'token' }, vaults: [mapping] });
  await missing.plugin.onload();
  await missing.plugin.syncVault(true);
  assert.equal(missing.uploads.length, 0);
  assert.ok(missing.notices.some(message => message.includes('missing or duplicate')));

  const cancelled = recoveryFixture({ saved: { secretName: 'token' }, vaults: [mapping], choice: -1 });
  await cancelled.plugin.onload();
  await cancelled.plugin.syncVault(true);
  assert.equal(cancelled.uploads.length, 0);
  assert.equal(cancelled.getSaved().vaultId, undefined);
});

test('restores a missing file map for a known vault and stops if the server is unavailable', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [{ fileId: '76e05b51-8c8e-402c-8df9-7af09d8f42ab', noteId: 'existing-note', path: 'Plans/Hardware.md' }],
  };
  const fixture = recoveryFixture({ saved: { secretName: 'token', vaultId: mapping.vaultId }, vaults: [mapping] });
  await fixture.plugin.onload();
  await fixture.plugin.syncVault(true);
  assert.equal(fixture.uploads[0].fileId, mapping.files[0].fileId);

  const unavailable = recoveryFixture({ saved: { secretName: 'token' }, vaults: [], status: 503 });
  await unavailable.plugin.onload();
  await unavailable.plugin.syncVault(true);
  assert.equal(unavailable.uploads.length, 0);
  assert.equal(unavailable.getSaved().vaultId, undefined);
});

test('defers a requested sync until vault selection completes, then resumes it', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [],
  };
  const fixture = recoveryFixture({ saved: { secretName: 'token' }, vaults: [mapping], choice: -2 });
  await fixture.plugin.onload();
  const pendingSync = fixture.plugin.syncVault(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.uploads.length, 0);
  assert.ok(fixture.notices.some(message => message.includes('Sync will continue')));
  fixture.choices[0]();
  await pendingSync;
  assert.equal(fixture.uploads.length, 1);
});

test('rejects duplicate paths in recovered mappings', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [
      { fileId: 'a', path: 'Plans/Hardware.md' },
      { fileId: 'b', path: 'Plans/Hardware.md' },
    ],
  };
  const fixture = recoveryFixture({ saved: { secretName: 'token' }, vaults: [mapping] });
  await fixture.plugin.onload();
  await fixture.plugin.syncVault(true);
  assert.equal(fixture.uploads.length, 0);
  assert.ok(fixture.notices.some(message => message.includes('duplicate')));
});

test('restores backed-up preferences and unsynced IDs without trusting old timestamps', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [{ fileId: '76e05b51-8c8e-402c-8df9-7af09d8f42ab', path: 'Plans/Hardware.md' }],
    metadata: {
      automatic: true,
      fileIds: { 'Plans/Pending.md': 'f9742319-cc91-432a-8e43-c23b01a39012' },
      syncedFiles: { '76e05b51-8c8e-402c-8df9-7af09d8f42ab': 100 },
      syncedPaths: { '76e05b51-8c8e-402c-8df9-7af09d8f42ab': 'Plans/Hardware.md' },
    },
  };
  const fixture = recoveryFixture({ saved: { secretName: 'token' }, vaults: [mapping] });
  await fixture.plugin.onload();
  await fixture.plugin.syncVault(true);
  assert.equal(fixture.getSaved().automatic, true);
  assert.equal(fixture.getSaved().fileIds['Plans/Pending.md'], mapping.metadata.fileIds['Plans/Pending.md']);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.getSaved().secretName, 'token');
});

test('queues sync until a secret is selected and metadata is recovered', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [{ fileId: '76e05b51-8c8e-402c-8df9-7af09d8f42ab', path: 'Plans/Hardware.md' }],
  };
  const fixture = recoveryFixture({ saved: {}, vaults: [mapping], choice: -2 });
  await fixture.plugin.onload();
  await fixture.plugin.syncVault(true);
  assert.ok(fixture.notices.some(message => message.includes('after it is connected')));
  const connection = fixture.plugin.connectSecret('token');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.uploads.length, 0);
  fixture.choices[0]();
  await connection;
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.uploads[0].fileId, mapping.files[0].fileId);
});

test('uses the encrypted backup to recover a renamed local file when the server path is old', async () => {
  const mapping = {
    vaultId: 'b504cb3d-25ba-4868-9c78-a67b725b5f13',
    vaultName: 'My vault',
    files: [{ fileId: '76e05b51-8c8e-402c-8df9-7af09d8f42ab', path: 'Old/Hardware.md' }],
    metadata: { automatic: false, fileIds: { 'Plans/Hardware.md': '76e05b51-8c8e-402c-8df9-7af09d8f42ab' } },
  };
  const fixture = recoveryFixture({ saved: { secretName: 'token' }, vaults: [mapping] });
  await fixture.plugin.onload();
  await fixture.plugin.syncVault(true);
  assert.equal(fixture.uploads[0].fileId, mapping.files[0].fileId);
  assert.equal(fixture.uploads[0].filePath, 'Plans/Hardware.md');
});
