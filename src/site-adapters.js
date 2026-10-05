(function initSiteAdapters(root) {
  'use strict';

  function hostnameOf(value) {
    try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
    catch { return ''; }
  }

  function detectSite(value) {
    const host = hostnameOf(value);
    if (host === 'x.com' || host === 'twitter.com') return 'x';
    if (host === 'web.telegram.org') return 'telegram';
    return 'generic';
  }

  function canonicalXStatusUrl(value) {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (!['x.com', 'twitter.com'].includes(host)) return null;
      const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/|$)/);
      if (!match) return null;
      return `https://x.com/${match[1]}/status/${match[2]}`;
    } catch {
      return null;
    }
  }

  function xOriginalImageUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== 'pbs.twimg.com' || !parsed.pathname.startsWith('/media/')) return null;
      parsed.searchParams.set('name', 'orig');
      parsed.hash = '';
      return parsed.href;
    } catch {
      return null;
    }
  }

  function scopePriority(scope) {
    if (scope === 'active-viewer') return 0;
    if (scope === 'selected-message') return 1;
    if (scope === 'current-message') return 2;
    return 3;
  }

  function selectTelegramTarget(candidates) {
    const visible = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate?.visible !== false);
    if (!visible.length) {
      return { mode: 'unsupported', reason: 'Open a Telegram media viewer or select one message first.' };
    }

    const bestPriority = Math.min(...visible.map((candidate) => scopePriority(candidate.scope)));
    const current = visible.filter((candidate) => scopePriority(candidate.scope) === bestPriority);
    const direct = current.find((candidate) => {
      try { return ['http:', 'https:'].includes(new URL(candidate.url).protocol) && ['image', 'video'].includes(candidate.type); }
      catch { return false; }
    });
    if (direct) return { mode: 'direct', url: direct.url, type: direct.type, scope: direct.scope };

    const pageBlob = current.find((candidate) =>
      typeof candidate.url === 'string'
      && candidate.url.startsWith('blob:https://web.telegram.org/')
      && ['image', 'video'].includes(candidate.type),
    );
    if (pageBlob) return { mode: 'page-blob', type: pageBlob.type, scope: pageBlob.scope };

    const button = current.find((candidate) => candidate.action === 'telegram-download-button');
    if (button) return { mode: 'telegram-button', scope: button.scope };

    return { mode: 'unsupported', reason: 'Current Telegram media is not exposed as a downloadable file.' };
  }

  function isVisible(element, win) {
    if (!element) return false;
    const style = win?.getComputedStyle ? win.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function collectXContext(doc, locationHref) {
    const statusUrl = canonicalXStatusUrl(locationHref);
    if (!statusUrl) return { site: 'x', statusUrl: null, images: [], hasVideo: false };
    const statusId = statusUrl.split('/').pop();
    const articles = [...(doc.querySelectorAll?.('article') || [])];
    const article = articles.find((candidate) =>
      [...(candidate.querySelectorAll?.('a[href]') || [])].some((anchor) => String(anchor.href || anchor.getAttribute?.('href') || '').includes(`/status/${statusId}`)),
    ) || articles[0] || null;

    const images = [];
    let imageElements = [...(article?.querySelectorAll?.('img[src*="pbs.twimg.com/media"]') || [])];
    let isPhotoRoute = false;
    try { isPhotoRoute = /\/photo\/\d+(?:\/|$)/.test(new URL(locationHref).pathname); }
    catch { isPhotoRoute = false; }
    if (isPhotoRoute) {
      imageElements = [...(doc.querySelectorAll?.('img[src*="pbs.twimg.com/media"]') || [])]
        .filter((image) => isVisible(image, doc.defaultView))
        .sort((left, right) => {
          const a = left.getBoundingClientRect?.() || { width: 0, height: 0 };
          const b = right.getBoundingClientRect?.() || { width: 0, height: 0 };
          return (b.width * b.height) - (a.width * a.height);
        })
        .slice(0, 1);
    }
    let duplicateCount = 0;
    for (const image of imageElements) {
      const original = xOriginalImageUrl(image.currentSrc || image.src);
      if (original && !images.includes(original)) images.push(original);
      else if (original) duplicateCount += 1;
    }
    const hasVideo = Boolean(article?.querySelector?.('video, [data-testid="videoPlayer"]'));
    return { site: 'x', statusUrl, images, hasVideo, duplicateCount };
  }

  function findTelegramScope(doc) {
    const viewerSelectors = [
      'dialog#MediaViewer[open]', '#MediaViewer[open]', '#MediaViewer',
      '.media-viewer-whole.active', '.media-viewer-whole',
      '.MediaViewer', '.media-viewer', '.story-viewer', '.lightbox', '.popup-media',
      '[role="dialog"]',
    ];
    for (const selector of viewerSelectors) {
      const candidates = [...(doc.querySelectorAll?.(selector) || [])];
      const visible = candidates.find((element) => isVisible(element, doc.defaultView));
      if (visible) return { element: visible, scope: 'active-viewer' };
    }

    const clickedMessages = [...(doc.querySelectorAll?.('[data-wmg-current-message="true"]') || [])];
    const clickedMessage = clickedMessages.find((element) => isVisible(element, doc.defaultView));
    if (clickedMessage) return { element: clickedMessage, scope: 'current-message' };

    const selectedSelectors = [
      '[aria-selected="true"]', '.message.selected', '.message-list-item.selected',
      '.Message.selected', '.is-selected',
    ];
    for (const selector of selectedSelectors) {
      const candidates = [...(doc.querySelectorAll?.(selector) || [])];
      const visible = candidates.find((element) => isVisible(element, doc.defaultView));
      if (visible) return { element: visible, scope: 'selected-message' };
    }
    return null;
  }

  function collectTelegramCandidates(doc) {
    const active = findTelegramScope(doc);
    if (!active) return [];
    const { element, scope } = active;
    const candidates = [];

    for (const image of element.querySelectorAll?.('img') || []) {
      const url = image.currentSrc || image.src;
      if (url) candidates.push({ scope, url, type: 'image', visible: isVisible(image, doc.defaultView) });
    }
    for (const video of element.querySelectorAll?.('video') || []) {
      const url = video.currentSrc || video.src;
      if (url) candidates.push({ scope, url, type: 'video', visible: isVisible(video, doc.defaultView) });
    }

    const controls = [...(element.querySelectorAll?.('button, a[role="button"], a[download], [title], [aria-label], .quality-download-options-button-menu') || [])];
    const download = controls.find((control) => {
      const label = `${control.getAttribute?.('aria-label') || ''} ${control.getAttribute?.('title') || ''} ${control.textContent || ''}`;
      const hasDownloadAttribute = control.getAttribute?.('download') !== null;
      const isKnownDownloadButton = control.matches?.('.quality-download-options-button-menu, .tgico-download');
      return (hasDownloadAttribute || isKnownDownloadButton || /download|save|ดาวน์โหลด/i.test(label))
        && isVisible(control, doc.defaultView);
    });
    if (download) candidates.push({ scope, action: 'telegram-download-button', visible: true });
    return candidates;
  }

  function triggerTelegramDownload(doc) {
    const active = findTelegramScope(doc);
    if (!active) return false;
    const controls = [...(active.element.querySelectorAll?.('button, a[role="button"], a[download], [title], [aria-label], .quality-download-options-button-menu') || [])];
    const button = controls.find((control) => {
      const label = `${control.getAttribute?.('aria-label') || ''} ${control.getAttribute?.('title') || ''} ${control.textContent || ''}`;
      const hasDownloadAttribute = control.getAttribute?.('download') !== null;
      const isKnownDownloadButton = control.matches?.('.quality-download-options-button-menu, .tgico-download');
      return (hasDownloadAttribute || isKnownDownloadButton || /download|save|ดาวน์โหลด/i.test(label))
        && isVisible(control, doc.defaultView);
    });
    if (!button) return false;
    button.click();
    return true;
  }

  const api = {
    detectSite,
    canonicalXStatusUrl,
    xOriginalImageUrl,
    selectTelegramTarget,
    collectXContext,
    collectTelegramCandidates,
    triggerTelegramDownload,
  };

  root.WebMediaSiteAdapters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
