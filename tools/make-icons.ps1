Add-Type -AssemblyName System.Drawing

$outDir = "C:\Users\Dfrom\OneDrive\Desktop\Splash Hours\icons"

function New-Icon {
    param([int]$Size, [string]$Path, [bool]$Maskable)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $teal = [System.Drawing.Color]::FromArgb(255, 14, 111, 110)
    $bg   = New-Object System.Drawing.SolidBrush($teal)

    if ($Maskable) {
        # full bleed - Android crops it to whatever shape the launcher uses
        $g.FillRectangle($bg, 0, 0, $Size, $Size)
        $art = $Size * 0.52
    } else {
        $r    = $Size * 0.22
        $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
        $gp.AddArc(0, 0, $r*2, $r*2, 180, 90)
        $gp.AddArc($Size-$r*2, 0, $r*2, $r*2, 270, 90)
        $gp.AddArc($Size-$r*2, $Size-$r*2, $r*2, $r*2, 0, 90)
        $gp.AddArc(0, $Size-$r*2, $r*2, $r*2, 90, 90)
        $gp.CloseFigure()
        $g.FillPath($bg, $gp)
        $gp.Dispose()
        $art = $Size * 0.62
    }

    $cx = $Size / 2.0
    $cy = $Size / 2.0
    $rad = $art / 2.0
    $stroke = $Size * 0.055

    $white = [System.Drawing.Color]::White
    $pen = New-Object System.Drawing.Pen($white, $stroke)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round

    # dial
    $g.DrawEllipse($pen, [float]($cx-$rad), [float]($cy-$rad), [float]($rad*2), [float]($rad*2))

    # hands at ten past ten. Angle is measured clockwise from 12, and y grows downwards,
    # so it is x = sin, y = -cos - not the usual cos/sin pair.
    $hourLen = $rad * 0.46
    $minLen  = $rad * 0.68
    $hA = [Math]::PI * 2 * (10.17 / 12.0)
    $mA = [Math]::PI * 2 * (10.0 / 60.0)
    $g.DrawLine($pen, [float]$cx, [float]$cy, [float]($cx + [Math]::Sin($hA)*$hourLen), [float]($cy - [Math]::Cos($hA)*$hourLen))
    $g.DrawLine($pen, [float]$cx, [float]$cy, [float]($cx + [Math]::Sin($mA)*$minLen),  [float]($cy - [Math]::Cos($mA)*$minLen))

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $pen.Dispose(); $bg.Dispose(); $g.Dispose(); $bmp.Dispose()
    "wrote $Path"
}

New-Icon -Size 192 -Path "$outDir\icon-192.png"          -Maskable $false
New-Icon -Size 512 -Path "$outDir\icon-512.png"          -Maskable $false
New-Icon -Size 512 -Path "$outDir\icon-maskable-512.png" -Maskable $true
