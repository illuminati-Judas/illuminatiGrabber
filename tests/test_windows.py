import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from native_host import host


class WindowsPortabilityTests(unittest.TestCase):
    def test_frozen_root_is_executable_parent_not_extraction_dir(self):
        with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'executable', str(ROOT / 'helper.exe')):
            self.assertTrue(hasattr(host, 'application_root'), 'missing frozen runtime root support')
            self.assertEqual(host.application_root(), ROOT)

    def test_windows_finds_bundled_exe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bin').mkdir()
            tool = root / 'bin' / 'ffmpeg.exe'
            tool.write_bytes(b'fixture')
            with patch.object(host, 'APP_ROOT', root), patch.object(sys, 'platform', 'win32'), patch.dict(os.environ, {}, clear=True):
                self.assertEqual(host.find_tool('ffmpeg', 'WMG_FFMPEG'), str(tool))

    def test_download_preserves_windows_environment(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(sys, 'platform', 'win32'), patch.dict(os.environ, {'PATH': 'C:\\Windows\\System32'}, clear=True), patch.object(host.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = ''
            host.run_download(['fake'], Path(directory))
            self.assertEqual(run.call_args.kwargs['env']['PATH'], 'C:\\Windows\\System32')

    def test_windows_opens_only_confined_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            media = root / 'video.mp4'
            media.write_bytes(b'fixture')
            with patch.object(host, 'DOWNLOAD_ROOT', root), patch.object(sys, 'platform', 'win32'), patch.object(os, 'startfile', create=True) as start:
                result = host.handle_message({'command': 'open_output', 'output_dir': str(root), 'filename': media.name})
                self.assertTrue(result['ok'])
                start.assert_called_once_with(str(media.resolve()))

    def test_distribution_sources_exist(self):
        for name in ('installer/windows/install.ps1', 'installer/windows/uninstall.ps1', 'installer/windows/install.cmd', 'installer/windows/uninstall.cmd', 'scripts/build-windows.ps1', 'scripts/package-windows.py', '.github/workflows/windows.yml', 'tests/windows-installer.ps1'):
            with self.subTest(name=name):
                self.assertTrue((ROOT / name).is_file(), name)


if __name__ == '__main__':
    unittest.main()
