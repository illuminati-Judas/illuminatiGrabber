const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(pickerError) {
  let clicked = 0;
  let fetched = 0;
  let opened = 0;
  let savedBlob;
  const context = vm.createContext({
    module: { exports: {} }, Blob, Map, Date, Math,
    URL: class extends URL {
      static createObjectURL(blob) { savedBlob = blob; return 'blob:https://web.telegram.org/test'; }
      static revokeObjectURL() {}
    },
    location: { hostname: 'fixture.test' },
    setTimeout() {}, navigator: { userActivation: { isActive: true } },
    document: { body: { append() {} }, createElement() { return { style: {}, click() { clicked++; }, remove() {} }; } },
    fetch: async () => { fetched++; return { status: 200, headers: { get: () => 'video/mp4' }, blob: async () => new Blob(['actual-video-bytes'], { type: 'video/mp4' }) }; },
    showSaveFilePicker: async () => { opened++; throw Object.assign(new Error('Picker unavailable'), { name: pickerError }); },
  });
  context.self = context.top = context;
  const source = process.env.WMG_TELEGRAM_TEST_SOURCE || path.join(__dirname, '../src/telegram-inpage.js');
  let code = fs.readFileSync(source, 'utf8');
  // Older builds did not export these helpers; expose only in this isolated test VM.
  code = code.replace('const api = {', 'const api = { downloadVideo, officialDownloadButton,');
  vm.runInContext(code, context);
  return { api: context.module.exports, counts: () => ({ clicked, fetched, opened }), blob: () => savedBlob };
}

test('viewer download always uses a Chrome-tracked blob download so Recent Downloads can Open it', async () => {
  const { api, counts, blob } = fixture('AbortError');
  const result = await api.downloadVideo({ src: 'https://web.telegram.org/k/stream/item' }, { dataset: {} });
  assert.equal(result.bytes, 18);
  assert.deepEqual(counts(), { clicked: 1, fetched: 1, opened: 0 });
  assert.equal(await blob().text(), 'actual-video-bytes');
});

test('disabled buttons and quality menus are not mistaken for file downloads', () => {
  const { api } = fixture();
  const button = (attrs = {}, extra = {}) => ({ className: '', textContent: '', getAttribute: (key) => attrs[key], ...extra });
  const disabled = button({ 'aria-label': 'Download' }, { disabled: true });
  const menu = button({ 'aria-label': 'Download', 'aria-haspopup': 'menu' });
  const quality = button({}, { className: 'quality-download-options-button-menu' });
  const download = button({ 'aria-label': 'Download' });
  assert.equal(api.officialDownloadButton({ actions: { querySelectorAll: () => [disabled, menu, quality] } }), null);
  assert.equal(api.officialDownloadButton({ actions: { querySelectorAll: () => [disabled, menu, download] } }), download);
});
