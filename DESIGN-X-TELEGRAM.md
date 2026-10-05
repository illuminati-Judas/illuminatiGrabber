# illuminati Grabber 1.1 — X + Telegram Design

## Confirmed scope

- Chrome on macOS; current X post or current Telegram Web media/message only.
- Highest-quality video automatically when the source exposes downloadable streams.
- User manually logs in, passes age gates, and opens the target item.
- No login bypass, CAPTCHA bypass, DRM bypass, whole-account/channel scraping, or cookie export.
- Local-only Chrome Native Messaging helper; no localhost port or cloud service.

## Components

### Extension site adapters

- **GenericAdapter:** existing page-wide direct image/MP4/WebM scanner.
- **XAdapter:** identifies the current `x.com/<user>/status/<id>` article, extracts original `pbs.twimg.com` images, and sends the exact status URL to the native host for video.
- **TelegramAdapter:** inspects only the active media viewer or selected/current message. It uses direct HTTP(S) media when exposed and otherwise invokes Telegram's own visible Download control. It fails closed for inaccessible `blob:` media.

### Native host

Host name: `com.june.web_media_grabber`

Commands:

- `ping`
- `check_dependencies`
- `download_x`
- `download_direct`

Security invariants:

- Native Messaging only; no listening socket.
- Stable extension ID in the host allowlist.
- `download_x` accepts only canonical X/Twitter status URLs.
- Direct downloads accept only HTTP(S), reject loopback/private/link-local targets, and require an approved source-page host.
- Subprocesses use argument arrays with `shell=False`.
- Output stays under `~/Downloads/WebMedia`; traversal is rejected.
- No Cookie or browser-profile extraction.

### Download behavior

X video format:

```text
bestvideo*+bestaudio/best
```

Merged output: MP4 when ffmpeg can remux; otherwise the best source container returned by yt-dlp.

Telegram priority:

1. Direct HTTP(S) source from active viewer/current message.
2. Telegram's own visible Download button.
3. Explicit unsupported message for inaccessible blob/stream media.

## Packaging

A stable manifest key fixes the unpacked extension ID. A macOS installer app copies:

- Native host runtime to `~/Library/Application Support/WebMediaGrabber/`
- Host manifest to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- Bundled or discovered `yt-dlp` and `ffmpeg` paths

The installer is local/ad-hoc, not notarized, and must disclose first-open Gatekeeper handling.

## Verification

- Unit tests for URL canonicalization, X original-image rewriting, Telegram active-scope extraction, SSRF protection, output confinement, and native framing.
- Regression tests for existing generic scanner/download naming.
- Native host protocol test using length-prefixed JSON.
- Real public X post smoke test without cookies.
- Local direct-file download test through the native host.
- Chrome manifest/permission/static validation and release archive integrity.

## Decision log

| Decision | Reason |
|---|---|
| Native Messaging | No exposed loopback API and exact extension allowlist |
| Current item only | Prevent accidental bulk collection |
| No cookies exported | Reduce account/session exposure |
| Telegram built-in Download fallback | Uses Telegram's authorized client path instead of reconstructing private blobs |
| Fail closed on inaccessible blobs | Avoid bypass behavior and corrupt output |
