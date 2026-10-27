# Tico Bot -- divide handlers/grupo.js em pasta
$root = "D:\Project\Whatsapp"
Set-Location $root

Write-Host "`n== 1. Backup do grupo.js atual ==" -ForegroundColor Cyan
$grupoAntigo = Join-Path $root "src\handlers\grupo.js"
$backupDir = Join-Path $root "backup_antes_migracao"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
if (Test-Path $grupoAntigo) {
    Copy-Item $grupoAntigo (Join-Path $backupDir "grupo.js.bak") -Force
    Write-Host "  Backup salvo em backup_antes_migracao\grupo.js.bak"
} else {
    Write-Host "  grupo.js nao encontrado (ja migrado?)."
}

Write-Host "`n== 2. Criando pasta handlers/grupo ==" -ForegroundColor Cyan
$grupoDir = Join-Path $root "src\handlers\grupo"
if (-not (Test-Path $grupoDir)) {
    New-Item -ItemType Directory -Path $grupoDir | Out-Null
    Write-Host "  Criada: $grupoDir"
} else {
    Write-Host "  Ja existe: $grupoDir"
}

Write-Host "`n== 3. Removendo o grupo.js antigo (monolito) ==" -ForegroundColor Cyan
if (Test-Path $grupoAntigo) {
    Remove-Item $grupoAntigo -Force
    Write-Host "  Removido: $grupoAntigo"
} else {
    Write-Host "  Ja nao existe."
}

Write-Host "`n== CONCLUIDO ==" -ForegroundColor Green
Write-Host "`nProximo passo manual:" -ForegroundColor Yellow
Write-Host "  1) Cole os arquivos novos dentro de src\handlers\grupo\:"
Write-Host "       helpers.js, moderacao.js, configuracao.js, info.js, comunicacao.js, index.js"
Write-Host "  2) Nenhum require() em bot.js precisa mudar (require('./handlers/grupo') continua"
Write-Host "     resolvendo para handlers/grupo/index.js automaticamente)."
Write-Host "  3) Teste com: node src\bot.js"