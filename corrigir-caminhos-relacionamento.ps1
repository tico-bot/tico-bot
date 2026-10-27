# Corrige os caminhos relativos quebrados apos mover relacionamento.js
# para relacionamento/index.js (ganhou +1 nivel de profundidade)
$root = "D:\Project\Whatsapp"
Set-Location $root

$indexPath = Join-Path $root "src\handlers\relacionamento\index.js"
$extraPath = Join-Path $root "src\handlers\relacionamento\extra.js"

Write-Host "`n== Backup antes de corrigir ==" -ForegroundColor Cyan
$backupDir = Join-Path $root "backup_antes_migracao"
Copy-Item $indexPath (Join-Path $backupDir "relacionamento-index.js.antes-fix.bak") -Force
Copy-Item $extraPath (Join-Path $backupDir "relacionamento-extra.js.antes-fix.bak") -Force
Write-Host "  Backups salvos em backup_antes_migracao\"

Write-Host "`n== Corrigindo index.js ==" -ForegroundColor Cyan
$conteudoIndex = Get-Content $indexPath -Raw -Encoding UTF8

$conteudoIndex = $conteudoIndex -replace `
    [regex]::Escape("require(path.join(__dirname, '..', 'models', 'Usuario'))"), `
    "require(path.join(__dirname, '..', '..', 'models', 'Usuario'))"

$conteudoIndex = $conteudoIndex -replace `
    [regex]::Escape("require(path.join(__dirname, '..', 'utils', 'levelUtils'))"), `
    "require(path.join(__dirname, '..', '..', 'utils', 'levelUtils'))"

$conteudoIndex = $conteudoIndex -replace `
    [regex]::Escape("path.join(__dirname, '..', '..', 'Audio-Image',"), `
    "path.join(__dirname, '..', '..', '..', 'Audio-Image',"

Set-Content $indexPath -Value $conteudoIndex -Encoding UTF8 -NoNewline
Write-Host "  Corrigido: index.js (Usuario, levelUtils, 3x Audio-Image)"

Write-Host "`n== Corrigindo extra.js ==" -ForegroundColor Cyan
$conteudoExtra = Get-Content $extraPath -Raw -Encoding UTF8

$conteudoExtra = $conteudoExtra -replace `
    [regex]::Escape("require(path.join(__dirname, '..', 'models', 'Usuario'))"), `
    "require(path.join(__dirname, '..', '..', 'models', 'Usuario'))"

$conteudoExtra = $conteudoExtra -replace `
    [regex]::Escape("require(path.join(__dirname, '..', 'utils', 'levelUtils'))"), `
    "require(path.join(__dirname, '..', '..', 'utils', 'levelUtils'))"

Set-Content $extraPath -Value $conteudoExtra -Encoding UTF8 -NoNewline
Write-Host "  Corrigido: extra.js (Usuario, levelUtils)"
Write-Host "  (diversao/economia NAO foi tocado - ja estava correto)"

Write-Host "`n== CONCLUIDO ==" -ForegroundColor Green
Write-Host "Rode 'node src\bot.js' para testar." -ForegroundColor Yellow 