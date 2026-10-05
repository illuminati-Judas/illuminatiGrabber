const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectSite,
  canonicalXStatusUrl,
  xOriginalImageUrl,
  collectXContext,
  selectTelegramTarget,
  collectTelegramCandidates,
  triggerTelegramDownload,
} = require('../src/site-adapters.js');

test('detects X, Telegram Web, and generic pages', () => {
  assert.equal(detectSite('https://x.com/user/status/123'), 'x');
  assert.equal(detectSite('https://twitter.com/user/status/123'), 'x');
  assert.equal(detectSite('https://web.telegram.org/k/'), 'telegram');
  assert.equal(detectSite('https://example.com/gallery'), 'generic');
});

test('canonicalizes only exact X or Twitter status URLs', () => {
  assert.equal(canonicalXStatusUrl('https://x.com/some_user/status/123456789?s=20#x'), 'https://x.com/some_user/status/123456789');
  assert.equal(canonicalXStatusUrl('https://twitter.com/some.user/status/987/photo/1'), 'https://x.com/some.user/status/987');
  assert.equal(canonicalXStatusUrl('https://x.com/home'), null);
  assert.equal(canonicalXStatusUrl('https://evil.test/user/status/123'), null);
});

test('rewrites pbs.twimg.com image URLs to original quality', () => {
  assert.equal(
    xOriginalImageUrl('https://pbs.twimg.com/media/ABC123?format=jpg&name=small'),
    'https://pbs.twimg.com/media/ABC123?format=jpg&name=orig',
  );
  assert.equal(
    xOriginalImageUrl('https://pbs.twimg.com/media/ABC123.png?name=medium'),
    'https://pbs.twimg.com/media/ABC123.png?name=orig',
  );
  assert.equal(xOriginalImageUrl('https://example.com/photo.jpg'), null);
});

test('X photo route selects only the largest visible viewer image outside the article', () => {
  const image = (src, width, height) => ({
    src, currentSrc: src,
    getBoundingClientRect: () => ({ width, height }),
  });
  const articleImage = image('https://pbs.twimg.com/media/ARTICLE?format=jpg&name=small', 420, 300);
  const viewerImage = image('https://pbs.twimg.com/media/VIEWER?format=jpg&name=large', 1200, 900);
  const unrelatedImage = image('https://pbs.twimg.com/media/OTHER?format=jpg&name=small', 200, 120);
  const article = {
    querySelectorAll: (selector) => selector === 'img[src*="pbs.twimg.com/media"]' ? [articleImage] : [],
    querySelector: () => null,
  };
  const doc = {
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
    querySelectorAll: (selector) => {
      if (selector === 'article') return [article];
      if (selector === 'img[src*="pbs.twimg.com/media"]') return [articleImage, viewerImage, unrelatedImage];
      return [];
    },
  };

  const result = collectXContext(doc, 'https://x.com/person/status/123/photo/1');
  assert.deepEqual(result.images, ['https://pbs.twimg.com/media/VIEWER?format=jpg&name=orig']);
});

test('Telegram chooses direct media from the active viewer before selected messages', () => {
  const result = selectTelegramTarget([
    { scope: 'selected-message', url: 'https://cdn.example/selected.jpg', type: 'image', visible: true },
    { scope: 'active-viewer', url: 'https://cdn.example/current.mp4', type: 'video', visible: true },
  ]);
  assert.deepEqual(result, {
    mode: 'direct',
    url: 'https://cdn.example/current.mp4',
    type: 'video',
    scope: 'active-viewer',
  });
});

test('X returns the duplicate count after choosing original URLs', () => {
  const article = {
    querySelectorAll: (selector) => selector.startsWith('img') ? ['small', 'large'].map((name) => ({ src: `https://pbs.twimg.com/media/A?format=jpg&name=${name}` })) : [],
    querySelector: () => null,
  };
  const result = collectXContext({ querySelectorAll: () => [article] }, 'https://x.com/person/status/123');
  assert.equal(result.images.length, 1);
  assert.equal(result.duplicateCount, 1);
});

test('Telegram uses popup bridge for the current media viewer', () => {
  const result = selectTelegramTarget([
    { scope: 'active-viewer', url: 'blob:https://web.telegram.org/id', type: 'video', visible: true },
  ]);
  assert.deepEqual(result, { mode: 'page-blob', type: 'video', scope: 'active-viewer' });
});

test('Telegram uses the page blob downloader for the clicked current media', () => {
  const result = selectTelegramTarget([
    { scope: 'current-message', url: 'blob:https://web.telegram.org/id', type: 'video', visible: true },
  ]);
  assert.deepEqual(result, { mode: 'page-blob', type: 'video', scope: 'current-message' });
});

function visibleElement({ attrs = {}, selectors = {}, src = '', currentSrc = '', textContent = '' } = {}) {
  return {
    src,
    currentSrc,
    textContent,
    clicked: false,
    getBoundingClientRect: () => ({ width: 640, height: 480 }),
    getAttribute: (name) => attrs[name] || null,
    querySelectorAll: (selector) => selectors[selector] || [],
    click() { this.clicked = true; },
  };
}

test('Telegram Web K prefers the active media viewer over unrelated dialogs', () => {
  const decoy = visibleElement({
    selectors: {
      img: [visibleElement({ src: 'blob:https://web.telegram.org/decoy' })],
      video: [],
      'button, a[role="button"], a[download], [title], [aria-label], .quality-download-options-button-menu': [],
    },
  });
  const download = visibleElement({ attrs: { 'aria-label': 'Download' } });
  const viewer = visibleElement({
    selectors: {
      img: [],
      video: [visibleElement({ src: 'blob:https://web.telegram.org/current' })],
      'button, a[role="button"], a[download], [title], [aria-label], .quality-download-options-button-menu': [download],
    },
  });
  const doc = {
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
    querySelectorAll: (selector) => {
      if (selector === '[role="dialog"]') return [decoy];
      if (selector === '.media-viewer-whole.active') return [viewer];
      return [];
    },
  };

  const result = selectTelegramTarget(collectTelegramCandidates(doc));
  assert.deepEqual(result, { mode: 'page-blob', type: 'video', scope: 'active-viewer' });
});

test('Telegram Web A recognizes dialog#MediaViewer and its download anchor', () => {
  const download = visibleElement({ attrs: { download: 'photo.jpg' } });
  const viewer = visibleElement({
    selectors: {
      img: [visibleElement({ src: 'blob:https://web.telegram.org/current-photo' })],
      video: [],
      'button, a[role="button"], a[download], [title], [aria-label], .quality-download-options-button-menu': [download],
    },
  });
  const doc = {
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
    querySelectorAll: (selector) => selector === 'dialog#MediaViewer[open]' ? [viewer] : [],
  };

  assert.equal(triggerTelegramDownload(doc), true);
  assert.equal(download.clicked, true);
});
