# Renders the Ludo Royale icons from the vector logo (same shapes as web/public/favicon.svg):
#   windows\LudoRoyale\Assets\LudoRoyale.ico   app, tray and installer icon (16-256 px; small sizes simplified)
#   web\public\icon-192.png, icon-512.png       web app icons
#   powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase, System.Drawing

$root = Split-Path -Parent $PSScriptRoot

function Brush([string]$hex, [double]$opacity = 1.0) {
    $b = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($hex))
    $b.Opacity = $opacity
    $b.Freeze()
    return $b
}

function Shape($group, [string]$data, $fill, $pen = $null) {
    $geo = [System.Windows.Media.Geometry]::Parse($data)
    $group.Children.Add((New-Object System.Windows.Media.GeometryDrawing $fill, $pen, $geo)) | Out-Null
}

# 64 x 64 logo. $small: simpler shapes that stay readable at 16-24 px.
function New-Logo([bool]$small) {
    $g = New-Object System.Windows.Media.DrawingGroup
    Shape $g "M16,2 H48 A14,14 0 0 1 62,16 V48 A14,14 0 0 1 48,62 H16 A14,14 0 0 1 2,48 V16 A14,14 0 0 1 16,2 Z" (Brush "#FFFFFF")
    Shape $g "M16 2h10v24H2V16A14 14 0 0 1 16 2z" (Brush "#E5484D")
    Shape $g "M38 2h10a14 14 0 0 1 14 14v10H38z" (Brush "#30A46C")
    Shape $g "M38 38h24v10a14 14 0 0 1-14 14H38z" (Brush "#F5B300")
    Shape $g "M2 38h24v24H16A14 14 0 0 1 2 48z" (Brush "#3E8EF7")
    $edge = New-Object System.Windows.Media.Pen (Brush "#000000" 0.10), 2
    Shape $g "M16,2 H48 A14,14 0 0 1 62,16 V48 A14,14 0 0 1 48,62 H16 A14,14 0 0 1 2,48 V16 A14,14 0 0 1 16,2 Z" $null $edge
    if ($small) {
        Shape $g "M21,19 H43 A5,5 0 0 1 48,24 V40 A5,5 0 0 1 43,45 H21 A5,5 0 0 1 16,40 V24 A5,5 0 0 1 21,19 Z" (Brush "#1D2433")
        foreach ($p in @(@(24.5, 26.5), @(32, 32), @(39.5, 37.5))) {
            Shape $g ("M {0},{1} m -3.6,0 a 3.6,3.6 0 1 0 7.2,0 a 3.6,3.6 0 1 0 -7.2,0" -f $p[0], $p[1]) (Brush "#FFFFFF")
        }
    }
    else {
        Shape $g "M26,22 H38 A6,6 0 0 1 44,28 V40 A6,6 0 0 1 38,46 H26 A6,6 0 0 1 20,40 V28 A6,6 0 0 1 26,22 Z" (Brush "#1D2433")
        foreach ($p in @(@(26.5, 28.5), @(32, 34), @(37.5, 39.5))) {
            Shape $g ("M {0},{1} m -2.6,0 a 2.6,2.6 0 1 0 5.2,0 a 2.6,2.6 0 1 0 -5.2,0" -f $p[0], $p[1]) (Brush "#FFFFFF")
        }
        $crownPen = New-Object System.Windows.Media.Pen (Brush "#1D2433"), 1.4
        $crownPen.LineJoin = [System.Windows.Media.PenLineJoin]::Round
        Shape $g "M22 19l3.5 3 6.5-6 6.5 6 3.5-3-1.5 6h-17z" (Brush "#F5B300") $crownPen
    }
    return $g
}

function Render-Png([System.Windows.Media.Drawing]$drawing, [int]$size) {
    $visual = New-Object System.Windows.Media.DrawingVisual
    $dc = $visual.RenderOpen()
    $scale = $size / 64.0
    $dc.PushTransform((New-Object System.Windows.Media.ScaleTransform $scale, $scale))
    $dc.DrawDrawing($drawing)
    $dc.Pop()
    $dc.Close()
    $bmp = New-Object System.Windows.Media.Imaging.RenderTargetBitmap $size, $size, 96, 96, ([System.Windows.Media.PixelFormats]::Pbgra32)
    $bmp.Render($visual)
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bmp))
    $ms = New-Object System.IO.MemoryStream
    $encoder.Save($ms)
    return , $ms.ToArray()
}

# Sizes up to 48 px as classic 32-bit bitmaps (best compatibility), larger ones as PNG.
function Get-IcoFrame([byte[]]$png, [int]$size) {
    if ($size -gt 48) { return , $png }
    $bmp = New-Object System.Drawing.Bitmap (New-Object System.IO.MemoryStream (, $png))
    $ms = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter $ms
    $w.Write([UInt32]40); $w.Write([Int32]$size); $w.Write([Int32]($size * 2))
    $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]0)
    $w.Write([UInt32]0); $w.Write([Int32]0); $w.Write([Int32]0); $w.Write([UInt32]0); $w.Write([UInt32]0)
    for ($y = $size - 1; $y -ge 0; $y--) {
        for ($x = 0; $x -lt $size; $x++) {
            $c = $bmp.GetPixel($x, $y)
            $w.Write([byte]$c.B); $w.Write([byte]$c.G); $w.Write([byte]$c.R); $w.Write([byte]$c.A)
        }
    }
    $rowBytes = [int]([Math]::Ceiling($size / 32.0) * 4)
    $w.Write((New-Object byte[] ($rowBytes * $size)))
    $w.Flush()
    $bmp.Dispose()
    return , $ms.ToArray()
}

$full = New-Logo $false
$simple = New-Logo $true

$sizes = 16, 20, 24, 32, 40, 48, 64, 96, 128, 256
$frames = @()
foreach ($s in $sizes) {
    $png = Render-Png $(if ($s -le 24) { $simple } else { $full }) $s
    $frames += , @{ Size = $s; Bytes = (Get-IcoFrame $png $s) }
}
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
    $dim = if ($f.Size -ge 256) { 0 } else { $f.Size }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$f.Bytes.Length); $w.Write([UInt32]$offset)
    $offset += $f.Bytes.Length
}
foreach ($f in $frames) { $w.Write([byte[]]$f.Bytes) }
$w.Flush()
$assets = Join-Path $root "windows\LudoRoyale\Assets"
New-Item -ItemType Directory -Force $assets | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $assets "LudoRoyale.ico"), $out.ToArray())
Write-Host "Icon written: windows\LudoRoyale\Assets\LudoRoyale.ico ($($out.Length) bytes)"

foreach ($s in 192, 512) {
    [System.IO.File]::WriteAllBytes((Join-Path $root "web\public\icon-$s.png"), (Render-Png $full $s))
    Write-Host "Written: web\public\icon-$s.png"
}
