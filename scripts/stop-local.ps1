$ErrorActionPreference = 'Stop'
$StatePath = Join-Path $PSScriptRoot '..\.data\local-server.json'
if (-not (Test-Path -LiteralPath $StatePath)) { Write-Output 'No local server was started by start-local.ps1.'; exit 0 }
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$ServerProcess = Get-Process -Id $State.processId -ErrorAction SilentlyContinue
if ($ServerProcess) {
    if ($ServerProcess.StartTime.ToUniversalTime().ToString('o') -ne $State.startedAt) { throw 'The process ID now belongs to another process. It was left untouched.' }
    Stop-Process -Id $ServerProcess.Id
}
Remove-Item -LiteralPath $StatePath
Write-Output 'Local Studio stopped. Projects and credentials remain in .data.'
