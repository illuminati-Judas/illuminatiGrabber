const test = require('node:test');
const assert = require('node:assert/strict');

const { downloadCurrentTelegramBlob } = require('../src/telegram-page-download.js');

function createFixture({ src = 'blob:https://web.telegram.org/video-id', type = 'video/mp4' } = {}) {
  let clicked = false;
  let revoked = '';
  const media = {
    currentSrc: src,
    src,
    tagName: 'VIDEO',
    getAttribute: (name) => name === 'data-wmg-filename' ? 'telegram-video.mp4' : null,
  };
  const anchor = {
    style: {},
    click() { clicked = true; },
    remove() {},
  };
  const documentRef = {
    querySelector: (selector) => selector.includes('data-wmg-current-media') ? media : null,
    createElement: (tag) => tag === 'a' ? anchor : null,
    body: { append() {} },
  };
  const URLRef = {
    createObjectURL: () => 'blob:extension/download-id',
    revokeObjectURL: (value) => { revoked = value; },
  };
  const fetchFn = async () => ({ ok: true, blob: async () => ({ size: 1234, type }) });
  return {
    documentRef, URLRef, fetchFn,
    clicked: () => clicked,
    revoked: () => revoked,
    anchor,
  };
}

test('downloads only the Telegram blob marked by the latest user click', async () => {
  const fixture = createFixture();
  const result = await downloadCurrentTelegramBlob({
    documentRef: fixture.documentRef,
    fetchFn: fixture.fetchFn,
    URLRef: fixture.URLRef,
    schedule: (fn) => fn(),
  });
  assert.deepEqual(result, { ok: true, status: 'triggered', filename: 'telegram-video.mp4', size: 1234, type: 'video/mp4' });
  assert.equal(fixture.clicked(), true);
  assert.equal(fixture.anchor.download, 'telegram-video.mp4');
  assert.equal(fixture.revoked(), 'blob:extension/download-id');
});

test('fails closed when no clicked Telegram media is marked', async () => {
  const result = await downloadCurrentTelegramBlob({
    documentRef: { querySelector: () => null },
    fetchFn: async () => { throw new Error('must not fetch'); },
    URLRef: {},
    schedule: () => {},
  });
  assert.deepEqual(result, { ok: false, status: 'no_current_media', error: 'Click a Telegram image or video first.' });
});

test('rejects non-blob URLs in the page downloader', async () => {
  const fixture = createFixture({ src: 'https://evil.test/video.mp4' });
  const result = await downloadCurrentTelegramBlob({
    documentRef: fixture.documentRef,
    fetchFn: fixture.fetchFn,
    URLRef: fixture.URLRef,
    schedule: () => {},
  });
  assert.deepEqual(result, { ok: false, status: 'not_blob', error: 'Current media is not a Telegram blob URL.' });
});
