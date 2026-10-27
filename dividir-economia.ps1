# Tico Bot -- divide handlers/diversao/economia.js em pasta
$root = "D:\Project\Whatsapp"
Set-Location $root

Write-Host "`n== 1. Backup do economia.js atual ==" -ForegroundColor Cyan
$economiaAntigo = Join-Path $root "src\handlers\diversao\economia.js"
$backupDir = Join-Path $root "backup_antes_migracao"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
if (Test-Path $economiaAntigo) {
    Copy-Item $economiaAntigo (Join-Path $backupDir "economia.js.bak") -Force
    Write-Host "  Backup salvo em backup_antes_migracao\economia.js.bak"
} else {
    Write-Host "  economia.js nao encontrado (ja migrado?)."
}

Write-Host "`n== 2. Criando pasta handlers/diversao/economia ==" -ForegroundColor Cyan
$economiaDir = Join-Path $root "src\handlers\diversao\economia"
if (-not (Test-Path $economiaDir)) {
    New-Item -ItemType Directory -Path $economiaDir | Out-Null
    Write-Host "  Criada: $economiaDir"
} else {
    Write-Host "  Ja existe: $economiaDir"
}

Write-Host "`n== 3. Removendo o economia.js antigo (monolito) ==" -ForegroundColor Cyan
if (Test-Path $economiaAntigo) {
    Remove-Item $economiaAntigo -Force
    Write-Host "  Removido: $economiaAntigo"
} else {
    Write-Host "  Ja nao existe."
}

Write-Host "n== CONCLUIDO ==" -ForegroundColor Green
Write-Host "nProximo passo manual:" -ForegroundColor Yellow
Write-Host "  1) Cole os arquivos novos dentro de src\handlers\diversao\economia\:"
Write-Host "       _shared.js, loja.js, garimpo.js, cassino.js, transferencia.js, extrato.js, ranking.js, index.js"
Write-Host "  2) Substitua o conteudo de src\config\economia.js pelo novo (mandado a seguir)."
Write-Host "  3) Nenhum require() em bot.js ou handlers/diversao/index.js precisa mudar."

