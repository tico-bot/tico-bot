# Tico Bot

Bot de WhatsApp desenvolvido em **Node.js**, com foco em administração de grupos, figurinhas, jogos, economia virtual em Prata e sistemas de progressão. O projeto utiliza a biblioteca Baileys para se conectar ao WhatsApp e MongoDB para persistir dados e a sessão de autenticação.

> **Nome do projeto:** Tico Bot
> **Plataforma:** WhatsApp
> **Runtime:** Node.js 20 ou superior
> **Idioma dos comandos e mensagens:** português

## Visão geral

O Tico reúne ferramentas para comunidades e grupos, desde moderação e utilidades até jogos com progresso persistente.

### Principais funcionalidades

- **Grupos e moderação:** boas-vindas, regras personalizadas, informações e estatísticas do grupo, lista de membros e administradores, banimento, silenciamento, advertências, anti-link, anti-flood e slow mode.
- **Figurinhas e mídia:** criação de figurinhas a partir de imagens e vídeos, efeitos e ferramentas de imagem; recursos de download de mídia dependem da disponibilidade e das restrições da plataforma de origem.
- **Jogos e brincadeiras:** quizzes temáticos, anagramas, charadas, desafios, jogos de sorte e outros comandos interativos.
- **Economia virtual:** saldo por grupo, transações e extratos, missões, garimpo, loja, inventário, marketplace e atividades com recompensas.
- **Progressão:** XP, níveis e rankings.
- **Pets e família:** pets, cuidados, relacionamentos, casamento virtual, filhos e atividades relacionadas.
- **Modo medieval:** personagens, combate, magia, equipamentos, loja e saque.
- **Relacionamentos e eventos:** comandos para casais, aniversários e interações sociais.
- **Utilidades:** consultas, cálculos, tradução, ferramentas de texto, código Morse, QR codes e encurtamento de links.
- **Persistência e sessão:** MongoDB para dados da aplicação e armazenamento da autenticação do WhatsApp.

A lista acima é um resumo das áreas implementadas. Os comandos disponíveis podem variar conforme a configuração e a versão do código.

## Tecnologias

- [Node.js](https://nodejs.org/) — execução do bot.
- [Baileys](https://github.com/WhiskeySockets/Baileys) — conexão com o WhatsApp.
- [MongoDB](https://www.mongodb.com/) e [Mongoose](https://mongoosejs.com/) — banco de dados e modelos.
- [FFmpeg](https://ffmpeg.org/) — processamento de mídia.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — suporte a determinados fluxos de download de mídia.
- [Express](https://expressjs.com/) — endpoints HTTP auxiliares.
- [Sharp](https://sharp.pixelplumbing.com/) — processamento de imagens.

## Requisitos

Antes de executar, tenha:

- Node.js **20 ou superior** e npm.
- Uma instância MongoDB local ou remota acessível pelo bot.
- Acesso à internet para a conexão com o WhatsApp e os serviços usados pelos recursos opcionais.
- Dependências de sistema necessárias para processamento de mídia. Em ambientes Linux, o script de instalação tenta instalar o `yt-dlp` durante o build.

## Instalação local

### 1. Obtenha o código

Clone este repositório usando a URL exibida no botão **Code** do GitHub e entre na pasta criada.

### 2. Instale as dependências

```bash
npm install
```

Para executar também o passo de preparação usado pelo projeto:

```bash
npm run build
```

O script de build instala as dependências npm e tenta disponibilizar o `yt-dlp` em sistemas que não sejam Windows.

### 3. Configure o ambiente

Crie um arquivo `.env` na raiz do projeto. Exemplo mínimo:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/tico_bot
NODE_ENV=development
```

O código aceita `MONGODB_URI` como alternativa a `MONGO_URI`. Se nenhuma das duas estiver definida, o bot utiliza o endereço local padrão configurado no código.

Alguns recursos opcionais podem utilizar variáveis adicionais, dependendo do que você ativar:

| Variável | Finalidade |
|---|---|
| `MONGO_URI` ou `MONGODB_URI` | Conexão com o MongoDB |
| `PORT` | Porta do servidor HTTP auxiliar |
| `NODE_ENV` | Ambiente de execução |
| `ADMIN_KEY` | Chave administrativa de determinados endpoints |
| `BOT_OWNERS` | Configuração de proprietários do bot |
| `JWT_SECRET` | Segredo para recursos que assinam tokens JWT |
| `CORS_ORIGINS` | Origens autorizadas pelo CORS |
| `GIPHY_KEY` | Integrações que utilizam a API do GIPHY |
| `FOOTBALL_API_KEY` | Recursos que dependem de uma API de futebol |
| `REMOVEBG_KEY` | Recursos de remoção de fundo que utilizam esse serviço |
| `YOUTUBE_COOKIES` / `TIKTOK_COOKIES` | Cookies opcionais para fluxos de download compatíveis |
| `CONTAS_KEY` | Chave de determinados recursos de contas |

Configure somente as variáveis dos recursos que realmente utilizar. Os nomes acima não significam que todos os serviços externos estejam ativos por padrão. Consulte o código correspondente para conhecer o formato esperado de cada valor.

**Nunca** publique seu `.env`, tokens, cookies, chaves de API, credenciais do MongoDB ou arquivos de sessão. Não use credenciais reais em exemplos públicos.

### 4. Inicie o MongoDB

Confirme que o banco está em execução e que a URI configurada permite conexão. O bot precisa acessar o banco para inicializar corretamente e persistir os dados.

### 5. Inicie o bot

```bash
npm start
```

Para desenvolvimento com reinício automático ao detectar alterações:

```bash
npm run dev
```

Na primeira conexão, acompanhe o terminal e siga as instruções exibidas para autenticar o WhatsApp, quando necessário. Mantenha os dados de autenticação privados; não compartilhe QR codes de sessão, credenciais ou arquivos de sessão.

## Como usar

No WhatsApp, envie os comandos em uma conversa com o bot ou em um grupo no qual ele esteja presente.

O prefixo padrão mais comum é `!`, mas o projeto possui suporte a prefixos configuráveis. Para começar, envie:

- `!menu` — menu principal.
- `!menujogos` — jogos e diversão.
- `!menuadm` — administração e moderação.
- `!menuutil` — utilidades.
- `!menubaixar` — comandos de download disponíveis.
- `!menufig` — ferramentas de figurinhas.
- `!menupet` — sistema de pets.
- `!menucasal` — relacionamentos.
- `!menumediev` — modo medieval, se disponível na configuração atual.
- `!menuprata` — economia virtual em Prata.

Os nomes dos menus e comandos podem mudar com atualizações. Use o menu enviado pelo próprio bot como referência para a instalação em execução. Comandos administrativos exigem as permissões apropriadas; ações de moderação também dependem das permissões concedidas ao bot no grupo.

## Estrutura do projeto

```text
src/
├── bot.js                 # Inicialização e conexão com o WhatsApp
├── router.js              # Roteamento de mensagens e comandos
├── mongoAuthState.js      # Persistência da autenticação
├── config/                # Configurações dos sistemas
├── handlers/
│   ├── grupo/             # Administração e moderação de grupos
│   ├── diversao/          # Jogos, economia, pets e missões
│   ├── medieval/          # RPG e modo medieval
│   ├── relacionamento/   # Casais e interações sociais
│   ├── menus/             # Menus de ajuda
│   ├── utilidade/         # Consultas, texto e downloads
│   ├── figurinha.js       # Criação de figurinhas
│   └── imagem.js          # Recursos de imagem
├── models/                # Modelos persistidos no MongoDB
├── routes/                # Rotas HTTP auxiliares
├── scripts/               # Scripts de instalação e manutenção
└── utils/                 # Identidade, XP, persistência e utilidades
```

A estrutura acima destaca os principais diretórios; outros módulos e arquivos auxiliares também fazem parte do projeto.

## Downloads de arquivos

O bot disponibiliza comandos para receber arquivos públicos diretamente pelo WhatsApp:

- `!mediafire <link>` — baixa um arquivo público do MediaFire.
- `!googledriver <link>` — baixa um arquivo público do Google Drive.
- Links de Documentos, Planilhas e Apresentações Google são exportados para DOCX, XLSX e PPTX, respectivamente.

Os arquivos precisam estar acessíveis sem login, sem senha e sem permissão especial. O limite por arquivo é de 64 MiB. Links para pastas, arquivos privados, downloads bloqueados pelo proprietário e arquivos acima do limite são recusados. Os downloads são limitados por usuário e têm um intervalo entre requisições para reduzir abuso e consumo excessivo de memória.

Teste os utilitários e os casos de segurança com:

```bash
npm run test:cloud-downloads
npm run test:security
```

## Buscar letras de m�asicas

Use `/letram�asica <nome da m�asica e artista>` para pesquisar uma faixa. Os aliases `/letramusica` e `/letramsc` também são aceitos. O bot retorna os dados da faixa, uma prévia curta de até 90 caracteres e um link para continuar a busca; ele não republica a letra completa.

## Testes e verificações

O projeto disponibiliza um teste automatizado de segurança para downloads:

```bash
npm run test:security
```

Antes de publicar alterações, confira a sintaxe dos arquivos modificados e teste os fluxos relevantes em um ambiente controlado. A execução desse teste, por si só, não garante que todos os comandos, integrações externas ou fluxos do WhatsApp estejam funcionando.

## Implantação

O repositório inclui um arquivo `render.yaml` com configuração de serviço para Render. Para executar em um servidor, configure as variáveis de ambiente no painel da plataforma, principalmente a URI do MongoDB, e confira se o ambiente possui os recursos de sistema necessários.

Considere que instâncias hospedadas precisam de armazenamento persistente adequado para os dados exigidos pelo projeto. Antes de usar múltiplas instâncias, verifique os mecanismos de bloqueio e persistência para evitar processos concorrentes.

## Segurança e privacidade

- Mantenha as credenciais e os arquivos de autenticação fora do Git.
- Restrinja o acesso ao banco de dados e utilize credenciais próprias para a aplicação.
- Configure chaves fortes para endpoints administrativos e tokens quando esses recursos forem utilizados.
- Conceda ao bot apenas as permissões de grupo necessárias.
- Respeite os termos de uso do WhatsApp e das plataformas de origem ao utilizar ferramentas de download.
- Faça backups controlados dos dados importantes e proteja os arquivos de backup.
- Não publique dados pessoais, números de telefone, cookies ou registros privados em issues, logs ou capturas de tela.

## Contribuição

Contribuições são bem-vindas. Para propor uma alteração:

1. Crie uma branch específica para a mudança.
2. Mantenha as alterações focadas e evite incluir segredos ou dados locais.
3. Execute os testes e verificações pertinentes.
4. Descreva o problema, a solução e os passos para reproduzir ou validar a alteração.

## Licença

Nenhuma licença de código aberto foi identificada nesta documentação. Até que uma licença seja adicionada ao repositório, não presuma que o código possa ser redistribuído, modificado ou utilizado sob uma licença específica.

---

**Tico Bot** — ferramentas, jogos e interação para comunidades no WhatsApp.
