# Tico Bot -- adiciona utils/carteira/compras.js e atualiza index.js
$root = "D:\Project\Whatsapp"
Set-Location $root

Write-Host "`n== 1. Backup do index.js atual (vai ser atualizado) ==" -ForegroundColor Cyan
$indexAtual = Join-Path $root "src\utils\carteira\index.js"
$backupDir  = Join-Path $root "backup_antes_migracao"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
if (Test-Path $indexAtual) {
    Copy-Item $indexAtual (Join-Path $backupDir "carteira-index.js.bak") -Force
    Write-Host "  Backup salvo em backup_antes_migracao\carteira-index.js.bak"
} else {
    Write-Host "  index.js nao encontrado em utils\carteira (confira o caminho)."
}

Write-Host "`n== 2. Criando utils/carteira/compras.js ==" -ForegroundColor Cyan
$comprasPath = Join-Path $root "src\utils\carteira\compras.js"
if (-not (Test-Path $comprasPath)) {
    New-Item -ItemType File -Path $comprasPath | Out-Null
    Write-Host "  Criado: $comprasPath"
} else {
    Write-Host "  Ja existe: $comprasPath (nao sobrescrito)"
}

Write-Host "`n== CONCLUIDO ==" -ForegroundColor Green
Write-Host "`nProximo passo manual:" -ForegroundColor Yellow
Write-Host "  1) Cole o codigo de compras.js em src\utils\carteira\compras.js"
Write-Host "  2) Substitua o conteudo de src\utils\carteira\index.js pela versao nova"
Write-Host "     (adiciona comprarComGold aos exports)"
Write-Host "  3) Edite src\handlers\diversao\economia\loja.js: atualize o import"
Write-Host "     e substitua a funcao handleComprar pela versao nova"
Write-Host "  4) Teste com: node src\bot.js"