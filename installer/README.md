# illuminati Grabber 1.1 macOS Installer

Double-click `install.command`.

It installs only local runtime files under:

- `~/Library/Application Support/WebMediaGrabber/`
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.june.web_media_grabber.json`

The installer verifies the Native Messaging host and dependencies. Chrome still requires one manual security step: enable Developer mode, choose **Load unpacked**, and select the extension folder opened by the installer.

No Chrome profile, enterprise policy, cookies, credentials, or browser sessions are modified.
