const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('uses illuminati Grabber branding and complete extension icon set', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, 'illuminati Grabber');
  assert.equal(manifest.action.default_title, 'illuminati Grabber');
  assert.equal(manifest.permissions.includes('downloads.open'), false);
  assert.deepEqual(manifest.optional_permissions, ['downloads.open']);
  assert.deepEqual(manifest.icons, {
    16: 'assets/icons/icon16.png',
    32: 'assets/icons/icon32.png',
    48: 'assets/icons/icon48.png',
    128: 'assets/icons/icon128.png',
  });
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  for (const file of Object.values(manifest.icons)) {
    assert.ok(fs.statSync(path.join(root, file)).size > 0, `${file} must exist`);
  }
});

test('popup uses the supplied logo, triangle loader, and crimson theme', () => {
  const html = read('popup/popup.html');
  const css = read('popup/popup.css');
  const js = read('popup/popup.js');
  assert.match(html, /<title>illuminati Grabber<\/title>/);
  assert.match(html, /assets\/brand-logo\.png/);
  assert.match(html, /assets\/loader\.svg/);
  assert.match(css, /--crimson:\s*#c91f3b/i);
  assert.match(css, /\.is-loading/);
  assert.match(js, /setLoadingState/);
  assert.ok(fs.statSync(path.join(root, 'assets/brand-logo.png')).size > 0);
  assert.ok(fs.statSync(path.join(root, 'assets/loader.svg')).size > 0);
});

test('Telegram viewer control follows the crimson theme', () => {
  const source = read('src/telegram-inpage.js');
  assert.match(source, /border:1px solid #c91f3b/i);
  assert.doesNotMatch(source, /#5ce1e6/i);
});
