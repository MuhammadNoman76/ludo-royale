# Waits for a Windows notification ("New notification" popup) and prints its text, read through UI
# Automation. Nothing is clicked or captured; it only reads the popup's accessible text.
#   toast.ps1 -Contains "invited you" [-Seconds 15]
param(
    [string]$Contains = "",
    [int]$Seconds = 15
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$named = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "New notification")
$until = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $until) {
    $popups = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $named)
    foreach ($popup in $popups) {
        $texts = $popup.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
            ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Unique
        $joined = ($texts -join " | ")
        if (-not $Contains -or $joined -like "*$Contains*") {
            "toast: $joined"
            return
        }
    }
    Start-Sleep -Milliseconds 300
}
"no matching toast within $Seconds s"
