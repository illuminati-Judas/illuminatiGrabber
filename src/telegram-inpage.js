(function initTelegramInPage(root) {
  'use strict';

  const RANGE_RE = /^bytes (\d+)-(\d+)\/(\d+)$/;
  const MAX_BYTES = 20 * 1024 * 1024 * 1024;
  // Keep capture identities inside the page across bridge reinjection.
  const captures = root.__wmgDownloadCaptures || (root.__wmgDownloadCaptures = new Map());

  function captureCurrent() {
    const viewer = currentViewer();
    if (!viewer || !mediaUrl(viewer.media)) return null;
    const token = root.crypto.randomUUID();
    if (captures.size >= 50) captures.delete(captures.keys().next().value);
    captures.set(token, { url: mediaUrl(viewer.media), type: viewer.type, progress: null });
    return { token, type: viewer.type };
  }

  async function downloadCaptured(token) {
    const capture = captures.get(token);
    const viewer = currentViewer();
    if (!capture || !viewer || capture.type !== viewer.type || capture.url !== mediaUrl(viewer.media)) {
      return { ok: false, error: 'Reopen the same Telegram media before retrying this file.' };
    }
    return handlePopupDownload({ captureToken: token });
  }

  function getCapturedProgress(token) {
    return captures.get(token)?.progress || null;
  }

  function parseContentRange(value) {
    const match = RANGE_RE.exec(String(value || ''));
    if (!match) return null;
    const result = { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
    if (!Number.isSafeInteger(result.start) || !Number.isSafeInteger(result.end)
      || !Number.isSafeInteger(result.total) || result.start > result.end || result.end >= result.total) return null;
    return result;
  }

  function safeFilename(value, fallback = 'telegram-video.mp4') {
    const cleaned = String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 180);
    return cleaned || fallback;
  }

  function filenameFromTelegramStream(url) {
    try {
      const part = new URL(url).pathname.split('/').filter(Boolean).pop();
      const metadata = JSON.parse(decodeURIComponent(part));
      return safeFilename(metadata.fileName);
    } catch {
      return `telegram-video-${Date.now()}.mp4`;
    }
  }

  async function downloadTelegramStream(url, options = {}) {
    const fetchFn = options.fetchFn || root.fetch?.bind(root);
    if (typeof fetchFn !== 'function') throw new Error('Fetch is unavailable');
    const writer = options.writer || null;
    const onProgress = options.onProgress || (() => {});
    const chunks = [];
    let offset = 0;
    let total = null;
    let type = 'video/mp4';
    let parts = 0;

    while (total === null || offset < total) {
      const response = await fetchFn(url, { method: 'GET', headers: { Range: `bytes=${offset}-` } });
      if (![200, 206].includes(response?.status)) throw new Error(`Telegram stream returned HTTP ${response?.status || 'error'}`);
      const contentType = String(response.headers?.get?.('Content-Type') || '').split(';')[0];
      if (contentType) type = contentType;
      if (!/^(video|audio|image)\//.test(type) && type !== 'application/octet-stream') {
        throw new Error(`Unexpected Telegram media type: ${type}`);
      }

      const blob = await response.blob();
      if (!blob?.size) throw new Error('Telegram returned an empty media chunk');
      parts += 1;

      if (response.status === 200) {
        if (offset !== 0) throw new Error('Telegram stopped range delivery before completion');
        total = blob.size;
        offset = total;
      } else {
        const range = parseContentRange(response.headers?.get?.('Content-Range'));
        if (!range) throw new Error('Telegram returned an invalid Content-Range');
        if (range.start !== offset) throw new Error(`Range gap: expected ${offset}, received ${range.start}`);
        if (blob.size !== range.end - range.start + 1) throw new Error('Telegram chunk size does not match Content-Range');
        if (total !== null && total !== range.total) throw new Error('Telegram stream size changed during download');
        total = range.total;
        if (total > MAX_BYTES) throw new Error('Telegram media exceeds the 20 GB safety limit');
        offset = range.end + 1;
      }

      if (writer) await writer.write(blob);
      else chunks.push(blob);
      onProgress({ bytes: offset, total, percent: total ? Math.min(100, Math.round((offset / total) * 100)) : 0 });
    }

    if (writer) await writer.close();
    return {
      ok: true,
      bytes: offset,
      parts,
      type,
      ...(writer ? {} : { blob: new Blob(chunks, { type }) }),
    };
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect?.();
    const style = root.getComputedStyle?.(element);
    const inViewport = !rect || (
      rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.right > 0
      && rect.top < (root.innerHeight || Number.POSITIVE_INFINITY)
      && rect.left < (root.innerWidth || Number.POSITIVE_INFINITY)
    );
    return inViewport && style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function largestVisibleMedia(container, minimumArea = 0) {
    return [...(container?.querySelectorAll('video, img') || [])]
      .filter((element) => {
        if (!visible(element)) return false;
        const rect = element.getBoundingClientRect();
        if ((rect.width * rect.height) < minimumArea) return false;
        if (element.tagName?.toLowerCase() !== 'img') return true;
        const source = element.currentSrc || element.src || '';
        try {
          const name = decodeURIComponent(new URL(source, root.location?.href).pathname.split('/').pop() || '');
          return !/^blank[-_.]/i.test(name);
        } catch {
          return true;
        }
      })
      .sort((left, right) => {
        const a = left.getBoundingClientRect();
        const b = right.getBoundingClientRect();
        return (b.width * b.height) - (a.width * a.height);
      })[0] || null;
  }

  function currentViewer() {
    // Match the exact Telegram Web A/K viewer structure used by the
    // working Telegram Media Downloader userscript, without adding UI.
    const webA = root.document?.querySelector('#MediaViewer');
    const aSlide = webA?.querySelector('.MediaViewerSlide--active');
    const aVideo = aSlide?.querySelector('.MediaViewerContent > .VideoPlayer video');
    const aImage = aSlide?.querySelector('.MediaViewerContent > div > img');
    const aMedia = visible(aVideo)
      ? aVideo
      : visible(aImage)
        ? aImage
        : largestVisibleMedia(aSlide?.querySelector('.MediaViewerContent'))
          || largestVisibleMedia(webA, 40_000);
    if (visible(webA) && aMedia) {
      const isVideo = aMedia.tagName?.toLowerCase() === 'video';
      return {
        container: webA,
        media: aMedia,
        video: isVideo ? aMedia : null,
        type: isVideo ? 'video' : 'image',
        actions: webA.querySelector('.MediaViewerActions'),
      };
    }

    const webK = [...(root.document?.querySelectorAll('.media-viewer-whole') || [])].find(visible);
    const aspecter = webK?.querySelector('.media-viewer-movers .media-viewer-aspecter');
    const kVideo = aspecter?.querySelector('.ckin__player video, video');
    const kImage = aspecter?.querySelector('img.thumbnail');
    const kMedia = visible(kVideo) ? kVideo : visible(kImage) ? kImage : largestVisibleMedia(aspecter);
    if (webK && kMedia) {
      const isVideo = kMedia.tagName?.toLowerCase() === 'video';
      return {
        container: webK,
        media: kMedia,
        video: isVideo ? kMedia : null,
        type: isVideo ? 'video' : 'image',
        actions: webK.querySelector('.media-viewer-topbar .media-viewer-buttons'),
      };
    }
    return null;
  }

  function officialDownloadButton(viewer) {
    const buttons = [...(viewer.actions?.querySelectorAll('button, a[role="button"]') || [])];
    return buttons.find((button) => {
      if (button.classList?.contains('wmg-tg-download') || button.classList?.contains('wmg-tg-current-download-button')) return false;
      if (button.disabled || button.getAttribute?.('aria-disabled') === 'true' || !visible(button)) return false;
      // A quality/menu toggle opens a menu; clicking it does not save a file.
      if (button.getAttribute?.('aria-haspopup') || /(?:menu|dropdown|options)/i.test(String(button.className || ''))) return false;
      const label = `${button.getAttribute?.('title') || ''} ${button.getAttribute?.('aria-label') || ''} ${button.className || ''}`.toLowerCase();
      return label.includes('download') || button.textContent?.includes('\ue979');
    }) || null;
  }

  function officialDownloadForRun(_viewer, _button) {
    // Telegram's own control can reject a synthetic click while returning
    // normally. That produced false "Completed" records with no Chrome
    // download, both from the page button and from the popup. Always use the
    // byte-verified stream path for illuminati Grabber actions.
    return null;
  }

  function triggerBlob(blob, filename) {
    const objectUrl = root.URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    root.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(objectUrl), 60_000);
  }

  async function thumbnailFromMedia(element) {
    try {
      if (!element) return '';
      if (element.tagName?.toLowerCase() === 'img' && typeof element.decode === 'function') {
        await element.decode().catch(() => {});
      }
      const width = element.naturalWidth || element.videoWidth || element.width || 0;
      const height = element.naturalHeight || element.videoHeight || element.height || 0;
      if (!width || !height) return '';
      const scale = Math.min(1, 180 / Math.max(width, height));
      const canvas = root.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL('image/jpeg', 0.72);
      return value.length <= 100_000 ? value : '';
    } catch {
      return '';
    }
  }

  async function thumbnailFromImageBlob(blob) {
    const objectUrl = root.URL.createObjectURL(blob);
    try {
      const image = new root.Image();
      image.src = objectUrl;
      if (typeof image.decode === 'function') await image.decode();
      else await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      return await thumbnailFromMedia(image);
    } catch {
      return '';
    } finally {
      root.URL.revokeObjectURL(objectUrl);
    }
  }

  function downloadRecord(details = {}) {
    const sourceName = telegramSourceName();
    return {
      id: `telegram-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      source: 'telegram',
      status: details.status === 'failed' ? 'failed' : 'success',
      type: details.type === 'video' ? 'video' : details.type === 'image' ? 'image' : 'media',
      filename: safeFilename(details.filename, details.type === 'video' ? 'telegram-video.mp4' : 'telegram-image.jpg'),
      bytes: Number.isSafeInteger(details.bytes) && details.bytes >= 0 ? details.bytes : null,
      completedAt: new Date().toISOString(),
      ...(sourceName ? { sourceName } : {}),
      ...(typeof details.previewDataUrl === 'string' && details.previewDataUrl.startsWith('data:image/')
        ? { previewDataUrl: details.previewDataUrl }
        : {}),
      ...(details.error ? { error: String(details.error).slice(0, 240) } : {}),
    };
  }

  function telegramSourceName() {
    const groupContext = /^#-\d+/.test(root.location?.hash || '')
      || Boolean(root.document?.querySelector('.MiddleHeader .ChatInfo .group-status'))
      || Boolean(root.document?.querySelector('.sidebar-header.topbar [data-peer-id^="-"]'));
    if (!groupContext) return '';
    const selectors = [
      '.MiddleHeader .ChatInfo .fullName',
      '.sidebar-header.topbar .chat-info .user-title .peer-title',
      '.sidebar-header.topbar .chat-info .user-title',
    ];
    for (const selector of selectors) {
      const element = root.document?.querySelector(selector);
      const text = String(element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (text) return text;
    }
    return '';
  }

  const pendingDownloadResults = new Map();

  function dispatchDownloadResult(record) {
    const html = root.document?.documentElement;
    if (!html) return record;
    html.dataset.wmgTelegramDownloadResult = JSON.stringify(record);
    root.dispatchEvent(new Event('wmg-telegram-download-result'));
    return record;
  }

  function publishDownloadResult(record) {
    const existing = pendingDownloadResults.get(record.id);
    if (existing?.timer) root.clearTimeout(existing.timer);
    const pending = { record, timer: null };
    pendingDownloadResults.set(record.id, pending);
    const retry = () => {
      if (pendingDownloadResults.get(record.id) !== pending) return;
      dispatchDownloadResult(record);
      pending.timer = root.setTimeout(retry, 1000);
    };
    retry();
    return record;
  }

  function mediaUrl(video) {
    const candidates = [
      video?.currentSrc,
      video?.src,
      video?.querySelector?.('source')?.src,
    ].filter(Boolean);
    return candidates.find((url) => /\/stream\//.test(url)) || candidates[0] || '';
  }

  function resetButtonLabel(button) {
    button.textContent = button.dataset?.wmgLabel || '⬇ WMG Download';
  }

  function imageFilename(url, type) {
    try {
      const raw = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      if (raw && !/^blank[-_.]/i.test(raw) && /\.[a-z0-9]{2,5}$/i.test(raw)) return safeFilename(raw);
    } catch {}
    const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    return `telegram-image-${Date.now()}.${extension}`;
  }

  async function downloadImage(image, button, official = null) {
    const url = image?.currentSrc || image?.src || '';
    if (official) {
      official.click();
      const elementPreview = await thumbnailFromMedia(image);
      button.textContent = '✓ Telegram Download';
      return {
        type: 'image', filename: safeFilename(official.download || imageFilename(url, 'image/jpeg')),
        bytes: null, previewDataUrl: elementPreview, handedOff: true,
      };
    }
    if (!url) throw new Error('Telegram image is not ready');
    const elementPreview = await thumbnailFromMedia(image);
    button.disabled = true;
    button.textContent = 'Downloading image…';
    try {
      const response = await root.fetch(url);
      if (!response?.ok) throw new Error(`Telegram image returned HTTP ${response?.status || 'error'}`);
      const blob = await response.blob();
      if (!blob?.size || !String(blob.type || 'image/jpeg').startsWith('image/')) {
        throw new Error('Telegram returned an invalid image');
      }
      const filename = imageFilename(url, blob.type);
      const previewDataUrl = elementPreview || await thumbnailFromImageBlob(blob);
      triggerBlob(blob, filename);
      button.textContent = '✓ Downloaded';
      return { type: 'image', filename, bytes: blob.size, previewDataUrl };
    } finally {
      button.disabled = false;
    }
  }

  async function downloadVideo(video, button, official = null) {
    const url = mediaUrl(video);
    const filename = url ? filenameFromTelegramStream(url) : `telegram-video-${Date.now()}.mp4`;
    if (official) {
      official.click();
      const previewDataUrl = await thumbnailFromMedia(video);
      button.textContent = '✓ Telegram Download';
      return { type: 'video', filename: safeFilename(official.download || filename), bytes: null, previewDataUrl, handedOff: true };
    }

    if (!url) throw new Error('Telegram video stream is not ready');
    const previewDataUrl = await thumbnailFromMedia(video);

    button.disabled = true;
    button.textContent = 'Downloading 0%';
    try {
      const result = await downloadTelegramStream(url, {
        onProgress: (progress) => {
          button.textContent = `Downloading ${progress.percent}%`;
          button.onProgress?.(progress);
        },
      });
      if (result.blob) triggerBlob(result.blob, filename);
      button.textContent = '✓ Downloaded';
      return { type: 'video', filename, bytes: result.bytes, previewDataUrl };
    } finally {
      button.disabled = false;
    }
  }

  async function runDownload(button) {
    const viewer = currentViewer();
    if (!viewer) throw new Error('Open the Telegram media viewer first');
    const official = officialDownloadForRun(viewer, button);
    return viewer.type === 'image'
      ? downloadImage(viewer.media, button, official)
      : downloadVideo(viewer.media, button, official);
  }

  function ensureInlineButtons() {
    for (const button of root.document?.querySelectorAll('.wmg-tg-download, .wmg-tg-inline-download, .wmg-tg-current-download-control') || []) {
      button.remove();
    }
  }

  function ensureOverlay() {
    ensureInlineButtons();
    const viewer = currentViewer();
    const html = root.document?.documentElement;
    if (!html) return;
    let button = root.document.querySelector('.wmg-tg-current-download-button');
    if (!viewer) {
      delete html.dataset.wmgTelegramMedia;
      button?.remove();
      return;
    }

    html.dataset.wmgTelegramMedia = viewer.type;
    const host = viewer.actions || viewer.container;
    if (!button) {
      button = root.document.createElement('button');
      button.type = 'button';
      button.className = 'wmg-tg-current-download-button';
      button.setAttribute('aria-label', 'illuminati Grabber download current media');
      button.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'min-width:132px',
        'min-height:38px',
        'margin:6px',
        'padding:8px 14px',
        'border:1px solid #c91f3b',
        'border-radius:10px',
        'background:linear-gradient(135deg,#c91f3b,#65101f)',
        'color:#fff5f7',
        'font:600 13px/1.2 "Avenir Next",-apple-system,BlinkMacSystemFont,sans-serif',
        'box-shadow:0 4px 18px rgba(201,31,59,.30)',
        'cursor:pointer',
        'z-index:2147483646',
      ].join(';');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.dataset.wmgMode === 'finder') {
          const recordId = button.dataset.wmgRecordId || '';
          if (!recordId) return;
          button.disabled = true;
          button.textContent = 'Opening Finder…';
          root.dispatchEvent(new CustomEvent('wmg-telegram-show-download-request', {
            detail: { recordId },
          }));
          return;
        }
        if (button.dataset.wmgMode === 'complete') return;
        const startedViewer = currentViewer();
        button.__wmgPendingMedia = startedViewer?.media || null;
        button.__wmgPendingUrl = mediaUrl(startedViewer?.media);
        runDownload(button).then((details) => {
          const record = downloadRecord({ status: 'success', ...details });
          button.dataset.wmgPendingRecordId = record.id;
          publishDownloadResult(record);
        }).catch((error) => {
          button.disabled = false;
          button.textContent = 'Download failed';
          button.title = error instanceof Error ? error.message : String(error);
          publishDownloadResult(downloadRecord({
            status: 'failed', type: button.dataset.wmgType,
            filename: button.dataset.wmgType === 'video' ? 'telegram-video.mp4' : 'telegram-image.jpg',
            error: error instanceof Error ? error.message : String(error),
          }));
          root.setTimeout(() => resetButtonLabel(button), 3000);
        });
      }, true);
    }
    if (button.parentElement !== host) host.append(button);
    const label = viewer.type === 'image' ? 'Download Photo' : 'Download Video';
    const viewerChanged = button.__wmgViewerMedia !== viewer.media
      || button.__wmgViewerUrl !== mediaUrl(viewer.media);
    if (viewerChanged) {
      delete button.dataset.wmgMode;
      delete button.dataset.wmgRecordId;
      delete button.dataset.wmgPendingRecordId;
      button.__wmgPendingMedia = null;
      button.__wmgPendingUrl = '';
      button.disabled = false;
    }
    button.__wmgViewerMedia = viewer.media;
    button.__wmgViewerUrl = mediaUrl(viewer.media);
    button.dataset.wmgLabel = label;
    button.dataset.wmgType = viewer.type;
    if (button.dataset.wmgMode === 'finder') button.textContent = 'Show in Finder';
    else if (!button.disabled && (viewerChanged || !/^Downloading|^✓/.test(button.textContent || ''))) button.textContent = label;
  }

  function handleDownloadRecorded(event) {
    const button = root.document?.querySelector('.wmg-tg-current-download-button');
    const recordId = typeof event.detail?.recordId === 'string' ? event.detail.recordId : '';
    const pending = pendingDownloadResults.get(recordId);
    if (pending?.timer) root.clearTimeout(pending.timer);
    pendingDownloadResults.delete(recordId);
    if (!button || !recordId || button.dataset.wmgPendingRecordId !== recordId) return;
    const viewer = currentViewer();
    const sameViewer = viewer && button.__wmgPendingMedia === viewer.media
      && button.__wmgPendingUrl === mediaUrl(viewer.media);
    delete button.dataset.wmgPendingRecordId;
    button.__wmgPendingMedia = null;
    button.__wmgPendingUrl = '';
    if (!sameViewer) return;
    button.disabled = false;
    if (event.detail?.canShowInFolder === true) {
      button.dataset.wmgMode = 'finder';
      button.dataset.wmgRecordId = recordId;
      button.textContent = 'Show in Finder';
      button.title = '';
    } else {
      button.dataset.wmgMode = 'complete';
      button.dataset.wmgRecordId = recordId;
      button.textContent = '✓ Downloaded';
      button.title = 'Saved, but Chrome could not associate this file for Finder';
    }
  }

  function handleShowDownloadResult(event) {
    const button = root.document?.querySelector('.wmg-tg-current-download-button');
    if (!button || button.dataset.wmgMode !== 'finder'
        || button.dataset.wmgRecordId !== event.detail?.recordId) return;
    button.disabled = false;
    if (event.detail?.ok) {
      button.textContent = 'Show in Finder';
      button.title = '';
    } else {
      delete button.dataset.wmgMode;
      delete button.dataset.wmgRecordId;
      button.textContent = 'File unavailable';
      button.title = String(event.detail?.error || 'Show in Finder failed').slice(0, 160);
    }
  }

  function popupStatusSink() {
    return {
      disabled: false,
      textContent: '',
      dataset: { wmgLabel: 'Download current Telegram media' },
    };
  }

  async function handlePopupDownload(options = {}) {
    ensureOverlay();
    const viewer = currentViewer();
    if (!viewer) {
      const result = { ok: false, error: 'Open one Telegram photo or video first' };
      root.dispatchEvent(new CustomEvent('wmg-telegram-popup-download-result', { detail: result }));
      return result;
    }
    try {
      const sink = popupStatusSink();
      if (options.captureToken) {
        sink.backgroundTask = true;
        sink.onProgress = (progress) => {
          const capture = captures.get(options.captureToken);
          if (capture) capture.progress = progress;
        };
      }
      const details = await runDownload(sink);
      const record = publishDownloadResult(downloadRecord({ status: 'success', ...details }));
      const result = { ok: true, ...record, handedOff: Boolean(details.handedOff) };
      root.dispatchEvent(new CustomEvent('wmg-telegram-popup-download-result', { detail: result }));
      return result;
    } catch (error) {
      const record = publishDownloadResult(downloadRecord({
        status: 'failed', type: viewer.type,
        filename: viewer.type === 'video' ? 'telegram-video.mp4' : 'telegram-image.jpg',
        error: error instanceof Error ? error.message : String(error),
      }));
      const result = { ok: false, ...record };
      root.dispatchEvent(new CustomEvent('wmg-telegram-popup-download-result', { detail: result }));
      return result;
    }
  }

  const api = {
    parseContentRange, filenameFromTelegramStream, downloadTelegramStream,
    mediaUrl, currentViewer, officialDownloadButton, officialDownloadForRun, downloadVideo, ensureInlineButtons, ensureOverlay, handlePopupDownload,
    captureCurrent, downloadCaptured, getCapturedProgress,
  };
  root.WebMediaTelegramInPage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  const BRIDGE_VERSION = '1.1.0-chrome-history-fallback-1';
  if (root.document && /(^|\.)web(?:k|z)?\.telegram\.org$/.test(root.location?.hostname || '')
      && root.__wmgTelegramInPage !== BRIDGE_VERSION) {
    root.document.querySelector('.wmg-tg-current-download-button')?.remove();
    if (root.__wmgTelegramPopupHandler) {
      root.removeEventListener('wmg-telegram-popup-download-request', root.__wmgTelegramPopupHandler);
    }
    if (root.__wmgTelegramRecordedHandler) {
      root.removeEventListener('wmg-telegram-download-recorded', root.__wmgTelegramRecordedHandler);
    }
    if (root.__wmgTelegramShowResultHandler) {
      root.removeEventListener('wmg-telegram-show-download-result', root.__wmgTelegramShowResultHandler);
    }
    if (root.__wmgTelegramOverlayTimer) root.clearInterval(root.__wmgTelegramOverlayTimer);
    root.__wmgTelegramInPage = BRIDGE_VERSION;
    root.__wmgTelegramPopupHandler = handlePopupDownload;
    root.__wmgTelegramRecordedHandler = handleDownloadRecorded;
    root.__wmgTelegramShowResultHandler = handleShowDownloadResult;
    root.addEventListener('wmg-telegram-popup-download-request', root.__wmgTelegramPopupHandler);
    root.addEventListener('wmg-telegram-download-recorded', root.__wmgTelegramRecordedHandler);
    root.addEventListener('wmg-telegram-show-download-result', root.__wmgTelegramShowResultHandler);
    root.__wmgTelegramOverlayTimer = root.setInterval(ensureOverlay, 500);
    ensureOverlay();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
