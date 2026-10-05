from __future__ import annotations

import ipaddress
import json
import re
import socket
import struct
from pathlib import Path
from typing import BinaryIO
from urllib.parse import urlparse, urlunparse

MAX_MESSAGE_BYTES = 1_000_000
SEGMENT_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_segment(value: str) -> str:
    cleaned = SEGMENT_UNSAFE.sub("-", str(value or "")).strip().rstrip(". ")[:120]
    return cleaned if cleaned and cleaned not in {".", ".."} else "untitled"


def validate_x_status_url(value: str) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}:
        raise ValueError("Only X/Twitter HTTPS status URLs are allowed")
    match = re.match(r"^/([^/]+)/status/(\d+)(?:/|$)", parsed.path)
    if not match:
        raise ValueError("URL is not an X status")
    return f"https://x.com/{match.group(1)}/status/{match.group(2)}"


def _reject_private_host(host: str) -> None:
    lowered = host.lower().rstrip(".")
    if lowered == "localhost" or lowered.endswith(".localhost"):
        raise ValueError("Local targets are not allowed")
    try:
        addresses = [ipaddress.ip_address(lowered)]
    except ValueError:
        addresses = []
        try:
            for result in socket.getaddrinfo(lowered, None, type=socket.SOCK_STREAM):
                addresses.append(ipaddress.ip_address(result[4][0]))
        except socket.gaierror:
            # Let the downloader report ordinary DNS failures; literal/private hosts are still blocked.
            pass
    for address in addresses:
        if any((
            address.is_private,
            address.is_loopback,
            address.is_link_local,
            address.is_multicast,
            address.is_reserved,
            address.is_unspecified,
        )):
            raise ValueError("Private or local network targets are not allowed")


def validate_direct_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only HTTP(S) media URLs are allowed")
    host = parsed.hostname.lower().rstrip(".")
    allowed = (
        host == "web.telegram.org"
        or host.endswith(".telegram.org")
        or host.endswith(".telegram-cdn.org")
        or host.endswith(".cdn-telegram.org")
    )
    if not allowed:
        raise ValueError("Direct downloads are limited to Telegram media hosts")
    _reject_private_host(host)
    return urlunparse(parsed._replace(fragment=""))


def confined_output_dir(base: Path, site: str, item_id: str) -> Path:
    root = Path(base).expanduser().resolve()
    candidate = (root / _safe_segment(site) / _safe_segment(item_id)).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("Output path escapes WebMedia root") from error
    return candidate


def confined_existing_file(base: Path, output_dir: Path | str, filename: str) -> Path:
    root = Path(base).expanduser().resolve()
    folder = Path(output_dir).expanduser().resolve()
    try:
        folder.relative_to(root)
    except ValueError as error:
        raise ValueError("Output directory escapes WebMedia root") from error
    if not filename or Path(filename).name != filename:
        raise ValueError("Invalid downloaded filename")
    target = (folder / filename).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("Downloaded file escapes WebMedia root") from error
    if not target.is_file():
        raise ValueError("Downloaded file no longer exists")
    return target


def build_x_command(yt_dlp: str, ffmpeg: str, url: str, output_dir: Path) -> list[str]:
    canonical = validate_x_status_url(url)
    return [
        yt_dlp,
        "--no-playlist",
        "--newline",
        "--restrict-filenames",
        "--ffmpeg-location", ffmpeg,
        "-f", "bestvideo*+bestaudio/best",
        "--merge-output-format", "mp4",
        "-P", str(output_dir),
        "-o", "%(uploader)s-%(id)s-%(title).120B.%(ext)s",
        canonical,
    ]


def build_direct_command(yt_dlp: str, ffmpeg: str, url: str, output_dir: Path) -> list[str]:
    validated = validate_direct_url(url)
    return [
        yt_dlp,
        "--no-playlist",
        "--newline",
        "--restrict-filenames",
        "--ffmpeg-location", ffmpeg,
        "-f", "bestvideo*+bestaudio/best",
        "--merge-output-format", "mp4",
        "-P", str(output_dir),
        "-o", "%(title).120B-%(id)s.%(ext)s",
        validated,
    ]


def read_native_message(stream: BinaryIO):
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError("Incomplete native message header")
    size = struct.unpack("<I", header)[0]
    if size > MAX_MESSAGE_BYTES:
        raise ValueError("Native message exceeds size limit")
    payload = stream.read(size)
    if len(payload) != size:
        raise ValueError("Incomplete native message payload")
    return json.loads(payload.decode("utf-8"))


def write_native_message(stream: BinaryIO, message) -> None:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_MESSAGE_BYTES:
        raise ValueError("Native response exceeds size limit")
    stream.write(struct.pack("<I", len(payload)))
    stream.write(payload)
    stream.flush()
