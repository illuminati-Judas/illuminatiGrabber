import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class WindowsPackageTests(unittest.TestCase):
    def test_forbidden_release_paths(self):
        spec = importlib.util.spec_from_file_location('packager', ROOT / 'scripts/package-windows.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, 'release_path_allowed'), 'missing sensitive path filter')
        for name in ('assets/node_modules/pkg/index.js', 'src/.env.js', 'assets/keys/key.svg', 'assets/secret.key', 'src/session.log.js'):
            self.assertFalse(module.release_path_allowed(Path(name)), name)
        self.assertTrue(module.release_path_allowed(Path('assets/icons/icon16.png')))

    def test_package_allowlist_and_integrity(self):
        script = ROOT / 'scripts/package-windows.py'
        self.assertTrue(script.exists(), 'missing Windows packager')
        spec = importlib.util.spec_from_file_location('packager', script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            native = root / 'native'
            (native / 'bin').mkdir(parents=True)
            for name in ['web-media-grabber-host.exe', 'bin/yt-dlp.exe', 'bin/ffmpeg.exe']:
                (native / name).write_bytes(b'package-test-fixture-not-executable')
            licenses = root / 'licenses'
            licenses.mkdir()
            (licenses / 'NOTICE.txt').write_text('test notice')
            stage, archive = module.package(ROOT, native, licenses, root / 'out', {'test': True})
            checksums = json.loads((stage / 'checksums.json').read_text())
            for name, digest in checksums.items():
                self.assertEqual(hashlib.sha256((stage / name).read_bytes()).hexdigest(), digest)
            with zipfile.ZipFile(archive) as zip_file:
                names = zip_file.namelist()
                self.assertIn('extension/manifest.json', names)
                self.assertIn('native_host/bin/ffmpeg.exe', names)
                self.assertFalse(any(x in name.lower() for name in names for x in ['node_modules', '.env', '.git/', '/keys/', '__pycache__', '.log', 'handoff']))
            before = archive.read_bytes()
            _, archive = module.package(ROOT, native, licenses, root / 'out', {'test': True})
            self.assertEqual(before, archive.read_bytes())

if __name__ == '__main__':
    unittest.main()
