import io
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from native_host.core import (  # noqa: E402
    build_direct_command,
    build_x_command,
    confined_existing_file,
    confined_output_dir,
    read_native_message,
    validate_direct_url,
    validate_x_status_url,
    write_native_message,
)
from native_host.host import summarize_output_dir  # noqa: E402


class NativeHostSecurityTests(unittest.TestCase):
    def test_opened_native_file_must_stay_inside_download_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "WebMedia"
            folder = root / "x.com" / "123"
            folder.mkdir(parents=True)
            media = folder / "video.mp4"
            media.write_bytes(b"video")
            self.assertEqual(confined_existing_file(root, folder, "video.mp4"), media.resolve())
            with self.assertRaises(ValueError):
                confined_existing_file(root, folder, "../../secret.txt")

    def test_native_output_summary_reports_real_file_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            older = root / "older.mp4"
            newest = root / "newest.mp4"
            older.write_bytes(b"1234")
            newest.write_bytes(b"123456")
            os.utime(older, (1, 1))
            os.utime(newest, (2, 2))
            summary = summarize_output_dir(root)
            self.assertEqual(summary["bytes"], 10)
            self.assertEqual(summary["filename"], "newest.mp4")

    def test_accepts_only_canonical_x_status_urls(self):
        self.assertEqual(
            validate_x_status_url("https://x.com/user/status/123?x=1"),
            "https://x.com/user/status/123",
        )
        self.assertEqual(
            validate_x_status_url("https://twitter.com/user/status/456/video/1"),
            "https://x.com/user/status/456",
        )
        with self.assertRaises(ValueError):
            validate_x_status_url("https://x.com/home")
        with self.assertRaises(ValueError):
            validate_x_status_url("https://evil.test/user/status/123")

    def test_direct_urls_reject_local_private_and_non_http_targets(self):
        self.assertEqual(
            validate_direct_url("https://cdn4.telegram-cdn.org/media/video.mp4"),
            "https://cdn4.telegram-cdn.org/media/video.mp4",
        )
        for value in (
            "https://evil.test/media/video.mp4",
            "file:///etc/passwd",
            "http://127.0.0.1/private",
            "http://localhost/private",
            "http://10.0.0.2/private",
            "http://169.254.1.2/private",
            "http://[::1]/private",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_direct_url(value)

    def test_output_directory_is_confined_below_webmedia(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary) / "WebMedia"
            result = confined_output_dir(base, "x.com", "123/../../escape")
            self.assertTrue(result.is_relative_to(base.resolve()))
            self.assertEqual(result, base.resolve() / "x.com" / "123-..-..-escape")

    def test_command_builders_return_argument_arrays(self):
        x_command = build_x_command(
            "/opt/bin/yt-dlp",
            "/opt/bin/ffmpeg",
            "https://x.com/user/status/123",
            Path("/tmp/out"),
        )
        self.assertIsInstance(x_command, list)
        self.assertEqual(x_command[0], "/opt/bin/yt-dlp")
        self.assertIn("bestvideo*+bestaudio/best", x_command)
        self.assertIn("--no-playlist", x_command)
        self.assertNotIn("sh", x_command)
        self.assertNotIn("--cookies-from-browser", x_command)

        direct_command = build_direct_command(
            "/opt/bin/yt-dlp",
            "/opt/bin/ffmpeg",
            "https://cdn4.telegram-cdn.org/video.mp4",
            Path("/tmp/out"),
        )
        self.assertEqual(direct_command[0], "/opt/bin/yt-dlp")
        self.assertIn("https://cdn4.telegram-cdn.org/video.mp4", direct_command)


class NativeFramingTests(unittest.TestCase):
    def test_round_trips_length_prefixed_json(self):
        output = io.BytesIO()
        write_native_message(output, {"ok": True, "status": "pong"})
        payload = output.getvalue()
        size = struct.unpack("<I", payload[:4])[0]
        self.assertEqual(size, len(payload) - 4)
        self.assertEqual(read_native_message(io.BytesIO(payload)), {"ok": True, "status": "pong"})

    def test_rejects_oversized_messages(self):
        stream = io.BytesIO(struct.pack("<I", 2_000_000))
        with self.assertRaises(ValueError):
            read_native_message(stream)


if __name__ == "__main__":
    unittest.main()
