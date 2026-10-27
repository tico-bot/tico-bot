$root = "D:\Project\Whatsapp"
Set-Location $root

Write-Host "`n== Criando src/router.js ==" -ForegroundColor Cyan
$routerPath = Join-Path $root "src\router.js"
if (-not (Test-Path $routerPath)) {
    New-Item -ItemType File -Path $routerPath | Out-Null
    Write-Host "  Criado: $routerPath"
} else {
    Write-Host "  Ja existe: $routerPath (nao sobrescrito)"
}

Write-Host "`nProximo passo manual:" -ForegroundColor Yellow
Write-Host "  1) Cole o codigo de router.js em src\router.js"
Write-Host "  2) NAO edite bot.js ainda -- vou te mandar a versao final dele"
Write-Host "     depois que voce confirmar que router.js nao tem erro de sintaxe"
Write-Host "     (node -e ""require('./src/router.js')"")"