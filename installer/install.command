#!/bin/bash
set -euo pipefail
umask 077

PRODUCT="WebMediaGrabber"
HOST_NAME="com.june.web_media_grabber"
EXTENSION_ID="kfdepjgimomjpdcamlkckoagnikohfkm"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_ROOT="$HOME/Library/Application Support/$PRODUCT"
EXT_DIR="$APP_ROOT/extension"
HOST_DIR="$APP_ROOT/native_host"
CHROME_HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_LAUNCHER="$APP_ROOT/web-media-grabber-host"
HOST_MANIFEST="$CHROME_HOST_DIR/$HOST_NAME.json"

printf '\nilluminati Grabber 1.1 Installer\n'
printf '%s\n' '--------------------------------'

if [[ ! -f "$SOURCE_ROOT/manifest.json" || ! -f "$SOURCE_ROOT/native_host/host.py" \
   || ! -f "$SOURCE_ROOT/assets/brand-logo.png" || ! -f "$SOURCE_ROOT/assets/loader.svg" \
   || ! -d "$SOURCE_ROOT/assets/icons" ]]; then
  printf 'ERROR: Installer payload is incomplete.\n' >&2
  exit 1
fi

YTDLP="$(command -v yt-dlp || true)"
FFMPEG="$(command -v ffmpeg || true)"
if [[ -z "$YTDLP" || -z "$FFMPEG" ]]; then
  if [[ -x /opt/homebrew/bin/brew ]]; then
    printf 'Installing yt-dlp and ffmpeg with Homebrew…\n'
    /opt/homebrew/bin/brew install yt-dlp ffmpeg
  else
    printf 'ERROR: yt-dlp and ffmpeg are required. Install Homebrew first.\n' >&2
    exit 1
  fi
fi

mkdir -p "$EXT_DIR" "$HOST_DIR" "$CHROME_HOST_DIR"
for runtime_dir in assets background content popup src; do
  mkdir -p "$EXT_DIR/$runtime_dir"
  /usr/bin/ditto "$SOURCE_ROOT/$runtime_dir" "$EXT_DIR/$runtime_dir"
done
/usr/bin/ditto "$SOURCE_ROOT/manifest.json" "$EXT_DIR/manifest.json"
/usr/bin/ditto "$SOURCE_ROOT/native_host/core.py" "$HOST_DIR/core.py"
/usr/bin/ditto "$SOURCE_ROOT/native_host/host.py" "$HOST_DIR/host.py"
chmod 700 "$HOST_DIR/host.py"

cat > "$HOST_LAUNCHER" <<EOF
#!/bin/bash
exec /usr/bin/python3 "$HOST_DIR/host.py"
EOF
chmod 700 "$HOST_LAUNCHER"

cat > "$HOST_MANIFEST" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Local helper for illuminati Grabber",
  "path": "$HOST_LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
chmod 600 "$HOST_MANIFEST"

/usr/bin/plutil -lint "$HOST_MANIFEST" >/dev/null 2>&1 || /usr/bin/python3 -m json.tool "$HOST_MANIFEST" >/dev/null
/usr/bin/python3 "$SOURCE_ROOT/installer/native-host-smoke.py" "$HOST_LAUNCHER"

printf '\nInstalled and verified.\n'
printf 'Extension ID: %s\n' "$EXTENSION_ID"
printf 'Extension folder: %s\n' "$EXT_DIR"
printf 'Native host: %s\n' "$HOST_MANIFEST"
printf '\nChrome requires one manual security step:\n'
printf '1. Enable Developer mode.\n2. Click Load unpacked.\n3. Choose the extension folder opened in Finder.\n\n'

open "$EXT_DIR"
open -a "Google Chrome" "chrome://extensions" || true
