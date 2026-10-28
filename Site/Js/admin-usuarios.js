/* =========================================================
   admin-usuarios.js — Tico Bot Admin
   Usuários, gold, level/XP, inventário,
   warns/bans, relacionamentos, pets
   ========================================================= */
(function() {
'use strict';

const _cu  = () => window.adminCore;
const API          = () => _cu().API;
const $            = id   => _cu().$(id);
const show         = id   => _cu().show(id);
const hide         = id   => _cu().hide(id);
const escapeHtml   = s    => _cu().escapeHtml(s);
const adminHeaders = ()   => _cu().adminHeaders();
const toast        = (m,t)=> _cu().toast(m,t);
const abrirModal   = (ti,ms,cb)=> _cu().abrirModal(ti,ms,cb);
const formatNum    = n    => _cu().formatNum(n);
const horaAgora    = ()   => _cu().horaAgora();
const nomeGrupoPorJid = jid => _cu().nomeGrupoPorJid(jid);

/* ═══════════════════════════════════════════════════════════
   WARNS / BANS
═══════════════════════════════════════════════════════════ */
window.warnsCache = [];

window.carregarWarnUsers = async function() {
  hide('warns-tabela-wrap');
  hide('warns-vazio');
  hide('warns-erro');
  show('warns-loading');
  try {
    const res = await fetch(`${API()}/admin/usuarios`, { headers: adminHeaders() });
    if (!res.ok) throw new Error();
    const { usuarios } = await res.json();
    window.warnsCache = usuarios || [];
    renderWarnUsersFiltrado();
    window.atualizarDashboard?.();
    $('sidebar-sync').textContent = `Atualizado às ${horaAgora()}`;
  } catch (err) {
    console.error('[Admin] Erro ao carregar warns:', err);
    hide('warns-loading');
    show('warns-erro');
  }
};

function renderWarnUsersFiltrado() {
  const termo = $('warns-busca')?.value.trim().toLowerCase() || '';
  if (!termo) { renderWarnUsers(window.warnsCache); return; }
  const filtrados = window.warnsCache.filter(u =>
    (u.nome || '').toLowerCase().includes(termo) ||
    (u.telefone || '').toLowerCase().includes(termo) ||
    (u.idWhatsApp || '').toLowerCase().includes(termo)
  );
  renderWarnUsers(filtrados, true);
}

function renderWarnUsers(usuarios, comFiltro = false) {
  hide('warns-loading');
  const badge = $('warns-contagem');
  if (badge) badge.textContent = window.warnsCache.length ? `(${usuarios.length})` : '';

  if (!usuarios.length) {
    const vazio = $('warns-vazio');
    if (vazio) vazio.textContent = comFiltro
      ? '🔍 Nenhum usuário encontrado para essa busca.'
      : '✅ Nenhum usuário com warns ou banido no momento.';
    hide('warns-tabela-wrap');
    show('warns-vazio');
    return;
  }
  hide('warns-vazio');

  const tbody = $('warns-tbody');
  tbody.innerHTML = usuarios.map(u => {
    const banido   = u.banido
      ? '<span class="badge-ban">Banido</span>'
      : '<span class="badge-ok">Ativo</span>';
    const warns    = u.warns    ?? 0;
    const maxWarns = u.maxWarns ?? 3;
    const idEsc    = escapeHtml(u.idWhatsApp);
    const nomeEsc  = escapeHtml(u.nome || u.idWhatsApp || '—');
    const numEsc   = escapeHtml(u.telefone || u.idWhatsApp?.split('@')[0] || '—');
    const grupos   = Object.entries(u.warnsPorGrupo || {}).filter(([,q]) => Number(q) > 0);

    return `
      <tr>
        <td><span class="user-nome">${nomeEsc}</span></td>
        <td><span class="user-num">+${numEsc}</span></td>
        <td><span class="warns-count ${warns >= maxWarns ? 'full' : ''}">${warns}/${maxWarns}</span></td>
        <td>${banido}</td>
        <td class="acoes-cell">
          ${grupos.length > 1 ? `<button class="btn-acao" data-action="detalhar" data-id="${idEsc}">Detalhar (${grupos.length})</button>` : ''}
          <button class="btn-acao" data-action="remover-warn"
            data-id="${idEsc}" data-nome="${nomeEsc}"
            data-grupo="${grupos[0] ? escapeHtml(grupos[0][0]) : ''}">−1 warn</button>
          <button class="btn-acao" data-action="zerar-warns"
            data-id="${idEsc}" data-nome="${nomeEsc}">Zerar tudo</button>
          <button class="btn-acao ${u.banido ? 'btn-acao--unban' : 'btn-acao--ban'}"
            data-action="toggle-ban"
            data-id="${idEsc}" data-nome="${nomeEsc}" data-banido="${!!u.banido}">
            ${u.banido ? 'Desbanir' : 'Banir'}
          </button>
        </td>
      </tr>
      <tr class="warn-detalhe-row hidden" data-detalhe-de="${idEsc}">
        <td colspan="5">
          <div class="warn-grupos-detalhe">
            ${grupos.map(([jid, qtd]) => `
              <div class="warn-grupo-linha">
                <span class="wg-nome">${escapeHtml(nomeGrupoPorJid(jid))}</span>
                <span class="wg-qtd">${qtd}</span>
                <button class="btn-remover-1" data-action="remover-warn"
                  data-id="${idEsc}" data-nome="${nomeEsc}"
                  data-grupo="${escapeHtml(jid)}">−1</button>
              </div>`).join('')}
          </div>
        </td>
      </tr>`;
  }).join('');

  show('warns-tabela-wrap');
}

$('warns-tbody')?.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, nome, grupo } = btn.dataset;

  if (action === 'detalhar') {
    const row = document.querySelector(`tr.warn-detalhe-row[data-detalhe-de="${CSS.escape(id)}"]`);
    if (row) row.classList.toggle('hidden');

  } else if (action === 'remover-warn') {
    const texto = grupo
      ? `Remover 1 warn de ${nome} em ${escapeHtml(nomeGrupoPorJid(grupo))}?`
      : `Remover 1 warn de ${nome}?`;
    abrirModal('Remover warn', texto, () => removerWarn(id, grupo));

  } else if (action === 'zerar-warns') {
    abrirModal('Zerar warns', `Zerar TODOS os warns de ${nome} em todos os grupos?`, () => zerarWarns(id));

  } else if (action === 'toggle-ban') {
    const banidoAtual = btn.dataset.banido === 'true';
    abrirModal(
      banidoAtual ? 'Desbanir usuário' : 'Banir usuário',
      banidoAtual ? `Desbanir ${nome}?` : `Banir ${nome}?`,
      () => alternarBan(id, !banidoAtual)
    );
  }
});

async function removerWarn(idWhatsApp, grupo) {
  try {
    const qs  = grupo ? `?grupo=${encodeURIComponent(grupo)}` : '';
    const res = await fetch(`${API()}/admin/warn/${encodeURIComponent(idWhatsApp)}${qs}`, {
      method: 'DELETE', headers: adminHeaders()
    });
    if (!res.ok) throw new Error();
    toast('Warn removido.');
    window.carregarWarnUsers();
  } catch { toast('Erro ao remover warn.', 'erro'); }
}

async function zerarWarns(idWhatsApp) {
  try {
    const res = await fetch(`${API()}/admin/warn/${encodeURIComponent(idWhatsApp)}`, {
      method: 'DELETE', headers: adminHeaders()
    });
    if (!res.ok) throw new Error();
    toast('Todos os warns foram zerados.');
    window.carregarWarnUsers();
  } catch { toast('Erro ao zerar warns.', 'erro'); }
}

async function alternarBan(idWhatsApp, novoBanido) {
  try {
    const res = await fetch(`${API()}/admin/usuario/${encodeURIComponent(idWhatsApp)}/ban`, {
      method: 'PATCH', headers: adminHeaders(),
      body: JSON.stringify({ banido: novoBanido })
    });
    if (!res.ok) throw new Error();
    toast(novoBanido ? '🔴 Usuário banido.' : '✅ Usuário desbanido.');
    window.carregarWarnUsers();
  } catch { toast('Erro ao alterar ban.', 'erro'); }
}

$('btn-refresh-warns')?.addEventListener('click', window.carregarWarnUsers);
$('btn-retry-warns')?.addEventListener('click',   window.carregarWarnUsers);
$('warns-busca')?.addEventListener('input', renderWarnUsersFiltrado);

$('btn-export-csv')?.addEventListener('click', () => {
  if (!window.warnsCache.length) { toast('Nada para exportar ainda.', 'erro'); return; }
  const linhas = [['Nome','Telefone','idWhatsApp','Warns','Banido']];
  window.warnsCache.forEach(u => linhas.push([
    u.nome || '', u.telefone || '', u.idWhatsApp || '',
    String(u.warns ?? 0), u.banido ? 'Sim' : 'Não'
  ]));
  const csv  = linhas.map(l => l.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `warns_tico_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('CSV exportado.');
});

/* ═══════════════════════════════════════════════════════════
   USUÁRIOS — busca e perfil
═══════════════════════════════════════════════════════════ */
let usuarioAtual = null;

async function buscarUsuario() {
  const termo = $('usuarios-busca-input')?.value.trim();
  if (!termo) { toast('Digite um número ou JID.', 'erro'); return; }

  hide('usuarios-resultado');
  hide('usuarios-vazio');
  hide('usuarios-erro');
  show('usuarios-loading');

  try {
    const res = await fetch(`${API()}/admin/usuario/${encodeURIComponent(termo)}`, {
      headers: adminHeaders()
    });
    if (res.status === 404) { hide('usuarios-loading'); show('usuarios-vazio'); return; }
    if (!res.ok) throw new Error();
    const { usuario } = await res.json();
    usuarioAtual = usuario;
    renderUsuario(usuario);
  } catch {
    hide('usuarios-loading');
    show('usuarios-erro');
  }
}

function renderUsuario(u) {
  hide('usuarios-loading');

  $('usr-nome').textContent         = u.nome || '(sem nome)';
  $('usr-jid').textContent          = u.idWhatsApp || '—';
  $('usr-jid-copiar').dataset.jid   = u.idWhatsApp || '';
  $('usr-xp-global').textContent    = formatNum(u.xp    || 0);
  $('usr-level-global').textContent = u.level || 1;
  $('usr-gold-global').textContent  = formatNum(u.gold  || 0);
  $('usr-msgs-global').textContent  = formatNum(u.mensagens || 0);

  const grupos  = u.grupos || [];
  const listaEl = $('usr-grupos-lista');
  const selAcao = $('usr-acao-grupo');
  const selOrig = $('transfer-grupo-origem');
  const selLv   = $('usr-level-grupo');
  const selInv  = $('usr-inv-grupo');

  if (!grupos.length) {
    listaEl.innerHTML = '<p class="dash-vazio">Nenhum grupo ativo encontrado.</p>';
    [selAcao, selOrig, selLv, selInv].forEach(s => {
      if (s) s.innerHTML = '<option value="">Nenhum grupo</option>';
    });
  } else {
    listaEl.innerHTML = grupos.map(g => `
      <div class="usr-grupo-item">
        <span class="usr-grupo-nome">${escapeHtml(g.nomeGrupo || g.idGrupo)}</span>
        <div class="usr-grupo-tags">
          <span class="usr-tag gold">🪙 ${formatNum(g.gold || 0)}</span>
          <span class="usr-tag xp">⚡ ${formatNum(g.xp || 0)} XP</span>
          <span class="usr-tag lv">Lv ${g.level || 1}</span>
          ${g.empregoAtual ? `<span class="usr-tag">${escapeHtml(g.empregoAtual)}</span>` : ''}
        </div>
      </div>`).join('');

    const optGrupos = grupos.map(g =>
      `<option value="${escapeHtml(g.idGrupo)}">${escapeHtml(g.nomeGrupo || g.idGrupo)}</option>`
    ).join('');
    [selAcao, selOrig, selLv, selInv].forEach(s => { if (s) s.innerHTML = optGrupos; });
  }

  // Limpa estado anterior
  if ($('usr-level-novo'))    $('usr-level-novo').value    = '';
  if ($('usr-xp-novo'))       $('usr-xp-novo').value       = '';
  if ($('usr-inv-lista'))     $('usr-inv-lista').innerHTML = '';
  if ($('usr-inv-lista'))     $('usr-inv-lista').classList.add('hidden');
  if ($('usr-inv-item-nome')) $('usr-inv-item-nome').value = '';
  if ($('usr-inv-item-qtd'))  $('usr-inv-item-qtd').value  = '1';
  if ($('usr-level-atual-info')) $('usr-level-atual-info').classList.add('hidden');
  invAtual = [];

  show('usuarios-resultado');
}

$('usr-jid-copiar')?.addEventListener('click', async () => {
  const jid = $('usr-jid-copiar').dataset.jid;
  if (!jid) return;
  try { await navigator.clipboard.writeText(jid); toast('JID copiado.'); }
  catch { toast('Não foi possível copiar.', 'erro'); }
});

$('btn-buscar-usuario')?.addEventListener('click', buscarUsuario);
$('usuarios-busca-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') buscarUsuario(); });
$('btn-refresh-usuarios')?.addEventListener('click', () => {
  $('usuarios-busca-input').value = '';
  usuarioAtual = null;
  hide('usuarios-resultado');
  hide('usuarios-vazio');
  hide('usuarios-erro');
});

/* ── Gold (aba usuários) ─────────────────────────────────── */
async function ajustarGold(operacao) {
  if (!usuarioAtual) return;
  const jid   = $('usr-acao-grupo')?.value;
  const valor = parseInt($('usr-gold-valor')?.value, 10);
  if (!jid)             { toast('Selecione um grupo.', 'erro'); return; }
  if (!valor || valor <= 0) { toast('Digite uma quantidade válida.', 'erro'); return; }

  const nomeU = usuarioAtual.nome || usuarioAtual.idWhatsApp;
  const nomeG = $('usr-acao-grupo').selectedOptions[0]?.text || jid;

  abrirModal(
    operacao === 'dar' ? 'Dar Plata' : 'Remover Plata',
    operacao === 'dar'
      ? `Dar ${formatNum(valor)} Plata para ${nomeU} em "${nomeG}"?`
      : `Remover ${formatNum(valor)} Plata de ${nomeU} em "${nomeG}"?`,
    async () => {
      try {
        const res = await fetch(`${API()}/admin/usuario/${encodeURIComponent(usuarioAtual.idWhatsApp)}/gold`, {
          method: 'PATCH', headers: adminHeaders(),
          body: JSON.stringify({ idGrupo: jid, valor, operacao })
        });
        if (!res.ok) throw new Error();
        toast(`✅ Plata ${operacao === 'dar' ? 'adicionado' : 'removido'}.`);
        buscarUsuario();
      } catch { toast('Erro ao ajustar Plata.', 'erro'); }
    }
  );
}

$('btn-dar-gold')?.addEventListener('click',     () => ajustarGold('dar'));
$('btn-remover-gold')?.addEventListener('click', () => ajustarGold('remover'));

$('btn-resetar-gold-usuario')?.addEventListener('click', () => {
  if (!usuarioAtual) return;
  const nomeU = usuarioAtual.nome || usuarioAtual.idWhatsApp;
  abrirModal('Zerar Plata', `Zerar TODO o Plata de ${nomeU} em todos os grupos?`, async () => {
    try {
      const res = await fetch(`${API()}/admin/usuario/${encodeURIComponent(usuarioAtual.idWhatsApp)}/gold/reset`, {
        method: 'DELETE', headers: adminHeaders()
      });
      if (!res.ok) throw new Error();
      toast('✅ Plata zerada em todos os grupos.');
      buscarUsuario();
    } catch { toast('Erro ao zerar Plata.', 'erro'); }
  });
});

$('btn-transferir-gold')?.addEventListener('click', async () => {
  if (!usuarioAtual) return;
  const idGrupoOrigem = $('transfer-grupo-origem')?.value;
  const destino       = $('transfer-destino')?.value.trim();
  const valor         = parseInt($('transfer-valor')?.value, 10);

  if (!idGrupoOrigem)       { toast('Selecione o grupo de origem.', 'erro'); return; }
  if (!destino)             { toast('Digite o número/JID de destino.', 'erro'); return; }
  if (!valor || valor <= 0) { toast('Digite uma quantidade válida.', 'erro'); return; }

  const jidDestino = destino.includes('@') ? destino : `${destino}@s.whatsapp.net`;
  const nomeOrigem = usuarioAtual.nome || usuarioAtual.idWhatsApp;
  const nomeGrupo  = $('transfer-grupo-origem').selectedOptions[0]?.text || idGrupoOrigem;

  abrirModal(
    'Transferir Plata',
    `Transferir ${formatNum(valor)} Plata de ${nomeOrigem} para ${destino} em "${nomeGrupo}"?`,
    async () => {
      try {
        const res = await fetch(`${API()}/admin/gold/transferir`, {
          method: 'POST', headers: adminHeaders(),
          body: JSON.stringify({ idGrupo: idGrupoOrigem, idOrigem: usuarioAtual.idWhatsApp, idDestino: jidDestino, valor })
        });
        if (!res.ok) throw new Error();
        toast(`✅ ${formatNum(valor)} Plata transferida.`);
        $('transfer-destino').value = '';
        $('transfer-valor').value   = '';
        buscarUsuario();
      } catch { toast('Erro ao transferir Plata.', 'erro'); }
    }
  );
});

/* ── Level / XP ──────────────────────────────────────────── */
function calcularLevelFrontend(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  return Math.max(1, Math.floor(Math.pow(x / 100, 1 / 1.5)) + 1);
}
function xpMinimoParaLevel(level) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  if (lvl <= 1) return 0;
  return Math.ceil(100 * Math.pow(lvl - 1, 1.5));
}

$('btn-ver-level-atual')?.addEventListener('click', () => {
  if (!usuarioAtual) { toast('Nenhum usuário selecionado.', 'erro'); return; }
  const jid   = $('usr-level-grupo')?.value;
  if (!jid)   { toast('Selecione um grupo.', 'erro'); return; }
  const grupo = (usuarioAtual.grupos || []).find(g => g.idGrupo === jid);
  const lv    = grupo?.level ?? 1;
  const xp    = grupo?.xp    ?? 0;
  $('usr-level-atual-val').textContent = lv;
  $('usr-xp-atual-val').textContent    = formatNum(xp);
  $('usr-level-novo').value = lv;
  $('usr-xp-novo').value    = xp;
  $('usr-level-atual-info').classList.remove('hidden');
  $('usr-level-atual-info').style.display = 'flex';
});

$('usr-level-grupo')?.addEventListener('change', () => {
  $('usr-level-atual-info')?.classList.add('hidden');
  if ($('usr-level-novo')) $('usr-level-novo').value = '';
  if ($('usr-xp-novo'))    $('usr-xp-novo').value    = '';
});

let _syncLvXp = false;
$('usr-level-novo')?.addEventListener('input', () => {
  if (_syncLvXp) return; _syncLvXp = true;
  const lv = parseInt($('usr-level-novo').value, 10);
  if ($('usr-xp-novo')) $('usr-xp-novo').value = lv >= 1 ? xpMinimoParaLevel(lv) : '';
  _syncLvXp = false;
});
$('usr-xp-novo')?.addEventListener('input', () => {
  if (_syncLvXp) return; _syncLvXp = true;
  const xp = parseInt($('usr-xp-novo').value, 10);
  if ($('usr-level-novo')) $('usr-level-novo').value = (!isNaN(xp) && xp >= 0) ? calcularLevelFrontend(xp) : '';
  _syncLvXp = false;
});

$('btn-calc-xp-level')?.addEventListener('click', () => {
  const lv = parseInt($('usr-level-novo')?.value, 10);
  if (!lv || lv < 1) { toast('Digite um level antes de calcular o XP.', 'erro'); return; }
  const xpMin = xpMinimoParaLevel(lv);
  if ($('usr-xp-novo')) $('usr-xp-novo').value = xpMin;
  toast(`⚡ XP mínimo para Level ${lv}: ${formatNum(xpMin)}`);
});

$('btn-set-level')?.addEventListener('click', async () => {
  if (!usuarioAtual) { toast('Nenhum usuário selecionado.', 'erro'); return; }
  const jid   = $('usr-level-grupo')?.value;
  const level = parseInt($('usr-level-novo')?.value, 10);
  const xp    = parseInt($('usr-xp-novo')?.value, 10);

  if (!jid)                 { toast('Selecione um grupo.', 'erro'); return; }
  if (!level || level < 1)  { toast('Digite um level válido (mín. 1).', 'erro'); return; }
  if (isNaN(xp) || xp < 0) { toast('Digite um XP válido (mín. 0).', 'erro'); return; }

  const nomeU       = usuarioAtual.nome || usuarioAtual.idWhatsApp;
  const nomeG       = $('usr-level-grupo').selectedOptions[0]?.text || jid;
  const xpMin       = xpMinimoParaLevel(level);
  const xpFinal     = xp < xpMin ? xpMin : xp;
  const levelDoXp   = calcularLevelFrontend(xpFinal);

  const msg = xp < xpMin
    ? `XP digitado (${formatNum(xp)}) abaixo do mínimo para Level ${level} (${formatNum(xpMin)}). Será corrigido para ${formatNum(xpMin)}.\n\nAplicar Level ${level} + ${formatNum(xpMin)} XP para ${nomeU} em "${nomeG}"?`
    : levelDoXp !== level
      ? `O XP ${formatNum(xp)} corresponde ao Level ${levelDoXp}, não ao Level ${level}. Será aplicado Level ${level} com XP ${formatNum(xpMin)} (mínimo do level).`
      : `Definir Level ${level} e ${formatNum(xp)} XP para ${nomeU} em "${nomeG}"?`;

  abrirModal('Alterar Level / XP', msg, async () => {
    const btn = $('btn-set-level');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(
        `${API()}/admin/usuario/${encodeURIComponent(usuarioAtual.idWhatsApp)}/level`,
        { method: 'PATCH', headers: adminHeaders(), body: JSON.stringify({ idGrupo: jid, level, xp: xpFinal }) }
      );
      if (!res.ok) throw new Error();
      toast(`✅ Level ${level} e ${formatNum(xpFinal)} XP aplicados.`);
      if ($('usr-level-novo')) $('usr-level-novo').value = '';
      if ($('usr-xp-novo'))    $('usr-xp-novo').value    = '';
      $('usr-level-atual-info')?.classList.add('hidden');
      buscarUsuario();
    } catch { toast('Erro ao aplicar Level. Verifique o backend.', 'erro'); }
    finally { if (btn) btn.disabled = false; }
  });
});

/* ── Inventário ──────────────────────────────────────────── */
let invAtual = [];

async function carregarInventario() {
  if (!usuarioAtual) { toast('Nenhum usuário selecionado.', 'erro'); return; }
  const jid = $('usr-inv-grupo')?.value;
  if (!jid) { toast('Selecione um grupo.', 'erro'); return; }

  const listaEl = $('usr-inv-lista');
  listaEl.innerHTML = '<div class="inv-vazio"><div class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:.4rem;border-width:2px;"></div> Carregando...</div>';
  listaEl.classList.remove('hidden');

  try {
    const res = await fetch(
      `${API()}/admin/usuario/${encodeURIComponent(usuarioAtual.idWhatsApp)}/inventario?idGrupo=${encodeURIComponent(jid)}`,
      { headers: adminHeaders() }
    );
    if (!res.ok) throw new Error();
    const { inventario } = await res.json();
    invAtual = Array.isArray(inventario) ? inventario : [];
    renderInventario(invAtual, jid);
  } catch {
    invAtual = [];
    listaEl.innerHTML = '<div class="estado-erro" style="font-size:.8rem;padding:.5rem .75rem;">Erro ao carregar inventário.</div>';
  }
}

function renderInventario(inv, jid) {
  const listaEl = $('usr-inv-lista');
  if (!inv.length) { listaEl.innerHTML = '<div class="inv-vazio">Inventário vazio.</div>'; return; }
  listaEl.innerHTML = inv.map(item => {
    const nome = item.nome || item.item || item.id || '?';
    const qtd  = item.quantidade ?? item.qty ?? 1;
    return `
    <div class="inv-item">
      <span class="inv-item-nome">${escapeHtml(nome)}</span>
      <span class="inv-item-qtd">x${qtd}</span>
      <button class="btn-inv-rem" data-action="inv-remover"
        data-item="${escapeHtml(nome)}"
        data-jid="${escapeHtml(jid)}">✕ Remover</button>
    </div>`;
  }).join('');

  listaEl.querySelectorAll('button[data-action="inv-remover"]').forEach(btn => {
    btn.addEventListener('click', () => {
      abrirModal('Remover item', `Remover "${btn.dataset.item}" do inventário de ${usuarioAtual.nome || usuarioAtual.idWhatsApp}?`,
        () => removerItemInventario(btn.dataset.jid, btn.dataset.item)
      );
    });
  });
}

async function removerItemInventario(jid, nomeItem) {
  try {
    const res = await fetch(`${API()}/admin/usuario/${encodeURIComponent(usuarioAtual.idWhatsApp)}/inventario`, {
      method: 'DELETE', headers: adminHeaders(),
      body: JSON.stringify({ idGrupo: jid, item: nomeItem })
    });
    if (!res.ok) throw new Error();
    toast(`✅ Item "${nomeItem}" removido.`);
    await carregarInventario();
  } catch { toast('Erro ao remover item.', 'erro'); }
}

async function adicionarItemInventario() {
  if (!usuarioAtual) return;
  const jid      = $('usr-inv-grupo')?.value;
  const nomeItem = $('usr-inv-item-nome')?.value.trim();
  const qtd      = parseInt($('usr-inv-item-qtd')?.value, 10);

  if (!jid)            { toast('Selecione um grupo.', 'erro'); return; }
  if (!nomeItem)       { toast('Digite o nome do item.', 'erro'); return; }
  if (!qtd || qtd < 1) { toast('Digite uma quantidade válida (mín. 1).', 'erro'); return; }

  const nomeU = usuarioAtual.nome || usuarioAtual.idWhatsApp;
  const nomeG = $('usr-inv-grupo').selectedOptions[0]?.text || jid;

  abrirModal('Adicionar item', `Adicionar ${qtd}x "${nomeItem}" ao inventário de ${nomeU} em "${nomeG}"?`, async () => {
    try {
      const res = await fetch(`${API()}/admin/usuario/${encodeURIComponent(usuarioAtual.idWhatsApp)}/inventario`, {
        method: 'POST', headers: adminHeaders(),
        body: JSON.stringify({ idGrupo: jid, item: nomeItem, quantidade: qtd })
      });
      if (!res.ok) throw new Error();
      toast('✅ Item adicionado ao inventário.');
      if ($('usr-inv-item-nome')) $('usr-inv-item-nome').value = '';
      if ($('usr-inv-item-qtd'))  $('usr-inv-item-qtd').value  = '1';
      await carregarInventario();
    } catch { toast('Erro ao adicionar item.', 'erro'); }
  });
}

$('btn-carregar-inv')?.addEventListener('click',  carregarInventario);
$('btn-inv-adicionar')?.addEventListener('click', adicionarItemInventario);

/* ═══════════════════════════════════════════════════════════
   RELACIONAMENTOS
═══════════════════════════════════════════════════════════ */
window.carregarRelacionamentos = async function() {
  const loading = $('rel-loading');
  const lista   = $('rel-lista');
  const vazio   = $('rel-vazio');
  if (!loading || !lista) return;

  show('rel-loading');
  hide('rel-lista');
  hide('rel-vazio');

  try {
    const res = await fetch(`${API()}/admin/relacionamentos`, { headers: adminHeaders() });
    if (!res.ok) throw new Error();
    const { relacionamentos } = await res.json();
    hide('rel-loading');

    if (!relacionamentos?.length) { show('rel-vazio'); return; }

    lista.innerHTML = relacionamentos.map(r => {
      const nomeA  = escapeHtml(r.nomeA || r.jidA?.split('@')[0] || '—');
      const nomeB  = escapeHtml(r.nomeB || r.jidB?.split('@')[0] || '—');
      const tipo   = r.tipo === 'casamento' ? '💍 Casados' : '❤️ Namorando';
      const grupo  = escapeHtml(r.nomeGrupo || (r.idGrupo ? nomeGrupoPorJid(r.idGrupo) : '—'));
      const xp     = formatNum(r.xp || 0);
      const telA   = escapeHtml(r.jidA?.split('@')[0] || '—');
      const telB   = escapeHtml(r.jidB?.split('@')[0] || '—');
      const desde  = r.desde ? new Date(r.desde).toLocaleDateString('pt-BR') : '—';
      const idRel  = `rel-${escapeHtml(r.jidA)}-${escapeHtml(r.jidB)}`.replace(/[^a-z0-9-]/gi, '_');
      return `
      <div class="rel-card" style="flex-direction:column;align-items:stretch;gap:.5rem;">
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">
          <div class="rel-info" style="flex:1;cursor:pointer;" data-toggle="${idRel}">
            <span class="rel-tipo">${tipo}</span>
            <span class="rel-nomes">${nomeA} <span style="color:var(--muted)">×</span> ${nomeB}</span>
            <span class="rel-meta">📍 ${grupo} · desde ${desde} · XP: ${xp}</span>
          </div>
          <button class="btn-gold-rem rel-encerrar"
            data-jida="${escapeHtml(r.jidA)}"
            data-jidb="${escapeHtml(r.jidB)}"
            data-grupo="${escapeHtml(r.idGrupo)}">
            💔 Encerrar
          </button>
        </div>
        <div id="${idRel}" class="hidden" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.75rem 1rem;display:flex;flex-wrap:wrap;gap:1rem;">
          <div style="flex:1;min-width:140px;">
            <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.35rem;">👤 ${nomeA}</div>
            <div style="font-size:.8rem;color:var(--text);">📱 +${telA}</div>
            <div style="font-size:.72rem;color:var(--muted);font-family:monospace;">${escapeHtml(r.jidA || '—')}</div>
          </div>
          <div style="flex:1;min-width:140px;">
            <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.35rem;">👤 ${nomeB}</div>
            <div style="font-size:.8rem;color:var(--text);">📱 +${telB}</div>
            <div style="font-size:.72rem;color:var(--muted);font-family:monospace;">${escapeHtml(r.jidB || '—')}</div>
          </div>
          <div style="flex:1;min-width:140px;">
            <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.35rem;">💑 Relacionamento</div>
            <div style="font-size:.8rem;color:var(--text);">${tipo}</div>
            <div style="font-size:.8rem;color:var(--mint);">⚡ ${xp} XP</div>
            <div style="font-size:.8rem;color:var(--text);">📅 Desde ${desde}</div>
            <div style="font-size:.8rem;color:var(--text);">📍 ${grupo}</div>
          </div>
        </div>
      </div>`;
    }).join('');

    lista.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const painel = document.getElementById(el.dataset.toggle);
        if (painel) painel.classList.toggle('hidden');
      });
    });

    lista.querySelectorAll('.rel-encerrar').forEach(btn => {
      btn.addEventListener('click', () => {
        const { jida, jidb, grupo } = btn.dataset;
        abrirModal(
          '💔 Encerrar relacionamento',
          `Encerrar o relacionamento entre ${jida.split('@')[0]} e ${jidb.split('@')[0]} no grupo "${nomeGrupoPorJid(grupo)}"?`,
          () => encerrarRelacionamento(jida, jidb, grupo)
        );
      });
    });
    show('rel-lista');
  } catch {
    hide('rel-loading');
    if (lista) lista.innerHTML = '<div class="estado-erro">Erro ao carregar relacionamentos.</div>';
    show('rel-lista');
  }
};

async function encerrarRelacionamento(jidA, jidB, idGrupo) {
  try {
    const res = await fetch(`${API()}/admin/relacionamentos/encerrar`, {
      method: 'POST', headers: adminHeaders(),
      body: JSON.stringify({ jidA, jidB, idGrupo })
    });
    if (!res.ok) throw new Error();
    toast('💔 Relacionamento encerrado.');
    window.carregarRelacionamentos();
  } catch { toast('Erro ao encerrar relacionamento.', 'erro'); }
}

$('btn-refresh-relacionamentos')?.addEventListener('click', window.carregarRelacionamentos);

/* ── Busca por grupo de relacionamentos ─────────────────── */
$('rel-busca')?.addEventListener('input', () => {
  const termo = $('rel-busca').value.trim().toLowerCase();
  document.querySelectorAll('.rel-card').forEach(card => {
    const texto = card.textContent.toLowerCase();
    card.style.display = texto.includes(termo) ? '' : 'none';
  });
});

/* ═══════════════════════════════════════════════════════════
   PETS
═══════════════════════════════════════════════════════════ */
window.carregarPets = async function() {
  const loading = $('pets-loading');
  const lista   = $('pets-lista');
  const vazio   = $('pets-vazio');
  if (!loading || !lista) return;

  show('pets-loading');
  hide('pets-lista');
  hide('pets-vazio');

  try {
    const res = await fetch(`${API()}/admin/pets`, { headers: adminHeaders() });
    if (!res.ok) throw new Error();
    const { pets } = await res.json();
    hide('pets-loading');

    if (!pets?.length) { show('pets-vazio'); return; }

    lista.innerHTML = pets.map(p => {
      const dono   = escapeHtml(p.nomeDono || p.idDono?.split('@')[0] || '—');
      const nome   = escapeHtml(p.nome || p.tipo || 'Pet');
      const tipo   = escapeHtml(p.tipo || '?');
      const hp        = p.hp ?? 100;
      const maxHp     = p.maxHp ?? 100;
      const fome      = p.fome ?? 0;
      const grupo     = escapeHtml(p.nomeGrupo || p.idGrupo || '—');
      const hpPct     = Math.round((hp / maxHp) * 100);
      const hpCor     = hpPct > 60 ? 'var(--mint)' : hpPct > 30 ? 'var(--amarelo)' : 'var(--vermelho)';
      const happiness = p.happiness ?? 0;
      const xp        = formatNum(p.xp ?? 0);
      const nivel     = p.nivel ?? 1;
      const rarity    = escapeHtml(p.rarity || '?');

      return `
      <div class="pet-card">
        <div class="pet-info">
          <span class="pet-nome">${nome} <span style="color:var(--muted);font-size:.78rem;">(${tipo} · ${rarity})</span></span>
          <span class="pet-dono">Dono: ${dono} · Grupo: ${grupo}</span>
          <div class="pet-stats">
            <span style="font-size:.78rem;color:var(--muted);">Energia:</span>
            <div class="pet-hp-bar"><div style="width:${hpPct}%;background:${hpCor};height:100%;border-radius:999px;transition:width .3s;"></div></div>
            <span style="font-size:.76rem;color:${hpCor};">${hp}%</span>
            <span style="font-size:.78rem;color:var(--muted);margin-left:.5rem;">Fome: ${fome}%</span>
            <span style="font-size:.78rem;color:var(--muted);margin-left:.5rem;">😊 ${happiness}%</span>
            <span style="font-size:.78rem;color:var(--mint);margin-left:.5rem;">Lv${nivel} · ${xp} XP</span>
          </div>
        </div>
        <div class="pet-acoes">
          <button class="btn-gold-dar pet-curar"
            data-id="${escapeHtml(p.idDono)}"
            data-grupo="${escapeHtml(p.idGrupo)}">💊 Curar</button>
          <button class="btn-ghost pet-alimentar" style="min-height:34px;padding:.35rem .7rem;font-size:.78rem;"
            data-id="${escapeHtml(p.idDono)}"
            data-grupo="${escapeHtml(p.idGrupo)}">🍖 Alimentar</button>
        </div>
      </div>`;
    }).join('');

    lista.querySelectorAll('.pet-curar').forEach(btn => {
      btn.addEventListener('click', () => acaoPet(btn.dataset.id, btn.dataset.grupo, 'curar'));
    });
    lista.querySelectorAll('.pet-alimentar').forEach(btn => {
      btn.addEventListener('click', () => acaoPet(btn.dataset.id, btn.dataset.grupo, 'alimentar'));
    });

    show('pets-lista');
  } catch {
    hide('pets-loading');
    if (lista) lista.innerHTML = '<div class="estado-erro">Erro ao carregar pets.</div>';
    show('pets-lista');
  }
};

async function acaoPet(idDono, idGrupo, acao) {
  try {
    const res = await fetch(`${API()}/admin/pets/${acao}`, {
      method: 'POST', headers: adminHeaders(),
      body: JSON.stringify({ idDono, idGrupo })
    });
    if (!res.ok) throw new Error();
    toast(`✅ Pet ${acao === 'curar' ? 'curado' : 'alimentado'} com sucesso.`);
    window.carregarPets();
  } catch { toast(`Erro ao ${acao} o pet.`, 'erro'); }
}

$('btn-refresh-pets')?.addEventListener('click', window.carregarPets);
$('pets-busca')?.addEventListener('input', () => {
  const termo = $('pets-busca').value.trim().toLowerCase();
  document.querySelectorAll('.pet-card').forEach(card => {
    card.style.display = card.textContent.toLowerCase().includes(termo) ? '' : 'none';
  });
});

})(); // fim IIFE admin-usuarios.js