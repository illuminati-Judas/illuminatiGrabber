#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path
from urllib.parse import urlparse

try:
    from .core import (
        build_direct_command,
        build_x_command,
        confined_existing_file,
        confined_output_dir,
        read_native_message,
        validate_direct_url,
        validate_x_status_url,
        write_native_message,
    )
except ImportError:  # Executed directly by Chrome's native-messaging manifest.
    from core import (
        build_direct_command,
        build_x_command,
        confined_existing_file,
        confined_output_dir,
        read_native_message,
        validate_direct_url,
        validate_x_status_url,
        write_native_message,
    )

VERSION = "1.1.0"
APP_ROOT = Path(__file__).resolve().parent
DOWNLOAD_ROOT = Path.home() / "Downloads" / "WebMedia"


def find_tool(name: str, env_name: str) -> str | None:
    configured = os.environ.get(env_name)
    candidates = [
        configured,
        str(APP_ROOT / "bin" / name),
        shutil.which(name),
        f"/opt/homebrew/bin/{name}",
        f"/usr/local/bin/{name}",
    ]
    return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()), None)


def dependency_status() -> dict:
    yt_dlp = find_tool("yt-dlp", "WMG_YTDLP")
    ffmpeg = find_tool("ffmpeg", "WMG_FFMPEG")
    return {
        "yt_dlp": yt_dlp,
        "ffmpeg": ffmpeg,
        "ready": bool(yt_dlp and ffmpeg),
    }


def summarize_output_dir(output_dir: Path) -> dict:
    files = [
        path for path in output_dir.rglob("*")
        if path.is_file() and not path.name.endswith((".part", ".ytdl", ".temp"))
    ]
    total_bytes = sum(path.stat().st_size for path in files)
    newest = max(files, key=lambda path: path.stat().st_mtime, default=None)
    return {
        "bytes": total_bytes,
        **({"filename": newest.name} if newest is not None else {}),
    }


def run_download(command: list[str], output_dir: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=3600,
        check=False,
        env={**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"},
    )
    lines = completed.stdout.splitlines()[-80:]
    return {
        "ok": completed.returncode == 0,
        "status": "completed" if completed.returncode == 0 else "failed",
        "exit_code": completed.returncode,
        "output_dir": str(output_dir),
        "log": lines,
        **summarize_output_dir(output_dir),
    }


def run_x_download(yt_dlp: str, ffmpeg: str, url: str, output_dir: Path) -> dict:
    argv = build_x_command(yt_dlp, ffmpeg, url, output_dir)
    return run_download(argv, output_dir)


def handle_message(message: dict) -> dict:
    command_name = message.get("command")
    if command_name == "ping":
        return {"ok": True, "status": "pong", "version": VERSION}
    if command_name == "check_dependencies":
        status = dependency_status()
        return {"ok": status["ready"], "status": "ready" if status["ready"] else "missing_dependencies", **status}
    if command_name == "open_output":
        target = confined_existing_file(
            DOWNLOAD_ROOT,
            message.get("output_dir", ""),
            message.get("filename", ""),
        )
        completed = subprocess.run(
            ["/usr/bin/open", str(target)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=30,
            check=False,
        )
        return {
            "ok": completed.returncode == 0,
            "status": "opened" if completed.returncode == 0 else "open_failed",
            "error": completed.stdout.strip() if completed.returncode else "",
        }

    dependencies = dependency_status()
    if not dependencies["ready"]:
        return {"ok": False, "status": "missing_dependencies", **dependencies}

    if command_name == "download_x":
        url = validate_x_status_url(message.get("url", ""))
        post_id = url.rsplit("/", 1)[-1]
        output_dir = confined_output_dir(DOWNLOAD_ROOT, "x.com", post_id)
        return run_x_download(dependencies["yt_dlp"], dependencies["ffmpeg"], url, output_dir)

    if command_name == "download_direct":
        source_page = urlparse(message.get("source_page", ""))
        if source_page.scheme != "https" or source_page.hostname != "web.telegram.org":
            raise ValueError("Direct native downloads are limited to Telegram Web media")
        url = validate_direct_url(message.get("url", ""))
        item_id = message.get("item_id") or "current-message"
        output_dir = confined_output_dir(DOWNLOAD_ROOT, "web.telegram.org", item_id)
        argv = build_direct_command(dependencies["yt_dlp"], dependencies["ffmpeg"], url, output_dir)
        return run_download(argv, output_dir)

    raise ValueError("Unknown native command")


def main() -> int:
    while True:
        try:
            message = read_native_message(sys.stdin.buffer)
            if message is None:
                return 0
            response = handle_message(message)
        except Exception as error:
            response = {
                "ok": False,
                "status": "error",
                "error": str(error),
                "detail": traceback.format_exc(limit=2),
            }
        write_native_message(sys.stdout.buffer, response)


if __name__ == "__main__":
    raise SystemExit(main())
