const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mediaQuality,
  filterAndSortMedia,
  computeVirtualRange,
} = require('../src/gallery-model.js');

test('classifies original, thumbnail, and low-resolution images conservatively', () => {
  assert.equal(mediaQuality({ type: 'image', width: 36, height: 36, url: 'https://x.test/avatar.jpg', source: 'img' }), 'low-res');
  assert.equal(mediaQuality({ type: 'image', width: 1200, height: 800, url: 'https://x.test/full.jpg', source: 'img' }), 'original');
  assert.equal(mediaQuality({ type: 'image', width: 640, height: 480, url: 'https://x.test/thumb_640.jpg', source: 'img' }), 'thumbnail');
  assert.equal(mediaQuality({ type: 'image', width: 0, height: 0, url: 'https://x.test/unknown.jpg', source: 'network' }), 'thumbnail');
  assert.equal(mediaQuality({ type: 'video', width: 1920, height: 1080, url: 'https://x.test/a.mp4' }), 'video');
});

test('filters small media and original-only results without hiding unknown dimensions as low-res', () => {
  const items = [
    { url: 'low.jpg', type: 'image', width: 36, height: 36 },
    { url: 'original.jpg', type: 'image', width: 1600, height: 900 },
    { url: 'thumb.jpg', type: 'image', width: 320, height: 240 },
    { url: 'unknown.jpg', type: 'image', width: 0, height: 0 },
  ];
  assert.deepEqual(filterAndSortMedia(items, { hideSmall: true }).map((item) => item.url), ['original.jpg', 'thumb.jpg', 'unknown.jpg']);
  assert.deepEqual(filterAndSortMedia(items, { originalOnly: true }).map((item) => item.url), ['original.jpg']);
});

test('sorts by resolution and known byte size with unknown values last', () => {
  const items = [
    { url: 'small.jpg', type: 'image', width: 400, height: 300, bytes: 900000 },
    { url: 'large.jpg', type: 'image', width: 1600, height: 900, bytes: 200000 },
    { url: 'unknown.jpg', type: 'image', width: 0, height: 0, bytes: 0 },
  ];
  assert.deepEqual(filterAndSortMedia(items, { sort: 'resolution' }).map((item) => item.url), ['large.jpg', 'small.jpg', 'unknown.jpg']);
  assert.deepEqual(filterAndSortMedia(items, { sort: 'size' }).map((item) => item.url), ['small.jpg', 'large.jpg', 'unknown.jpg']);
});

test('virtual range renders a bounded overscanned window for 300 items', () => {
  const range = computeVirtualRange({ itemCount: 300, columns: 2, rowHeight: 220, scrollTop: 6600, viewportHeight: 500, overscanRows: 3, threshold: 60 });
  assert.equal(range.virtual, true);
  assert.ok(range.start > 0);
  assert.ok(range.end < 300);
  assert.ok(range.end - range.start <= 20, `rendered ${range.end - range.start} items`);
  assert.ok(range.topSpacer > 0);
  assert.ok(range.bottomSpacer > 0);
});

test('virtual range renders all items below the threshold', () => {
  assert.deepEqual(computeVirtualRange({ itemCount: 40, threshold: 60 }), {
    virtual: false,
    start: 0,
    end: 40,
    topSpacer: 0,
    bottomSpacer: 0,
  });
});
