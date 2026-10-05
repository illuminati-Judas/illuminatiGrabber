const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('macOS installer installs only runtime files and the stable native host origin', () => {
  const installerPath = path.join(root, 'installer', 'install.command');
  assert.equal(fs.existsSync(installerPath), true, 'install.command must exist');
  const installer = fs.readFileSync(installerPath, 'utf8');
  assert.match(installer, /com\.june\.web_media_grabber/);
  assert.match(installer, /EXTENSION_ID="kfdepjgimomjpdcamlkckoagnikohfkm"/);
  assert.match(installer, /chrome-extension:\/\/\$EXTENSION_ID\//);
  assert.match(installer, /NativeMessagingHosts/);
  assert.match(installer, /native_host\/host\.py/);
  assert.match(installer, /assets\/brand-logo\.png/);
  assert.match(installer, /assets\/loader\.svg/);
  assert.match(installer, /assets\/icons/);
  assert.doesNotMatch(installer, /installer\/keys/);
});

test('installer verifies the native host after writing it', () => {
  const installer = fs.readFileSync(path.join(root, 'installer', 'install.command'), 'utf8');
  const smoke = fs.readFileSync(path.join(root, 'installer', 'native-host-smoke.py'), 'utf8');
  assert.match(smoke, /check_dependencies/);
  assert.match(installer, /native-host-smoke\.py/);
});
