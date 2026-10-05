(() => {
  'use strict';

  const BRIDGE_VERSION = '1.1.0-chrome-history-fallback-1';
  // Always replace the listener. A same-version marker can survive an extension
  // reload while its old chrome.runtime context is already invalid.
  try { globalThis.__wmgTelegramResultBridgeCleanup?.(); } catch {}

  const logDiagnostic = (event, details = {}) => {
    try {
      chrome.storage.local.get({ diagnosticLogs: [] }).then((stored) => {
        const logs = Array.isArray(stored.diagnosticLogs) ? stored.diagnosticLogs : [];
        logs.push({ timestamp: new Date().toISOString(), scope: 'telegram-result-bridge', event, details });
        return chrome.storage.local.set({ diagnosticLogs: logs.slice(-80) });
      }).catch(() => {});
    } catch {}
  };

  const downloadResultHandler = async () => {
    try {
      const raw = document.documentElement.dataset.wmgTelegramDownloadResult || '';
      delete document.documentElement.dataset.wmgTelegramDownloadResult;
      const record = JSON.parse(raw);
      const response = await chrome.runtime.sendMessage({ action: 'telegram-download-result', record });
      const recordId = typeof response?.recordId === 'string' ? response.recordId : '';
      if (!response?.ok || recordId !== record.id) throw new Error('Download could not be associated');
      window.dispatchEvent(new CustomEvent('wmg-telegram-download-recorded', {
        detail: { recordId, canShowInFolder: response.canShowInFolder === true },
      }));
    } catch (error) {
      logDiagnostic('telegram-download-result-invalid', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const showDownloadHandler = async (event) => {
    const recordId = typeof event.detail?.recordId === 'string' ? event.detail.recordId : '';
    let response = { ok: false, error: 'Invalid download record' };
    if (recordId) {
      response = await chrome.runtime.sendMessage({
        action: 'telegram-show-download', recordId,
      }).catch(() => ({ ok: false, error: 'Show in Finder failed' }));
    }
    window.dispatchEvent(new CustomEvent('wmg-telegram-show-download-result', {
      detail: {
        recordId,
        ok: response?.ok === true,
        ...(response?.ok ? {} : { error: String(response?.error || 'Show in Finder failed').slice(0, 160) }),
      },
    }));
  };

  window.addEventListener('wmg-telegram-download-result', downloadResultHandler);
  window.addEventListener('wmg-telegram-show-download-request', showDownloadHandler);
  globalThis.__wmgTelegramResultBridgeVersion = BRIDGE_VERSION;
  globalThis.__wmgTelegramResultBridgeCleanup = () => {
    window.removeEventListener('wmg-telegram-download-result', downloadResultHandler);
    window.removeEventListener('wmg-telegram-show-download-request', showDownloadHandler);
  };
  logDiagnostic('loaded', { version: BRIDGE_VERSION });
})();
