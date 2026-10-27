# Tico Bot -- cria utils/identity.js e divide utils/carteira.js em pasta
$root = "D:\Project\Whatsapp"
Set-Location $root

Write-Host "`n== 1. Backup do carteira.js atual ==" -ForegroundColor Cyan
$carteiraAntigo = Join-Path $root "src\utils\carteira.js"
$backupDir = Join-Path $root "backup_antes_migracao"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
if (Test-Path $carteiraAntigo) {
    Copy-Item $carteiraAntigo (Join-Path $backupDir "carteira.js.bak") -Force
    Write-Host "  Backup salvo em backup_antes_migracao\carteira.js.bak"
} else {
    Write-Host "  carteira.js nao encontrado (ja migrado?)."
}

Write-Host "`n== 2. Criando utils/identity.js ==" -ForegroundColor Cyan
$identityPath = Join-Path $root "src\utils\identity.js"
if (-not (Test-Path $identityPath)) {
    New-Item -ItemType File -Path $identityPath | Out-Null
    Write-Host "  Criado: $identityPath"
} else {
    Write-Host "  Ja existe: $identityPath (nao sobrescrito)"
}

Write-Host "`n== 3. Criando pasta utils/carteira ==" -ForegroundColor Cyan
$carteiraDir = Join-Path $root "src\utils\carteira"
if (-not (Test-Path $carteiraDir)) {
    New-Item -ItemType Directory -Path $carteiraDir | Out-Null
    Write-Host "  Criada: $carteiraDir"
} else {
    Write-Host "  Ja existe: $carteiraDir"
}

Write-Host "`n== 4. Criando arquivos dentro de utils/carteira ==" -ForegroundColor Cyan
$arquivos = @("gold.js", "ranking.js", "transferencia.js", "index.js")
foreach ($nome in $arquivos) {
    $caminho = Join-Path $carteiraDir $nome
    if (-not (Test-Path $caminho)) {
        New-Item -ItemType File -Path $caminho | Out-Null
        Write-Host "  Criado: $caminho"
    } else {
        Write-Host "  Ja existe: $caminho (nao sobrescrito)"
    }
}

Write-Host "`n== 5. Removendo o carteira.js antigo (monolito) ==" -ForegroundColor Cyan
if (Test-Path $carteiraAntigo) {
    Remove-Item $carteiraAntigo -Force
    Write-Host "  Removido: $carteiraAntigo"
} else {
    Write-Host "  Ja nao existe."
}

Write-Host "`n== CONCLUIDO ==" -ForegroundColor Green
Write-Host "`nProximo passo manual:" -ForegroundColor Yellow
Write-Host "  1) Cole o codigo de identity.js em src\utils\identity.js"
Write-Host "  2) Cole os codigos de gold.js, ranking.js, transferencia.js, index.js em src\utils\carteira\"
Write-Host "  3) Atualize os requires em bot.js (resolveJidComLid) e em quem"
Write-Host "     importava utils/carteira.js -- o caminho './utils/carteira'"
Write-Host "     continua resolvendo pro index.js da pasta automaticamente."
Write-Host "  4) Teste com: node src\bot.js"