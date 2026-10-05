(function initDiagnostics(root) {
  'use strict';

  const BUILD_ID = '1.1.0-history-queue-fix-2';
  const MAX_ENTRIES = 100;
  const ALLOWED_SOURCES = new Set(['popup', 'content', 'background', 'main']);

  function safeText(value, max = 160) {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, max);
  }

  function sanitizeDetails(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
    const output = {};
    for (const [key, value] of Object.entries(details).slice(0, 24)) {
      if (typeof value === 'boolean' || typeof value === 'number') output[safeText(key, 48)] = value;
      else if (typeof value === 'string') output[safeText(key, 48)] = safeText(value);
    }
    return output;
  }

  function normalizeEntry(input, now = new Date().toISOString()) {
    return {
      ts: now,
      build: BUILD_ID,
      source: ALLOWED_SOURCES.has(input?.source) ? input.source : 'background',
      event: safeText(input?.event || 'unknown', 80),
      details: sanitizeDetails(input?.details),
    };
  }

  function appendEntry(entries, input, now) {
    const current = Array.isArray(entries) ? entries : [];
    return [...current, normalizeEntry(input, now)].slice(-MAX_ENTRIES);
  }

  const api = { BUILD_ID, MAX_ENTRIES, normalizeEntry, appendEntry };
  root.WebMediaDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
