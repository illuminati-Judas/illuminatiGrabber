const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmg-telegram-image-e2e-'));
  const payload = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
  });

  try {
    const page = await context.newPage();
    await page.route('https://web.telegram.org/a/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <script>window.__wmgTelegramInPage = true;</script>
        <header class="MiddleHeader"><div class="ChatInfo"><h3 class="fullName">Security Research Thailand</h3><span class="group-status">1,234 members</span></div></header>
        <div id="MediaViewer" style="display:block;width:900px;height:700px">
          <div class="MediaViewerSlides"><div class="MediaViewerSlide is-active">
            <div class="MediaViewerContent"><div><video style="display:none"></video><img src="/a/full-image.jpg" style="width:600px;height:640px"></div></div>
          </div></div>
          <div class="MediaViewerActions"></div>
        </div>
      </body></html>`,
    }));
    await page.route('https://web.telegram.org/a/full-image.jpg', (route) => route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      body: payload,
    }));

    await page.goto('https://web.telegram.org/a/#-1001234567890');
    let worker = context.serviceWorkers().find((candidate) => candidate.url().includes('/background/service-worker.js'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    await page.locator('html[data-wmg-telegram-media="image"]').waitFor({ state: 'attached', timeout: 15_000 });
    const viewerButton = page.locator('.wmg-tg-current-download-button');
    await viewerButton.waitFor({ state: 'visible', timeout: 15_000 });
    if (await viewerButton.textContent() !== 'Download Photo') {
      throw new Error(`Unexpected viewer button label: ${await viewerButton.textContent()}`);
    }
    const buttonStyle = await viewerButton.evaluate((element) => getComputedStyle(element).backgroundColor);
    if (buttonStyle === 'rgb(255, 255, 0)') throw new Error('Viewer button must not use the old yellow style');
    if (await page.locator('.wmg-tg-download, .wmg-tg-inline-download, .wmg-tg-current-download-control').count()) {
      throw new Error('Legacy Telegram page controls must not be injected');
    }
    const scan = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return inspectTelegramCurrent(tab.id);
    });
    if (!scan?.mediaReady || scan?.mediaType !== 'image') {
      throw new Error(`Popup did not target the current Telegram image: ${JSON.stringify(scan)}`);
    }
    const diagnosticState = await worker.evaluate(() => chrome.storage.local.get({ diagnosticLog: [] }));
    const inspectLog = diagnosticState.diagnosticLog.find((entry) => entry.event === 'telegram-inspect' && entry.details?.mediaType === 'image');
    if (!inspectLog) throw new Error(`Telegram inspection was not stored in extension diagnostics: ${JSON.stringify(diagnosticState)}`);

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    const queued = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return queueSmartDownload({ kind: 'telegram', tabId: tab.id });
    });
    if (!queued?.ok || queued.queued !== 1 || queued.jobIds?.length !== 1) {
      throw new Error(`Popup queue did not accept current Telegram image: ${JSON.stringify(queued)}`);
    }
    const download = await downloadPromise;
    const savedPath = path.join(userDataDir, await download.suggestedFilename());
    await download.saveAs(savedPath);
    const actual = fs.readFileSync(savedPath);
    if (!actual.equals(payload)) throw new Error(`Image download mismatch: ${actual.toString()}`);
    const history = await worker.evaluate(async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const state = await chrome.storage.local.get({ downloadHistory: [] });
        if (state.downloadHistory.length) return state.downloadHistory;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return [];
    });
    const latest = history.at(-1);
    if (latest?.filename !== 'full-image.jpg' || latest?.type !== 'image' || latest?.bytes !== payload.length
      || latest?.sourceName !== 'Security Research Thailand'
      || !latest?.previewDataUrl?.startsWith('data:image/') || !Number.isInteger(latest?.downloadId)) {
      const chromeDownloads = await worker.evaluate(() => chrome.downloads.search({ orderBy: ['-startTime'], limit: 20 }));
      throw new Error(`Completed download was not stored correctly: ${JSON.stringify(history)} downloads=${JSON.stringify(chromeDownloads)}`);
    }
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    const recentText = await popup.locator('#downloadHistory').innerText({ timeout: 10_000 });
    if (!recentText.includes('full-image.jpg') || !recentText.includes('Photo') || !recentText.includes('Completed')
      || !recentText.includes('Telegram · Security Research Thailand')) {
      throw new Error(`Popup did not show completed download: ${recentText}`);
    }
    const thumbnail = popup.locator('.history-thumbnail img');
    await thumbnail.waitFor({ state: 'visible', timeout: 10_000 });
    await thumbnail.click();
    await popup.locator('#previewModal:not([hidden]) img[src^="data:image/"]').waitFor({ state: 'visible', timeout: 10_000 });
    const openButton = popup.getByRole('button', { name: 'Open full-image.jpg' });
    if (!await openButton.isEnabled()) throw new Error('Open downloaded file action is not enabled');
    const badgeText = await worker.evaluate(() => chrome.action.getBadgeText({}));
    if (badgeText !== '') throw new Error(`Badge was not cleared when popup opened: ${badgeText}`);
    await popup.close();
    console.log(JSON.stringify({ trigger: 'popup-queue', media: 'image', filename: await download.suggestedFilename(), bytes: actual.length, historyVerified: true, popupVerified: true, contentVerified: true }, null, 2));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
