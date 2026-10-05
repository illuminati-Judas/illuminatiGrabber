(function initDownloads(root) {
  'use strict';

  function sanitizeSegment(value) {
    const cleaned = String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 120);
    return !cleaned || cleaned === '.' || cleaned === '..' ? 'untitled' : cleaned;
  }

  function filenameFromUrl(url, type, index) {
    let filename = '';
    try {
      const pathname = new URL(url).pathname;
      filename = decodeURIComponent(pathname.split('/').pop() || '');
    } catch {
      filename = '';
    }
    filename = sanitizeSegment(filename || `${type}-${index}`);
    if (!/\.[a-z0-9]{2,5}$/i.test(filename)) {
      const extension = type === 'video' ? 'mp4' : 'jpg';
      filename = `${filename}-${index}.${extension}`;
    }
    return filename;
  }

  function sanitizeRoot(rootFolder) {
    return String(rootFolder || 'WebMedia')
      .split('/')
      .filter(Boolean)
      .map(sanitizeSegment)
      .join('/') || 'WebMedia';
  }

  function buildDownloadPath(rootFolder, url, type, index) {
    const parsed = new URL(url);
    const domain = sanitizeSegment(parsed.hostname || 'website');
    const category = type === 'video' ? 'videos' : 'images';
    const filename = filenameFromUrl(url, type, index);
    return `${sanitizeRoot(rootFolder)}/${domain}/${category}/${filename}`;
  }

  const api = { sanitizeSegment, filenameFromUrl, buildDownloadPath };
  root.WebMediaDownloads = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
