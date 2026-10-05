const test = require('node:test');
const assert = require('node:assert/strict');

const { BUILD_ID, MAX_ENTRIES, normalizeEntry, appendEntry } = require('../src/diagnostics.js');

test('diagnostics retain only bounded sanitized scalar data', () => {
  const entry = normalizeEntry({
    source: 'content',
    event: 'scan\ntelegram',
    details: {
      mediaType: 'video\nsecret',
      ready: true,
      count: 2,
      nested: { token: 'must-not-be-stored' },
    },
  }, '2026-09-27T00:00:00.000Z');

  assert.equal(entry.build, BUILD_ID);
  assert.equal(entry.event, 'scan telegram');
  assert.deepEqual(entry.details, { mediaType: 'video secret', ready: true, count: 2 });
});

test('diagnostics keep only the newest bounded history', () => {
  let entries = [];
  for (let index = 0; index < MAX_ENTRIES + 5; index += 1) {
    entries = appendEntry(entries, { source: 'popup', event: `event-${index}` }, `time-${index}`);
  }
  assert.equal(entries.length, MAX_ENTRIES);
  assert.equal(entries[0].event, 'event-5');
  assert.equal(entries.at(-1).event, `event-${MAX_ENTRIES + 4}`);
});
