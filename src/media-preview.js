(function (root) {
  'use strict';

  function parseHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }

  function isSafeDirectVideo(item, site = 'generic') {
    if (!item || item.type !== 'video' || site === 'telegram' || item.protected || item.drm || item.encrypted) return false;
    const url = parseHttpUrl(item.url);
    if (!url || /\/stream\//i.test(url.pathname)) return false;
    return /\.(mp4|webm)$/i.test(url.pathname);
  }

  function normalizePosterUrl(value) {
    const url = parseHttpUrl(value);
    return url ? url.href : '';
  }

  function formatDuration(seconds) {
    const value = Number(seconds);
    if (seconds == null || seconds === '' || !Number.isFinite(value) || value < 0) return '';
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function captureVideoFrame(doc, item, { signal, timeout = 8000 } = {}) {
    if (!isSafeDirectVideo(item) || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const video = doc.createElement('video');
      let finished = false;
      let timer;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        video.onloadeddata = video.onseeked = video.onerror = video.onencrypted = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        resolve(result);
      };
      const abort = () => finish(null);
      const capture = () => {
        if (finished || signal?.aborted || video.mediaKeys) return abort();
        try {
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (!width || !height || !Number.isFinite(video.duration)) return abort();
          const canvas = doc.createElement('canvas');
          canvas.width = Math.min(360, width);
          canvas.height = Math.max(1, Math.round(height * canvas.width / width));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          finish({ posterUrl: canvas.toDataURL('image/jpeg', 0.75), width, height, duration: video.duration });
        } catch { abort(); }
      };
      video.crossOrigin = 'anonymous';
      video.referrerPolicy = 'no-referrer';
      video.preload = 'auto';
      video.muted = video.defaultMuted = true;
      video.volume = 0;
      video.playsInline = true;
      video.onencrypted = video.onerror = abort;
      video.onloadeddata = () => {
        if (!Number.isFinite(video.duration) || video.mediaKeys) return abort();
        video.onloadeddata = null;
        if (video.duration > 0.2) {
          video.onseeked = capture;
          try { video.currentTime = Math.min(0.1, video.duration / 2); } catch { capture(); }
        } else capture();
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, timeout);
      video.src = item.url;
      video.load();
    });
  }

  const api = { isSafeDirectVideo, normalizePosterUrl, formatDuration, captureVideoFrame };
  root.WebMediaPreview = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
