const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const extensionPath = process.env.WMG_EXTENSION_PATH || root;
  const scratchRoot = path.join(os.homedir(), '.hermes/cache/scratch');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'illuminati-history-'));
  const output = path.join(scratch, 'downloads');
  fs.mkdirSync(output);
  const profile = path.join(scratch, 'profile');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: output, prompt_for_download: false } }));
  const bytes = fs.readFileSync(path.join(root, 'assets/brand-logo.png'));
  const held = new Set();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/forbidden')) { res.writeHead(403); res.end('forbidden'); return; }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length });
    if (req.url.startsWith('/slow')) { res.write(bytes.subarray(0, 100)); held.add(res); res.on('close', () => held.delete(res)); }
    else res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const context = await chromium.launchPersistentContext(profile, {
    headless: false, acceptDownloads: true, downloadsPath: output,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const popup = await context.newPage();
    const pageErrors = [];
    popup.on('pageerror', (error) => pageErrors.push(error.message));
    await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup/popup.html`);
    await popup.waitForSelector('#buildId:not(:has-text("loading"))');
    assert.equal(await popup.locator('#buildId').textContent(), require('../src/diagnostics.js').BUILD_ID);
    const submit = async (urls) => worker.evaluate((items) => downloadMedia({ items: items.map((url) => ({ url, type: 'image' })) }), urls);
    await submit([`${base}/good.png?secret=must-not-be-stored`]);
    await popup.waitForFunction(async () => (await chrome.runtime.sendMessage({ action: 'download-history-get' })).downloadHistory.some((r) => r.source === 'generic'));
    await popup.reload();
    await popup.waitForSelector('.history-source');
    assert.equal(await popup.locator('.history-source').first().textContent(), 'Web media');
    const state = await worker.evaluate(() => chrome.storage.local.get(null));
    const record = state.downloadHistory[0];
    assert.equal(record.bytes, bytes.length);
    assert.ok(!JSON.stringify(state.downloadHistory).includes('secret'));
    const item = await worker.evaluate(async (id) => (await chrome.downloads.search({ id }))[0], record.downloadId);
    assert.deepEqual(fs.readFileSync(item.filename), bytes);
    await submit([`${base}/slow-a.png`, `${base}/slow-b.png`, `${base}/slow-c.png`]);
    await popup.reload();
    await popup.waitForSelector('.download-job.waiting');
    await popup.getByRole('button', { name: 'Clear finished', exact: true }).click();
    await popup.waitForFunction(() => document.querySelectorAll('.download-job').length === 3 && !document.querySelector('.download-job.completed'));
    const cleared = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.equal(cleared.downloadHistory.length, 0);
    assert.equal(cleared.directDownloadQueueV1.jobs.filter((j) => j.status === 'downloading').length, 2);
    assert.equal(cleared.directDownloadQueueV1.jobs.filter((j) => j.status === 'waiting').length, 1);
    assert.deepEqual(fs.readFileSync(item.filename), bytes);
    for (const response of [...held]) response.end(bytes.subarray(100));
    await popup.waitForFunction(() => document.querySelectorAll('.download-job.completed').length >= 2);
    for (const response of [...held]) response.end(bytes.subarray(100));
    await popup.waitForFunction(() => document.querySelectorAll('.download-job.completed').length === 3);
    await submit([`${base}/forbidden.png`]);
    await popup.waitForFunction(() => document.querySelector('.download-job.failed'));
    assert.match(await popup.locator('.download-job.failed').textContent(), /scan/i);
    assert.equal(await popup.locator('.download-job.failed button').textContent(), 'Scan again');
    const before = await worker.evaluate(() => chrome.downloads.search({}));
    await popup.screenshot({ path: path.join(scratch, 'download-history.png') });
    await popup.locator('.download-job.failed button').click();
    await popup.waitForTimeout(150);
    assert.deepEqual(pageErrors, []);
    assert.equal((await worker.evaluate(() => chrome.downloads.search({}))).length, before.length);
    console.log(JSON.stringify({ result: 'PASS', extensionId: new URL(worker.url()).hostname, byteVerified: bytes.length, activeAndWaitingPreserved: 3, filePreservedAfterClear: true, forbiddenFreshScan: true, scratch }, null, 2));
  } finally {
    for (const response of held) response.destroy();
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
