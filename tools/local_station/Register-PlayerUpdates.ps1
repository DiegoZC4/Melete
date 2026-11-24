# Install once on an opted-in station. No timer, audio restart, or open port.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Python,
    [Parameter(Mandatory)][string]$Player,
    [Parameter(Mandatory)][uri]$Manifest,
    [Parameter(Mandatory)][string]$User,
    [string]$Checkout,
    [string]$CheckoutBranch = 'main',
    [switch]$DefinitionOnly
)
$ErrorActionPreference = 'Stop'
$Python = (Resolve-Path -LiteralPath $Python).ProviderPath
$Player = (Resolve-Path -LiteralPath $Player).ProviderPath
$updater = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'update_player.py')).ProviderPath
if ($Manifest.Scheme -ne 'https' -or $Manifest.UserInfo -or $Manifest.Fragment -or
    [IO.Path]::GetExtension($Player) -ne '.html' -or $Manifest.AbsoluteUri.Contains('"')) { throw 'Invalid station release channel' }
$sid = ([Security.Principal.NTAccount]$User).Translate([Security.Principal.SecurityIdentifier]).Value
$channel = 'Melete verified offline player'
$tag = 'Melete local_station verified player updater v1'
function XmlText([string]$s) { [Security.SecurityElement]::Escape($s) }
$argsLine = '"{0}" "{1}" --manifest "{2}"' -f $updater,$Player,$Manifest.AbsoluteUri
if ($Checkout) {
    $Checkout=(Resolve-Path -LiteralPath $Checkout).ProviderPath
    if ($CheckoutBranch -notmatch '^[A-Za-z0-9][A-Za-z0-9/._-]*$') { throw 'Invalid source branch' }
    $argsLine += ' --checkout "{0}" --checkout-branch "{1}"' -f $Checkout,$CheckoutBranch
}
$argsText = XmlText $argsLine
$events = XmlText '<QueryList><Query Id="0"><Select Path="Microsoft-Windows-NetworkProfile/Operational">*[System[EventID=10000]]</Select><Select Path="System">*[System[Provider[@Name="Microsoft-Windows-Power-Troubleshooter"] and EventID=1]]</Select></Query></QueryList>'
$xml = @"
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>$tag</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$sid</UserId></LogonTrigger>
    <EventTrigger><Enabled>true</Enabled><Subscription>$events</Subscription><Delay>PT5S</Delay></EventTrigger>
  </Triggers>
  <Principals><Principal id="Operator"><UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT3M</ExecutionTimeLimit></Settings>
  <Actions Context="Operator"><Exec><Command>$(XmlText $Python)</Command><Arguments>$argsText</Arguments></Exec></Actions>
</Task>
"@
if ($DefinitionOnly) { return $xml }
$existing = Get-ScheduledTask -TaskPath '\' -TaskName $channel -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $tag) { throw 'An unrelated task has this name; left untouched.' }
$null = Register-ScheduledTask -TaskPath '\' -TaskName $channel -Xml $xml -Force
Write-Output $channel
