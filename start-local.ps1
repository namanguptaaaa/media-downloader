param([switch]$Demo, [int]$Port = 8765, [string[]]$AllowOrigin = @())
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# Existing workspace dependencies are optional. No download/install is performed.
$taskDeps = Join-Path $PSScriptRoot '.deps'
if (Test-Path -LiteralPath $taskDeps) {
    $env:PYTHONPATH = $taskDeps + [IO.Path]::PathSeparator + $env:PYTHONPATH
}
$taskCandidates = @()
if ($env:MEDIA_DOWNLOADER_PYTHON) { $taskCandidates += $env:MEDIA_DOWNLOADER_PYTHON }
if (Test-Path -LiteralPath $taskDeps) {
    # This installed interpreter is independent of the Codex app and AI services.
    $taskCandidates += Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
}
$taskCandidates += Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
$taskPythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($taskPythonCommand) { $taskCandidates += $taskPythonCommand.Source }
foreach ($taskCandidate in $taskCandidates) {
    if (!(Test-Path -LiteralPath $taskCandidate)) { continue }
    & $taskCandidate -c 'import yt_dlp, gallery_dl, imageio_ffmpeg' 2>$null
    if ($LASTEXITCODE -eq 0) {
        $taskArguments = @('-u', '-m', 'server.app', '--port', "$Port")
        if ($Demo) { $taskArguments += '--demo' }
        foreach ($taskOrigin in $AllowOrigin) { $taskArguments += @('--allow-origin', $taskOrigin) }
        & $taskCandidate @taskArguments
        exit $LASTEXITCODE
    }
}
throw 'No Python with downloader dependencies found. Follow README setup, or set MEDIA_DOWNLOADER_PYTHON to your installed Python executable.'
