Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$HostName = 'com.june.web_media_grabber'
$ExtensionId = 'kfdepjgimomjpdcamlkckoagnikohfkm'
$RegistryPath = "Software\Google\Chrome\NativeMessagingHosts\$HostName"
$InstallRoot = Join-Path $env:LOCALAPPDATA 'WebMediaGrabber'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Json($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 10), $Utf8)
}
function Assert-NoLinks($Root) {
    $item = Get-Item -LiteralPath $Root -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path refused: $Root" }
    foreach ($child in Get-ChildItem -LiteralPath $Root -Force -Recurse) {
        if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked payload refused: $($child.FullName)" }
    }
}
function Assert-Payload($Root) {
    Assert-NoLinks $Root
    $hashes = Get-Content -LiteralPath (Join-Path $Root 'checksums.json') -Raw | ConvertFrom-Json
    $names = @($hashes.PSObject.Properties.Name)
    foreach ($required in @('extension/manifest.json', 'native_host/web-media-grabber-host.exe', 'native_host/bin/yt-dlp.exe', 'native_host/bin/ffmpeg.exe', 'installer/windows/install.ps1', 'installer/windows/uninstall.ps1', 'installer/windows/common.ps1')) {
        if ($names -notcontains $required) { throw "Missing checksum: $required" }
    }
    foreach ($entry in $hashes.PSObject.Properties) {
        if ($entry.Name -notmatch '^(extension|native_host|installer|licenses)/[A-Za-z0-9_./-]+$' -and $entry.Name -ne 'WINDOWS.md' -and $entry.Name -ne 'provenance.json') { throw 'Unexpected payload path' }
        if ($entry.Name.Split('/') -contains '..' -or $entry.Name.Split('/') -contains '.') { throw 'Unsafe checksum path' }
        if ($entry.Value -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid checksum' }
        $file = Join-Path $Root $entry.Name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing payload: $($entry.Name)" }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.Value) { throw "Checksum mismatch: $($entry.Name)" }
    }
    foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse -Force) {
        $relative = $file.FullName.Substring($Root.Length + 1).Replace('\', '/')
        if ($relative -ne 'checksums.json' -and $names -notcontains $relative) { throw "Unlisted payload: $relative" }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'extension/manifest.json') -Raw | ConvertFrom-Json
    if (-not $manifest.key) { throw 'Stable extension key missing' }
}
function Invoke-HostProbe($Exe) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Exe
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'Host did not start' }
        foreach ($command in @('ping', 'check_dependencies')) {
            $data = $Utf8.GetBytes((@{command=$command} | ConvertTo-Json -Compress))
            $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes([int]$data.Length), 0, 4)
            $process.StandardInput.BaseStream.Write($data, 0, $data.Length)
            $process.StandardInput.BaseStream.Flush()
            $header = New-Object byte[] 4
            Read-FrameBytes $process.StandardOutput.BaseStream $header
            $size = [BitConverter]::ToUInt32($header, 0)
            if ($size -lt 1 -or $size -gt 1000000) { throw 'Invalid response frame' }
            $body = New-Object byte[] $size
            Read-FrameBytes $process.StandardOutput.BaseStream $body
            $reply = $Utf8.GetString($body) | ConvertFrom-Json
            if (-not $reply.ok) { throw "Host probe failed: $command" }
            if ($command -eq 'ping' -and $reply.status -ne 'pong') { throw 'Invalid ping' }
            if ($command -eq 'check_dependencies' -and $reply.status -ne 'ready') { throw 'Dependencies unavailable' }
        }
        # Close the binary pipe, not StreamWriter: Windows PowerShell 5.1
        # may append a text-encoding preamble when disposing that writer.
        $process.StandardInput.BaseStream.Close()
        if (-not $process.WaitForExit(10000) -or $process.ExitCode -ne 0) { throw 'Host exit failed' }
    } catch {
        Write-Host ("Native host probe error: " + $_.Exception.ToString())
        throw
    } finally {
        if ($process.Id -and -not $process.HasExited) {
            # A one-file PyInstaller host has a child process holding the EXE.
            # Terminate only the probe's process tree, then wait before cleanup.
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
            $process.WaitForExit(10000) | Out-Null
        }
        $process.Dispose()
    }
    foreach ($tool in @('yt-dlp', 'ffmpeg')) {
        $arguments = if ($tool -eq 'ffmpeg') { '-version' } else { '--version' }
        & (Join-Path (Split-Path $Exe) "bin/$tool.exe") $arguments | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Dependency execution failed: $tool" }
    }
}
function Read-FrameBytes($Stream, [byte[]]$Buffer) {
    $offset = 0
    while ($offset -lt $Buffer.Length) {
        $task = $Stream.ReadAsync($Buffer, $offset, $Buffer.Length - $offset)
        if (-not $task.Wait(30000)) { throw 'Host response timeout' }
        if ($task.Result -eq 0) { throw 'Truncated host response' }
        $offset += $task.Result
    }
}
function Get-RegistryViews {
    @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)
}
function Assert-OwnedInstall {
    Assert-NoLinks $InstallRoot
    $marker = Join-Path $InstallRoot 'install-owner.json'
    if (-not (Test-Path -LiteralPath $marker)) { throw 'Existing directory is not an owned install' }
    $owner = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    if ($owner.host -ne $HostName -or $owner.root -ne $InstallRoot) { throw 'Invalid ownership marker' }
}
