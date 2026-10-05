const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requiredFiles = [
  'manifest.json',
  'assets/brand-logo.png',
  'assets/loader.svg',
  'assets/icons/icon16.png',
  'assets/icons/icon32.png',
  'assets/icons/icon48.png',
  'assets/icons/icon128.png',
  'src/scanner.js',
  'src/gallery-model.js',
  'src/downloads.js',
  'src/download-jobs.js',
  'src/media-preview.js',
  'src/diagnostics.js',
  'src/site-adapters.js',
  'src/telegram-page-download.js',
  'src/telegram-inpage.js',
  'content/content.js',
  'background/service-worker.js',
  'popup/popup.html',
  'popup/popup.css',
  'popup/popup.js',
  'README.md',
  'DESIGN.md',
  'DESIGN-X-TELEGRAM.md',
  'native_host/core.py',
  'native_host/host.py',
];

const errors = [];
if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.background?.service_worker !== 'background/service-worker.js') errors.push('background service worker path is incorrect');
if (manifest.action?.default_popup !== 'popup/popup.html') errors.push('popup path is incorrect');
if (!manifest.key) errors.push('stable extension key must be present');

const expectedPermissions = ['activeTab', 'downloads', 'nativeMessaging', 'scripting', 'storage'];
const actualPermissions = [...(manifest.permissions || [])].sort();
if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions.sort())) {
  errors.push(`unexpected permissions: ${actualPermissions.join(', ')}`);
}
if (JSON.stringify(manifest.optional_permissions || []) !== JSON.stringify(['downloads.open'])) {
  errors.push('downloads.open must remain an optional permission');
}

const expectedHosts = [
  'https://pbs.twimg.com/*',
  'https://twitter.com/*',
  'https://video.twimg.com/*',
  'https://web.telegram.org/*',
  'https://x.com/*',
];
const actualHosts = [...(manifest.host_permissions || [])].sort();
if (JSON.stringify(actualHosts) !== JSON.stringify(expectedHosts.sort())) {
  errors.push(`unexpected host permissions: ${actualHosts.join(', ')}`);
}

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) errors.push(`missing ${relative}`);
}

const scripts = requiredFiles.filter((file) => file.endsWith('.js'));
for (const script of scripts) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, script)], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`syntax error in ${script}: ${error.stderr?.toString() || error.message}`);
  }
}

const source = scripts.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
if (/\beval\s*\(/.test(source)) errors.push('eval() is not allowed');
if (/\.innerHTML\s*=/.test(source)) errors.push('innerHTML assignment is not allowed for page-provided data safety');

if (errors.length) {
  console.error(errors.map((error) => `ERROR: ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Manifest MV3 valid; ${requiredFiles.length} required files present; ${scripts.length} scripts syntax-clean; minimum permissions confirmed.`);
