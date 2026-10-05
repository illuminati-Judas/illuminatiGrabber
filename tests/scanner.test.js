const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUrl,
  parseSrcset,
  extractCssUrls,
  classifyMedia,
  dedupeMedia,
  dedupeMediaDetailed,
  canonicalMediaKey,
  scanDocument,
} = require('../src/scanner.js');

test('normalizes relative URLs and rejects unsupported protocols', () => {
  assert.equal(normalizeUrl('../img/photo.jpg', 'https://example.com/gallery/page'), 'https://example.com/img/photo.jpg');
  assert.equal(normalizeUrl('//cdn.example.com/a.webp', 'https://example.com'), 'https://cdn.example.com/a.webp');
  assert.equal(normalizeUrl('blob:https://example.com/id', 'https://example.com'), null);
  assert.equal(normalizeUrl('javascript:alert(1)', 'https://example.com'), null);
});

test('keeps identity and signature query parameters, even on image paths', () => {
  for (const suffix of ['', '.jpg']) {
    const result = dedupeMediaDetailed(['alice', 'bob'].map((name) => ({ type: 'image', url: `https://cdn.test/image${suffix}?name=${name}&size=original` })));
    assert.equal(result.items.length, 2);
  }
  assert.notEqual(canonicalMediaKey('https://cdn.test/a.jpg?w=100&signature=a'), canonicalMediaKey('https://cdn.test/a.jpg?w=900&signature=b'));
});

test('chooses X original and larger resize URLs without measured dimensions', () => {
  const x = dedupeMediaDetailed(['small', 'orig'].map((name) => ({ type: 'image', url: `https://pbs.twimg.com/media/ABC?format=jpg&name=${name}` })));
  assert.match(x.items[0].url, /name=orig/);
  const resized = dedupeMediaDetailed([320, 1920].map((w) => ({ type: 'image', url: `https://cdn.test/a.jpg?w=${w}` })));
  assert.match(resized.items[0].url, /w=1920/);
});

test('scan uses srcset descriptors across paths and does not borrow small image dimensions', () => {
  const doc = {
    baseURI: 'https://cdn.test/', title: 'fixture',
    images: [{ src: 'https://cdn.test/small.jpg', width: 320, naturalWidth: 320, height: 240, naturalHeight: 240,
      getAttribute: (name) => name === 'srcset' ? 'small.jpg 320w, large.jpg 1920w' : null }],
    querySelectorAll: () => [],
  };
  const result = scanDocument(doc, { location: new URL(doc.baseURI) });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, 'https://cdn.test/large.jpg');
  assert.equal(result.items[0].width, 1920);
  assert.equal(result.items[0].height, 0);
  assert.equal(result.duplicateCount, 2);
});

test('does not borrow bytes or dimensions from a different representation', () => {
  const result = dedupeMediaDetailed([
    { type: 'image', url: 'https://cdn.test/a.jpg?w=320', width: 320, height: 240, bytes: 10000 },
    { type: 'image', url: 'https://cdn.test/a.jpg?w=1920', variantWidth: 1920 },
  ]);
  assert.equal(result.items[0].bytes, undefined);
  assert.equal(result.items[0].height, undefined);
});

test('parses srcset candidates without descriptors', () => {
  assert.deepEqual(parseSrcset('small.jpg 480w, large.jpg 2x, /hero.webp'), ['small.jpg', 'large.jpg', '/hero.webp']);
});

test('extracts multiple CSS background URLs', () => {
  assert.deepEqual(
    extractCssUrls('linear-gradient(#000,#fff), url("/a.jpg"), url(https://cdn.example.com/b.webp)'),
    ['/a.jpg', 'https://cdn.example.com/b.webp'],
  );
});

test('classifies supported direct image and video URLs', () => {
  assert.equal(classifyMedia('https://x.test/photo.JPG?size=2'), 'image');
  assert.equal(classifyMedia('https://x.test/movie.mp4#t=1'), 'video');
  assert.equal(classifyMedia('https://x.test/stream.m3u8'), null);
  assert.equal(classifyMedia('https://x.test/page'), null);
});

test('deduplicates media by normalized URL and preserves richer metadata', () => {
  const result = dedupeMedia([
    { url: 'https://x.test/a.jpg', type: 'image', width: 0, height: 0, source: 'srcset' },
    { url: 'https://x.test/a.jpg', type: 'image', width: 1920, height: 1080, source: 'img' },
    { url: 'https://x.test/b.mp4', type: 'video', source: 'video' },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].width, 1920);
  assert.equal(result[0].height, 1080);
  assert.equal(result[0].source, 'img');
});

test('deduplication merges resource byte size into richer DOM metadata', () => {
  const [item] = dedupeMedia([
    { url: 'https://x.test/a.jpg', type: 'image', width: 1200, height: 800, source: 'img', order: 2 },
    { url: 'https://x.test/a.jpg', type: 'image', width: 0, height: 0, source: 'network', bytes: 456789, order: 8 },
  ]);
  assert.equal(item.width, 1200);
  assert.equal(item.height, 800);
  assert.equal(item.bytes, 456789);
  assert.equal(item.order, 2);
});

test('collapses URL variants and selects the highest-resolution representation', () => {
  const small = 'https://pbs.twimg.com/media/ABC123?format=jpg&name=small';
  const original = 'https://pbs.twimg.com/media/ABC123?name=orig&format=jpg';
  assert.equal(canonicalMediaKey(small, 'image'), canonicalMediaKey(original, 'image'));
  const result = dedupeMediaDetailed([
    { url: small, type: 'image', width: 680, height: 453, source: 'img', order: 0 },
    { url: original, type: 'image', width: 2048, height: 1365, source: 'srcset', order: 1 },
    { url: original, type: 'image', width: 2048, height: 1365, source: 'network', bytes: 900000, order: 2 },
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.items[0].url, original);
  assert.equal(result.items[0].width, 2048);
  assert.equal(result.items[0].bytes, 900000);
  assert.equal(result.items[0].order, 0);
});

test('does not merge different media paths that merely share a host', () => {
  const result = dedupeMediaDetailed([
    { url: 'https://cdn.test/a.jpg?w=300', type: 'image', width: 300, height: 300 },
    { url: 'https://cdn.test/b.jpg?w=1200', type: 'image', width: 1200, height: 1200 },
  ]);
  assert.equal(result.items.length, 2);
  assert.equal(result.duplicateCount, 0);
});
