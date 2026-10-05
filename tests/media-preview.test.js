const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSafeDirectVideo,
  normalizePosterUrl,
  formatDuration,
  captureVideoFrame,
} = require('../src/media-preview.js');

test('allows only direct MP4 and WebM previews outside Telegram', () => {
  assert.equal(isSafeDirectVideo({ type: 'video', url: 'https://cdn.test/movie.mp4?token=x' }, 'generic'), true);
  assert.equal(isSafeDirectVideo({ type: 'video', url: 'https://cdn.test/movie.webm' }, 'generic'), true);
  for (const url of [
    'blob:https://cdn.test/id',
    'data:video/mp4;base64,AAAA',
    'https://cdn.test/live.m3u8',
    'https://cdn.test/manifest.mpd',
    'https://cdn.test/movie.mov',
    'https://cdn.test/stream',
    'https://web.telegram.org/stream/1',
  ]) assert.equal(isSafeDirectVideo({ type: 'video', url }, 'generic'), false, url);
  assert.equal(isSafeDirectVideo({ type: 'video', url: 'https://cdn.test/movie.mp4' }, 'telegram'), false);
  assert.equal(isSafeDirectVideo({ type: 'image', url: 'https://cdn.test/movie.mp4' }, 'generic'), false);
});

function frameDocument({ blockedCanvas = false } = {}) {
  const video = {
    videoWidth: 1920, videoHeight: 1080, duration: 60, paused: false,
    pause() { this.paused = true; },
    removeAttribute(name) { delete this[name]; },
    load() {},
  };
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toDataURL: () => {
      if (blockedCanvas) throw new Error('Tainted canvas');
      return 'data:image/jpeg;base64,FRAME';
    },
  };
  return { video, canvas, doc: { createElement: (tag) => tag === 'video' ? video : canvas } };
}

const directVideo = { type: 'video', url: 'https://cdn.test/movie.mp4' };

test('captures a bounded frame with metadata, then releases the video', async () => {
  const { doc, video, canvas } = frameDocument();
  const result = captureVideoFrame(doc, directVideo);
  assert.equal(video.muted, true);
  assert.equal(video.volume, 0);
  assert.equal(video.crossOrigin, 'anonymous');
  video.onloadeddata();
  assert.equal(video.currentTime, 0.1);
  video.onseeked();
  assert.deepEqual(await result, { posterUrl: 'data:image/jpeg;base64,FRAME', width: 1920, height: 1080, duration: 60 });
  assert.equal(canvas.width, 360);
  assert.equal(canvas.height, 203);
  assert.equal(video.src, undefined);
  assert.equal(video.paused, true);
});

test('aborts encrypted, live, CORS-blocked and cancelled frame requests', async () => {
  for (const mode of ['encrypted', 'live', 'cors', 'cancelled', 'timeout']) {
    const { doc, video } = frameDocument({ blockedCanvas: mode === 'cors' });
    const controller = new AbortController();
    const result = captureVideoFrame(doc, directVideo, { signal: controller.signal, timeout: mode === 'timeout' ? 1 : 1000 });
    if (mode === 'encrypted') video.onencrypted();
    else if (mode === 'live') { video.duration = Infinity; video.onloadeddata(); }
    else if (mode === 'cors') { video.onloadeddata(); video.onseeked(); }
    else if (mode === 'cancelled') controller.abort();
    assert.equal(await result, null, mode);
    assert.equal(video.src, undefined, mode);
    assert.equal(video.onencrypted, null, mode);
  }
});

test('never loads known protected video or manifest URLs for frame capture', async () => {
  const doc = { createElement() { throw new Error('Should not create a media element'); } };
  for (const item of [
    { ...directVideo, protected: true }, { ...directVideo, drm: true },
    { ...directVideo, url: 'https://cdn.test/live.m3u8' },
    { ...directVideo, url: 'blob:https://cdn.test/video' },
  ]) assert.equal(await captureVideoFrame(doc, item), null);
});

test('accepts only credential-free http/https poster URLs', () => {
  assert.equal(normalizePosterUrl('https://cdn.test/poster.jpg'), 'https://cdn.test/poster.jpg');
  assert.equal(normalizePosterUrl('https://user:secret@cdn.test/poster.jpg'), '');
  assert.equal(normalizePosterUrl('blob:https://cdn.test/id'), '');
});

test('formats finite durations without accepting live streams', () => {
  assert.equal(formatDuration(65.8), '1:05');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(Infinity), '');
  assert.equal(formatDuration(-1), '');
  for (const value of [NaN, undefined, null, '', 'invalid']) assert.equal(formatDuration(value), '');
  assert.equal(formatDuration(0), '0:00');
});
