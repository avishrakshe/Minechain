# Run a bash command inside the MineChain codespace without PowerShell/ssh quoting problems.
# Usage: powershell -File l1/cs.ps1 -Cmd 'tail -n 20 ~/minechain-fuji/node.log'
param(
  [Parameter(Mandatory)] [string]$Cmd,
  [string]$Codespace = $env:MINECHAIN_CODESPACE
)
if (-not $Codespace) { throw "set -Codespace or MINECHAIN_CODESPACE" }
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Cmd))
& $gh codespace ssh -c $Codespace -- "echo $b64 | base64 -d | bash" 2>&1 | ForEach-Object { "$_" }
