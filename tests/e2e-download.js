const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const url = process.env.WMG_X_TEST_URL || 'https://x.com/historyinmemes/status/1790637656616943991';

(async () => {
  const extensionPath = path.join(os.homedir(), 'Library/Application Support/WebMediaGrabber/extension');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmg-download-e2e-'));
  const nativeManifest = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.june.web_media_grabber.json');
  const profileHosts = path.join(userDataDir, 'NativeMessagingHosts');
  fs.mkdirSync(profileHosts, { recursive: true });
  fs.copyFileSync(nativeManifest, path.join(profileHosts, 'com.june.web_media_grabber.json'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
  });

  try {
    let worker = context.serviceWorkers().find((candidate) => candidate.url().includes('/background/service-worker.js'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extensionId = new URL(worker.url()).hostname;
    const result = await worker.evaluate(({ targetUrl }) => new Promise((resolve) => {
      chrome.runtime.sendNativeMessage('com.june.web_media_grabber', { command: 'download_x', url: targetUrl }, (response) => {
        resolve({ response, error: chrome.runtime.lastError?.message || null });
      });
    }), { targetUrl: url });

    if (result.error || !result.response?.ok) throw new Error(JSON.stringify(result));
    const files = fs.readdirSync(result.response.output_dir).filter((name) => !name.startsWith('.'));
    if (!files.length) throw new Error(`No downloaded files in ${result.response.output_dir}`);
    console.log(JSON.stringify({ extensionId, url, response: result.response, files }, null, 2));
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
