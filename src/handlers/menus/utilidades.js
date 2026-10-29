'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuUtil(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '      🔧 MENU UTILIDADES',
    '╚══════════════════════╝',
    '',
    '🤖 *INFORMAÇÕES DO BOT*',
    '  ▸ ' + P + 'bot — tempo ativo, comandos executados e versão',
    '',
    '📍 *CONSULTAS*',
    '  ▸ ' + P + 'cep <CEP> — consultar CEP',
    '  ▸ ' + P + 'clima <cidade> — condições do tempo',
    '  ▸ ' + P + 'calcular <expressão> — calculadora',
    '  ▸ ' + P + 'moeda <valor> <origem> <destino> — conversão de moeda',
    '',
    '🌐 *TEXTO & IDIOMAS*',
    '  ▸ ' + P + 'traduzir <idioma> <texto> — traduzir texto',
    '  ▸ ' + P + 'inverter <texto> — inverter o texto',
    '  ▸ ' + P + 'gerarnome — gerar um nickname',
    '  ▸ ' + P + 'gimage <termo> — pesquisar imagens no Google Imagens',
    '  ▸ ' + P + 'fofoca [@pessoa] — brincadeira social',
    '',
    '📡 *CÓDIGO MORSE*',
    '  ▸ ' + P + 'morse <texto> — codificar em Morse',
    '  ▸ ' + P + 'codigomorse <texto> — alias de morse',
    '  ▸ ' + P + 'demorse <código> — decodificar Morse',
    '  ▸ ' + P + 'decodificarmorse <código> — alias de demorse',
    '',
    '👤 *PERFIL & PROGRESSO*',
    '  ▸ ' + P + 'perfil — ver seu perfil',
    '  ▸ ' + P + 'bio <texto> — definir sua bio',
    '  ▸ ' + P + 'level — consultar nível e XP',
    '  ▸ ' + P + 'ranklevel — ranking de níveis',
    '  ▸ ' + P + 'meupainel / ' + P + 'site — acessar o painel',
    '  ▸ ' + P + 'recuperar — gerar código de verificação (use em conversa privada)',
    '  ▸ ' + P + 'resetsenha — instruções para redefinir a senha no painel',
    '',
    '🔗 *OUTROS*',
    '  ▸ ' + P + 'encurtar <link> — encurtar link',
    '  ▸ ' + P + 'qrcode <texto/link> — gerar QR code',
    '  ▸ ' + P + 'piada — piada aleatória',
    '  ▸ ' + P + 'fato — curiosidade aleatória',
    '  ▸ ' + P + 'alteradores — efeitos de áudio e vídeo',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

async function handleMenuBaixar(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '        📥 MENU DOWNLOADS',
    '╚══════════════════════╝',
    '',
    '🎵 *MÚSICA & ÁUDIO*',
    '  ▸ ' + P + 'som <nome/música> — pesquisar e baixar áudio',
    '  ▸ ' + P + 'play <nome/música> — alias de som',
    '  ▸ ' + P + 'audio <link> — baixar áudio de um link',
    '  ▸ ' + P + 'playmp4 — baixar o vídeo da música pesquisada mais recentemente',
    '  ▸ ' + P + 'playdoc — enviar a música recente como documento',
    '  ▸ ' + P + 'letramúsica <música/artista> — pesquisar letra',
    '  ▸ ' + P + 'letramusica / ' + P + 'letramsc — aliases do comando',
    '',
    '📱 *VÍDEO & REDES SOCIAIS*',
    '  ▸ ' + P + 'tiktok <link> — baixar vídeo do TikTok',
    '  ▸ ' + P + 'save <link> — baixar mídia de redes compatíveis',
    '  ▸ ' + P + 'saverec <link> — recortar trecho inicial da mídia',
    '  ▸ ' + P + 'pinterest <link> — baixar mídia do Pinterest',
    '  ▸ ' + P + 'pinterest2 <link> — alias de pinterest',
    '',
    '📁 *ARQUIVOS*',
    '  ▸ ' + P + 'mediafire <link> — baixar arquivo do MediaFire',
    '  ▸ ' + P + 'googledriver <link> — baixar arquivo do Google Drive',
    '  ▸ ' + P + 'googledriver <link do Docs/Sheets/Slides> — exportar para DOCX/XLSX/PPTX',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuUtil, handleMenuBaixar };
