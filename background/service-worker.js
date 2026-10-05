importScripts('../src/downloads.js', '../src/diagnostics.js', '../src/download-jobs.js');

const NATIVE_HOST = 'com.june.web_media_grabber';
const NATIVE_COMMANDS = new Set(['ping', 'check_dependencies', 'download_x', 'download_direct', 'open_output']);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'diagnostic-log') {
    appendDiagnostic(message.entry).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.action === 'diagnostic-get') {
    chrome.storage.local.get({ diagnosticLog: [] }).then(({ diagnosticLog }) => {
      sendResponse({ ok: true, build: WebMediaDiagnostics.BUILD_ID, entries: diagnosticLog });
    });
    return true;
  }
  if (message?.action === 'diagnostic-clear') {
    chrome.storage.local.set({ diagnosticLog: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.action === 'download-media') {
    downloadMedia(message).then(sendResponse, (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'download-jobs-get') {
    getPublicDownloadJobs().then(sendResponse, (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'download-job-retry') {
    retryDownloadJob(message.jobId).then(sendResponse, (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'download-job-cancel') {
    cancelDownloadJob(message.jobId).then(sendResponse, (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'native-command') {
    (['download_x', 'download_direct'].includes(message.payload?.command)
      ? queueSmartDownload({ kind: 'native', payload: message.payload })
      : sendNativeCommand(message.payload)).then(sendResponse, (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'telegram-page-blob-download') {
    downloadTelegramPageBlob(message.tabId).then(sendResponse);
    return true;
  }
  if (message?.action === 'telegram-inspect-current') {
    inspectTelegramCurrent(message.tabId).then(sendResponse);
    return true;
  }
  if (message?.action === 'telegram-download-current') {
    queueSmartDownload({ kind: 'telegram', tabId: message.tabId }).then(sendResponse, (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'telegram-download-result') {
    const senderUrl = _sender?.tab?.url || '';
    if (!senderUrl.startsWith('https://web.telegram.org/')) {
      sendResponse({ ok: false, error: 'Untrusted download result source' });
      return false;
    }
    recordDownload(message.record).then(({ record, ignored }) => sendResponse({
      ok: true,
      recordId: record.id,
      canShowInFolder: !ignored && Number.isInteger(record.downloadId),
    }), (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'telegram-show-download') {
    const senderUrl = _sender?.tab?.url || '';
    if (!senderUrl.startsWith('https://web.telegram.org/')) {
      sendResponse({ ok: false, error: 'Untrusted Show in Finder source' });
      return false;
    }
    showRecordedDownload(message.recordId).then(sendResponse, () => sendResponse({
      ok: false, error: 'Downloaded file could not be shown',
    }));
    return true;
  }
  if (message?.action === 'download-history-get') {
    repairDownloadHistoryAssociations().then(sendResponse);
    return true;
  }
  if (message?.action === 'download-history-mark-read') {
    markDownloadHistoryRead().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.action === 'download-history-clear') {
    clearDownloadHistory().then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: safeDownloadError(error) }));
    return true;
  }
  if (message?.action === 'download-open') {
    openRecordedDownload(message.id).then(sendResponse, (error) => sendResponse({
      ok: false, error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }
  return false;
});

async function appendDiagnostic(entry) {
  const { diagnosticLog } = await chrome.storage.local.get({ diagnosticLog: [] });
  const next = WebMediaDiagnostics.appendEntry(diagnosticLog, entry);
  await chrome.storage.local.set({ diagnosticLog: next });
}

function normalizeDownloadRecord(raw = {}) {
  const type = ['image', 'video', 'media'].includes(raw.type) ? raw.type : 'media';
  const status = raw.status === 'failed' ? 'failed' : 'success';
  const source = ['x', 'telegram', 'generic'].includes(raw.source) ? raw.source : 'telegram';
  const fallback = source === 'x'
    ? 'x-video.mp4'
    : source === 'generic' ? 'web-media' : type === 'video' ? 'telegram-video.mp4' : type === 'image' ? 'telegram-image.jpg' : 'telegram-media';
  const filename = String(raw.filename || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .trim().slice(0, 180) || fallback;
  const sourceName = String(raw.sourceName || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  const previewDataUrl = typeof raw.previewDataUrl === 'string'
    && /^data:image\/(?:jpeg|png|webp);base64,/i.test(raw.previewDataUrl)
    && raw.previewDataUrl.length <= 100_000 ? raw.previewDataUrl : '';
  const nativeJobId = source === 'x' && /^[0-9a-f-]{36}$/i.test(String(raw.nativeJobId || ''))
    ? String(raw.nativeJobId) : '';
  return {
    id: String(raw.id || `${source}-${Date.now()}`).slice(0, 100),
    source, status, type, filename,
    bytes: Number.isSafeInteger(raw.bytes) && raw.bytes >= 0 ? raw.bytes : null,
    completedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(raw.completedAt || '')) ? raw.completedAt : new Date().toISOString(),
    ...(nativeJobId ? { nativeJobId } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(previewDataUrl ? { previewDataUrl } : {}),
    ...(Number.isInteger(raw.downloadId) && raw.downloadId >= 0 ? { downloadId: raw.downloadId } : {}),
    ...(status === 'failed' ? { error: safeDownloadError(raw.error || 'Download failed') } : {}),
  };
}

async function recordDownload(raw) {
  const record = normalizeDownloadRecord(raw);
  const item = record.status === 'success' && record.source !== 'generic' && !record.nativeJobId && !Number.isInteger(record.downloadId)
    ? await findRecentDownload(record.filename, record.completedAt, record.bytes)
    : null;
  if (item) {
    record.downloadId = item.id;
    record.actualFilename = item.filename.split(/[\\/]/).pop() || record.filename;
  }
  return serializeDownloadState(async () => {
  const state = await chrome.storage.local.get({
    downloadHistory: [], downloadUnread: 0, downloadHistoryClearedAt: '',
  });
  const clearedAt = Date.parse(state.downloadHistoryClearedAt) || 0;
  const completedAt = Date.parse(record.completedAt) || Date.now();
  if (completedAt <= clearedAt) return { ok: true, ignored: true, record };
  if (state.downloadHistory.some((entry) => entry.id === record.id)) return { ok: true, duplicate: true, record };
  if (Number.isInteger(record.downloadId)) {
    const associated = state.downloadHistory.find((entry) => entry.downloadId === record.downloadId);
    if (associated) return { ok: true, duplicate: true, record: associated };
  }
  const history = boundedDownloadHistory([...state.downloadHistory, record]);
  const unread = Math.min(99, Number(state.downloadUnread || 0) + 1);
  await chrome.storage.local.set({ downloadHistory: history, downloadUnread: unread });
  await chrome.action.setBadgeBackgroundColor({ color: record.status === 'failed' ? '#d94f68' : '#159ca3' });
  await chrome.action.setBadgeText({ text: String(unread) });
  await appendDiagnostic({ source: 'background', event: 'download-recorded', details: {
    status: record.status, mediaType: record.type, filename: record.filename, bytes: record.bytes,
  } });
  return { ok: true, record };
  });
}

function comparableFilename(value) {
  return String(value || '').split(/[\\/]/).pop().toLowerCase()
    .replace(/ \(\d+\)(?=\.[^.]+$)/, '');
}

async function findRecentDownload(filename, completedAt, bytes = null, attempts = 20) {
  const expected = comparableFilename(filename);
  const completedMs = Date.parse(completedAt) || Date.now();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 50 });
    const match = items.find((candidate) => {
      const age = Math.abs((Date.parse(candidate.startTime) || completedMs) - completedMs);
      const nameMatches = comparableFilename(candidate.filename) === expected && age <= 120_000;
      const sizeAndTimeMatch = Number.isSafeInteger(bytes) && bytes >= 0
        && candidate.totalBytes === bytes && age <= 5_000;
      return nameMatches || sizeAndTimeMatch;
    });
    if (match) return match;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function repairDownloadHistoryAssociations() {
  await ensureDownloadQueueReady();
  return serializeDownloadState(async () => {
  const state = await chrome.storage.local.get({
    downloadHistory: [], downloadUnread: 0, downloadHistoryClearedAt: '',
  });
  let changed = false;
  const history = [];
  for (const stored of state.downloadHistory) {
    const record = { ...stored };
    if (Number.isInteger(record.downloadId)) {
      const [item] = await chrome.downloads.search({ id: record.downloadId });
      if (item?.state === 'complete' && Number.isSafeInteger(item.bytesReceived) && item.bytesReceived >= 0 && record.bytes !== item.bytesReceived) {
        record.bytes = item.bytesReceived;
        changed = true;
      }
    }
    if (record.status === 'success' && !record.nativeJobId && !Number.isInteger(record.downloadId)) {
      const item = await findRecentDownload(record.filename, record.completedAt, record.bytes, 1);
      if (item?.state === 'complete' && Number.isInteger(item.id)) {
        record.downloadId = item.id;
        record.actualFilename = item.filename.split(/[\\/]/).pop() || record.filename;
        changed = true;
      }
    }
    history.push(record);
  }
  const clearedAt = Date.parse(state.downloadHistoryClearedAt) || 0;
  const queue = await loadDownloadQueue();
  for (const job of queue.jobs) {
    const generic = genericJobRecord(job);
    if (generic && (Date.parse(generic.completedAt) || 0) > clearedAt && !history.some((record) => record.id === generic.id)) {
      history.push(normalizeDownloadRecord(generic));
      changed = true;
    }
    const completedAt = Date.parse(job.completedAt) || 0;
    const isXOutput = typeof job.outputDir === 'string' && /\/WebMedia\/x\.com\//.test(job.outputDir);
    if (job.status !== 'completed' || !isXOutput || !job.filename || completedAt <= clearedAt) continue;
    if (history.some((record) => record.nativeJobId === job.id)) continue;
    history.push(normalizeDownloadRecord({
      id: `x-native-${job.id}`,
      source: 'x',
      nativeJobId: job.id,
      status: 'success',
      type: 'video',
      filename: job.filename,
      bytes: Number.isSafeInteger(job.totalBytes) ? job.totalBytes : Number(job.bytesReceived) || null,
      completedAt: job.completedAt,
    }));
    changed = true;
  }
  const boundedHistory = boundedDownloadHistory(history);
  if (changed) await chrome.storage.local.set({ downloadHistory: boundedHistory });
  return { downloadHistory: boundedHistory, downloadUnread: state.downloadUnread };
  });
}

async function recordCompletedTelegramChromeDownload(downloadId) {
  if (!Number.isInteger(downloadId)) return;
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item || item.state !== 'complete') return;
  const filename = String(item.filename || '').split(/[\\/]/).pop() || '';
  const match = /^telegram-(video|image)-\d+\.(mp4|webm|mov|jpg|jpeg|png|webp)$/i.exec(filename);
  if (!match) return;
  await recordDownload({
    id: `telegram-chrome-${item.id}`,
    status: 'success',
    type: match[1].toLowerCase(),
    filename,
    bytes: Number.isSafeInteger(item.totalBytes) && item.totalBytes >= 0 ? item.totalBytes : null,
    completedAt: item.endTime || item.startTime || new Date().toISOString(),
  });
}

async function openRecordedDownload(id) {
  const { downloadHistory = [] } = await chrome.storage.local.get({ downloadHistory: [] });
  const record = downloadHistory.find((entry) => entry.id === id);
  if (!record || record.status !== 'success') return { ok: false, error: 'Download record not found' };
  if (record.nativeJobId) {
    const queue = await loadDownloadQueue();
    const job = queue.jobs.find((entry) => entry.id === record.nativeJobId && entry.status === 'completed');
    if (!job?.outputDir || !job.filename) return { ok: false, error: 'Downloaded X file could not be found' };
    return sendNativeCommand({
      command: 'open_output',
      output_dir: job.outputDir,
      filename: job.filename,
    });
  }
  let item = Number.isInteger(record.downloadId)
    ? (await chrome.downloads.search({ id: record.downloadId }))[0]
    : null;
  if (!item) item = await findRecentDownload(record.filename, record.completedAt, record.bytes, 1);
  if (!item) return { ok: false, error: 'Downloaded file could not be found in Chrome Downloads' };
  if (item.state !== 'complete') return { ok: false, error: 'The file is still downloading' };
  await chrome.downloads.open(item.id);
  return { ok: true, downloadId: item.id };
}

async function showRecordedDownload(recordId) {
  if (typeof recordId !== 'string' || !/^telegram-[a-z0-9_-]{8,90}$/i.test(recordId)) {
    return { ok: false, error: 'Invalid download record' };
  }
  const { downloadHistory = [] } = await chrome.storage.local.get({ downloadHistory: [] });
  const record = downloadHistory.find((entry) => entry.id === recordId);
  if (!record || record.status !== 'success' || !Number.isInteger(record.downloadId)) {
    return { ok: false, error: 'Download record is not associated with a Chrome download' };
  }
  const [item] = await chrome.downloads.search({ id: record.downloadId });
  if (!item || item.id !== record.downloadId) {
    return { ok: false, error: 'Downloaded file could not be found in Chrome Downloads' };
  }
  if (item.state !== 'complete') return { ok: false, error: 'The file is still downloading' };
  await chrome.downloads.show(record.downloadId);
  return { ok: true };
}

async function markDownloadHistoryRead() {
  return serializeDownloadState(async () => {
  await chrome.storage.local.set({ downloadUnread: 0 });
  await chrome.action.setBadgeText({ text: '' });
  });
}

async function clearDownloadHistory() {
  await ensureDownloadQueueReady();
  return serializeDownloadState(async () => {
  const queue = await loadDownloadQueue();
  queue.jobs = queue.jobs.filter((job) => ['waiting', 'downloading'].includes(job.status));
  queue.revision = Number(queue.revision || 0) + 1;
  await chrome.storage.local.set({
    [DOWNLOAD_QUEUE_KEY]: queue,
    downloadHistory: [],
    downloadUnread: 0,
    downloadHistoryClearedAt: new Date().toISOString(),
  });
  await chrome.action.setBadgeText({ text: '' });
  notifyDownloadJobs(queue.revision);
  });
}

async function telegramTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('Invalid Telegram tab');
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url || '');
  if (url.protocol !== 'https:' || url.hostname !== 'web.telegram.org') {
    throw new Error('The active tab is not Telegram Web');
  }
  return tab;
}

async function loadCurrentTelegramBridge(tabId) {
  await telegramTab(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    files: ['content/telegram-result-bridge.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['src/telegram-inpage.js'],
  });
}

async function inspectTelegramCurrent(tabId) {
  try {
    await loadCurrentTelegramBridge(tabId);
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const viewerRoot = document.querySelector('#MediaViewer')
          || [...document.querySelectorAll('.media-viewer-whole')].find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const mediaElements = [...(viewerRoot?.querySelectorAll('img, video') || [])];
        const mediaSummary = mediaElements.slice(0, 12).map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const className = typeof element.className === 'string' ? element.className : '';
          return `${element.tagName}:${Math.round(rect.width)}x${Math.round(rect.height)}:${style.display}:${style.visibility}:${className.slice(0, 48)}`;
        }).join('|');
        const viewer = globalThis.WebMediaTelegramInPage?.currentViewer?.();
        const rootRect = viewerRoot?.getBoundingClientRect();
        return {
          ok: true,
          mediaReady: viewer?.type === 'image' || viewer?.type === 'video',
          mediaType: viewer?.type || 'none',
          viewerA: Boolean(document.querySelector('#MediaViewer')),
          viewerK: Boolean(document.querySelector('.media-viewer-whole.active, .media-viewer-whole')),
          viewerVisible: Boolean(rootRect && rootRect.width > 0 && rootRect.height > 0),
          viewerMediaCount: mediaElements.length,
          activeSlide: Boolean(viewerRoot?.querySelector('.MediaViewerSlide--active')),
          mediaSummary,
          pathVariant: location.pathname.split('/').filter(Boolean)[0] || 'root',
        };
      },
    });
    const result = execution?.result || { ok: false, mediaReady: false, mediaType: 'none', error: 'No inspection result' };
    await appendDiagnostic({ source: 'main', event: 'telegram-inspect', details: result });
    return result;
  } catch (error) {
    const result = { ok: false, mediaReady: false, mediaType: 'none', error: error instanceof Error ? error.message : String(error) };
    await appendDiagnostic({ source: 'background', event: 'telegram-inspect-error', details: result });
    return result;
  }
}

async function downloadTelegramCurrent(tabId, token) {
  try {
    await loadCurrentTelegramBridge(tabId);
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (captureToken) => globalThis.WebMediaTelegramInPage?.downloadCaptured?.(captureToken),
      args: [token],
    });
    const result = execution?.result || { ok: false, error: 'Telegram downloader returned no result' };
    if (result?.id) {
      const recorded = await recordDownload(result);
      result.downloadId = recorded.record?.downloadId;
    }
    await appendDiagnostic({ source: 'main', event: 'telegram-download', details: result });
    return result;
  } catch (error) {
    const result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    await appendDiagnostic({ source: 'background', event: 'telegram-download-error', details: result });
    return result;
  }
}

async function downloadTelegramPageBlob(tabId) {
  try {
    if (!Number.isInteger(tabId)) throw new Error('Invalid Telegram tab');
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url || '');
    if (url.protocol !== 'https:' || url.hostname !== 'web.telegram.org') {
      throw new Error('The active tab is not Telegram Web');
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['src/telegram-page-download.js'],
    });
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => globalThis.WebMediaTelegramPageDownload?.downloadCurrentTelegramBlob(),
    });
    return execution?.result || { ok: false, status: 'no_result', error: 'Telegram page returned no download result.' };
  } catch (error) {
    return { ok: false, status: 'page_download_failed', error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendNativeCommand(payload) {
  if (!payload || !NATIVE_COMMANDS.has(payload.command)) {
    return { ok: false, status: 'error', error: 'Unsupported native command' };
  }
  const allowed = { command: payload.command };
  if (typeof payload.url === 'string') allowed.url = payload.url;
  if (typeof payload.source_page === 'string') allowed.source_page = payload.source_page;
  if (typeof payload.item_id === 'string') allowed.item_id = payload.item_id;
  if (typeof payload.output_dir === 'string') allowed.output_dir = payload.output_dir;
  if (typeof payload.filename === 'string') allowed.filename = payload.filename;

  return new Promise((resolve) => {
    // An open native port keeps MV3 alive while yt-dlp/ffmpeg is working.
    let port;
    let settled = false;
    const finish = (response) => {
      if (settled) return;
      settled = true;
      resolve(response);
      try { port?.disconnect(); } catch {}
    };
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener((response) => finish(response || { ok: false, error: 'Native host returned no response' }));
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || 'Native host disconnected before completion';
        finish({ ok: false, status: 'native_host_unavailable', error });
      });
      port.postMessage(allowed);
    } catch (error) {
      finish({ ok: false, status: 'native_host_unavailable', error: safeDownloadError(error) });
    }
  });
}

const DOWNLOAD_QUEUE_KEY = 'directDownloadQueueV1';
const MAX_ACTIVE_DOWNLOADS = 2;
let queueMutation = Promise.resolve();
let queueReadyPromise;

// Queue and history share a transaction lane so clear cannot be undone by
// an older append, repair, progress update, or startup reconciliation.
function serializeDownloadState(operation) {
  const mutation = queueMutation.then(operation);
  queueMutation = mutation.catch(() => {});
  return mutation;
}

function genericJobRecord(job) {
  if (!['completed', 'failed'].includes(job.status)) return null;
  if (job.source ? job.source !== 'generic' : job.request?.kind || job.outputDir || /^Telegram |^X video$/.test(job.filename)) return null;
  return {
    id: `generic-${job.id}-${job.attempt}`, source: 'generic',
    status: job.status === 'completed' ? 'success' : 'failed',
    type: job.type, filename: String(job.filename || 'web-media').split(/[\\/]/).pop(),
    downloadId: job.downloadId, bytes: job.bytesReceived,
    completedAt: job.completedAt, error: job.errorMessage,
  };
}

function boundedDownloadHistory(history) {
  return history.sort((a, b) => (Date.parse(a.completedAt) || 0) - (Date.parse(b.completedAt) || 0)
    || String(a.id).localeCompare(String(b.id))).slice(-20);
}

async function recordGenericJob(job) {
  const record = job && genericJobRecord(job);
  if (record) await recordDownload(record);
}

async function queueSmartDownload(request) {
  await ensureDownloadQueueReady();
  let filename = 'X video';
  let type = 'video';
  if (request.kind === 'telegram') {
    await loadCurrentTelegramBridge(request.tabId);
    const [capture] = await chrome.scripting.executeScript({
      target: { tabId: request.tabId }, world: 'MAIN',
      func: () => globalThis.WebMediaTelegramInPage?.captureCurrent?.(),
    });
    if (!capture?.result?.token) return { ok: false, error: 'Open one Telegram photo or video first' };
    request = { kind: 'telegram', tabId: request.tabId, token: capture.result.token, url: 'telegram-current' };
    type = capture.result.type;
    filename = `Telegram ${type}`;
  } else {
    const payload = request.payload;
    if (!payload || !['download_x', 'download_direct'].includes(payload.command)) return { ok: false, error: 'Invalid download command' };
    const url = new URL(payload.url);
    if (url.protocol !== 'https:' || url.username || url.password) return { ok: false, error: 'Invalid download URL' };
    request = { kind: 'native', url: url.href, payload: {
      command: payload.command, url: url.href,
      ...(typeof payload.source_page === 'string' ? { source_page: payload.source_page } : {}),
      ...(typeof payload.item_id === 'string' ? { item_id: payload.item_id } : {}),
    } };
    if (payload.command === 'download_direct') filename = WebMediaDownloads.filenameFromUrl(url.href, type, 1);
  }
  const id = crypto.randomUUID();
  await mutateDownloadQueue((queue) => {
    const job = WebMediaDownloadJobs.createDownloadJob({ id, item: { type, url: request.url }, filename });
    job.request = request;
    job.source = request.kind === 'telegram' ? 'telegram' : request.payload.command === 'download_x' ? 'x' : 'generic';
    queue.jobs.push(job);
  });
  await pumpDownloadQueue();
  return { ok: true, queued: 1, jobIds: [id] };
}

async function launchSmartJob(job) {
  try {
    const result = job.request.kind === 'native'
      ? await sendNativeCommand(job.request.payload)
      : await downloadTelegramCurrent(job.request.tabId, job.request.token);
    const outcome = await mutateDownloadQueue((queue) => {
      const current = queue.jobs.find((entry) => entry.id === job.id && entry.status === 'downloading');
      if (!current) return;
      if (result.filename) current.filename = result.filename;
      if (result.output_dir) current.outputDir = result.output_dir;
      if (result.ok && Number.isInteger(result.downloadId)) {
        current.downloadId = result.downloadId;
        current.launch = null;
        return;
      }
      if (result.ok && result.handedOff) {
        current.launch = { handedOffAt: new Date().toISOString(), filename: result.filename };
        return;
      }
      current.status = result.ok ? 'completed' : 'failed';
      current.updatedAt = current.completedAt = new Date().toISOString();
      current.progressPercent = result.ok ? 100 : null;
      current.launch = null;
      if (result.ok) {
        current.bytesReceived = Number(result.bytes) || 0;
        current.totalBytes = Number(result.bytes) || null;
        delete current.request;
      } else {
        current.errorCode = 'SMART_DOWNLOAD_FAILED';
        current.errorMessage = safeDownloadError(result.error || result.status || 'Download failed', current.request?.url);
      }
      return { ...current };
    });
    await recordGenericJob(outcome);
    if (result.ok && outcome?.status === 'completed' && job.request.kind === 'native' && job.request.payload?.command === 'download_x') {
      await recordDownload({
        id: `x-native-${job.id}`,
        source: 'x',
        nativeJobId: job.id,
        status: 'success',
        type: 'video',
        filename: result.filename || job.filename || 'x-video.mp4',
        bytes: Number.isSafeInteger(result.bytes) ? result.bytes : null,
        completedAt: outcome.completedAt,
      });
    }
  } catch (error) {
    const outcome = await mutateDownloadQueue((queue) => {
      const current = queue.jobs.find((entry) => entry.id === job.id && entry.status === 'downloading');
      if (!current) return;
      current.status = 'failed';
      current.errorCode = 'SMART_DOWNLOAD_FAILED';
      current.errorMessage = safeDownloadError(error, current.request?.url);
      current.updatedAt = current.completedAt = new Date().toISOString();
      current.launch = null;
      return { ...current };
    });
    await recordGenericJob(outcome);
  }
  await pumpDownloadQueue();
}

function normalizeQueue(value) {
  return value && value.version === 1 && Array.isArray(value.jobs)
    ? value
    : { version: 1, revision: 0, jobs: [] };
}

async function loadDownloadQueue() {
  const stored = await chrome.storage.local.get({ [DOWNLOAD_QUEUE_KEY]: null });
  return normalizeQueue(stored[DOWNLOAD_QUEUE_KEY]);
}

function pruneDownloadJobs(jobs) {
  if (jobs.length <= 200) return jobs;
  const active = jobs.filter((job) => job.status === 'waiting' || job.status === 'downloading');
  const terminal = jobs.filter((job) => !active.includes(job)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return [...active, ...terminal.slice(0, Math.max(0, 200 - active.length))];
}

function notifyDownloadJobs(revision) {
  chrome.runtime.sendMessage({ action: 'download-jobs-changed', revision }).catch(() => {});
}

async function mutateDownloadQueue(mutator) {
  let result;
  let revision;
  const mutation = queueMutation.then(async () => {
    const queue = await loadDownloadQueue();
    result = await mutator(queue);
    queue.jobs = pruneDownloadJobs(queue.jobs);
    queue.revision = Number(queue.revision || 0) + 1;
    revision = queue.revision;
    await chrome.storage.local.set({ [DOWNLOAD_QUEUE_KEY]: queue });
  });
  // Keep serialization usable after a failed write, while rejecting this caller.
  queueMutation = mutation.catch(() => {});
  await mutation;
  notifyDownloadJobs(revision);
  return result;
}

function safeDownloadError(error, requestUrl = '') {
  let text = error instanceof Error ? error.message : String(error || 'Download failed');
  if (requestUrl) text = text.split(requestUrl).join('[URL]');
  return text.replace(/https?:\/\/\S+/gi, '[URL]').slice(0, 240);
}

async function getPublicDownloadJobs() {
  await ensureDownloadQueueReady();
  await refreshActiveDownloads();
  const queue = await loadDownloadQueue();
  return {
    ok: true,
    revision: queue.revision,
    jobs: queue.jobs.map(WebMediaDownloadJobs.publicJob).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
}

let progressRefresh;
function refreshActiveDownloads() {
  if (progressRefresh) return progressRefresh;
  progressRefresh = (async () => {
    const snapshot = await loadDownloadQueue();
    const updates = await Promise.all(snapshot.jobs
      .filter((job) => ['downloading', 'completed'].includes(job.status) && Number.isInteger(job.downloadId))
      .map(async (job) => {
        const [item] = await chrome.downloads.search({ id: job.downloadId });
        return item;
      }));
    const telegramUpdates = await Promise.all(snapshot.jobs
      .filter((job) => job.status === 'downloading' && job.request?.kind === 'telegram' && !Number.isInteger(job.downloadId))
      .map(async (job) => {
        try {
          if (job.launch?.handedOffAt) {
            const download = await findRecentDownload(job.launch.filename, job.launch.handedOffAt, null, 1);
            return { jobId: job.id, download, expired: Date.now() - Date.parse(job.launch.handedOffAt) > 120_000 };
          }
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: job.request.tabId }, world: 'MAIN',
            func: (token) => globalThis.WebMediaTelegramInPage?.getCapturedProgress?.(token),
            args: [job.request.token],
          });
          return { jobId: job.id, progress: result?.result };
        } catch { return { jobId: job.id }; }
      }));
    let terminal = false;
    const outcomes = [];
    // Do not broadcast a refresh: popup reads must not trigger a message/read loop.
    const mutation = queueMutation.then(async () => {
      const queue = await loadDownloadQueue();
      let changed = false;
      for (const update of telegramUpdates) {
        const job = queue.jobs.find((entry) => entry.id === update.jobId && entry.status === 'downloading');
        if (!job) continue;
        if (update.download) {
          job.downloadId = update.download.id;
          job.launch = null;
          updates.push(update.download);
          changed = true;
        } else if (update.expired) {
          job.status = 'failed';
          job.errorCode = 'HANDOFF_UNCONFIRMED';
          job.errorMessage = 'Telegram took over; completion could not be confirmed. Check Downloads before retrying.';
          job.updatedAt = job.completedAt = new Date().toISOString();
          terminal = changed = true;
        } else if (update.progress) {
          const { bytes, total } = update.progress;
          if (Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(total) && total > 0 && bytes <= total) {
            job.bytesReceived = bytes;
            job.totalBytes = total;
            // 100% is reserved for completed jobs; buffered bytes still need saving.
            job.progressPercent = Math.min(99, Math.floor(bytes * 100 / total));
            changed = true;
          }
        }
      }
      for (const item of updates.filter(Boolean)) {
        const index = queue.jobs.findIndex((job) => ['downloading', 'completed'].includes(job.status) && job.downloadId === item.id);
        if (index < 0) continue;
        const job = queue.jobs[index];
        if (job.status === 'completed') {
          if (item.state === 'complete' && Number.isSafeInteger(item.bytesReceived) && item.bytesReceived >= 0 && (job.bytesReceived !== item.bytesReceived || job.totalBytes !== (item.totalBytes > 0 ? item.totalBytes : null))) {
            job.bytesReceived = item.bytesReceived;
            job.totalBytes = item.totalBytes > 0 ? item.totalBytes : null;
            changed = true;
          }
          continue;
        }
        if (job.bytesReceived === item.bytesReceived && job.totalBytes === item.totalBytes && item.state === 'in_progress') continue;
        const next = WebMediaDownloadJobs.applyDownloadDelta(job, {
          id: item.id, state: { current: item.state },
          bytesReceived: { current: item.bytesReceived }, totalBytes: { current: item.totalBytes },
          error: { current: item.error },
        });
        if (next.status === 'failed') next.errorMessage = safeDownloadError(next.errorMessage, next.request?.url);
        terminal ||= ['completed', 'failed'].includes(next.status);
        if (['completed', 'failed'].includes(next.status)) outcomes.push(next);
        queue.jobs[index] = next;
        changed = true;
      }
      if (changed) {
        queue.revision += 1;
        await chrome.storage.local.set({ [DOWNLOAD_QUEUE_KEY]: queue });
      }
    });
    queueMutation = mutation.catch(() => {});
    await mutation;
    await Promise.all(outcomes.map(recordGenericJob));
    if (terminal) await pumpDownloadQueue();
  })().finally(() => { progressRefresh = null; });
  return progressRefresh;
}

async function launchDownloadJob(jobId) {
  const queue = await loadDownloadQueue();
  const job = queue.jobs.find((entry) => entry.id === jobId && entry.status === 'downloading');
  if (!job?.request?.url) return;
  if (job.request.kind) {
    void launchSmartJob(job).catch(() => {});
    return;
  }
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url: job.request.url,
      filename: job.filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    await mutateDownloadQueue((next) => {
      const current = next.jobs.find((entry) => entry.id === jobId && entry.status === 'downloading');
      if (current) {
        current.downloadId = downloadId;
        current.launch = null;
        current.updatedAt = new Date().toISOString();
      }
    });
  } catch (error) {
    const failedJob = await mutateDownloadQueue((next) => {
      const current = next.jobs.find((entry) => entry.id === jobId && entry.status === 'downloading');
      if (!current) return;
      current.status = 'failed';
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
      current.errorCode = 'DOWNLOAD_START_FAILED';
      current.errorMessage = safeDownloadError(error, current.request?.url);
      current.launch = null;
      return { ...current };
    });
    await recordGenericJob(failedJob);
    await pumpDownloadQueue();
    return;
  }
  // A small/cached file can finish before its ID is persisted. Read its current
  // state after registration so an earlier onChanged event cannot strand it.
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (download) await applyDownloadChange({
    id: downloadId,
    state: { current: download.state },
    bytesReceived: { current: download.bytesReceived },
    totalBytes: { current: download.totalBytes },
    ...(download.error ? { error: { current: download.error } } : {}),
  });
}

async function pumpDownloadQueue() {
  const launchIds = await mutateDownloadQueue((queue) => {
    const active = queue.jobs.filter((job) => job.status === 'downloading').length;
    const waiting = queue.jobs.filter((job) => job.status === 'waiting').slice(0, Math.max(0, MAX_ACTIVE_DOWNLOADS - active));
    const now = new Date().toISOString();
    for (const job of waiting) Object.assign(job, WebMediaDownloadJobs.startWaitingJob(job, now));
    return waiting.map((job) => job.id);
  });
  await Promise.all(launchIds.map(launchDownloadJob));
}

async function downloadMedia(message) {
  await ensureDownloadQueueReady();
  const rawItems = Array.isArray(message.items) ? message.items.slice(0, 200) : [];
  const rootFolder = message.rootFolder || 'WebMedia';
  let failed = 0;
  const jobIds = [];
  await mutateDownloadQueue((queue) => {
    rawItems.forEach((item, index) => {
      try {
        const parsed = new URL(item?.url || '');
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('INVALID_URL');
        if (!['image', 'video'].includes(item.type)) throw new Error('INVALID_TYPE');
        const downloadIndex = Number.isInteger(item.downloadIndex) && item.downloadIndex > 0 ? item.downloadIndex : index + 1;
        const filename = WebMediaDownloads.buildDownloadPath(rootFolder, item.url, item.type, downloadIndex);
        const id = crypto.randomUUID();
        queue.jobs.push(WebMediaDownloadJobs.createDownloadJob({ id, item: { ...item, downloadIndex }, filename }));
        jobIds.push(id);
      } catch {
        failed += 1;
      }
    });
  });
  await pumpDownloadQueue();
  return { ok: jobIds.length > 0, queued: jobIds.length, failed, jobIds };
}

async function retryDownloadJob(jobId) {
  await ensureDownloadQueueReady();
  let ok = false;
  let freshScan = false;
  await mutateDownloadQueue((queue) => {
    const index = queue.jobs.findIndex((job) => job.id === jobId);
    if (index < 0) return;
    freshScan = WebMediaDownloadJobs.needsFreshScan(queue.jobs[index]);
    const retry = WebMediaDownloadJobs.retryFailedJob(queue.jobs[index]);
    if (!retry) return;
    queue.jobs[index] = retry;
    ok = true;
  });
  if (ok) await pumpDownloadQueue();
  return { ok, errorCode: ok ? null : freshScan ? 'FRESH_SCAN_REQUIRED' : 'INVALID_STATE',
    ...(freshScan ? { error: 'Scan the page again for a fresh media URL; the saved URL was denied or expired.' } : {}) };
}

async function cancelDownloadJob(jobId) {
  await ensureDownloadQueueReady();
  let ok = false;
  await mutateDownloadQueue((queue) => {
    const result = WebMediaDownloadJobs.cancelWaitingJob(queue.jobs, jobId);
    ok = result.ok;
    queue.jobs = result.jobs;
  });
  return { ok, errorCode: ok ? null : 'INVALID_STATE' };
}

async function applyDownloadChange(delta) {
  if (['complete', 'interrupted'].includes(delta.state?.current)) {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item) delta = { ...delta,
      ...(Number.isSafeInteger(item.bytesReceived) && item.bytesReceived >= 0 ? { bytesReceived: { current: item.bytesReceived } } : {}),
      ...(Number.isFinite(item.totalBytes) ? { totalBytes: { current: item.totalBytes } } : {}),
      ...(item.error ? { error: { current: item.error } } : {}),
    };
  }
  let terminal = false;
  let outcome;
  await mutateDownloadQueue((queue) => {
    const index = queue.jobs.findIndex((job) => job.status === 'downloading' && job.downloadId === delta.id);
    if (index < 0) return;
    const next = WebMediaDownloadJobs.applyDownloadDelta(queue.jobs[index], delta);
    if (next.status === 'failed') next.errorMessage = safeDownloadError(next.errorMessage, next.request?.url);
    terminal = ['completed', 'failed'].includes(next.status);
    queue.jobs[index] = next;
    if (terminal) outcome = next;
  });
  await recordGenericJob(outcome);
  if (terminal) await pumpDownloadQueue();
}

chrome.downloads.onChanged.addListener((delta) => {
  void ensureDownloadQueueReady().then(() => applyDownloadChange(delta)).catch(() => {});
  if (delta.state?.current === 'complete') void recordCompletedTelegramChromeDownload(delta.id).catch(() => {});
});

async function reconcileDownloadQueue() {
  await serializeDownloadState(async () => {
  const queue = await loadDownloadQueue();
  for (const job of queue.jobs.filter((entry) => entry.status === 'downloading')) {
    if (!Number.isInteger(job.downloadId)) {
      job.status = job.request?.kind ? 'failed' : 'waiting';
      if (job.request?.kind) {
        job.errorCode = 'SESSION_INTERRUPTED';
        job.errorMessage = 'Download session ended. Check saved files before retrying.';
      }
      job.launch = null;
      continue;
    }
    const [download] = await chrome.downloads.search({ id: job.downloadId });
    if (!download) {
      job.status = 'failed';
      job.errorCode = 'DOWNLOAD_MISSING';
      job.errorMessage = 'Chrome download could not be found';
      job.completedAt = new Date().toISOString();
      continue;
    }
    job.bytesReceived = Number(download.bytesReceived) || 0;
    job.totalBytes = Number(download.totalBytes) > 0 ? Number(download.totalBytes) : job.totalBytes;
    if (download.state === 'complete') Object.assign(job, WebMediaDownloadJobs.applyDownloadDelta(job, { id: job.downloadId, state: { current: 'complete' }, bytesReceived: { current: job.totalBytes || job.bytesReceived }, totalBytes: { current: job.totalBytes } }));
    else if (download.state === 'interrupted') Object.assign(job, WebMediaDownloadJobs.applyDownloadDelta(job, { id: job.downloadId, state: { current: 'interrupted' }, error: { current: download.error || 'DOWNLOAD_INTERRUPTED' } }));
  }
  queue.revision = Number(queue.revision || 0) + 1;
  await chrome.storage.local.set({ [DOWNLOAD_QUEUE_KEY]: queue });
  notifyDownloadJobs(queue.revision);
  });
  await pumpDownloadQueue();
}

function ensureDownloadQueueReady() {
  if (!queueReadyPromise) queueReadyPromise = reconcileDownloadQueue().catch((error) => {
    queueReadyPromise = null;
    throw error;
  });
  return queueReadyPromise;
}

void ensureDownloadQueueReady().catch(() => {});
