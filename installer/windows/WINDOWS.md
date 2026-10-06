# Windows x64 / Chrome

Download [`illuminatiGrabber-windows-x64.zip` from GitHub Releases](https://github.com/illuminati-Judas/illuminatiGrabber/releases/download/v1.1.0-windows.1/illuminatiGrabber-windows-x64.zip), then extract it
to a normal local folder. The repository's **Code → Download ZIP** is source code,
not the bundled Windows installer. Do not run from inside
Explorer's ZIP view. Windows 10/11 x64 is the build target (not Windows ARM64).

1. Run `installer\windows\install.cmd` as your normal user. No administrator,
   Python, pip, Homebrew, or separate ffmpeg/yt-dlp installation is required.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select `%LOCALAPPDATA%\WebMediaGrabber\extension`.
3. The stable extension ID is `kfdepjgimomjpdcamlkckoagnikohfkm`. Reload an existing
   card after upgrades, then refresh the target tab. Do not load a duplicate copy.

The installer checks the complete SHA-256 inventory before running any EXE,
checks native-message framing and executes both dependency version probes,
then registers `com.june.web_media_grabber` in HKCU in both registry views.
No Chrome registry discovery is needed: the host registration is independent
of Chrome's executable location. It installs only under LOCALAPPDATA and does
not change global execution policy. The CMD launcher uses a process-only policy
exception; enterprise policy may prohibit this, in which case stop and consult
IT rather than bypassing that policy. It opens only the installed folder, never
modifies Chrome profiles, and requires the manual Chrome security step above.

Run `installer\windows\uninstall.cmd` from the extracted release to unregister
the helper. Remove the extension card manually in Chrome. Downloads under
`%USERPROFILE%\Downloads\WebMedia`, unknown/modified installed files, other
native hosts, and replacement registrations are preserved. Upgrades retain the
previous owned installation in a sibling `.backup-*` directory; delete that
backup manually after checking it contains nothing you need. An existing
unowned target directory or a conflicting registration causes a refusal.

## Integrity and provenance

`checksums.json` verifies shipped files; the sibling ZIP `.sha256` verifies the
archive. These detect corruption, not authenticity if an attacker replaces both
payload and checksums. Use artifacts from the expected repository/workflow.
EXEs are currently unsigned: SmartScreen may warn. No release-signing claim is
made. `provenance.json` records the source revision and exact upstream tags,
URLs and GitHub-provided asset digests. The build fails if those digests are
missing or don't match. Dependency notices/license material are in `licenses`.

CI runs existing JS/Python tests, builds a real PyInstaller native host EXE,
bundles standalone yt-dlp and ffmpeg, extracts the final ZIP, exercises framing,
version probes, checksums, install/uninstall, both registry views, and preservation
checks on a disposable Windows runner. Do not equate that with a real Chrome
user-machine test. Windows Chrome end-to-end/manual validation remains pending
until performed on a user machine. No media is downloaded during packaging or
smoke tests. Cookies, tokens, DRM workarounds are not used. The known HTML/MP4
response validation issue is **unresolved**; Windows packaging does not fix or
prove that download behavior.
