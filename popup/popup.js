(() => {
  'use strict';

  const { mediaQuality, filterAndSortMedia, computeVirtualRange } = globalThis.WebMediaGalleryModel;
  const { buildDownloadPath } = globalThis.WebMediaDownloads;
  const { isSafeDirectVideo, normalizePosterUrl, formatDuration } = globalThis.WebMediaPreview;
  const VIRTUAL_THRESHOLD = 60;
  const VIRTUAL_OVERSCAN_ROWS = 3;
  let virtualScrollFrame = 0;

  const state = {
    items: [], selected: new Set(), filter: 'all', query: '', scanning: false,
    site: 'generic', smartTarget: null, tabId: null, pageUrl: '', downloadsOpenPermission: false,
    previewItems: [], previewIndex: -1, previewZoom: 1, previewToken: 0,
    duplicateCount: 0, downloadJobs: [],
    hideSmall: true, originalOnly: false, sort: 'page', thumbnailSize: 'medium', virtualItems: [], virtualKey: '', virtualRangeKey: '',
  };
  const elements = {
    scanButton: document.querySelector('#scanButton'),
    pageTitle: document.querySelector('#pageTitle'),
    pageDomain: document.querySelector('#pageDomain'),
    statusDot: document.querySelector('#statusDot'),
    activityLoader: document.querySelector('#activityLoader'),
    searchInput: document.querySelector('#searchInput'),
    hideSmall: document.querySelector('#hideSmall'),
    originalOnly: document.querySelector('#originalOnly'),
    sortMedia: document.querySelector('#sortMedia'),
    thumbnailSize: document.querySelector('#thumbnailSize'),
    filteredCount: document.querySelector('#filteredCount'),
    folderInput: document.querySelector('#folderInput'),
    selectVisible: document.querySelector('#selectVisible'),
    selectionCount: document.querySelector('#selectionCount'),
    expandedSelectionCount: document.querySelector('#expandedSelectionCount'),
    expandedSelectVisible: document.querySelector('#expandedSelectVisible'),
    expandedDownload: document.querySelector('#expandedDownload'),
    expandedExit: document.querySelector('#expandedExit'),
    downloadButton: document.querySelector('#downloadButton'),
    message: document.querySelector('#message'),
    gallery: document.querySelector('#gallery'),
    allCount: document.querySelector('#allCount'),
    imageCount: document.querySelector('#imageCount'),
    videoCount: document.querySelector('#videoCount'),
    smartPanel: document.querySelector('#smartPanel'),
    smartSite: document.querySelector('#smartSite'),
    smartLabel: document.querySelector('#smartLabel'),
    smartButton: document.querySelector('#smartButton'),
    buildId: document.querySelector('#buildId'),
    diagnosticLog: document.querySelector('#diagnosticLog'),
    copyDiagnostics: document.querySelector('#copyDiagnostics'),
    clearDiagnostics: document.querySelector('#clearDiagnostics'),
    downloadHistory: document.querySelector('#downloadHistory'),
    historyPanel: document.querySelector('.history-panel'),
    downloadJobsPanel: document.querySelector('#downloadJobsPanel'),
    downloadJobsList: document.querySelector('#downloadJobsList'),
    downloadJobsTitle: document.querySelector('#downloadJobsTitle'),
    clearHistory: document.querySelector('#clearHistory'),
    expandGallery: document.querySelector('#expandGallery'),
    previewModal: document.querySelector('#previewModal'),
    previewImage: document.querySelector('#previewImage'),
    previewVideo: document.querySelector('#previewVideo'),
    previewNotice: document.querySelector('#previewNotice'),
    previewZoomControls: document.querySelector('.preview-zoom-controls'),
    previewCaption: document.querySelector('#previewCaption'),
    previewDetails: document.querySelector('#previewDetails'),
    previewPrevious: document.querySelector('#previewPrevious'),
    previewNext: document.querySelector('#previewNext'),
    previewZoomOut: document.querySelector('#previewZoomOut'),
    previewZoomIn: document.querySelector('#previewZoomIn'),
    previewZoomReset: document.querySelector('#previewZoomReset'),
    closePreview: document.querySelector('#closePreview'),
  };

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function mediaFileType(item) {
    let extension = '';
    try {
      const parsed = new URL(item.url);
      const base = parsed.pathname.split('/').pop() || '';
      const match = base.match(/\.([a-z0-9]{2,5})$/i);
      extension = (match?.[1] || parsed.searchParams.get('format') || '').toLowerCase();
    } catch {}
    const labels = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', webp: 'WEBP', gif: 'GIF', avif: 'AVIF', mp4: 'MP4', webm: 'WEBM', mov: 'MOV' };
    return labels[extension] || (item.type === 'video' ? 'VIDEO' : 'IMAGE');
  }

  function mediaDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return 'page'; }
  }

  function itemDownloadIndex(item) {
    const index = state.items.findIndex((candidate) => candidate.url === item.url);
    return index >= 0 ? index + 1 : 1;
  }

  function itemSavePath(item) {
    try {
      return buildDownloadPath(elements.folderInput.value.trim() || 'WebMedia', item.url, item.type, itemDownloadIndex(item));
    } catch {
      return filename(item.url);
    }
  }

  function applyThumbnailSize(value) {
    const size = ['compact', 'medium', 'large'].includes(value) ? value : 'medium';
    state.thumbnailSize = size;
    elements.thumbnailSize.value = size;
    document.body.dataset.thumbnailSize = size;
    state.virtualRangeKey = '';
    requestAnimationFrame(() => renderMediaWindow(true));
  }

  function setLoadingState(button, active) {
    button?.classList.toggle('is-loading', active);
    if (button) button.setAttribute('aria-busy', active ? 'true' : 'false');
    const hasActiveWork = Boolean(document.querySelector('button.is-loading'));
    elements.activityLoader.hidden = !hasActiveWork;
    elements.statusDot.hidden = hasActiveWork;
  }

  function applyPreviewZoom(nextZoom) {
    const item = state.previewItems[state.previewIndex];
    if (item?.type === 'video') return;
    state.previewZoom = Math.min(3, Math.max(0.5, nextZoom));
    elements.previewImage.style.transform = `scale(${state.previewZoom})`;
    elements.previewZoomReset.textContent = `${Math.round(state.previewZoom * 100)}%`;
  }

  function updatePreviewNavigation() {
    const navigable = state.previewItems.length > 1 && state.previewIndex >= 0;
    elements.previewPrevious.disabled = !navigable;
    elements.previewNext.disabled = !navigable;
  }

  function unloadPreviewVideo() {
    state.previewToken += 1;
    elements.previewVideo.onloadedmetadata = null;
    elements.previewVideo.onerror = null;
    elements.previewVideo.pause();
    elements.previewVideo.removeAttribute('src');
    elements.previewVideo.removeAttribute('poster');
    elements.previewVideo.load();
    elements.previewVideo.hidden = true;
  }

  function previewDetails(item, width = item.width, height = item.height, duration = item.duration) {
    const estimate = item.bytes ? ` · Estimated ${formatBytes(item.bytes)}` : '';
    const length = item.type === 'video' && Number.isFinite(duration) ? ` · ${formatDuration(duration)}` : '';
    return `${width || '?'} × ${height || '?'} · ${mediaFileType(item)}${length} · ${mediaDomain(item.url)}${estimate} · Save as ${itemSavePath(item)} · ${state.previewIndex + 1}/${state.previewItems.length}`;
  }

  function showPreviewNotice(text) {
    unloadPreviewVideo();
    elements.previewImage.hidden = true;
    elements.previewNotice.textContent = text;
    elements.previewNotice.hidden = false;
  }

  function renderGalleryPreview() {
    const item = state.previewItems[state.previewIndex];
    if (!item) return;
    unloadPreviewVideo();
    const token = ++state.previewToken;
    elements.previewImage.onload = null;
    elements.previewImage.removeAttribute('src');
    elements.previewImage.hidden = true;
    elements.previewNotice.hidden = true;
    elements.previewZoomControls.hidden = item.type === 'video';
    elements.previewCaption.textContent = filename(item.url);
    elements.previewDetails.textContent = previewDetails(item);

    if (item.type === 'video') {
      if (!isSafeDirectVideo(item, state.site)) {
        showPreviewNotice('Only direct MP4/WebM files can be previewed. Protected streams are not opened.');
      } else {
        elements.previewVideo.hidden = false;
        elements.previewVideo.crossOrigin = 'anonymous';
        elements.previewVideo.referrerPolicy = 'no-referrer';
        elements.previewVideo.preload = 'metadata';
        elements.previewVideo.defaultMuted = true;
        elements.previewVideo.muted = true;
        elements.previewVideo.volume = 0;
        const poster = frameCache.get(item.url)?.posterUrl || normalizePosterUrl(item.posterUrl);
        if (poster) elements.previewVideo.poster = poster;
        elements.previewVideo.onloadedmetadata = () => {
          if (token !== state.previewToken) return;
          if (!Number.isFinite(elements.previewVideo.duration)) {
            showPreviewNotice('Live or protected video cannot be previewed.');
            return;
          }
          elements.previewDetails.textContent = previewDetails(
            item,
            elements.previewVideo.videoWidth || item.width,
            elements.previewVideo.videoHeight || item.height,
            elements.previewVideo.duration,
          );
        };
        elements.previewVideo.onerror = () => {
          if (token === state.previewToken) showPreviewNotice('This direct video could not be previewed safely.');
        };
        elements.previewVideo.src = item.url;
        elements.previewVideo.load();
      }
    } else {
      applyPreviewZoom(1);
      elements.previewImage.hidden = false;
      elements.previewImage.onload = () => {
        if (token !== state.previewToken) return;
        elements.previewDetails.textContent = previewDetails(item, item.width || elements.previewImage.naturalWidth, item.height || elements.previewImage.naturalHeight);
      };
      elements.previewImage.src = item.url;
    }
    elements.previewModal.hidden = false;
    updatePreviewNavigation();
  }

  function showGalleryPreview(url) {
    state.previewItems = visibleItems().filter((item) => item.type === 'image' || isSafeDirectVideo(item, state.site));
    state.previewIndex = state.previewItems.findIndex((item) => item.url === url);
    if (state.previewIndex < 0) return;
    renderGalleryPreview();
  }

  function moveGalleryPreview(delta) {
    if (state.previewItems.length < 2 || state.previewIndex < 0) return;
    state.previewIndex = (state.previewIndex + delta + state.previewItems.length) % state.previewItems.length;
    renderGalleryPreview();
  }

  function showPreview(record) {
    if (!record.previewDataUrl) return;
    unloadPreviewVideo();
    state.previewItems = [];
    state.previewIndex = -1;
    elements.previewZoomControls.hidden = false;
    elements.previewNotice.hidden = true;
    elements.previewImage.hidden = false;
    applyPreviewZoom(1);
    elements.previewImage.onload = () => {
      elements.previewDetails.textContent = `${elements.previewImage.naturalWidth || '?'} × ${elements.previewImage.naturalHeight || '?'} · Local download preview`;
    };
    elements.previewImage.src = record.previewDataUrl;
    elements.previewCaption.textContent = `${record.filename || 'Telegram media'}${record.sourceName ? ` · ${record.sourceName}` : ''}`;
    elements.previewDetails.textContent = 'Local download preview';
    elements.previewModal.hidden = false;
    updatePreviewNavigation();
  }

  function closePreview() {
    unloadPreviewVideo();
    elements.previewModal.hidden = true;
    elements.previewImage.removeAttribute('src');
    elements.previewImage.onload = null;
    elements.previewImage.hidden = false;
    elements.previewNotice.hidden = true;
    elements.previewZoomControls.hidden = false;
    elements.previewCaption.textContent = '';
    elements.previewDetails.textContent = '';
    state.previewItems = [];
    state.previewIndex = -1;
    applyPreviewZoom(1);
  }

  elements.previewVideo.addEventListener('encrypted', () => {
    showPreviewNotice('Encrypted or protected video cannot be previewed.');
  });
  elements.previewVideo.addEventListener('volumechange', () => {
    if (!elements.previewVideo.muted || elements.previewVideo.volume !== 0) {
      elements.previewVideo.muted = true;
      elements.previewVideo.volume = 0;
    }
  });

  async function openDownload(record, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening…';
    setLoadingState(button, true);
    try {
      if (record.nativeJobId) {
        const result = await chrome.runtime.sendMessage({ action: 'download-open', id: record.id });
        if (!result?.ok) throw new Error(result?.error || result?.status || 'Downloaded X file could not be opened');
      } else {
        if (!Number.isInteger(record.downloadId)) throw new Error('Open is available for new downloads only');
        if (!state.downloadsOpenPermission) {
          const granted = await chrome.permissions.request({ permissions: ['downloads.open'] });
          state.downloadsOpenPermission = granted;
          if (!granted) throw new Error('Open-file permission was not granted');
        }
        await chrome.downloads.open(record.downloadId);
      }
      setMessage(`Opened ${record.actualFilename || record.filename}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoadingState(button, false);
      button.textContent = original;
      button.disabled = record.status !== 'success'
        || (!Number.isInteger(record.downloadId) && !record.nativeJobId);
    }
  }

  function renderDownloadHistory(history) {
    const records = Array.isArray(history) ? history.slice(-5).reverse() : [];
    elements.historyPanel.classList.toggle('is-empty', records.length === 0);
    elements.downloadHistory.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'No downloads yet.';
      elements.downloadHistory.append(empty);
      return;
    }
    for (const record of records) {
      const item = document.createElement('article');
      item.className = 'history-item';
      const thumbnail = document.createElement('button');
      thumbnail.type = 'button';
      thumbnail.className = `history-thumbnail${record.status === 'failed' ? ' failed' : ''}`;
      thumbnail.setAttribute('aria-label', `Preview ${record.filename || 'Telegram media'}`);
      if (record.previewDataUrl) {
        const image = document.createElement('img');
        image.src = record.previewDataUrl;
        image.alt = '';
        thumbnail.append(image);
        if (record.type !== 'video') thumbnail.addEventListener('click', () => showPreview(record));
      } else {
        thumbnail.textContent = record.status === 'failed' ? '!' : record.type === 'video' ? '▶' : '▧';
        thumbnail.disabled = true;
      }
      const copy = document.createElement('div');
      copy.className = 'history-copy';
      const name = document.createElement('strong');
      name.textContent = record.filename || 'Telegram media';
      const details = document.createElement('span');
      details.className = record.status === 'failed' ? 'failed' : '';
      const mediaLabel = record.type === 'video' ? 'Video' : record.type === 'image' ? 'Photo' : 'Media';
      const size = formatBytes(record.bytes);
      details.textContent = record.status === 'failed'
        ? `${mediaLabel} · Failed${record.error ? ` · ${record.error}` : ''}`
        : `${mediaLabel} · Completed${size ? ` · ${size}` : ''}`;
      const source = document.createElement('span');
      source.className = 'history-source';
      source.textContent = record.source === 'x'
        ? 'X.com'
        : record.source === 'generic' ? 'Web media'
          : record.sourceName ? `Telegram · ${record.sourceName}` : 'Telegram';
      const time = document.createElement('time');
      time.className = 'history-time';
      const date = new Date(record.completedAt);
      time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      copy.append(name, source, details);
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'history-open';
      openButton.textContent = 'Open';
      openButton.setAttribute('aria-label', `Open ${record.filename || 'Telegram media'}`);
      openButton.disabled = record.status !== 'success'
        || (!Number.isInteger(record.downloadId) && !record.nativeJobId);
      openButton.addEventListener('click', () => openDownload(record, openButton));
      if (record.type === 'video') {
        thumbnail.setAttribute('aria-label', `Play downloaded video ${record.filename || ''}`.trim());
        thumbnail.title = Number.isInteger(record.downloadId) || record.nativeJobId
          ? 'Open the downloaded video in your default player'
          : 'This history item is not associated with its downloaded file';
        thumbnail.disabled = record.status !== 'success'
          || (!Number.isInteger(record.downloadId) && !record.nativeJobId);
        thumbnail.addEventListener('click', () => openDownload(record, thumbnail));
      }
      actions.append(time, openButton);
      item.append(thumbnail, copy, actions);
      elements.downloadHistory.append(item);
    }
  }

  async function refreshDownloadHistory(markRead = false) {
    const result = await chrome.runtime.sendMessage({ action: 'download-history-get' });
    renderDownloadHistory(result?.downloadHistory || []);
    if (markRead) await chrome.runtime.sendMessage({ action: 'download-history-mark-read' });
  }

  function downloadJobLabel(status) {
    return ({ waiting: 'Waiting', downloading: 'Downloading', completed: 'Completed', failed: 'Failed' })[status] || 'Unknown';
  }

  function renderDownloadJobs(jobs) {
    state.downloadJobs = Array.isArray(jobs) ? jobs : [];
    elements.downloadJobsPanel.hidden = state.downloadJobs.length === 0;
    elements.downloadJobsList.replaceChildren();
    const active = state.downloadJobs.filter((job) => ['waiting', 'downloading'].includes(job.status)).length;
    elements.downloadJobsTitle.textContent = active ? `${active} active · ${state.downloadJobs.length} total` : `${state.downloadJobs.length} recent`;
    for (const job of state.downloadJobs) {
      const row = document.createElement('article');
      row.className = `download-job ${job.status}`;
      const stateIcon = document.createElement('span');
      stateIcon.className = job.status === 'downloading' ? 'download-job-loader' : 'download-job-state';
      stateIcon.textContent = job.status === 'completed' ? '✓' : job.status === 'failed' ? '!' : job.status === 'waiting' ? '…' : '';
      const copy = document.createElement('div');
      copy.className = 'download-job-copy';
      const name = document.createElement('strong');
      name.textContent = String(job.filename || 'media').split(/[\\/]/).pop();
      name.title = job.filename || '';
      const status = document.createElement('span');
      const received = formatBytes(job.bytesReceived);
      const total = formatBytes(job.totalBytes);
      const progress = Number.isFinite(job.progressPercent) ? ` · ${job.progressPercent}%` : '';
      const bytes = received ? ` · ${received}${total ? ` / ${total}` : ''}` : '';
      status.textContent = `${downloadJobLabel(job.status)}${progress}${bytes}${job.status === 'failed' && job.errorMessage ? ` · ${job.errorMessage}` : ''}`;
      copy.append(name, status);
      if (job.status === 'downloading') {
        const bar = document.createElement('div');
        bar.className = `download-job-progress${Number.isFinite(job.progressPercent) ? '' : ' indeterminate'}`;
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', `Downloading ${name.textContent}`);
        if (Number.isFinite(job.progressPercent)) bar.setAttribute('aria-valuenow', String(job.progressPercent));
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        const fill = document.createElement('i');
        fill.style.width = `${Number.isFinite(job.progressPercent) ? job.progressPercent : 24}%`;
        bar.append(fill);
        copy.append(bar);
      }
      const actions = document.createElement('div');
      actions.className = 'download-job-actions';
      if (job.status === 'failed' || job.status === 'waiting') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = job.needsFreshScan ? 'Scan again' : job.status === 'failed' ? 'Retry' : 'Cancel';
        button.addEventListener('click', async () => {
          if (job.needsFreshScan) {
            setMessage('Scan the page again for a fresh media URL, then select the item to download.', true);
            elements.scanButton.click();
            return;
          }
          button.disabled = true;
          const action = job.status === 'failed' ? 'download-job-retry' : 'download-job-cancel';
          try {
            const result = await chrome.runtime.sendMessage({ action, jobId: job.id });
            if (!result?.ok) throw new Error(result?.error || 'This job has already changed state.');
            await refreshDownloadJobs();
          } catch (error) {
            setMessage(error.message, true);
            button.disabled = false;
          }
        });
        actions.append(button);
      }
      row.append(stateIcon, copy, actions);
      elements.downloadJobsList.append(row);
    }
  }

  let jobsRefreshPromise;
  let jobsRefreshTimer;
  let popupClosed = false;
  function refreshDownloadJobs() {
    if (popupClosed) return Promise.resolve();
    if (jobsRefreshPromise) return jobsRefreshPromise;
    clearTimeout(jobsRefreshTimer);
    jobsRefreshPromise = (async () => {
      const result = await chrome.runtime.sendMessage({ action: 'download-jobs-get' });
      if (!result?.ok) throw new Error(result?.error || 'Cannot read download progress');
      if (!popupClosed) renderDownloadJobs(result.jobs || []);
    })().finally(() => {
      jobsRefreshPromise = null;
      if (!popupClosed && state.downloadJobs.some((job) => ['waiting', 'downloading'].includes(job.status))) {
        jobsRefreshTimer = setTimeout(() => refreshDownloadJobs().catch(() => {}), 1000);
      }
    });
    return jobsRefreshPromise;
  }

  function popupDiagnostic(event, details = {}) {
    return chrome.runtime.sendMessage({ action: 'diagnostic-log', entry: { source: 'popup', event, details } });
  }

  async function refreshDiagnostics() {
    const result = await chrome.runtime.sendMessage({ action: 'diagnostic-get' });
    elements.buildId.textContent = result?.build || chrome.runtime.getManifest().version;
    const entries = Array.isArray(result?.entries) ? result.entries.slice(-20) : [];
    elements.diagnosticLog.textContent = entries.length
      ? entries.map((entry) => `${entry.ts} [${entry.source}] ${entry.event} ${JSON.stringify(entry.details)}`).join('\n')
      : 'No diagnostic entries yet.';
  }

  function filename(url) {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || new URL(url).hostname); }
    catch { return 'media'; }
  }

  function visibleItems() {
    return filterAndSortMedia(state.items, {
      type: state.filter,
      query: state.query,
      hideSmall: state.hideSmall,
      originalOnly: state.originalOnly,
      sort: state.sort,
      filename,
    });
  }

  function setMessage(text, error = false) {
    elements.message.textContent = text;
    elements.message.classList.toggle('error', error);
    elements.message.hidden = !text;
  }

  function updateSelectionUi() {
    const visible = visibleItems();
    const visibleSelected = visible.filter((item) => state.selected.has(item.url)).length;
    const allVisibleSelected = visible.length > 0 && visibleSelected === visible.length;
    elements.selectVisible.checked = allVisibleSelected;
    elements.selectVisible.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    elements.selectionCount.textContent = `${state.selected.size} selected`;
    elements.expandedSelectionCount.textContent = `${state.selected.size} selected`;
    elements.expandedSelectVisible.textContent = allVisibleSelected ? 'Clear visible' : 'Select all visible';
    elements.downloadButton.disabled = state.selected.size === 0;
    elements.expandedDownload.disabled = state.selected.size === 0;
    const downloadLabel = state.selected.size ? `Download ${state.selected.size}` : 'Download selected';
    elements.downloadButton.textContent = state.selected.size ? `${downloadLabel} selected` : downloadLabel;
    elements.expandedDownload.textContent = downloadLabel;
  }

  function setVisibleSelection(selected) {
    for (const item of visibleItems()) {
      if (selected) state.selected.add(item.url);
      else state.selected.delete(item.url);
    }
    render();
  }

  function renderSmartPanel() {
    const target = state.smartTarget;
    elements.smartPanel.hidden = !target;
    if (!target) return;
    elements.smartSite.textContent = state.site === 'x' ? 'X CURRENT POST' : 'TELEGRAM CURRENT MESSAGE';
    elements.smartLabel.textContent = target.label || 'Current media';
    elements.smartButton.textContent = target.mode === 'telegram-button'
      ? 'Download Current Media'
      : target.mode === 'page-blob' ? 'Save Clicked Video'
        : target.mode === 'unsupported' && state.site === 'telegram' ? 'Open Media First'
          : 'Download HQ';
    elements.smartButton.disabled = target.mode === 'unsupported';
  }

  const frameCache = new Map();
  let frameController = new AbortController();
  let pendingFrames = [];
  let activeFrames = 0;
  const frameObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      frameObserver.unobserve(entry.target);
      const task = entry.target.frameTask;
      if (task) pendingFrames.push(task);
    }
    pumpFrames();
  }, { root: elements.gallery });

  function pumpFrames() {
    while (activeFrames < 2 && pendingFrames.length) {
      const { item, preview, glyph, signal } = pendingFrames.shift();
      if (signal.aborted || !preview.isConnected) continue;
      activeFrames += 1;
      globalThis.WebMediaPreview.captureVideoFrame(document, item, { signal }).then((frame) => {
        if (!frame || signal.aborted || !preview.isConnected) return;
        if (frameCache.size >= 60) frameCache.delete(frameCache.keys().next().value);
        frameCache.set(item.url, frame);
        item.width = frame.width;
        item.height = frame.height;
        item.duration = frame.duration;
        const image = document.createElement('img');
        image.src = frame.posterUrl;
        image.alt = 'Video frame preview';
        glyph.replaceWith(image);
        const specs = preview.parentElement?.querySelector('.media-specs');
        if (specs) specs.textContent = `${frame.width} × ${frame.height} · ${mediaFileType(item)} · ${formatDuration(frame.duration)}`;
      }).catch(() => {}).finally(() => { activeFrames -= 1; pumpFrames(); });
    }
  }

  function resetFrameRequests() {
    frameObserver.disconnect();
    pendingFrames = [];
    frameController.abort();
    frameController = new AbortController();
  }

  function createMediaCard(item) {
    const card = document.createElement('article');
    card.className = `card${state.selected.has(item.url) ? ' selected' : ''}`;
    card.title = item.url;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(item.url);
    checkbox.setAttribute('aria-label', `Select ${filename(item.url)}`);

    const preview = document.createElement('div');
    preview.className = 'preview';
    if (item.type === 'image') {
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = item.alt || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        image.remove();
        const glyph = document.createElement('span');
        glyph.className = 'video-glyph';
        glyph.textContent = '◇';
        preview.append(glyph);
      }, { once: true });
      preview.append(image);
      preview.tabIndex = 0;
      preview.setAttribute('role', 'button');
      preview.setAttribute('aria-label', `Preview ${filename(item.url)}`);
      preview.addEventListener('click', (event) => {
        event.stopPropagation();
        showGalleryPreview(item.url);
      });
      preview.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        showGalleryPreview(item.url);
      });
    } else {
      const poster = frameCache.get(item.url)?.posterUrl || normalizePosterUrl(item.posterUrl);
      if (poster) {
        const image = document.createElement('img');
        image.src = poster;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        preview.append(image);
      } else {
        const glyph = document.createElement('span');
        glyph.className = 'video-glyph';
        glyph.textContent = '▶';
        preview.append(glyph);
        if (isSafeDirectVideo(item, state.site)) {
          preview.frameTask = { item, preview, glyph, signal: frameController.signal };
          frameObserver.observe(preview);
        }
      }
      if (isSafeDirectVideo(item, state.site)) {
        preview.tabIndex = 0;
        preview.setAttribute('role', 'button');
        preview.setAttribute('aria-label', `Preview video ${filename(item.url)}`);
        preview.addEventListener('click', (event) => {
          event.stopPropagation();
          showGalleryPreview(item.url);
        });
        preview.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          showGalleryPreview(item.url);
        });
      }
    }

    const quality = mediaQuality(item);
    const badge = document.createElement('span');
    badge.className = `badge ${quality}`;
    badge.textContent = quality === 'low-res' ? 'LOW RES' : quality.toUpperCase();
    preview.append(badge);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('strong');
    name.className = 'filename';
    name.textContent = filename(item.url);
    const specs = document.createElement('span');
    specs.className = 'media-specs';
    const resolution = item.width && item.height ? `${item.width} × ${item.height}` : 'Resolution unknown';
    specs.textContent = `${resolution} · ${mediaFileType(item)}${item.type === 'video' && Number.isFinite(item.duration) ? ` · ${formatDuration(item.duration)}` : ''}${item.bytes ? ` · Estimated ${formatBytes(item.bytes)}` : ''}`;
    const origin = document.createElement('span');
    origin.className = 'media-origin';
    origin.textContent = `${mediaDomain(item.url)} · ${item.source || 'page'}`;
    const savePath = document.createElement('span');
    savePath.className = 'save-path';
    savePath.textContent = `Save as ${itemSavePath(item)}`;
    savePath.title = itemSavePath(item);
    meta.append(name, specs, origin, savePath);

    checkbox.addEventListener('change', (event) => {
      event.stopPropagation();
      if (checkbox.checked) state.selected.add(item.url);
      else state.selected.delete(item.url);
      render();
    });
    card.append(checkbox, preview, meta);
    return card;
  }

  function appendVirtualSpacer(height) {
    if (!height) return;
    const spacer = document.createElement('div');
    spacer.className = 'virtual-spacer';
    spacer.style.height = `${height}px`;
    elements.gallery.append(spacer);
  }

  function renderMediaWindow(force = false) {
    const items = state.virtualItems;
    const rowHeights = { compact: 178, medium: 210, large: 254 };
    const rowHeight = rowHeights[state.thumbnailSize] || rowHeights.medium;
    const range = computeVirtualRange({
      itemCount: items.length,
      columns: 2,
      rowHeight,
      scrollTop: elements.gallery.scrollTop,
      viewportHeight: elements.gallery.clientHeight,
      overscanRows: VIRTUAL_OVERSCAN_ROWS,
      threshold: VIRTUAL_THRESHOLD,
    });
    const expanded = document.body.classList.contains('gallery-expanded');
    const rangeKey = `${range.start}:${range.end}:${state.thumbnailSize}:${expanded}:${items.length}`;
    if (!force && rangeKey === state.virtualRangeKey) return;
    state.virtualRangeKey = rangeKey;
    const scrollTop = elements.gallery.scrollTop;
    resetFrameRequests();
    elements.gallery.replaceChildren();
    appendVirtualSpacer(range.topSpacer);
    for (const item of items.slice(range.start, range.end)) elements.gallery.append(createMediaCard(item));
    appendVirtualSpacer(range.bottomSpacer);
    elements.gallery.scrollTop = scrollTop;
    const rendered = range.end - range.start;
    elements.gallery.dataset.renderedCount = String(rendered);
    elements.filteredCount.textContent = `${items.length}/${state.items.length} shown · ${rendered} rendered`;
  }

  function render() {
    document.body.classList.toggle('has-results', state.items.length > 0);
    if (!state.items.length) setGalleryExpanded(false);
    renderSmartPanel();
    elements.allCount.textContent = state.items.length;
    elements.imageCount.textContent = state.items.filter((item) => item.type === 'image').length;
    elements.videoCount.textContent = state.items.filter((item) => item.type === 'video').length;

    const items = visibleItems();
    if (!items.length) {
      resetFrameRequests();
      state.virtualItems = [];
      state.virtualKey = '';
      state.virtualRangeKey = '';
      elements.gallery.replaceChildren();
      elements.filteredCount.textContent = `0/${state.items.length} shown`;
      setMessage(state.site === 'telegram'
        ? (state.smartTarget?.mode === 'telegram-button'
            ? 'Ready: this downloads only the photo or video currently open in Telegram.'
            : 'Open one photo or video in Telegram, then reopen this popup.')
        : state.items.length ? 'No media matches the active quality filters.' : 'No direct media found. Scroll the page to load lazy media, then rescan.');
      updateSelectionUi();
      return;
    }
    setMessage(state.duplicateCount
      ? `${state.duplicateCount} ${state.duplicateCount === 1 ? 'duplicate removed' : 'duplicates removed'} · highest-resolution versions kept.`
      : '');
    const nextVirtualKey = items.map((item) => item.url).join('\n');
    if (nextVirtualKey !== state.virtualKey) elements.gallery.scrollTop = 0;
    state.virtualItems = items;
    state.virtualKey = nextVirtualKey;
    state.virtualRangeKey = '';
    renderMediaWindow(true);
    updateSelectionUi();
  }

  function setGalleryExpanded(expanded) {
    const hasGalleryItems = state.items.length > 0 || elements.gallery.childElementCount > 0;
    const active = Boolean(expanded && hasGalleryItems);
    document.body.classList.toggle('gallery-expanded', active);
    elements.expandGallery.setAttribute('aria-pressed', active ? 'true' : 'false');
    elements.expandGallery.textContent = active ? 'Exit expanded' : 'Expand preview';
    state.virtualRangeKey = '';
    requestAnimationFrame(() => renderMediaWindow(true));
  }

  async function scanPage() {
    if (state.scanning) return;
    state.scanning = true;
    elements.scanButton.disabled = true;
    setLoadingState(elements.scanButton, true);
    elements.statusDot.className = 'status-dot';
    setMessage('Scanning the current page…');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open a public http/https webpage, then try again.');

      const isTelegram = new URL(tab.url).hostname === 'web.telegram.org';
      let result;
      if (isTelegram) {
        const inspection = await chrome.runtime.sendMessage({ action: 'telegram-inspect-current', tabId: tab.id });
        result = {
          ok: inspection?.ok !== false,
          site: 'telegram',
          page: { title: tab.title || 'Telegram Web', url: tab.url, domain: 'web.telegram.org' },
          items: [],
          unsupported: 0,
          smartTarget: inspection?.mediaReady
            ? { mode: 'telegram-button', mediaType: inspection.mediaType, label: `Download the ${inspection.mediaType} currently open in Telegram` }
            : { mode: 'unsupported', label: 'Open one photo or video in Telegram, then reopen this popup' },
        };
      } else {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/scanner.js', 'src/site-adapters.js', 'content/content.js'],
        });
        result = await chrome.tabs.sendMessage(tab.id, { action: 'scan-page' });
      }
      if (!result?.ok) throw new Error(result?.error || 'The page did not return scan results.');

      state.items = result.items || [];
      state.duplicateCount = Number(result.duplicateCount) || 0;
      state.site = result.site || 'generic';
      state.smartTarget = result.smartTarget || null;
      state.tabId = tab.id;
      state.pageUrl = result.page?.url || tab.url;
      await popupDiagnostic('scan-result', {
        site: state.site,
        smartMode: state.smartTarget?.mode || 'none',
        mediaType: state.smartTarget?.mediaType || 'none',
        itemCount: state.items.length,
        duplicateCount: state.duplicateCount,
      });
      state.selected = new Set([...state.selected].filter((url) => state.items.some((item) => item.url === url)));
      elements.pageTitle.textContent = result.page?.title || 'Untitled page';
      elements.pageDomain.textContent = result.page?.domain || tab.url;
      elements.statusDot.className = 'status-dot ready';
      render();
      if (result.unsupported) setMessage(`${result.unsupported} blob/data item(s) were skipped because they are not direct files.`);
    } catch (error) {
      await popupDiagnostic('scan-error', { error: error instanceof Error ? error.message : String(error) }).catch(() => {});
      state.items = [];
      state.duplicateCount = 0;
      state.smartTarget = null;
      state.site = 'generic';
      renderSmartPanel();
      elements.gallery.replaceChildren();
      elements.pageTitle.textContent = 'Unable to scan this page';
      elements.pageDomain.textContent = 'Chrome internal pages and protected pages are restricted';
      elements.statusDot.className = 'status-dot error';
      elements.allCount.textContent = '0';
      elements.imageCount.textContent = '0';
      elements.videoCount.textContent = '0';
      updateSelectionUi();
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      state.scanning = false;
      setLoadingState(elements.scanButton, false);
      elements.scanButton.disabled = false;
      await refreshDiagnostics().catch(() => {});
    }
  }

  async function downloadSelected(event) {
    const items = state.items
      .filter((item) => state.selected.has(item.url))
      .map((item) => ({ ...item, downloadIndex: itemDownloadIndex(item) }));
    if (!items.length) return;
    const triggerButton = event?.currentTarget || elements.downloadButton;
    elements.downloadButton.disabled = true;
    elements.expandedDownload.disabled = true;
    triggerButton.textContent = 'Queueing…';
    setLoadingState(triggerButton, true);
    const rootFolder = elements.folderInput.value.trim() || 'WebMedia';
    await chrome.storage.local.set({ rootFolder });

    try {
      const result = await chrome.runtime.sendMessage({ action: 'download-media', items, rootFolder });
      if (!result?.ok) throw new Error(result?.error || 'No files could be queued.');
      setMessage(`Queued ${result.queued}; failed ${result.failed}.`, result.failed > 0);
      await refreshDownloadJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoadingState(triggerButton, false);
      updateSelectionUi();
    }
  }

  async function runSmartAction() {
    const target = state.smartTarget;
    if (!target || target.mode === 'unsupported') return;
    elements.smartButton.disabled = true;
    setLoadingState(elements.smartButton, true);
    const originalLabel = elements.smartButton.textContent;
    elements.smartButton.textContent = target.mode === 'telegram-button' ? 'Downloading…' : 'Downloading…';
    setMessage(target.mode === 'telegram-button'
      ? 'Downloading the media currently open in Telegram…'
      : target.mode === 'page-blob'
        ? 'Saving the Telegram video you clicked…'
        : 'Native Helper is downloading and merging the highest-quality media…');

    try {
      let result;
      if (target.mode === 'telegram-button') {
        result = await chrome.runtime.sendMessage({ action: 'telegram-download-current', tabId: state.tabId });
      } else if (target.mode === 'page-blob') {
        result = await chrome.runtime.sendMessage({ action: 'telegram-page-blob-download', tabId: state.tabId });
      } else {
        const payload = target.mode === 'x-video'
          ? { command: 'download_x', url: target.url }
          : {
              command: 'download_direct',
              url: target.url,
              source_page: state.pageUrl,
              item_id: `message-${Date.now()}`,
            };
        result = await chrome.runtime.sendMessage({ action: 'native-command', payload });
      }

      if (!result?.ok) throw new Error(result?.error || result?.status || 'Smart download failed.');
      if (result.queued) {
        setMessage('Queued. Follow progress in Files.');
        await refreshDownloadJobs();
      } else if (target.mode === 'telegram-button') {
        setMessage(`Completed: ${result.filename || 'current Telegram media'}.`);
        await refreshDownloadHistory(true);
      } else if (target.mode === 'page-blob') {
        setMessage(`Telegram media download was triggered${result.filename ? ` as ${result.filename}` : ''}. Check Chrome Downloads.`);
      } else {
        setMessage(`Completed. Saved under ${result.output_dir || '~/Downloads/WebMedia'}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoadingState(elements.smartButton, false);
      elements.smartButton.textContent = originalLabel;
      elements.smartButton.disabled = target.mode === 'unsupported';
    }
  }

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
      button.classList.add('active');
      state.filter = button.dataset.filter;
      render();
    });
  });
  elements.searchInput.addEventListener('input', () => { state.query = elements.searchInput.value; render(); });
  elements.hideSmall.addEventListener('change', () => { state.hideSmall = elements.hideSmall.checked; render(); });
  elements.originalOnly.addEventListener('change', () => { state.originalOnly = elements.originalOnly.checked; render(); });
  elements.sortMedia.addEventListener('change', () => { state.sort = elements.sortMedia.value; render(); });
  elements.thumbnailSize.addEventListener('change', () => {
    applyThumbnailSize(elements.thumbnailSize.value);
    chrome.storage.local.set({ thumbnailSize: state.thumbnailSize });
  });
  elements.gallery.addEventListener('scroll', () => {
    if (virtualScrollFrame) return;
    virtualScrollFrame = requestAnimationFrame(() => {
      virtualScrollFrame = 0;
      renderMediaWindow(false);
    });
  }, { passive: true });
  elements.selectVisible.addEventListener('change', () => {
    setVisibleSelection(elements.selectVisible.checked);
  });
  elements.expandedSelectVisible.addEventListener('click', () => {
    const visible = visibleItems();
    const allSelected = visible.length > 0 && visible.every((item) => state.selected.has(item.url));
    setVisibleSelection(!allSelected);
  });
  elements.scanButton.addEventListener('click', scanPage);
  elements.expandGallery.addEventListener('click', () => {
    setGalleryExpanded(!document.body.classList.contains('gallery-expanded'));
  });
  elements.expandedExit.addEventListener('click', () => setGalleryExpanded(false));
  elements.smartButton.addEventListener('click', runSmartAction);
  elements.downloadButton.addEventListener('click', downloadSelected);
  elements.expandedDownload.addEventListener('click', downloadSelected);
  elements.folderInput.addEventListener('change', () => {
    chrome.storage.local.set({ rootFolder: elements.folderInput.value.trim() || 'WebMedia' });
    render();
  });
  elements.copyDiagnostics.addEventListener('click', async () => {
    await navigator.clipboard.writeText(elements.diagnosticLog.textContent || '');
    elements.copyDiagnostics.textContent = 'Copied';
    setTimeout(() => { elements.copyDiagnostics.textContent = 'Copy log'; }, 1000);
  });
  elements.clearDiagnostics.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'diagnostic-clear' });
    await refreshDiagnostics();
  });
  elements.clearHistory.addEventListener('click', async () => {
    elements.clearHistory.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ action: 'download-history-clear' });
      if (!result?.ok) throw new Error(result?.error || 'Cannot clear finished downloads');
      await Promise.all([refreshDownloadHistory(), refreshDownloadJobs()]);
      setMessage('Finished history cleared. Active downloads and saved files were kept.');
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      elements.clearHistory.disabled = false;
    }
  });
  elements.closePreview.addEventListener('click', closePreview);
  elements.previewPrevious.addEventListener('click', () => moveGalleryPreview(-1));
  elements.previewNext.addEventListener('click', () => moveGalleryPreview(1));
  elements.previewZoomOut.addEventListener('click', () => applyPreviewZoom(state.previewZoom - 0.25));
  elements.previewZoomIn.addEventListener('click', () => applyPreviewZoom(state.previewZoom + 0.25));
  elements.previewZoomReset.addEventListener('click', () => applyPreviewZoom(1));
  elements.previewModal.addEventListener('click', (event) => {
    if (event.target === elements.previewModal) closePreview();
  });
  document.addEventListener('keydown', (event) => {
    if (!elements.previewModal.hidden) {
      if (document.activeElement === elements.previewVideo && ['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) return;
      if (event.key === 'ArrowLeft') moveGalleryPreview(-1);
      else if (event.key === 'ArrowRight') moveGalleryPreview(1);
      else if (event.key === '+' || event.key === '=') applyPreviewZoom(state.previewZoom + 0.25);
      else if (event.key === '-') applyPreviewZoom(state.previewZoom - 0.25);
      else if (event.key === 'Escape') closePreview();
      return;
    }
    if (event.key === 'Escape') setGalleryExpanded(false);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.downloadHistory) renderDownloadHistory(changes.downloadHistory.newValue || []);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'download-jobs-changed') refreshDownloadJobs().catch(() => {});
  });
  window.addEventListener('beforeunload', () => {
    popupClosed = true;
    resetFrameRequests();
    clearTimeout(jobsRefreshTimer);
    unloadPreviewVideo();
  });

  chrome.permissions.contains({ permissions: ['downloads.open'] })
    .then((granted) => { state.downloadsOpenPermission = granted; })
    .catch(() => {});
  chrome.storage.local.get({ rootFolder: 'WebMedia', thumbnailSize: 'medium' }).then(({ rootFolder, thumbnailSize }) => {
    elements.folderInput.value = rootFolder;
    applyThumbnailSize(thumbnailSize);
    popupDiagnostic('popup-open', { manifestVersion: chrome.runtime.getManifest().version }).catch(() => {});
    refreshDownloadHistory(true).catch(() => {});
    refreshDownloadJobs().catch(() => {});
    scanPage();
  });
})();
