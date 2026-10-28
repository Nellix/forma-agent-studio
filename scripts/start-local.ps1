param([int]$Port = 3000, [string]$NodePath = '')
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $NodePath) {
    $NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($NodeCommand) { $NodePath = $NodeCommand.Source }
    else {
        $BundledRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node'
        $BundledNode = Get-ChildItem -Path (Join-Path $BundledRoot '*\bin\node.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($BundledNode) { $NodePath = $BundledNode.FullName }
    }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) { throw 'Install Node.js 24+ or provide -NodePath.' }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'dist\server\main.js'))) { throw 'Build the project first: npm ci; npm run build.' }
$DataDirectory = Join-Path $ProjectRoot '.data'
New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
$StatePath = Join-Path $DataDirectory 'local-server.json'
if (Test-Path -LiteralPath $StatePath) {
    $State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    $Existing = Get-Process -Id $State.processId -ErrorAction SilentlyContinue
    if ($Existing -and $Existing.StartTime.ToUniversalTime().ToString('o') -eq $State.startedAt) {
        Write-Output "Studio is already running at http://127.0.0.1:$($State.port)"
        exit 0
    }
}
# Check before starting; never stop a process that owns an unrelated port.
$PortCheck = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $PortCheck.Start() } catch { throw "Port $Port is occupied. Stop the existing server or choose -Port." } finally { $PortCheck.Stop() }
$EntryPath = Join-Path $PSScriptRoot 'local-demo.mjs'
$OldPort = $env:PORT
# Normalize inherited PATH casing for Windows PowerShell's environment dictionary.
$ProcessPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
foreach ($PathName in @('PATH', 'Path', 'path')) { [Environment]::SetEnvironmentVariable($PathName, $null, 'Process') }
[Environment]::SetEnvironmentVariable('Path', $ProcessPath, 'Process')
try {
    $env:PORT = [string]$Port
    $ServerProcess = Start-Process -FilePath $NodePath -ArgumentList ('"{0}"' -f $EntryPath) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataDirectory 'local-server.log') -RedirectStandardError (Join-Path $DataDirectory 'local-server-error.log') -PassThru
} finally { $env:PORT = $OldPort }
@{ processId = $ServerProcess.Id; startedAt = $ServerProcess.StartTime.ToUniversalTime().ToString('o'); port = $Port } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
Write-Output "Studio is starting at http://127.0.0.1:$Port. Logs: $DataDirectory"
