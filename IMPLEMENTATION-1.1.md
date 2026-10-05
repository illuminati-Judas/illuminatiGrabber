# Implementation Plan — illuminati Grabber 1.1

1. Add pure site-adapter functions and failing tests:
   - identify supported hosts and canonical X status URLs;
   - rewrite X image URLs to original quality;
   - select only active Telegram viewer/message media;
   - describe smart actions for the popup.
2. Add native-host pure functions and failing tests:
   - native-message framing;
   - URL allowlists and SSRF rejection;
   - confined output directories;
   - command construction without shell invocation.
3. Integrate adapters into the injected content script and popup UI.
4. Generate one stable Chrome manifest key and derive the extension ID.
5. Implement the Python native host and a dependency/status protocol.
6. Build a user-level macOS installer app and uninstaller script.
7. Install dependencies for the POC, install the host, and verify `ping` plus direct download.
8. Smoke-test a public X status, then run all regressions and package release artifacts.
