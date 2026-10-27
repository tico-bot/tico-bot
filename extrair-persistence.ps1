# Tico Bot -- extrai loadData/saveData do bot.js para src/utils/persistence.js
$root = "D:\Project\Whatsapp"
Set-Location $root

Write-Host "`n== 1. Backup do bot.js atual ==" -ForegroundColor Cyan
$botAtual  = Join-Path $root "src\bot.js"
$backupDir = Join-Path $root "backup_antes_migracao"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
if (Test-Path $botAtual) {
    Copy-Item $botAtual (Join-Path $backupDir "bot.js.bak") -Force
    Write-Host "  Backup salvo em backup_antes_migracao\bot.js.bak"
} else {
    Write-Host "  bot.js nao encontrado (confira o caminho)."
}

Write-Host "`n== 2. Criando utils/persistence.js ==" -ForegroundColor Cyan
$persistPath = Join-Path $root "src\utils\persistence.js"
if (-not (Test-Path $persistPath)) {
    New-Item -ItemType File -Path $persistPath | Out-Null
    Write-Host "  Criado: $persistPath"
} else {
    Write-Host "  Ja existe: $persistPath (nao sobrescrito)"
}

Write-Host "`n== CONCLUIDO ==" -ForegroundColor Green
Write-Host "`nProximo passo manual:" -ForegroundColor Yellow
Write-Host "  1) Cole o codigo de persistence.js em src\utils\persistence.js"
Write-Host "  2) Aguarde o router.js (proxima entrega) antes de editar o bot.js"
Write-Host "     -- nao remova nada do bot.js ainda, so cole o arquivo novo"