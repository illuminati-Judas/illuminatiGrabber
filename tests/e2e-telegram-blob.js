const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmg-telegram-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
    ],
  });

  try {
    let worker = context.serviceWorkers().find((candidate) => candidate.url().includes('/background/service-worker.js'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });

    const page = await context.newPage();
    await page.route('https://web.telegram.org/k/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <div class="bubble" style="width:320px;height:220px">
          <video controls style="width:300px;height:200px"></video>
        </div>
        <script>
          const bytes = new TextEncoder().encode('telegram-blob-e2e');
          document.querySelector('video').src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        </script>
      </body></html>`,
    }));
    await page.goto('https://web.telegram.org/k/');
    await page.waitForSelector('video');
    await page.waitForTimeout(500);
    await page.click('video');
    await page.waitForFunction(() => document.querySelector('video')?.getAttribute('data-wmg-current-media') === 'true');

    const scan = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { action: 'scan-page' });
    });
    if (scan?.smartTarget?.mode !== 'unsupported' || scan?.items?.length !== 0) {
      throw new Error(`Telegram popup must not offer guessed blob media, got ${JSON.stringify(scan)}`);
    }

    const telegramTabId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab.id;
    });
    const extensionId = new URL(worker.url()).hostname;
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 }).catch((error) => ({ error }));
    const result = await extensionPage.evaluate(
      (tabId) => chrome.runtime.sendMessage({ action: 'telegram-page-blob-download', tabId }),
      telegramTabId,
    );
    if (!result?.ok || result.status !== 'triggered') {
      throw new Error(`Blob download failed: ${JSON.stringify(result)}`);
    }
    const download = await downloadPromise;
    if (download?.error) throw download.error;
    const savedPath = path.join(userDataDir, await download.suggestedFilename());
    await download.saveAs(savedPath);
    const contents = fs.readFileSync(savedPath, 'utf8');
    if (contents !== 'telegram-blob-e2e') throw new Error(`Unexpected downloaded contents: ${contents}`);

    console.log(JSON.stringify({
      extensionId: new URL(worker.url()).hostname,
      smartMode: scan.smartTarget.mode,
      result,
      suggestedFilename: await download.suggestedFilename(),
      downloadedBytes: fs.statSync(savedPath).size,
    }, null, 2));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
