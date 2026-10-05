const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  sanitizeSegment,
  filenameFromUrl,
  buildDownloadPath,
} = require('../src/downloads.js');

test('sanitizes unsafe path characters and reserved dot names', () => {
  assert.equal(sanitizeSegment('bad:name/with\\chars?'), 'bad-name-with-chars-');
  assert.equal(sanitizeSegment('..'), 'untitled');
});

test('derives a decoded filename and removes query strings', () => {
  assert.equal(filenameFromUrl('https://cdn.example.com/media/My%20Photo.jpg?token=abc', 'image', 3), 'My Photo.jpg');
});

test('adds a useful extension when a media URL has no extension', () => {
  assert.equal(filenameFromUrl('https://cdn.example.com/media/asset', 'video', 7), 'asset-7.mp4');
});

test('builds a safe domain and media-type download path', () => {
  assert.equal(
    buildDownloadPath('My Downloads', 'https://news.example.com/a/photo.jpg', 'image', 1),
    'My Downloads/news.example.com/images/photo.jpg',
  );
});

test('background honors the stable gallery index used by the pre-save path', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
  assert.match(worker, /Number\.isInteger\(item\.downloadIndex\)/);
  assert.match(worker, /buildDownloadPath\(rootFolder, item\.url, item\.type, downloadIndex\)/);
});

test('Telegram bridge relays only an opaque record ID for Show in Finder', () => {
  const content = fs.readFileSync(path.join(__dirname, '../content/telegram-result-bridge.js'), 'utf8');
  assert.match(content, /wmg-telegram-download-recorded/);
  assert.match(content, /wmg-telegram-show-download-request/);
  assert.match(content, /action:\s*['"]telegram-show-download['"]/);
  assert.doesNotMatch(content, /wmg-telegram-show-download-request[\s\S]{0,300}(?:path|downloadId|url)\s*:/);
});

test('an unassociated completed viewer download cannot start a duplicate download', () => {
  const inPage = fs.readFileSync(path.join(__dirname, '../src/telegram-inpage.js'), 'utf8');
  assert.match(inPage, /wmgMode === 'complete'/);
  assert.match(inPage, /dataset\.wmgMode = 'complete'/);
  assert.match(inPage, /pendingDownloadResults/);
  assert.match(inPage, /setTimeout\(retry, 1000\)/);
  assert.match(inPage, /pendingDownloadResults\.delete\(recordId\)/);
  assert.match(inPage, /querySelector\('\.wmg-tg-current-download-button'\)\?\.remove\(\)/);
});

test('Telegram bridge reinjection replaces stale isolated-world listeners after extension reload', () => {
  const content = fs.readFileSync(path.join(__dirname, '../content/telegram-result-bridge.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
  assert.match(content, /__wmgTelegramResultBridgeVersion/);
  assert.doesNotMatch(content, /__wmgTelegramResultBridgeVersion\s*===\s*BRIDGE_VERSION\)\s*return/);
  assert.match(content, /removeEventListener\('wmg-telegram-download-result'/);
  assert.match(content, /removeEventListener\('wmg-telegram-show-download-request'/);
  assert.match(worker, /world:\s*'ISOLATED'[\s\S]{0,160}files:\s*\['content\/telegram-result-bridge\.js'\]/);
});

test('completed Chrome-tracked Telegram downloads are persisted even when the page relay is unavailable', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
  assert.match(worker, /recordCompletedTelegramChromeDownload/);
  assert.match(worker, /telegram-\(video\|image\)-\\d\+/);
  assert.match(worker, /delta\.state\?\.current === 'complete'/);
  assert.match(worker, /entry\.downloadId === record\.downloadId/);
});

test('clearing Recent Downloads suppresses delayed retries for already completed media', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
  assert.match(worker, /downloadHistoryClearedAt/);
  assert.match(worker, /const clearedAt = Date\.parse\(state\.downloadHistoryClearedAt\)/);
  assert.match(worker, /const completedAt = Date\.parse\(record\.completedAt\)/);
  assert.match(worker, /completedAt <= clearedAt/);
  assert.match(worker, /ignored:\s*true/);
  assert.match(worker, /downloadHistory:\s*\[\],[\s\S]{0,120}downloadHistoryClearedAt/);
});

test('successful native X downloads enter Recent Downloads and open by opaque job ID', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
  const popup = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  assert.match(worker, /source:\s*'x'/);
  assert.match(worker, /nativeJobId:\s*job\.id/);
  assert.match(worker, /command:\s*'open_output'/);
  assert.match(popup, /record\.nativeJobId/);
  assert.match(popup, /record\.source === 'x'/);
});
