param([switch]$NoOpen)
. (Join-Path $PSScriptRoot 'common.ps1')
$SourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\')
$stage = "$InstallRoot.stage-$([Guid]::NewGuid().ToString('N'))"
$backup = "$InstallRoot.backup-$([Guid]::NewGuid().ToString('N'))"
$manifestPath = Join-Path $InstallRoot 'native-host.json'
$previous = @()
$promoted = $false
try {
    # Validate every shipped file before copying or executing any helper binary.
    Assert-Payload $SourceRoot
    if ($SourceRoot -eq $InstallRoot) { throw 'Run the installer from the extracted release, not the installed directory' }
    if (Test-Path -LiteralPath $InstallRoot) { Assert-OwnedInstall }
    foreach ($view in (Get-RegistryViews)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $base.OpenSubKey($RegistryPath)
            $old = if ($key) { $key.GetValue('') } else { $null }
            if ($key) { $key.Dispose() }
            if ($old -and $old -ne $manifestPath) { throw 'A different native host is registered; refusing overwrite' }
            $previous += @{View=$view; Value=$old}
        } finally { $base.Dispose() }
    }
    New-Item -ItemType Directory -Path $stage | Out-Null
    Get-ChildItem -LiteralPath $SourceRoot -Force | Copy-Item -Destination $stage -Recurse
    Assert-Payload $stage
    Invoke-HostProbe (Join-Path $stage 'native_host/web-media-grabber-host.exe')
    Write-Json (Join-Path $stage 'native-host.json') @{
        name=$HostName; description='Local helper for illuminati Grabber'; type='stdio'
        path=(Join-Path $InstallRoot 'native_host/web-media-grabber-host.exe')
        allowed_origins=@("chrome-extension://$ExtensionId/")
    }
    Write-Json (Join-Path $stage 'install-owner.json') @{host=$HostName; root=$InstallRoot}
    if (Test-Path -LiteralPath $InstallRoot) { Move-Item -LiteralPath $InstallRoot -Destination $backup }
    Move-Item -LiteralPath $stage -Destination $InstallRoot
    $promoted = $true
    foreach ($view in (Get-RegistryViews)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $base.CreateSubKey($RegistryPath)
            $key.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String)
            if ($key.GetValue('') -ne $manifestPath) { throw 'Registration readback failed' }
            $key.Dispose()
        } finally { $base.Dispose() }
    }
    Invoke-HostProbe (Join-Path $InstallRoot 'native_host/web-media-grabber-host.exe')
    # Preserve the prior owned installation as a backup, including user-added files.
    Write-Host "Installed. Chrome: enable Developer mode, Load unpacked, choose $InstallRoot\extension"
    if (Test-Path -LiteralPath $backup) { Write-Host "Previous installation preserved: $backup" }
    if (-not $NoOpen) { Start-Process explorer.exe -ArgumentList ('"' + (Join-Path $InstallRoot 'extension') + '"') }
} catch {
    if ($promoted) {
        foreach ($entry in $previous) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $entry.View)
            try {
                if ($null -eq $entry.Value) { $base.DeleteSubKeyTree($RegistryPath, $false) }
                else {
                    $key = $base.CreateSubKey($RegistryPath)
                    $key.SetValue('', $entry.Value)
                    $key.Dispose()
                }
            } finally { $base.Dispose() }
        }
        Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $InstallRoot }
    throw
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
