/* =========================================================
   admin-core.js — Tico Bot Admin
   Utilitários, login, sidebar, navegação, modal, toast
   ========================================================= */

const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000/api'
  : 'https://tico-bot-6jpn.onrender.com/api';

/* ── Auto-Login por Token de Acesso Direto (!site / !painel) ── */
(function checkTokenAutoLogin() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    const apiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3000/api'
      : 'https://tico-bot-6jpn.onrender.com/api';

    fetch(`${apiHost}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.jwt) {
          localStorage.setItem('jwt', data.jwt);
          sessionStorage.setItem('piro_jwt', data.jwt);
          const cleanUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);
          if (window.location.pathname.includes('login.html') || window.location.pathname.includes('cadastro.html')) {
            window.location.replace('perfil.html');
          } else {
            window.location.reload();
          }
        }
      })
      .catch(err => console.error('Erro no auto-login:', err));
  }
})();

/* ── Utilitários básicos ─────────────────────────────────── */
const $ = id => document.getElementById(id);
const show = id => $(id)?.classList.remove('hidden');
const hide = id => $(id)?.classList.add('hidden');

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function adminKey()     { return sessionStorage.getItem('piro_admin_key'); }
function adminHeaders() { return { 'x-admin-key': adminKey(), 'Content-Type': 'application/json' }; }

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('pt-BR');
}

/* ── Nomes customizados (localStorage como cache local) ───── */
function nomesCustomLocais() {
  try { return JSON.parse(localStorage.getItem('piro_nomes_grupo') || '{}'); }
  catch { return {}; }
}
function salvarNomeCustomLocal(jid, nome) {
  const atual = nomesCustomLocais();
  atual[jid] = nome;
  localStorage.setItem('piro_nomes_grupo', JSON.stringify(atual));
}
function nomeExibicao(grupo) {
  const local = nomesCustomLocais()[grupo.idGrupo];
  return grupo.nomeCustom || local || grupo.nome || 'Grupo sem nome';
}
function nomeGrupoPorJid(jid) {
  const g = window.gruposCache?.find(x => x.idGrupo === jid);
  return g ? nomeExibicao(g) : jid;
}

/* ── Toast ───────────────────────────────────────────────── */
let toastTimer;
function toast(msg, tipo = 'ok') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast--${tipo}`;
  void t.offsetWidth;
  t.classList.add('toast--show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('toast--show'), 2800);
}

/* ── Modal de confirmação ────────────────────────────────── */
let modalCallback = null;

function abrirModal(titulo, msg, cb) {
  $('modal-titulo').textContent = titulo;
  $('modal-msg').textContent    = msg;
  modalCallback = cb;
  show('modal-overlay');
}

$('modal-cancelar').addEventListener('click',  () => hide('modal-overlay'));
$('modal-confirmar').addEventListener('click', () => {
  hide('modal-overlay');
  if (modalCallback) modalCallback();
});
$('modal-overlay').addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') hide('modal-overlay');
});

/* ── Modal renomear grupo ────────────────────────────────── */
let renomearJidAtual = null;

function abrirModalRenomear(jid, nomeAtual) {
  renomearJidAtual = jid;
  $('renomear-jid-ref').textContent = jid;
  $('renomear-input').value = (nomeAtual === jid || nomeAtual === 'Grupo sem nome') ? '' : nomeAtual;
  show('modal-renomear-overlay');
  setTimeout(() => $('renomear-input').focus(), 50);
}

function fecharModalRenomear() {
  hide('modal-renomear-overlay');
  renomearJidAtual = null;
}

$('renomear-cancelar').addEventListener('click', fecharModalRenomear);
$('modal-renomear-overlay').addEventListener('click', e => {
  if (e.target.id === 'modal-renomear-overlay') fecharModalRenomear();
});
$('renomear-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('renomear-salvar').click();
});

$('renomear-salvar').addEventListener('click', async () => {
  if (!renomearJidAtual) return;
  const novoNome = $('renomear-input').value.trim();
  if (!novoNome) { toast('Digite um nome válido.', 'erro'); return; }

  const jid = renomearJidAtual;
  $('renomear-salvar').disabled = true;

  salvarNomeCustomLocal(jid, novoNome);

  try {
    const res = await fetch(`${API}/admin/grupo/${encodeURIComponent(jid)}/nome`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ nome: novoNome })
    });
    if (!res.ok) throw new Error();
    toast('Nome salvo no banco de dados!');
  } catch {
    toast('Nome salvo localmente (erro ao persistir no backend).', 'erro');
  }

  const grupo = window.gruposCache?.find(g => g.idGrupo === jid);
  if (grupo) grupo.nomeCustom = novoNome;

  window.atualizarListaGrupos?.();
  window.popularSelectMensagens?.(window.gruposCache);
  window.atualizarDashboard?.();
  fecharModalRenomear();
  $('renomear-salvar').disabled = false;
});

/* ── ESC fecha modais ────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('modal-overlay')?.classList.contains('hidden'))          hide('modal-overlay');
  if (!$('modal-renomear-overlay')?.classList.contains('hidden')) fecharModalRenomear();
});

/* ── Login ───────────────────────────────────────────────── */
$('btn-toggle-senha').addEventListener('click', () => {
  const campo = $('admin-key');
  const visivel = campo.type === 'text';
  campo.type = visivel ? 'password' : 'text';
  $('btn-toggle-senha').textContent = visivel ? '👁' : '🙈';
});

$('btn-login').addEventListener('click', async () => {
  const chave = $('admin-key').value.trim();
  if (!chave) return;
  $('btn-login').disabled = true;
  $('btn-login').textContent = 'Verificando...';
  hide('login-erro');
  try {
    const res = await fetch(`${API}/admin/verify`, { headers: { 'x-admin-key': chave } });
    if (!res.ok) throw new Error();
    sessionStorage.setItem('piro_admin_key', chave);
    hide('tela-login');
    show('painel');
    iniciarPainel();
  } catch {
    show('login-erro');
  } finally {
    $('btn-login').disabled = false;
    $('btn-login').textContent = 'Entrar';
  }
});

$('admin-key').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-login').click(); });

/* ── Logout ──────────────────────────────────────────────── */
$('btn-logout').addEventListener('click', () => {
  sessionStorage.removeItem('piro_admin_key');
  if (window.autosyncTimer) clearInterval(window.autosyncTimer);
  if (window.logsLiveTimer) clearInterval(window.logsLiveTimer);
  hide('painel');
  show('tela-login');
  $('admin-key').value = '';
});

/* ── Sidebar ─────────────────────────────────────────────── */
$('btn-abrir-sidebar').addEventListener('click', () => {
  $('sidebar').classList.add('aberta');
  $('sidebar-overlay').classList.remove('hidden');
});
$('btn-fechar-sidebar').addEventListener('click', fecharSidebar);
$('sidebar-overlay').addEventListener('click', fecharSidebar);

function fecharSidebar() {
  $('sidebar').classList.remove('aberta');
  $('sidebar-overlay').classList.add('hidden');
}

/* ── Navegação ───────────────────────────────────────────── */
const ABAS_VALIDAS = ['dashboard','grupos','mensagens','warns','usuarios','economia','logs','broadcast','relacionamentos','pets'];
const titulosAbas  = {
  dashboard:'Dashboard', grupos:'Grupos', mensagens:'Mensagens',
  warns:'Warns / Bans', usuarios:'Usuários', economia:'Economia',
  logs:'Logs', broadcast:'Broadcast', relacionamentos:'Relacionamentos', pets:'Pets'
};

function ativarAba(aba) {
  if (!ABAS_VALIDAS.includes(aba)) aba = 'dashboard';
  document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.aba').forEach(el => el.classList.remove('active'));
  show(`aba-${aba}`);
  document.querySelector(`.nav-item[data-aba="${aba}"]`)?.classList.add('active');
  document.querySelector(`.aba[data-aba="${aba}"]`)?.classList.add('active');
  $('topbar-titulo').textContent = titulosAbas[aba] || '';
  if (location.hash !== `#${aba}`) history.replaceState(null, '', `#${aba}`);
  fecharSidebar();

  if (aba === 'economia')       window.carregarEconomia?.();
  if (aba === 'logs')           window.carregarLogs?.();
  if (aba === 'broadcast')      window.iniciarBroadcast?.();
  if (aba === 'relacionamentos') window.carregarRelacionamentos?.();
  if (aba === 'pets')           window.carregarPets?.();
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); ativarAba(el.dataset.aba); });
});
document.querySelectorAll('.aba').forEach(el => {
  el.addEventListener('click', () => ativarAba(el.dataset.aba));
});

/* ── Dashboard ───────────────────────────────────────────── */
function atualizarDashboard() {
  const gruposCache = window.gruposCache || [];
  const warnsCache  = window.warnsCache  || [];

  const totalGrupos   = gruposCache.length;
  const totalMembros  = gruposCache.reduce((s, g) => s + (g.membros  || 0), 0);
  const totalXp       = gruposCache.reduce((s, g) => s + (g.xpTotal  || 0), 0);
  const gruposXpAtivo = gruposCache.filter(g => g.config?.xpAtivo !== false).length;
  const totalWarnUsers = warnsCache.length;
  const totalBanidos   = warnsCache.filter(u => u.banido).length;

  $('dash-total-grupos').textContent    = totalGrupos;
  $('dash-total-membros').textContent   = formatNum(totalMembros);
  $('dash-total-xp').textContent        = formatNum(totalXp);
  $('dash-total-warns').textContent     = totalWarnUsers;
  $('dash-total-banidos').textContent   = totalBanidos;
  $('dash-grupos-xp-ativo').textContent = `${gruposXpAtivo}/${totalGrupos}`;

  function ordenarGrupos(lista, modo) {
    const c = [...lista];
    if (modo === 'xp') c.sort((a, b) => (b.xpTotal || 0) - (a.xpTotal || 0));
    return c;
  }

  const top5 = ordenarGrupos(gruposCache, 'xp').slice(0, 5);
  $('dash-top-grupos').innerHTML = top5.length
    ? top5.map((g, i) => `
      <div class="dash-top-grupo">
        <span class="dash-top-pos">${i + 1}</span>
        <span class="dash-top-nome">${escapeHtml(nomeExibicao(g))}</span>
        <span class="dash-top-xp">${formatNum(g.xpTotal || 0)} XP</span>
      </div>`).join('')
    : '<p class="dash-vazio">Nenhum grupo encontrado ainda.</p>';

  hide('dash-loading');
  show('dash-conteudo');
}

$('btn-refresh-dashboard').addEventListener('click', () => {
  window.carregarGrupos?.();
  window.carregarWarnUsers?.();
});

/* ── Auto-atualização ────────────────────────────────────── */
window.autosyncTimer = null;

function aplicarAutosync(ativo) {
  if (window.autosyncTimer) clearInterval(window.autosyncTimer);
  window.autosyncTimer = ativo
    ? setInterval(() => { window.carregarGrupos?.(); window.carregarWarnUsers?.(); }, 60000)
    : null;
  localStorage.setItem('piro_autosync', ativo ? '1' : '0');
}

$('chk-autosync').addEventListener('change', e => aplicarAutosync(e.target.checked));

/* ── Inicialização ───────────────────────────────────────── */
function iniciarPainel() {
  const abaInicial = location.hash.replace('#', '');
  ativarAba(ABAS_VALIDAS.includes(abaInicial) ? abaInicial : 'dashboard');
  window.carregarGrupos?.();
  window.carregarWarnUsers?.();
  $('chk-autosync').checked = localStorage.getItem('piro_autosync') === '1';
  if ($('chk-autosync').checked) aplicarAutosync(true);
}

if (adminKey()) {
  hide('tela-login');
  show('painel');
  iniciarPainel();
}

/* ── Exports para outros módulos ─────────────────────────── */
window.adminCore = {
  API, $, show, hide, escapeHtml, adminKey, adminHeaders,
  horaAgora, formatNum, toast, abrirModal, abrirModalRenomear,
  nomeExibicao, nomeGrupoPorJid, salvarNomeCustomLocal, nomesCustomLocais,
  atualizarDashboard
};