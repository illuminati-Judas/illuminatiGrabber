const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'illuminati-theme-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 430, height: 650 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const extensionId = 'kfdepjgimomjpdcamlkckoagnikohfkm';
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await page.waitForSelector('#buildId:not(:has-text("loading"))');
    const result = await page.evaluate(() => ({
      title: document.title,
      heading: document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim(),
      build: document.querySelector('#buildId')?.textContent,
      crimson: getComputedStyle(document.documentElement).getPropertyValue('--crimson').trim(),
      logoLoaded: document.querySelector('.brand-mark')?.naturalWidth > 0,
      loaderLoaded: document.querySelector('#activityLoader')?.naturalWidth > 0,
      width: document.body.getBoundingClientRect().width,
    }));
    assert.deepEqual(result, {
      title: 'illuminati Grabber',
      heading: 'illuminati Grabber',
      build: require('../src/diagnostics.js').BUILD_ID,
      crimson: '#c91f3b',
      logoLoaded: true,
      loaderLoaded: true,
      width: 430,
    });
    await page.locator('#filterPanel summary').click();
    assert.equal(await page.locator('#filterPanel').evaluate((node) => node.open), true);
    await page.locator('#thumbnailSize').selectOption('large');
    await page.waitForFunction(() => document.body.dataset.thumbnailSize === 'large');
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('thumbnailSize')).thumbnailSize), 'large');
    await page.reload();
    await page.waitForSelector('#buildId:not(:has-text("loading"))');
    await page.waitForFunction(() => document.body.dataset.thumbnailSize === 'large');
    assert.equal(await page.locator('#thumbnailSize').inputValue(), 'large');
    assert.equal(await page.locator('#filterPanel').evaluate((node) => node.open), false);
    await page.locator('#filterPanel summary').click();
    const filterScreenshot = '/tmp/illuminati-grabber-filter-panel-e2e.png';
    await page.screenshot({ path: filterScreenshot });
    await page.locator('#filterPanel summary').click();
    await page.evaluate(() => {
      document.body.classList.add('has-results');
      document.querySelector('#gallery').innerHTML = '<article class="card"><div class="preview"><img src="../assets/brand-logo.png"></div><div class="meta"><strong class="filename">brand-logo.png</strong><span class="media-specs">128 × 128 · PNG · Estimated 18.2 KB</span><span class="media-origin">local extension · img</span><span class="save-path">Save as WebMedia/local/images/brand-logo.png</span></div></article>'.repeat(8);
    });
    const collapsedHeight = await page.locator('#gallery').evaluate((node) => node.getBoundingClientRect().height);
    await page.locator('#expandGallery').click();
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      document.querySelector('#gallery').innerHTML = '<article class="card"><div class="preview"><img src="../assets/brand-logo.png"></div><div class="meta"><strong class="filename">brand-logo.png</strong><span class="media-specs">128 × 128 · PNG · Estimated 18.2 KB</span><span class="media-origin">local extension · img</span><span class="save-path">Save as WebMedia/local/images/brand-logo.png</span></div></article>'.repeat(8);
    });
    const expanded = await page.evaluate(() => ({
      active: document.body.classList.contains('gallery-expanded'),
      height: document.querySelector('#gallery').getBoundingClientRect().height,
      fit: getComputedStyle(document.querySelector('.preview img')).objectFit,
      thumbnailHeight: Math.round(document.querySelector('.preview').getBoundingClientRect().height),
      label: document.querySelector('#expandGallery').textContent.trim(),
      actionBarDisplay: getComputedStyle(document.querySelector('#expandedActionBar')).display,
      actionBarBottom: Math.round(document.querySelector('#expandedActionBar').getBoundingClientRect().bottom),
      mainBottom: Math.round(document.querySelector('main').getBoundingClientRect().bottom),
    }));
    assert.equal(expanded.active, true);
    assert.ok(expanded.height > collapsedHeight + 180, `${expanded.height} should greatly exceed ${collapsedHeight}`);
    assert.ok(expanded.height >= 480, `expanded gallery height was only ${expanded.height}`);
    assert.equal(expanded.fit, 'contain');
    assert.equal(expanded.thumbnailHeight, 180);
    assert.equal(expanded.label, 'Exit expanded');
    assert.equal(expanded.actionBarDisplay, 'flex');
    assert.ok(Math.abs(expanded.actionBarBottom - expanded.mainBottom) <= 12);
    const expandedScreenshot = '/tmp/illuminati-grabber-expanded-actions-e2e.png';
    await page.screenshot({ path: expandedScreenshot });

    await page.evaluate(() => {
      const modal = document.querySelector('#previewModal');
      document.querySelector('#previewImage').src = '../assets/brand-logo.png';
      document.querySelector('#previewCaption').textContent = 'Preview fixture';
      modal.hidden = false;
    });
    await page.locator('#previewZoomIn').click();
    const preview = await page.evaluate(() => {
      const card = document.querySelector('.preview-modal-card').getBoundingClientRect();
      return {
        width: Math.round(card.width),
        height: Math.round(card.height),
        zoom: document.querySelector('#previewZoomReset').textContent.trim(),
        transform: getComputedStyle(document.querySelector('#previewImage')).transform,
      };
    });
    assert.ok(preview.width >= 400, `preview width was only ${preview.width}`);
    assert.ok(preview.height >= 560, `preview height was only ${preview.height}`);
    assert.equal(preview.zoom, '125%');
    assert.notEqual(preview.transform, 'none');
    const screenshot = '/tmp/illuminati-grabber-popup-e2e.png';
    await page.screenshot({ path: screenshot });
    console.log(JSON.stringify({ extensionId, screenshot, filterScreenshot, ...result }, null, 2));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
