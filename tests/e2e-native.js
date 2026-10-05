const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

(async () => {
  const extensionPath = path.join(os.homedir(), 'Library/Application Support/WebMediaGrabber/extension');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmg-e2e-'));
  const nativeManifest = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.june.web_media_grabber.json');
  const profileHosts = path.join(userDataDir, 'NativeMessagingHosts');
  fs.mkdirSync(profileHosts, { recursive: true });
  fs.copyFileSync(nativeManifest, path.join(profileHosts, 'com.june.web_media_grabber.json'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
    ],
  });

  try {
    let worker = context.serviceWorkers().find((candidate) => candidate.url().includes('/background/service-worker.js'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    if (!worker.url().includes('/background/service-worker.js')) {
      throw new Error(`Unexpected service worker: ${worker.url()}`);
    }
    const extensionId = new URL(worker.url()).hostname;
    const invoke = (command) => worker.evaluate((name) => new Promise((resolve) => {
      chrome.runtime.sendNativeMessage('com.june.web_media_grabber', { command: name }, (response) => {
        resolve({ response, error: chrome.runtime.lastError?.message || null });
      });
    }), command);

    const ping = await invoke('ping');
    const dependencies = await invoke('check_dependencies');
    if (ping.error || !ping.response?.ok || ping.response.status !== 'pong') {
      throw new Error(`Native ping failed for ${extensionId}: ${JSON.stringify(ping)}`);
    }
    if (dependencies.error || !dependencies.response?.ready) {
      throw new Error(`Dependency check failed: ${JSON.stringify(dependencies)}`);
    }
    console.log(JSON.stringify({ extensionId, ping, dependencies }, null, 2));
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
