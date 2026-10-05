# illuminati Grabber — Design

## Understanding summary

- Chrome-only Manifest V3 extension for public pages that require no login.
- The user manually passes age gates; the extension never bypasses age checks, login, CAPTCHA, paywalls, or DRM.
- Scans rendered and lazy-loaded images plus direct MP4/WebM media URLs.
- Presents a local gallery with type filters, search, selection, and explicit download actions.
- Stores settings locally; no backend, analytics, telemetry, or browsing-history collection.
- Version 1 excludes HLS/DASH, DRM, blob reconstruction, and audio/video track merging.

## Assumptions

- Single-user local installation on Chrome for macOS.
- Typical public webpages, bounded to 5,000 DOM elements per scan to avoid page slowdown.
- Downloads use Chrome's Downloads API and remain subject to site access controls and Chrome's multiple-download prompts.

## Architecture

1. **Popup UI** — scan/rescan, filters, gallery, selection, and download controls.
2. **Injected scanner** — scans current DOM, lazy-load attributes, CSS backgrounds, video/source elements, direct media links, and matching Performance Resource entries.
3. **Background service worker** — validates download requests, creates safe paths, and invokes `chrome.downloads.download`.
4. **Local storage** — saves the destination folder and display settings only.

## Data flow

```text
User manually enters page / passes age gate
  -> Popup injects scanner into active tab
  -> Scanner normalizes and deduplicates exposed media URLs
  -> Popup displays selectable local gallery
  -> User explicitly confirms downloads
  -> Service worker uses Chrome Downloads API
```

## Security and privacy

- Minimum permissions: `activeTab`, `scripting`, `downloads`, and `storage`.
- No host permissions and no cookies/form/password access.
- Only `http:` and `https:` media URLs are downloadable.
- Extension UI renders text with DOM APIs, never page-provided HTML.
- File and folder names are sanitized.

## Error handling

- Restricted Chrome pages show a clear scan error.
- Unsupported `blob:`/`data:` media is excluded and reported in scan statistics.
- Individual download failures do not stop the remaining queue.
- Empty scans suggest scrolling, manually entering the site, and rescanning.

## Test strategy

- Node unit tests for URL normalization, srcset/CSS parsing, media classification, deduplication, and safe filenames.
- Browser integration fixture for post-age-gate dynamic DOM, lazy images, backgrounds, MP4/WebM sources, duplicates, and unsupported blobs.
- Manifest JSON validation and JavaScript syntax checks.
- Chrome launch smoke test with the unpacked extension.

## Decision log

| Decision | Alternatives | Reason |
|---|---|---|
| Vanilla JS + MV3 | React/Vite; native helper | Lowest install and maintenance overhead for v1 |
| Active-tab injection | Broad `<all_urls>` content script | Minimum permissions and better privacy |
| Direct image/MP4/WebM only | HLS/DASH/native ffmpeg | Avoids DRM ambiguity and native setup in v1 |
| Manual age-gate interaction | Auto-clicking/bypass | Consent and site controls remain user-controlled |
| Local-only state | Cloud history/backend | Privacy and simplicity |
