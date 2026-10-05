(function initGalleryModel(root) {
  'use strict';

  const THUMBNAIL_HINT = /(?:^|[\/_\-.])(thumb(?:nail)?|small|tiny|preview|avatar|icon)(?:[\/_\-.]|$)|[?&](?:w|width|h|height)=(?:[1-4]?\d{1,2})(?:&|$)/i;
  const ORIGINAL_HINT = /(?:^|[\/_\-.])(orig(?:inal)?|full|large|master|raw)(?:[\/_\-.]|$)|[?&](?:name|size)=orig(?:&|$)/i;

  function mediaQuality(item) {
    if (item?.type !== 'image') return item?.type === 'video' ? 'video' : 'thumbnail';
    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;
    const knownDimensions = width > 0 && height > 0;
    if (knownDimensions && (width < 200 || height < 200)) return 'low-res';
    const url = String(item.url || '');
    if (THUMBNAIL_HINT.test(url)) return 'thumbnail';
    if (ORIGINAL_HINT.test(url)) return 'original';
    if (knownDimensions && width >= 500 && height >= 500 && width * height >= 250000) return 'original';
    return 'thumbnail';
  }

  function filterAndSortMedia(items, options = {}) {
    const query = String(options.query || '').toLowerCase();
    const type = options.type || 'all';
    const filtered = (Array.isArray(items) ? items : []).filter((item) => {
      const quality = mediaQuality(item);
      if (type !== 'all' && item.type !== type) return false;
      if (options.hideSmall && quality === 'low-res') return false;
      if (options.originalOnly && item.type === 'image' && quality !== 'original') return false;
      if (query && !String(item.url || '').toLowerCase().includes(query) && !String(options.filename?.(item.url) || '').toLowerCase().includes(query)) return false;
      return true;
    });
    const indexed = filtered.map((item, index) => ({ item, index }));
    const metric = options.sort === 'resolution'
      ? (item) => (Number(item.width) || 0) * (Number(item.height) || 0)
      : options.sort === 'size'
        ? (item) => Number(item.bytes) || 0
        : null;
    if (metric) {
      indexed.sort((a, b) => metric(b.item) - metric(a.item) || a.index - b.index);
    }
    return indexed.map(({ item }) => item);
  }

  function computeVirtualRange(options = {}) {
    const itemCount = Math.max(0, Number(options.itemCount) || 0);
    const threshold = Number(options.threshold) || 60;
    if (itemCount < threshold) return { virtual: false, start: 0, end: itemCount, topSpacer: 0, bottomSpacer: 0 };
    const columns = Math.max(1, Number(options.columns) || 2);
    const rowHeight = Math.max(1, Number(options.rowHeight) || 220);
    const scrollTop = Math.max(0, Number(options.scrollTop) || 0);
    const viewportHeight = Math.max(rowHeight, Number(options.viewportHeight) || rowHeight * 3);
    const overscanRows = Math.max(0, Number(options.overscanRows) || 3);
    const totalRows = Math.ceil(itemCount / columns);
    const firstVisibleRow = Math.floor(scrollTop / rowHeight);
    const visibleRows = Math.ceil(viewportHeight / rowHeight);
    const startRow = Math.max(0, firstVisibleRow - overscanRows);
    const endRow = Math.min(totalRows, firstVisibleRow + visibleRows + overscanRows);
    return {
      virtual: true,
      start: startRow * columns,
      end: Math.min(itemCount, endRow * columns),
      topSpacer: startRow * rowHeight,
      bottomSpacer: Math.max(0, (totalRows - endRow) * rowHeight),
    };
  }

  const api = { mediaQuality, filterAndSortMedia, computeVirtualRange };
  root.WebMediaGalleryModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
