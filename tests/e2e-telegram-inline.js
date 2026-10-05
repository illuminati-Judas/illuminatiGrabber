const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmg-telegram-inline-e2e-'));
  const payload = Buffer.from('telegram-inline-range-e2e');
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
      body: `<!doctype html><html><body>
        <div class="bubble" style="position:relative;width:360px;height:240px">
          <video style="width:340px;height:220px"></video>
        </div>
        <div class="bubble" style="position:absolute;top:-500px;width:360px;height:240px">
          <video style="width:340px;height:220px"></video>
        </div>
        <script>
          const metadata = encodeURIComponent(JSON.stringify({ fileName: 'telegram-inline.mp4' }));
          document.querySelector('video').src = '/k/stream/' + metadata;
        </script>
      </body></html>`,
    }));
    await page.route('https://web.telegram.org/k/stream/**', async (route) => {
      const range = route.request().headers().range || 'bytes=0-';
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] || 0);
      const end = Math.min(start + 6, payload.length - 1);
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

    await page.goto('https://web.telegram.org/k/');
    await page.waitForTimeout(750);
    const visibleButtons = page.locator('.wmg-tg-download, .wmg-tg-inline-download');
    if (await page.locator('.wmg-tg-download, .wmg-tg-inline-download, .wmg-tg-current-download-control').count()) {
      throw new Error('Telegram page controls must not be injected');
    }
    if (await page.locator('html[data-wmg-telegram-media]').count()) {
      throw new Error('Popup target marker must not target an inline or offscreen video without an open viewer');
    }

    console.log(JSON.stringify({
      pageButtons: 0,
      currentViewerControl: 0,
      failClosed: true,
    }, null, 2));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
