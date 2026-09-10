$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

$appPath = Join-Path $PSScriptRoot "..\src-tauri\target\debug\biblioteca-3d.exe"
$artifactDir = Join-Path $PSScriptRoot "..\artifacts"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

Start-Process -FilePath $appPath

$process = $null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  $process = Get-Process -Name "biblioteca-3d" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($process) { break }
}
if (-not $process) { throw "No se encontró una ventana visible de Biblioteca 3D." }

$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
$buttonType = [System.Windows.Automation.ControlType]::Button

function Find-Button([string]$name) {
  $typeCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    $buttonType
  )
  if ($name.StartsWith("PREFIX:")) {
    $prefix = $name.Substring(7)
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $typeCondition)
    return $buttons | Where-Object { $_.Current.Name.StartsWith($prefix) } | Select-Object -First 1
  }
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $name
  )
  $condition = New-Object System.Windows.Automation.AndCondition($nameCondition, $typeCondition)
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Press-Button([string]$name) {
  Write-Output "PRESS=$name"
  $button = Find-Button $name
  if (-not $button) { throw "No se encontró el botón '$name'." }
  try {
    $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
  } catch [System.InvalidOperationException] {
    $pattern = $button.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $pattern.Toggle()
  }
  Start-Sleep -Milliseconds 900
}

function Read-Toggle([string]$name) {
  $button = Find-Button $name
  if (-not $button) { throw "No se encontró el botón '$name'." }
  $pattern = $button.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  return $pattern.Current.ToggleState.ToString()
}

function Ensure-Selected([string]$name) {
  $button = Find-Button $name
  if (-not $button) {
    $typeCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      $buttonType
    )
    $available = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $typeCondition) |
      ForEach-Object { $_.Current.Name } |
      Where-Object { $_ }
    Write-Output "AVAILABLE_BUTTONS=$($available -join ' | ')"
    throw "No se encontró la opción '$name'."
  }
  if ((Read-Toggle $name) -ne "On") { Press-Button $name }
}

function Save-WindowShot([string]$fileName) {
  $bounds = $root.Current.BoundingRectangle
  $width = [Math]::Max(1, [int][Math]::Round($bounds.Width))
  $height = [Math]::Max(1, [int][Math]::Round($bounds.Height))
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([int]$bounds.Left, [int]$bounds.Top, 0, 0, $bitmap.Size)
    $path = Join-Path $artifactDir $fileName
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    return $path
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$windowBounds = $root.Current.BoundingRectangle
Write-Output "TITLE=$($root.Current.Name)"
Write-Output "WINDOW=$([int]$windowBounds.Width)x$([int]$windowBounds.Height)"

$existingClose = Find-Button "Cerrar"
if ($existingClose) {
  $existingClose.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 500
}
$animationButton = Find-Button "PREFIX:sword and shield run"
if (-not $animationButton) { throw "No se encontró la animación de prueba sword and shield run." }
try {
  $animationButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
} catch [System.InvalidOperationException] {
  $animationButton.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
}
Start-Sleep -Seconds 5
function Verify-Combination([string]$body, [string]$bones, [string]$fileName) {
  Press-Button "Ajustes"
  Ensure-Selected $body
  Ensure-Selected $bones
  $bodyState = Read-Toggle $body
  $bonesState = Read-Toggle $bones
  Press-Button "Cerrar"
  Start-Sleep -Seconds 4
  $shot = Save-WindowShot $fileName
  Write-Output "COMBINATION=$body | $bones | $bodyState | $bonesState"
  Write-Output "SCREENSHOT=$shot"
}

Verify-Combination "Masculino" "Sin palitos" "Biblioteca-3D-v0.1.0-masculino-sin-palitos.png"
Verify-Combination "Masculino" "Con palitos" "Biblioteca-3D-v0.1.0-masculino-con-palitos.png"
Verify-Combination "Femenino" "Sin palitos" "Biblioteca-3D-v0.1.0-femenino-sin-palitos.png"
Verify-Combination "Femenino" "Con palitos" "Biblioteca-3D-v0.1.0-femenino-con-palitos.png"
