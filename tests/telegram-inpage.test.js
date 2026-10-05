const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseContentRange,
  filenameFromTelegramStream,
  downloadTelegramStream,
  mediaUrl,
  downloadCaptured,
  captureCurrent,
  officialDownloadForRun,
} = require('../src/telegram-inpage.js');

test('parses Telegram Content-Range headers strictly', () => {
  assert.deepEqual(parseContentRange('bytes 0-1023/4096'), { start: 0, end: 1023, total: 4096 });
  assert.equal(parseContentRange('invalid'), null);
});

test('captured Telegram retries reject missing or changed viewers without downloading', async () => {
  const previousDocument = globalThis.document;
  const source = { tagName: 'IMG', src: 'https://web.telegram.org/file/one.jpg', querySelector: () => null };
  const slide = { querySelector: (selector) => selector === '.MediaViewerContent > div > img' ? source : null };
  const viewer = { querySelector: (selector) => selector === '.MediaViewerSlide--active' ? slide : null };
  globalThis.document = { querySelector: (selector) => selector === '#MediaViewer' ? viewer : null, querySelectorAll: () => [] };
  try {
    const captured = captureCurrent();
    assert.ok(captured.token);
    assert.equal(captured.type, 'image');
    assert.equal(captured.url, undefined);
    source.src = 'https://web.telegram.org/file/two.jpg';
    const result = await downloadCaptured(captured.token);
    assert.equal(result.ok, false);
    assert.match(result.error, /same Telegram media/);
    assert.equal((await downloadCaptured('missing-token')).ok, false);
  } finally { globalThis.document = previousDocument; }
});

test('extracts a safe filename from Telegram stream metadata', () => {
  const metadata = encodeURIComponent(JSON.stringify({ fileName: 'concert/video?.MP4' }));
  assert.equal(filenameFromTelegramStream(`https://web.telegram.org/k/stream/${metadata}`), 'concert-video-.MP4');
});

test('prefers Telegram stream URLs over blob player URLs', () => {
  const video = {
    currentSrc: 'blob:https://web.telegram.org/player',
    src: 'https://web.telegram.org/k/stream/item',
    querySelector: () => null,
  };
  assert.equal(mediaUrl(video), 'https://web.telegram.org/k/stream/item');
});

test('all illuminati downloads bypass an unconfirmed Telegram button handoff', () => {
  const official = {
    className: 'download-button', textContent: '', disabled: false,
    getAttribute: (name) => name === 'aria-label' ? 'Download' : '',
  };
  const viewer = { actions: { querySelectorAll: () => [official] } };
  assert.equal(officialDownloadForRun(viewer, { backgroundTask: true }), null);
  assert.equal(officialDownloadForRun(viewer, {}), null);
});

test('downloads Telegram streams sequentially with Range requests', async () => {
  const bytes = Buffer.from('telegram-range-test');
  const ranges = [];
  const writes = [];
  let closed = false;
  const fetchFn = async (_url, options) => {
    const start = Number(options.headers.Range.match(/bytes=(\d+)-/)[1]);
    ranges.push(start);
    const end = Math.min(start + 4, bytes.length - 1);
    const body = bytes.subarray(start, end + 1);
    return {
      status: 206,
      headers: { get(name) {
        const key = name.toLowerCase();
        if (key === 'content-range') return `bytes ${start}-${end}/${bytes.length}`;
        if (key === 'content-type') return 'video/mp4';
        return null;
      } },
      blob: async () => new Blob([body], { type: 'video/mp4' }),
    };
  };
  const writer = {
    async write(blob) { writes.push(Buffer.from(await blob.arrayBuffer())); },
    async close() { closed = true; },
  };
  const result = await downloadTelegramStream('https://web.telegram.org/k/stream/item', { fetchFn, writer });
  assert.deepEqual(ranges, [0, 5, 10, 15]);
  assert.equal(Buffer.concat(writes).toString(), bytes.toString());
  assert.equal(closed, true);
  assert.deepEqual(result, { ok: true, bytes: bytes.length, parts: 4, type: 'video/mp4' });
});

test('rejects gaps in Telegram range responses', async () => {
  const fetchFn = async () => ({
    status: 206,
    headers: { get: (name) => name.toLowerCase() === 'content-range' ? 'bytes 5-9/10' : 'video/mp4' },
    blob: async () => new Blob(['12345'], { type: 'video/mp4' }),
  });
  await assert.rejects(
    downloadTelegramStream('https://web.telegram.org/k/stream/item', { fetchFn, writer: { write() {}, close() {} } }),
    /Range gap/,
  );
});
