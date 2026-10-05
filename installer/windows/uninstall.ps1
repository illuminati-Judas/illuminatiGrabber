. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path -LiteralPath $InstallRoot)) { Write-Host 'Nothing installed.'; exit 0 }
Assert-OwnedInstall
$hashes = Get-Content -LiteralPath (Join-Path $InstallRoot 'checksums.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $hashes.PSObject.Properties) {
    if ($entry.Name -notmatch '^(extension|native_host|installer|licenses)/[A-Za-z0-9_./-]+$' -and $entry.Name -ne 'WINDOWS.md' -and $entry.Name -ne 'provenance.json') { throw 'Unsafe inventory path' }
    if ($entry.Name.Split('/') -contains '..' -or $entry.Name.Split('/') -contains '.') { throw 'Unsafe inventory path' }
    if ($entry.Value -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid inventory checksum' }
}
$manifestPath = Join-Path $InstallRoot 'native-host.json'
foreach ($view in (Get-RegistryViews)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try {
        $key = $base.OpenSubKey($RegistryPath)
        if ($key) {
            $owned = $key.GetValue('') -eq $manifestPath
            $key.Dispose()
            if ($owned) { $base.DeleteSubKeyTree($RegistryPath, $false) }
            $verify = $base.OpenSubKey($RegistryPath)
            if ($verify) {
                try { if ($verify.GetValue('') -eq $manifestPath) { throw 'Unregistration failed' } }
                finally { $verify.Dispose() }
            }
        }
    } finally { $base.Dispose() }
}
# Delete only unmodified files in the shipped inventory; preserve unknown files,
# modified files, Downloads/WebMedia, Chrome profiles and other host registrations.
foreach ($entry in $hashes.PSObject.Properties) {
    $file = Join-Path $InstallRoot $entry.Name
    if ((Test-Path -LiteralPath $file -PathType Leaf) -and (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $entry.Value) {
        Remove-Item -LiteralPath $file -Force
    }
}
foreach ($control in @('native-host.json', 'install-owner.json', 'checksums.json')) {
    Remove-Item -LiteralPath (Join-Path $InstallRoot $control) -Force
}
Get-ChildItem -LiteralPath $InstallRoot -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
    if (@(Get-ChildItem -LiteralPath $_.FullName -Force).Count -eq 0) { Remove-Item -LiteralPath $_.FullName }
}
if (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $InstallRoot }
Write-Host 'Helper unregistered. Downloads and unrelated/modified files preserved. Remove the extension manually in Chrome.'
