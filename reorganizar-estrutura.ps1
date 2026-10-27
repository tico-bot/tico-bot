# Tico Bot -- reorganizacao estrutural completa
# Roda a partir de qualquer lugar; o script entra na raiz sozinho.

$root = "D:\Project\Whatsapp"
Set-Location $root

Write-Host "`n== 1. Removendo o shim handlers/diversao.js ==" -ForegroundColor Cyan
$diversaoShim = Join-Path $root "src\handlers\diversao.js"
if (Test-Path $diversaoShim) {
    Remove-Item $diversaoShim -Force
    Write-Host "  Removido: $diversaoShim"
} else {
    Write-Host "  Ja nao existe."
}

Write-Host "`n== 2. Removendo lixo de patch antigo ==" -ForegroundColor Cyan
foreach ($f in @("tmp_patch_utilidade.py", "patch_output.txt")) {
    $full = Join-Path $root $f
    if (Test-Path $full) {
        Remove-Item $full -Force
        Write-Host "  Removido: $full"
    } else {
        Write-Host "  Ja nao existe: $f"
    }
}

Write-Host "`n== 3. Removendo utilidade/menus.js orfao (se existir) ==" -ForegroundColor Cyan
$orfao = Join-Path $root "src\handlers\utilidade\menus.js"
if (Test-Path $orfao) {
    Remove-Item $orfao -Force
    Write-Host "  Removido: $orfao"
} else {
    Write-Host "  Ja nao existe."
}

Write-Host "`n== 4. Movendo verify-structure.js para scripts/ ==" -ForegroundColor Cyan
$verifySrc = Join-Path $root "src\handlers\diversao\verify-structure.js"
$verifyDst = Join-Path $root "src\scripts\diversao-verify-structure.js"
if (Test-Path $verifySrc) {
    Move-Item $verifySrc $verifyDst -Force
    Write-Host "  Movido: $verifySrc -> $verifyDst"
} else {
    Write-Host "  Nao encontrado, pulando."
}

Write-Host "`n== 5. Criando pastas novas ==" -ForegroundColor Cyan
foreach ($p in @("src\config", "src\handlers\menus", "src\handlers\relacionamento")) {
    $full = Join-Path $root $p
    if (-not (Test-Path $full)) {
        New-Item -ItemType Directory -Path $full | Out-Null
        Write-Host "  Criada: $full"
    } else {
        Write-Host "  Ja existe: $full"
    }
}

Write-Host "`n== 6. Movendo arquivos de relacionamento para handlers/relacionamento/ ==" -ForegroundColor Cyan
$relMap = @{
    "src\handlers\relacionamento.js"       = "src\handlers\relacionamento\index.js"
    "src\handlers\relacionamento-extra.js" = "src\handlers\relacionamento\extra.js"
    "src\handlers\relacionamento-fixar.js" = "src\handlers\relacionamento\fixar.js"
}
foreach ($origem in $relMap.Keys) {
    $origemFull = Join-Path $root $origem
    $destinoFull = Join-Path $root $relMap[$origem]
    if (Test-Path $origemFull) {
        Move-Item $origemFull $destinoFull -Force
        Write-Host "  Movido: $origem -> $($relMap[$origem])"
    } else {
        Write-Host "  Nao encontrado, pulando: $origem"
    }
}

Write-Host "`n== 7. Criando placeholders para o proximo passo ==" -ForegroundColor Cyan
$placeholders = @{
    "src\utils\identity.js"       = "// TODO: centralizar aqui a resolucao de identidade do usuario`n// (getSenderJid, resolveGlobalId, resolveUserFromMsg).`n// Preenchido na proxima etapa, depois de revisar utils/carteira.js.`n"
    "src\config\economia.js"      = "// TODO: mover para ca ITENS_LOJA, MINERIOS e EVENTOS_GARIMPO`n// hoje definidos dentro de handlers/diversao/economia.js.`n"
    "src\config\banco.js"         = "// TODO: mover para ca BANCO_CONFIG`n// hoje definido dentro de handlers/diversao/banco.js.`n"
    "src\config\emprego.js"       = "// TODO: mover para ca CARGOS, TEMPO e HORARIO`n// hoje definidos dentro de handlers/diversao/emprego.js.`n"
    "src\handlers\menus\index.js" = "// TODO: unica fonte de verdade para os textos de menu.`n// Vai reunir o conteudo hoje espalhado entre`n// handlers/diversao/menus.js e handlers/utilidade/menu.js,`n// escolhendo sempre a versao ja corrigida de cada funcao.`n"
}
foreach ($caminho in $placeholders.Keys) {
    $full = Join-Path $root $caminho
    if (-not (Test-Path $full)) {
        Set-Content -Path $full -Value $placeholders[$caminho] -Encoding utf8
        Write-Host "  Criado: $caminho"
    } else {
        Write-Host "  Ja existe, nao sobrescrito: $caminho"
    }
}

Write-Host "`n== CONCLUIDO ==" -ForegroundColor Green
Write-Host "`nATENCAO -- os seguintes require() ficam pendentes de correcao no proximo passo:" -ForegroundColor Yellow
Write-Host "  1) bot.js: require(...'handlers','relacionamento') deve continuar funcionando,"
Write-Host "     pois o arquivo movido virou index.js dentro da pasta nova."
Write-Host "  2) Qualquer require('./relacionamento-extra') ou require('./relacionamento-fixar')"
Write-Host "     precisa ser atualizado para os novos caminhos dentro da pasta relacionamento/."
Write-Host "`nRode os dois comandos de verificacao que serao enviados a seguir e mande o resultado."
