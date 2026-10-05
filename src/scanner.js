(function initScanner(root) {
  'use strict';

  const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico']);
  const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
  const LAZY_ATTRIBUTES = ['data-src', 'data-original', 'data-lazy-src', 'data-url'];
  const MAX_STYLE_ELEMENTS = 5000;

  function normalizeUrl(value, baseUrl) {
    if (!value || typeof value !== 'string') return null;
    try {
      const parsed = new URL(value.trim(), baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      parsed.hash = '';
      return parsed.href;
    } catch {
      return null;
    }
  }

  function parseSrcset(value) {
    if (!value || typeof value !== 'string') return [];
    return value
      .split(',')
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function extractCssUrls(value) {
    if (!value || typeof value !== 'string') return [];
    const urls = [];
    const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let match;
    while ((match = pattern.exec(value))) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
  }

  function extensionFromUrl(value) {
    try {
      const pathname = new URL(value).pathname;
      const filename = pathname.split('/').pop() || '';
      const dot = filename.lastIndexOf('.');
      return dot > -1 ? filename.slice(dot + 1).toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function classifyMedia(value) {
    const extension = extensionFromUrl(value);
    if (IMAGE_EXTENSIONS.has(extension)) return 'image';
    if (VIDEO_EXTENSIONS.has(extension)) return 'video';
    return null;
  }

  function metadataScore(item) {
    return (Number(item.width) || 0) * (Number(item.height) || 0) + (item.source === 'img' || item.source === 'video' ? 1 : 0);
  }

  function parseSrcsetDetailed(value) {
    return String(value || '').split(',').map((part) => {
      const [url, descriptor = '1x'] = part.trim().split(/\s+/);
      const match = descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/);
      return { url, ...(match && Number(match[1]) > 0 ? { [match[2] === 'w' ? 'variantWidth' : 'density']: Number(match[1]) } : {}) };
    }).filter((candidate) => candidate.url);
  }

  function isXImage(url) {
    return url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/');
  }

  function representationScore(item) {
    let url;
    try { url = new URL(item.url); } catch { return 0; }
    if (isXImage(url)) {
      const names = { thumb: 150, small: 680, medium: 1200, large: 2048, orig: Number.MAX_SAFE_INTEGER };
      const edge = names[url.searchParams.get('name')];
      if (edge) return edge * edge;
    }
    const requestedWidth = Number(url.searchParams.get('w') || url.searchParams.get('width'));
    const requestedHeight = Number(url.searchParams.get('h') || url.searchParams.get('height'));
    if (item.variantWidth) return Number(item.variantWidth) ** 2;
    if (requestedWidth || requestedHeight) return (requestedWidth || requestedHeight) * (requestedHeight || requestedWidth);
    if (item.width && item.height) return Number(item.width) * Number(item.height);
    return (Number(item.width) || Number(item.density) || 0) ** 2;
  }

  function canonicalMediaKey(value) {
    try {
      const url = new URL(value);
      url.hash = '';
      // Unknown query parameters may identify a different file or a signed URL.
      // Only recognize bounded resize parameters on explicit image paths.
      if (IMAGE_EXTENSIONS.has(extensionFromUrl(value))) {
        for (const key of ['w', 'width', 'h', 'height']) {
          if (/^\d+$/.test(url.searchParams.get(key) || '')) url.searchParams.delete(key);
        }
      }
      if (isXImage(url) && /^(thumb|small|medium|large|orig)$/.test(url.searchParams.get('name') || '')) url.searchParams.delete('name');
      url.searchParams.sort();
      return url.href;
    } catch {
      return String(value || '');
    }
  }

  function dedupeMediaDetailed(items) {
    const byKey = new Map();
    const groups = new Map();
    const parent = new Map();
    const find = (key) => {
      if (!parent.has(key)) parent.set(key, key);
      if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
      return parent.get(key);
    };
    for (const item of items) {
      if (!item?.url || !item.variantGroup || item.type !== 'image') continue;
      const key = canonicalMediaKey(item.url);
      if (groups.has(item.variantGroup)) parent.set(find(key), find(groups.get(item.variantGroup)));
      else groups.set(item.variantGroup, key);
    }
    let duplicateCount = 0;
    for (const item of items) {
      if (!item || !item.url) continue;
      const key = `${item.type}:${find(canonicalMediaKey(item.url))}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...item });
        continue;
      }
      duplicateCount += 1;
      const sameUrl = normalizeUrl(item.url, item.url) === normalizeUrl(existing.url, existing.url);
      const richer = sameUrl ? metadataScore(item) > metadataScore(existing)
        : representationScore(item) > representationScore(existing)
          || (representationScore(item) === representationScore(existing) && metadataScore(item) > metadataScore(existing));
      const merged = { ...(richer ? item : existing) };
      merged.url = richer ? item.url : existing.url;
      if (sameUrl) {
        merged.protected = Boolean(item.protected || existing.protected);
        merged.bytes = Math.max(Number(existing.bytes) || 0, Number(item.bytes) || 0);
        merged.decodedBytes = Math.max(Number(existing.decodedBytes) || 0, Number(item.decodedBytes) || 0);
        merged.duration = Number.isFinite(item.duration) ? item.duration : existing.duration;
        merged.posterUrl = item.posterUrl || existing.posterUrl || null;
        merged.mimeType = item.mimeType || existing.mimeType || null;
      }
      merged.order = Math.min(Number.isFinite(existing.order) ? existing.order : Infinity, Number.isFinite(item.order) ? item.order : Infinity);
      if (!Number.isFinite(merged.order)) delete merged.order;
      byKey.set(key, merged);
    }
    return { items: [...byKey.values()], duplicateCount };
  }

  function dedupeMedia(items) {
    return dedupeMediaDetailed(items).items;
  }

  function scanDocument(doc, win) {
    const baseUrl = doc.baseURI || win.location.href;
    const found = [];
    let unsupported = 0;
    let order = 0;

    function add(rawUrl, hint, source, metadata = {}) {
      if (!rawUrl) return;
      const url = normalizeUrl(rawUrl, baseUrl);
      if (!url) {
        if (/^(blob:|data:)/i.test(String(rawUrl).trim())) unsupported += 1;
        return;
      }
      const type = classifyMedia(url) || hint;
      if (!type || !['image', 'video'].includes(type)) return;
      found.push({ url, type, source, order: order++, ...metadata });
    }

    for (const image of doc.images || []) {
      const metadata = {
        width: Number(image.naturalWidth || image.width || 0),
        height: Number(image.naturalHeight || image.height || 0),
        alt: image.alt || '',
      };
      const variantGroup = `img-${order}`;
      add(image.currentSrc || image.src, 'image', 'img', { ...metadata, variantGroup });
      for (const candidate of parseSrcsetDetailed(image.getAttribute?.('srcset'))) {
        const variantWidth = candidate.variantWidth || (candidate.density && image.width ? candidate.density * image.width : 0);
        add(candidate.url, 'image', 'srcset', { ...candidate, url: normalizeUrl(candidate.url, baseUrl), variantGroup, variantWidth, width: variantWidth, height: 0 });
      }
      for (const attribute of LAZY_ATTRIBUTES) add(image.getAttribute?.(attribute), 'image', attribute, metadata);
    }

    for (const source of doc.querySelectorAll?.('picture source[srcset]') || []) {
      const variantGroup = `picture-${order}`;
      for (const candidate of parseSrcsetDetailed(source.getAttribute('srcset'))) add(candidate.url, 'image', 'picture', {
        variantGroup, variantWidth: candidate.variantWidth, density: candidate.density, width: candidate.variantWidth || 0, height: 0,
      });
    }

    for (const video of doc.querySelectorAll?.('video') || []) {
      const duration = Number(video.duration);
      const posterUrl = normalizeUrl(video.poster, baseUrl);
      const metadata = {
        width: Number(video.videoWidth || video.width || 0),
        height: Number(video.videoHeight || video.height || 0),
        duration: Number.isFinite(duration) && duration >= 0 ? duration : null,
        posterUrl,
        protected: Boolean(video.mediaKeys),
      };
      add(video.currentSrc || video.src, 'video', 'video', metadata);
      add(video.poster, 'image', 'poster', metadata);
      for (const source of video.querySelectorAll?.('source[src]') || []) {
        const mimeType = ['video/mp4', 'video/webm'].includes(source.type) ? source.type : null;
        add(source.src || source.getAttribute('src'), 'video', 'video-source', { ...metadata, mimeType });
      }
    }

    for (const link of doc.querySelectorAll?.('a[href]') || []) {
      const href = link.href || link.getAttribute('href');
      const type = classifyMedia(normalizeUrl(href, baseUrl) || '');
      if (type) add(href, type, 'link');
    }

    const elements = [...(doc.querySelectorAll?.('*') || [])].slice(0, MAX_STYLE_ELEMENTS);
    for (const element of elements) {
      const inline = element.style?.backgroundImage || '';
      for (const url of extractCssUrls(inline)) add(url, 'image', 'background');
      if (win.getComputedStyle) {
        const computed = win.getComputedStyle(element).backgroundImage;
        if (computed && computed !== inline) {
          for (const url of extractCssUrls(computed)) add(url, 'image', 'background');
        }
      }
    }

    try {
      for (const entry of win.performance?.getEntriesByType?.('resource') || []) {
        const type = classifyMedia(entry.name);
        if (type) add(entry.name, type, 'network', {
          bytes: Number(entry.transferSize || entry.encodedBodySize || 0),
          decodedBytes: Number(entry.decodedBodySize || 0),
        });
      }
    } catch {
      // Resource timing can be restricted; DOM scanning remains available.
    }

    const deduped = dedupeMediaDetailed(found);
    const items = deduped.items.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    return {
      items,
      duplicateCount: deduped.duplicateCount,
      unsupported,
      truncatedStyles: elements.length >= MAX_STYLE_ELEMENTS,
      page: {
        title: doc.title || '',
        url: win.location.href,
        domain: win.location.hostname,
      },
    };
  }

  const api = {
    normalizeUrl,
    parseSrcset,
    parseSrcsetDetailed,
    extractCssUrls,
    classifyMedia,
    dedupeMedia,
    dedupeMediaDetailed,
    canonicalMediaKey,
    scanDocument,
  };

  root.WebMediaScanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
