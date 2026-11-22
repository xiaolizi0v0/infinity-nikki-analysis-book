param([string]$Python = 'python')

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$appName = 'Xijing'
$packageName = 'xijing-windows-x64'

Push-Location -LiteralPath $project
try {
    $architecture = & $Python -c 'import platform; print(platform.machine())'
    if ($LASTEXITCODE -ne 0 -or $architecture -ne 'AMD64') {
        throw 'Use an x64 Python installation to build this package.'
    }

    $pythonRoot = & $Python -c 'import sys; print(sys.base_prefix)'
    if ($LASTEXITCODE -ne 0) { throw 'Could not locate the Python installation.' }

    New-Item -ItemType Directory -Path 'build', 'dist' -Force | Out-Null
    $buildOptions = @(
        '--noconfirm', '--onedir', '--windowed', '--noupx',
        '--name', $appName, '--icon', (Join-Path $project 'icon.ico'),
        '--workpath', 'build', '--specpath', 'build', '--distpath', 'dist', 'launcher.py'
    )
    & $Python -m PyInstaller @buildOptions
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed.' }

    $bundle = Join-Path (Join-Path $project 'dist') $appName
    foreach ($entry in 'index.html', 'css', 'js', 'assets', 'icon.ico', 'LICENSE') {
        Copy-Item -LiteralPath $entry -Destination $bundle -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $pythonRoot 'LICENSE.txt') -Destination (Join-Path $bundle 'THIRD-PARTY-NOTICES.txt')
    Copy-Item -LiteralPath 'scripts/licenses' -Destination $bundle -Recurse

    $zip = Join-Path (Join-Path $project 'dist') "$packageName.zip"
    Compress-Archive -LiteralPath $bundle -DestinationPath $zip -Force
    Write-Output $zip
}
finally {
    Pop-Location
}
