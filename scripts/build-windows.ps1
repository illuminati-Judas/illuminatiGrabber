param([string]$Output = 'dist/windows')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw 'Build requires Windows x64' }
$Root = Split-Path $PSScriptRoot
$Output = [IO.Path]::GetFullPath((Join-Path $Root $Output))
$work = Join-Path $Output 'build'
if (Test-Path $Output) { throw 'Use a fresh output directory for each build' }
New-Item -ItemType Directory -Path "$work/native/bin", "$work/licenses" -Force | Out-Null
$headers = @{ 'User-Agent'='illuminatiGrabber-build'; 'Accept'='application/vnd.github+json' }
if ($env:GH_TOKEN) { $headers.Authorization = "Bearer $env:GH_TOKEN" }
$provenance = @{ revision=$env:GITHUB_SHA; pyinstaller='6.11.1'; dependencies=@() }
function Get-VerifiedAsset($Repository, $AssetName, $Destination) {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/latest" -Headers $headers
    $asset = @($release.assets | Where-Object name -eq $AssetName)
    if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:([0-9a-f]{64})$') { throw "Missing upstream asset digest: $AssetName" }
    $digest = $Matches[1]
    Invoke-WebRequest $asset[0].browser_download_url -OutFile $Destination
    if ((Get-FileHash $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) { throw "Upstream digest mismatch: $AssetName" }
    $script:provenance.dependencies += @{repository=$Repository; tag=$release.tag_name; asset=$AssetName; url=$asset[0].browser_download_url; sha256=$digest}
    return $release
}
$ytRelease = Get-VerifiedAsset 'yt-dlp/yt-dlp' 'yt-dlp.exe' "$work/native/bin/yt-dlp.exe"
$ffRelease = Get-VerifiedAsset 'BtbN/FFmpeg-Builds' 'ffmpeg-master-latest-win64-gpl.zip' "$work/ffmpeg.zip"
Expand-Archive "$work/ffmpeg.zip" "$work/ffmpeg"
$ffmpeg = @(Get-ChildItem "$work/ffmpeg" -Filter ffmpeg.exe -Recurse)
if ($ffmpeg.Count -ne 1) { throw 'Ambiguous ffmpeg payload' }
Copy-Item $ffmpeg[0].FullName "$work/native/bin/ffmpeg.exe"
# Preserve the distributor's license files and source/build references.
Get-ChildItem "$work/ffmpeg" -File -Recurse | Where-Object { $_.Name -match '(?i)license|copying|readme' } | ForEach-Object {
    Copy-Item $_.FullName (Join-Path "$work/licenses" ('ffmpeg-' + $_.Name))
}
Invoke-WebRequest "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$($ytRelease.tag_name)/LICENSE" -OutFile "$work/licenses/yt-dlp-LICENSE.txt"
Invoke-WebRequest "https://raw.githubusercontent.com/pyinstaller/pyinstaller/v6.11.1/COPYING.txt" -OutFile "$work/licenses/PyInstaller-COPYING.txt"
@"
Bundled Windows x64 dependencies:
yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/tag/$($ytRelease.tag_name)
ffmpeg GPL build: https://github.com/BtbN/FFmpeg-Builds/releases/tag/$($ffRelease.tag_name)
Corresponding source/build scripts: https://github.com/BtbN/FFmpeg-Builds
FFmpeg source: https://github.com/FFmpeg/FFmpeg
PyInstaller 6.11.1 bootloader exception: see PyInstaller-COPYING.txt
CPython: https://docs.python.org/3/license.html (license included by PyInstaller)
Upstream tags and asset digests are recorded in provenance.json.
"@ | Set-Content "$work/licenses/NOTICE.txt" -Encoding UTF8
& python -m PyInstaller --clean --noconfirm --onefile --console --name web-media-grabber-host --paths "$Root/native_host" --distpath "$work/native" --workpath "$work/pyinstaller" --specpath $work "$Root/native_host/host.py"
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }
. "$Root/installer/windows/common.ps1"
Invoke-HostProbe "$work/native/web-media-grabber-host.exe"
Write-Json "$work/provenance.json" $provenance
& python "$Root/scripts/package-windows.py" --source $Root --native "$work/native" --licenses "$work/licenses" --output $Output --provenance "$work/provenance.json"
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
# Test a freshly extracted delivery, not the packaging stage.
$archive = "$Output/illuminatiGrabber-windows-x64.zip"
$expected = (Get-Content "$archive.sha256" -Raw).Split(' ')[0]
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Archive checksum mismatch' }
Expand-Archive "$Output/illuminatiGrabber-windows-x64.zip" "$Output/extracted"
Assert-Payload "$Output/extracted"
Invoke-HostProbe "$Output/extracted/native_host/web-media-grabber-host.exe"
& python "$Root/installer/native-host-smoke.py" "$Output/extracted/native_host/web-media-grabber-host.exe"
if ($LASTEXITCODE -ne 0) { throw 'Native framing smoke failed' }
& "$Root/tests/windows-installer.ps1" -Payload "$Output/extracted"
