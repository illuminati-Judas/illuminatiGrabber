(function initTelegramPageDownload(root) {
  'use strict';

  function safeFilename(value, type, tagName) {
    const cleaned = String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .trim()
      .slice(0, 120);
    if (cleaned) return cleaned;
    const extension = type === 'video/webm' ? 'webm'
      : type?.startsWith('video/') || tagName === 'VIDEO' ? 'mp4'
        : type === 'image/png' ? 'png'
          : type === 'image/webp' ? 'webp'
            : 'jpg';
    return `telegram-${Date.now()}.${extension}`;
  }

  async function downloadCurrentTelegramBlob(options = {}) {
    const documentRef = options.documentRef || root.document;
    const fetchFn = options.fetchFn || root.fetch?.bind(root);
    const URLRef = options.URLRef || root.URL;
    const schedule = options.schedule || ((fn) => root.setTimeout(fn, 60_000));
    const media = documentRef?.querySelector?.('[data-wmg-current-media="true"]');
    if (!media) {
      return { ok: false, status: 'no_current_media', error: 'Click a Telegram image or video first.' };
    }

    const source = media.currentSrc || media.src || media.getAttribute?.('src') || '';
    if (!source.startsWith('blob:https://web.telegram.org/')) {
      return { ok: false, status: 'not_blob', error: 'Current media is not a Telegram blob URL.' };
    }

    try {
      const response = await fetchFn(source);
      if (!response?.ok) throw new Error(`Blob fetch returned HTTP ${response?.status || 'error'}`);
      const blob = await response.blob();
      if (!blob?.size) throw new Error('Telegram returned an empty media blob');

      const objectUrl = URLRef.createObjectURL(blob);
      const filename = safeFilename(media.getAttribute?.('data-wmg-filename'), blob.type, media.tagName);
      const anchor = documentRef.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = 'none';
      documentRef.body?.append?.(anchor);
      anchor.click();
      anchor.remove?.();
      schedule(() => URLRef.revokeObjectURL(objectUrl));
      return { ok: true, status: 'triggered', filename, size: blob.size, type: blob.type || '' };
    } catch (error) {
      return {
        ok: false,
        status: 'blob_fetch_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const api = { downloadCurrentTelegramBlob };
  root.WebMediaTelegramPageDownload = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
