const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../popup/popup.css'), 'utf8');

test('gallery rows keep their content height instead of compressing large result sets', () => {
  const galleryRule = css.match(/\.gallery\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(galleryRule, /grid-auto-rows\s*:\s*max-content/);
  assert.match(galleryRule, /align-content\s*:\s*start/);
});

test('preview thumbnails show the whole image instead of cropping it', () => {
  const previewRule = css.match(/\.preview\s+img\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(previewRule, /object-fit\s*:\s*contain/);
});

test('results reclaim empty history space and offer an expanded gallery mode', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  assert.match(html, /id="expandGallery"/);
  assert.match(css, /body\.has-results\s+\.history-panel\.is-empty\s*\{\s*display:\s*none/);
  assert.match(css, /body\.gallery-expanded\s+\.gallery/);
  assert.match(js, /classList\.toggle\('gallery-expanded'/);
});

test('gallery images open a navigable zoom preview while selection stays on checkboxes', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  for (const id of ['previewPrevious', 'previewNext', 'previewZoomOut', 'previewZoomIn', 'previewZoomReset', 'previewDetails']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(js, /preview\.addEventListener\('click',[\s\S]*showGalleryPreview/);
  assert.doesNotMatch(js, /card\.addEventListener\('click',\s*toggle\)/);
  assert.match(js, /event\.key === 'ArrowLeft'/);
  assert.match(js, /event\.key === 'ArrowRight'/);
});

test('expanded mode keeps selection and download actions in a sticky bar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  for (const id of ['expandedActionBar', 'expandedSelectionCount', 'expandedSelectVisible', 'expandedDownload', 'expandedExit']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /body\.gallery-expanded\s+\.expanded-actionbar\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.expanded-actionbar\s*\{[^}]*position:\s*sticky/);
  assert.match(js, /expandedDownload\.addEventListener\('click',\s*downloadSelected\)/);
});

test('quality controls and windowed gallery rendering are wired into the popup', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  for (const id of ['hideSmall', 'originalOnly', 'sortMedia', 'filteredCount']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /src="\.\.\/src\/gallery-model\.js"/);
  assert.match(js, /computeVirtualRange/);
  assert.match(js, /virtual-spacer/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(css, /\.badge\.original/);
  assert.match(css, /\.badge\.thumbnail/);
  assert.match(css, /\.badge\.low-res/);
});

test('full preview controls remain aligned and inside a compact responsive card', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const cardRule = css.match(/\.preview-modal-card\s*\{([^}]+)\}/)?.[1] || '';
  const stageRule = css.match(/\.preview-stage\s*\{([^}]+)\}/)?.[1] || '';
  const navRule = css.match(/\.preview-nav\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(cardRule, /box-sizing\s*:\s*border-box/);
  assert.match(cardRule, /100dvh/);
  assert.match(cardRule, /grid-template-rows\s*:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.doesNotMatch(stageRule, /grid-template-columns/);
  assert.match(stageRule, /position\s*:\s*relative/);
  assert.match(navRule, /position\s*:\s*absolute/);
  assert.match(navRule, /top\s*:\s*50%/);
  assert.match(html, /preview-modal-heading[\s\S]*preview-zoom-controls[\s\S]*closePreview/);
  assert.doesNotMatch(html, /preview-modal-meta[\s\S]*preview-zoom-controls/);
});

test('filters, folder, sorting, and thumbnail sizing share one collapsible panel', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  assert.match(html, /<details[^>]+id="filterPanel"[\s\S]*id="searchInput"[\s\S]*id="folderInput"[\s\S]*id="hideSmall"[\s\S]*id="sortMedia"[\s\S]*id="thumbnailSize"[\s\S]*<\/details>/);
  assert.match(html, /<option value="compact">Compact<\/option>/);
  assert.match(html, /<option value="medium" selected>Medium<\/option>/);
  assert.match(html, /<option value="large">Large<\/option>/);
  assert.match(js, /thumbnailSize:\s*'medium'/);
  assert.match(js, /chrome\.storage\.local\.set\(\{ thumbnailSize:/);
  assert.match(js, /dataset\.thumbnailSize/);
  assert.match(css, /body\[data-thumbnail-size="compact"\]/);
  assert.match(css, /body\[data-thumbnail-size="large"\]/);
  assert.match(css, /height:\s*var\(--thumbnail-height\)/);
});

test('media cards show useful metadata and the exact pre-save path', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  assert.match(html, /src="\.\.\/src\/downloads\.js"/);
  assert.match(js, /WebMediaDownloads/);
  assert.match(js, /className = 'media-specs'/);
  assert.match(js, /className = 'media-origin'/);
  assert.match(js, /className = 'save-path'/);
  assert.match(js, /Estimated/);
  assert.match(js, /Save as/);
  assert.match(css, /\.media-specs/);
  assert.match(css, /\.media-origin/);
  assert.match(css, /\.save-path/);
});

test('download jobs show per-file states, progress, retry, cancel, and the supplied loader', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  for (const id of ['downloadJobsPanel', 'downloadJobsList']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(js, /download-jobs-get/);
  assert.match(js, /download-job-retry/);
  assert.match(js, /download-job-cancel/);
  assert.match(js, /download-job-loader/);
  assert.match(css, /\.download-job-progress/);
  assert.match(css, /\.download-job-loader/);
  assert.match(css, /loader\.svg/);
});

test('full preview supports safe muted direct video without replacing image preview', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  assert.match(html, /id="previewVideo"[^>]*muted[^>]*playsinline/);
  assert.match(html, /id="previewNotice"/);
  assert.match(html, /src="\.\.\/src\/media-preview\.js"/);
  assert.match(js, /isSafeDirectVideo/);
  assert.match(js, /previewVideo\.muted = true/);
  assert.match(js, /addEventListener\('encrypted'/);
  assert.match(js, /previewVideo\.pause\(\)/);
});

test('scan result reports duplicate removal count to the user', () => {
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  assert.match(js, /duplicateCount/);
  assert.match(js, /duplicate(?:s)? removed/i);
});

test('download history opens videos instead of presenting their thumbnail as playable media', () => {
  const js = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
  assert.match(js, /record\.type === 'video'/);
  assert.match(js, /openDownload\(record, thumbnail\)/);
  assert.doesNotMatch(js, /Open-file permission enabled\. Click Open again/);
});
