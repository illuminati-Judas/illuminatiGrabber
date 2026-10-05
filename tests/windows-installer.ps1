param([Parameter(Mandatory=$true)][string]$Payload)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'This registry-mutating test is only for disposable GitHub Actions runners' }
. (Join-Path $Payload 'installer/windows/common.ps1')
foreach ($view in (Get-RegistryViews)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try {
        $key = $base.OpenSubKey($RegistryPath)
        if ($key) { $key.Dispose(); throw 'Refusing tests over an existing native-host registration' }
    } finally { $base.Dispose() }
}
$originalLocal = $env:LOCALAPPDATA
$testRoot = Join-Path $env:RUNNER_TEMP ('WMG spaces Unicode-' + [char]0x03A9 + '-' + [Guid]::NewGuid().ToString('N'))
$env:LOCALAPPDATA = Join-Path $testRoot 'local'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'WebMediaGrabber'
$copy = Join-Path $testRoot 'payload'
New-Item -ItemType Directory -Path $copy -Force | Out-Null
Get-ChildItem -LiteralPath $Payload -Force | Copy-Item -Destination $copy -Recurse
function Run-Installer([string]$Script, [bool]$Success) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script)
    if ($Script.EndsWith('install.ps1') -and -not $Script.EndsWith('uninstall.ps1')) { $arguments += '-NoOpen' }
    & powershell.exe @arguments
    if (($LASTEXITCODE -eq 0) -ne $Success) { throw "Unexpected installer exit code $LASTEXITCODE" }
}
function Assert-NoRegistration {
    foreach ($view in (Get-RegistryViews)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $base.OpenSubKey($RegistryPath)
            if ($key) { $key.Dispose(); throw 'Unexpected registry mutation' }
        } finally { $base.Dispose() }
    }
}
try {
    # Tampering fails before install/registration and restores no false success.
    $exe = Join-Path $copy 'native_host/bin/ffmpeg.exe'
    [IO.File]::AppendAllText($exe, 'tamper')
    Run-Installer "$copy/installer/windows/install.ps1" $false
    if (Test-Path $InstallRoot) { throw 'Tamper test mutated install target' }
    Assert-NoRegistration
    Copy-Item "$Payload/native_host/bin/ffmpeg.exe" $exe -Force
    # Unowned directory is preserved.
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Set-Content (Join-Path $InstallRoot 'sentinel.txt') 'preserve'
    Run-Installer "$copy/installer/windows/install.ps1" $false
    if ((Get-Content (Join-Path $InstallRoot 'sentinel.txt')) -ne 'preserve') { throw 'Foreign file was changed' }
    Assert-NoRegistration
    Remove-Item $InstallRoot -Recurse
    Run-Installer "$copy/installer/windows/install.ps1" $true
    $manifestPath = Join-Path $InstallRoot 'native-host.json'
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.allowed_origins.Count -ne 1 -or $manifest.allowed_origins[0] -ne "chrome-extension://$ExtensionId/") { throw 'Bad allowed origin' }
    if ($manifest.path -ne (Join-Path $InstallRoot 'native_host/web-media-grabber-host.exe')) { throw 'Bad executable path' }
    foreach ($view in (Get-RegistryViews)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $base.OpenSubKey($RegistryPath)
            if (-not $key -or $key.GetValue('') -ne $manifestPath) { throw "Missing registration in $view" }
            $key.Dispose()
        } finally { $base.Dispose() }
    }
    Invoke-HostProbe $manifest.path
    Set-Content (Join-Path $InstallRoot 'user-sentinel.txt') 'preserve'
    Add-Content (Join-Path $InstallRoot 'extension/popup/popup.css') '/* user modification */'
    $downloadRoot = Join-Path $testRoot 'Downloads/WebMedia'
    New-Item -ItemType Directory $downloadRoot -Force | Out-Null
    Set-Content (Join-Path $downloadRoot 'sentinel.txt') 'download'
    # Upgrade retains the prior tree, including user files.
    Run-Installer "$copy/installer/windows/install.ps1" $true
    $backup = @(Get-ChildItem $env:LOCALAPPDATA -Directory -Filter 'WebMediaGrabber.backup-*')
    if ($backup.Count -ne 1 -or -not (Test-Path (Join-Path $backup[0].FullName 'user-sentinel.txt'))) { throw 'Upgrade lost prior user files' }
    Set-Content (Join-Path $InstallRoot 'user-sentinel.txt') 'preserve'
    Add-Content (Join-Path $InstallRoot 'extension/popup/popup.css') '/* user modification */'
    # First exercise complete removal of owned registrations in both views.
    Run-Installer "$copy/installer/windows/uninstall.ps1" $true
    Assert-NoRegistration
    if (-not (Test-Path (Join-Path $InstallRoot 'user-sentinel.txt')) -or -not (Test-Path (Join-Path $InstallRoot 'extension/popup/popup.css'))) { throw 'Normal uninstall lost preserved files' }
    if (Test-Path (Join-Path $InstallRoot 'native_host/web-media-grabber-host.exe')) { throw 'Unmodified helper was not removed' }
    Move-Item -LiteralPath $InstallRoot -Destination (Join-Path $testRoot 'preserved-after-uninstall')
    Run-Installer "$copy/installer/windows/install.ps1" $true
    Set-Content (Join-Path $InstallRoot 'user-sentinel.txt') 'preserve'
    Add-Content (Join-Path $InstallRoot 'extension/popup/popup.css') '/* user modification */'
    # Preserve a replacement registration while removing any remaining owned view.
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry32)
    $key = $base.CreateSubKey($RegistryPath)
    $key.SetValue('', 'C:\foreign\host.json'); $key.Dispose(); $base.Dispose()
    Run-Installer "$copy/installer/windows/uninstall.ps1" $true
    if (-not (Test-Path (Join-Path $InstallRoot 'user-sentinel.txt')) -or -not (Test-Path (Join-Path $InstallRoot 'extension/popup/popup.css'))) { throw 'Uninstall lost unrelated/modified files' }
    if ((Get-Content (Join-Path $downloadRoot 'sentinel.txt')) -ne 'download') { throw 'Download sentinel changed' }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry32)
    $key = $base.OpenSubKey($RegistryPath)
    if (-not $key -or $key.GetValue('') -ne 'C:\foreign\host.json') { throw 'Foreign registration lost' }
    $key.Dispose(); $base.Dispose()
    # HKCU Software can be shared between registry views on Windows. If the
    # replacement is visible in both views, preserve it in both rather than
    # assuming WOW64 isolation. Otherwise the owned 64-bit entry must be gone.
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
    $key = $base.OpenSubKey($RegistryPath)
    if ($key) {
        if ($key.GetValue('') -ne 'C:\foreign\host.json') { throw 'Owned registration remains' }
        $key.Dispose()
    }
    $base.Dispose()
    Write-Host 'PASS: Windows install/uninstall, checksum failure, upgrade and preservation'
} finally {
    foreach ($view in (Get-RegistryViews)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try { $base.DeleteSubKeyTree($RegistryPath, $false) } finally { $base.Dispose() }
    }
    $env:LOCALAPPDATA = $originalLocal
    if (Test-Path $testRoot) { Remove-Item $testRoot -Recurse -Force }
}
