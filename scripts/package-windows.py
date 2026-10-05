"""Allowlisted Windows delivery; fixed ZIP metadata for repeatable packaging."""
import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path


def release_path_allowed(path):
    parts = [part.lower() for part in path.parts]
    forbidden = {'node_modules', 'keys', '__pycache__', 'test-results', 'playwright-report'}
    return not any(part.startswith('.') or part in forbidden or '.log' in part or
                   '.env' in part or part.endswith(('.key', '.pem', '.p12', '.pfx')) for part in parts)


def package(source, native, licenses, output, provenance):
    source, native, licenses, output = map(Path, (source, native, licenses, output))
    output.mkdir(parents=True, exist_ok=True)
    stage = output / 'illuminatiGrabber-windows-x64'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir()
    def copy(src, dst):
        if not release_path_allowed(dst.relative_to(stage)):
            raise ValueError(f'Forbidden release path: {dst}')
        if src.is_symlink():
            raise ValueError(f'Symlink rejected: {src}')
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
    copy(source / 'manifest.json', stage / 'extension/manifest.json')
    for directory in ('assets', 'background', 'content', 'popup', 'src'):
        for file in sorted((source / directory).rglob('*')):
            if (file.is_file() and release_path_allowed(file.relative_to(source)) and
                    file.suffix.lower() in ('.js', '.html', '.css', '.png', '.svg')):
                copy(file, stage / 'extension' / file.relative_to(source))
    for name in ('web-media-grabber-host.exe', 'bin/yt-dlp.exe', 'bin/ffmpeg.exe'):
        copy(native / name, stage / 'native_host' / name)
    for name in ('common.ps1', 'install.ps1', 'uninstall.ps1', 'install.cmd', 'uninstall.cmd'):
        copy(source / 'installer/windows' / name, stage / 'installer/windows' / name)
    for file in sorted(licenses.rglob('*')):
        if file.is_file():
            copy(file, stage / 'licenses' / file.relative_to(licenses))
    copy(source / 'installer/windows/WINDOWS.md', stage / 'WINDOWS.md')
    (stage / 'provenance.json').write_text(json.dumps(provenance, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    hashes = {p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(stage.rglob('*')) if p.is_file()}
    (stage / 'checksums.json').write_text(json.dumps(hashes, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    archive = output / (stage.name + '.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(stage.rglob('*')):
            if p.is_file():
                info = zipfile.ZipInfo(p.relative_to(stage).as_posix(), (2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                z.writestr(info, p.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    return stage, archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('source', 'native', 'licenses', 'output', 'provenance'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    stage, archive = package(args.source, args.native, args.licenses, args.output,
                             json.loads(Path(args.provenance).read_text(encoding='utf-8-sig')))
    print(archive)
