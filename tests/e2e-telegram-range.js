const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmg-telegram-range-e2e-'));
  const payload = Buffer.from('telegram-range-e2e-video');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
  });

  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      try { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); } catch {}
    });
    await page.route('https://web.telegram.org/k/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <header class="sidebar-header topbar"><div class="chat-info"><div class="user-title"><span class="peer-title" data-peer-id="-1009876543210">Incident Response Community</span></div></div></header>
        <div class="media-viewer-whole" style="display:block;width:800px;height:600px">
          <div class="media-viewer-movers"><div class="media-viewer-aspecter">
            <div class="ckin__player"><video style="width:640px;height:360px"></video></div>
          </div></div>
          <div class="media-viewer-topbar"><div class="media-viewer-buttons">
            <button id="telegramOfficialDownload" aria-label="Download" onclick="window.__officialClicks = (window.__officialClicks || 0) + 1">Official download</button>
          </div></div>
        </div>
        <script>
          const metadata = encodeURIComponent(JSON.stringify({ fileName: 'telegram-e2e.mp4' }));
          document.querySelector('video').src = '/k/stream/' + metadata;
        </script>
      </body></html>`,
    }));
    await page.route('https://web.telegram.org/k/stream/**', async (route) => {
      const range = route.request().headers().range || 'bytes=0-';
      const match = /bytes=(\d+)-/.exec(range);
      const start = Number(match?.[1] || 0);
      const end = Math.min(start + 5, payload.length - 1);
      const body = payload.subarray(start, end + 1);
      await route.fulfill({
        status: 206,
        body,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${payload.length}`,
          'Content-Length': String(body.length),
          'Accept-Ranges': 'bytes',
        },
      });
    });

    await page.goto('https://web.telegram.org/k/#-1009876543210');
    let worker = context.serviceWorkers().find((candidate) => candidate.url().includes('/background/service-worker.js'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    await page.locator('html[data-wmg-telegram-media="video"]').waitFor({ state: 'attached', timeout: 15_000 });
    const viewerButton = page.locator('.wmg-tg-current-download-button');
    await viewerButton.waitFor({ state: 'visible', timeout: 15_000 });
    if (await viewerButton.textContent() !== 'Download Video') {
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
    if (!scan?.mediaReady || scan?.mediaType !== 'video') {
      throw new Error(`Popup did not target current Telegram video: ${JSON.stringify(scan)}`);
    }
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: () => {
          globalThis.__wmgTelegramResultBridgeCleanup?.();
          delete globalThis.__wmgTelegramResultBridgeCleanup;
          delete globalThis.__wmgTelegramResultBridgeVersion;
        },
      });
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await viewerButton.click();
    const download = await downloadPromise;
    const savedPath = path.join(userDataDir, await download.suggestedFilename());
    await download.saveAs(savedPath);
    const actual = fs.readFileSync(savedPath);
    if (!actual.equals(payload)) throw new Error(`Range download mismatch: ${actual.toString()}`);
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await inspectTelegramCurrent(tab.id);
    });
    const history = await worker.evaluate(async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const state = await chrome.storage.local.get({ downloadHistory: [] });
        if (state.downloadHistory.length) return state.downloadHistory;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return [];
    });
    const latest = history.at(-1);
    if (latest?.filename !== 'telegram-e2e.mp4' || latest?.type !== 'video' || latest?.bytes !== payload.length
      || latest?.sourceName !== 'Incident Response Community' || !Number.isInteger(latest?.downloadId)) {
      throw new Error(`Completed video was not stored correctly: ${JSON.stringify(history)}`);
    }
    const officialClicks = await page.evaluate(() => window.__officialClicks || 0);
    if (officialClicks !== 0) {
      throw new Error('Popup download used an unconfirmed Telegram UI handoff');
    }
    await page.locator('video').evaluate((video) => {
      const metadata = encodeURIComponent(JSON.stringify({ fileName: 'next-media.mp4' }));
      video.src = `/k/stream/${metadata}`;
    });
    await viewerButton.filter({ hasText: 'Download Video' }).waitFor({ state: 'visible', timeout: 10_000 });
    if (await viewerButton.getAttribute('data-wmg-record-id')) {
      throw new Error('Finder state leaked into the next Media Viewer item');
    }

    console.log(JSON.stringify({
      trigger: 'viewer-button',
      media: 'video',
      filename: await download.suggestedFilename(),
      bytes: actual.length,
      historyVerified: true,
      viewerButtonOpenAssociationVerified: true,
      viewerChangeResetVerified: true,
      contentVerified: true,
    }, null, 2));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
