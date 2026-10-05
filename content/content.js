(() => {
  'use strict';

  const CONTENT_BRIDGE_VERSION = '1.1.0-chrome-history-fallback-1';
  if (globalThis.__wmgContentBridgeVersion === CONTENT_BRIDGE_VERSION) return;
  try { globalThis.__wmgContentBridgeCleanup?.(); } catch {}

  let revision = 0;
  const TELEGRAM_MESSAGE_SELECTOR = '.message-list-item, .Message, [data-message-id], [data-mid], .bubble, .message';

  function telegramVariant() {
    const segment = location.pathname.split('/').filter(Boolean)[0] || 'root';
    return ['a', 'k', 'z'].includes(segment) ? segment : 'other';
  }

  function logDiagnostic(event, details = {}) {
    chrome.runtime.sendMessage({
      action: 'diagnostic-log',
      entry: { source: 'content', event, details: { variant: telegramVariant(), ...details } },
    }).catch(() => {});
  }

  function refreshTrackedTelegramMedia() {
    if (location.hostname !== 'web.telegram.org') return;
    const message = document.querySelector('[data-wmg-current-message="true"]');
    if (!message) return;
    const media = [...message.querySelectorAll('video, img')].find((element) => {
      const source = element.currentSrc || element.src || '';
      return element.tagName === 'VIDEO' && source.startsWith('blob:https://web.telegram.org/');
    }) || [...message.querySelectorAll('video, img')].find((element) => {
      const source = element.currentSrc || element.src || '';
      return source.startsWith('blob:https://web.telegram.org/');
    }) || message.querySelector('video');
    if (!media) return;
    document.querySelectorAll('[data-wmg-current-media="true"]').forEach((element) => {
      if (element !== media) element.removeAttribute('data-wmg-current-media');
    });
    media.setAttribute('data-wmg-current-media', 'true');
    if (!media.getAttribute('data-wmg-filename')) {
      media.setAttribute('data-wmg-filename', `telegram-${media.tagName === 'VIDEO' ? 'video.mp4' : 'image.jpg'}`);
    }
  }

  let telegramClickHandler = null;
  if (location.hostname === 'web.telegram.org') {
    logDiagnostic('content-loaded', {
      readyState: document.readyState,
      mainBridgeMarker: document.documentElement.dataset.wmgTelegramMedia || 'none',
    });
    telegramClickHandler = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const mediaHit = target?.closest('video, img, [class*="video" i], [class*="media" i], [class*="photo" i]');
      const message = mediaHit?.closest(TELEGRAM_MESSAGE_SELECTOR);
      if (!message) return;
      document.querySelectorAll('[data-wmg-current-message="true"]').forEach((element) => {
        if (element !== message) element.removeAttribute('data-wmg-current-message');
      });
      message.setAttribute('data-wmg-current-message', 'true');
      refreshTrackedTelegramMedia();
      setTimeout(refreshTrackedTelegramMedia, 250);
      setTimeout(refreshTrackedTelegramMedia, 1000);
      revision += 1;
    };
    document.addEventListener('click', telegramClickHandler, true);
  }

  const observer = new MutationObserver(() => {
    revision += 1;
    refreshTrackedTelegramMedia();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'poster', 'style', 'data-src', 'data-original', 'data-lazy-src'],
  });

  function pageMetadata() {
    return {
      title: document.title || '',
      url: window.location.href,
      domain: window.location.hostname,
    };
  }

  function scanCurrentPage() {
    const adapters = globalThis.WebMediaSiteAdapters;
    const site = adapters.detectSite(window.location.href);

    if (site === 'x') {
      const context = adapters.collectXContext(document, window.location.href);
      const items = context.images.map((url) => ({
        url,
        type: 'image',
        source: 'x-original',
        width: 0,
        height: 0,
        alt: 'X post image',
      }));
      return {
        ok: true,
        revision,
        site,
        page: pageMetadata(),
        items,
        duplicateCount: context.duplicateCount || 0,
        unsupported: 0,
        smartTarget: context.hasVideo && context.statusUrl
          ? { mode: 'x-video', url: context.statusUrl, label: 'Download highest-quality X video' }
          : null,
        context,
      };
    }

    if (site === 'telegram') {
      const currentMediaType = document.documentElement.dataset.wmgTelegramMedia || '';
      const mediaReady = currentMediaType === 'image' || currentMediaType === 'video';
      const viewerA = Boolean(document.querySelector('#MediaViewer'));
      const viewerK = Boolean(document.querySelector('.media-viewer-whole.active, .media-viewer-whole'));
      logDiagnostic('telegram-scan', {
        revision,
        mediaReady,
        mediaType: currentMediaType || 'none',
        viewerA,
        viewerK,
        visibleImages: [...document.querySelectorAll('img')].filter((element) => element.getBoundingClientRect().width > 0).length,
        visibleVideos: [...document.querySelectorAll('video')].filter((element) => element.getBoundingClientRect().width > 0).length,
      });
      return {
        ok: true,
        revision,
        site,
        page: pageMetadata(),
        items: [],
        unsupported: 0,
        smartTarget: mediaReady
          ? {
              mode: 'telegram-button',
              mediaType: currentMediaType,
              label: `Download the ${currentMediaType} currently open in Telegram`,
            }
          : {
              mode: 'unsupported',
              label: 'Open one photo or video in Telegram, then reopen this popup',
            },
      };
    }

    return {
      ok: true,
      revision,
      site,
      ...globalThis.WebMediaScanner.scanDocument(document, window),
      smartTarget: null,
    };
  }

  const runtimeMessageHandler = (message, _sender, sendResponse) => {
    try {
      if (message?.action === 'scan-page') {
        sendResponse(scanCurrentPage());
        return false;
      }
      if (message?.action === 'telegram-trigger-download') {
        const mediaType = document.documentElement.dataset.wmgTelegramMedia || '';
        const triggered = mediaType === 'image' || mediaType === 'video';
        if (triggered) window.dispatchEvent(new CustomEvent('wmg-telegram-popup-download-request'));
        logDiagnostic('telegram-trigger', { triggered, mediaType: mediaType || 'none' });
        sendResponse({ ok: triggered, status: triggered ? 'triggered' : 'current_media_not_found', mediaType });
        return false;
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(runtimeMessageHandler);

  globalThis.__wmgContentBridgeVersion = CONTENT_BRIDGE_VERSION;
  globalThis.__wmgContentBridgeCleanup = () => {
    if (telegramClickHandler) document.removeEventListener('click', telegramClickHandler, true);
    observer.disconnect();
    try { chrome.runtime.onMessage.removeListener(runtimeMessageHandler); } catch {}
  };
})();
