/* =========================================================
   admin-grupos.js — Tico Bot Admin
   ...
   ========================================================= */
(function() {
'use strict';

/* Atalhos para o core */
const _c = () => window.adminCore;
const API             = () => _c().API;
const $               = id      => _c().$(id);
const show            = id      => _c().show(id);
const hide            = id      => _c().hide(id);
const escapeHtml      = s       => _c().escapeHtml(s);
const adminHeaders    = ()      => _c().adminHeaders();
const toast           = (m,t)   => _c().toast(m,t);
const abrirModal      = (ti,ms,cb) => _c().abrirModal(ti,ms,cb);
const formatNum       = n       => _c().formatNum(n);
const horaAgora       = ()      => _c().horaAgora();
const nomeExibicao    = g       => _c().nomeExibicao(g);
const nomeGrupoPorJid = jid     => _c().nomeGrupoPorJid(jid);

/* ── Cache global de grupos ─────────────────────────────── */
window.gruposCache    = [];
window.grupoSortAtual = 'xp';

function ordenarGrupos(lista, modo) {
  const c = [...lista];
  if      (modo === 'membros') c.sort((a, b) => (b.membros  || 0) - (a.membros  || 0));
  else if (modo === 'nome')    c.sort((a, b) => nomeExibicao(a).localeCompare(nomeExibicao(b), 'pt-BR'));
  else                         c.sort((a, b) => (b.xpTotal  || 0) - (a.xpTotal  || 0));
  return c;
}

function gruposFiltrados() {
  const termo = $('grupos-busca')?.value.trim().toLowerCase() || '';
  let lista = window.gruposCache;
  if (termo) lista = lista.filter(g =>
    nomeExibicao(g).toLowerCase().includes(termo) ||
    g.idGrupo.toLowerCase().includes(termo)
  );
  return { lista: ordenarGrupos(lista, window.grupoSortAtual), comFiltro: !!termo };
}

window.atualizarListaGrupos = function() {
  const { lista, comFiltro } = gruposFiltrados();
  renderGrupos(lista, comFiltro);
};

/* ── Carregar grupos ─────────────────────────────────────── */
window.carregarGrupos = async function() {
  hide('grupos-erro');
  hide('grupos-lista');
  hide('grupos-vazio');
  show('grupos-loading');
  try {
    const res = await fetch(`${API()}/grupos`, { headers: adminHeaders() });
    if (!res.ok) throw new Error();
    const { grupos } = await res.json();
    window.gruposCache = grupos || [];
    window.atualizarListaGrupos();
    window.popularSelectMensagens?.(window.gruposCache);
    window.atualizarDashboard?.();
    $('sidebar-sync').textContent = `Atualizado às ${horaAgora()}`;
  } catch (err) {
    console.error('[Admin] Erro ao carregar grupos:', err);
    hide('grupos-loading');
    show('grupos-erro');
  }
};

/* ── Render grupos ───────────────────────────────────────── */
function renderGrupos(grupos, comFiltro = false) {
  hide('grupos-loading');
  const badge = $('grupos-contagem');
  if (badge) badge.textContent = window.gruposCache.length ? `(${grupos.length})` : '';

  if (!grupos.length) {
    const vazio = $('grupos-vazio');
    if (vazio) vazio.textContent = comFiltro
      ? '🔍 Nenhum grupo encontrado para essa busca.'
      : 'Nenhum grupo encontrado.';
    hide('grupos-lista');
    show('grupos-vazio');
    return;
  }
  hide('grupos-vazio');

  const lista = $('grupos-lista');
  lista.innerHTML = grupos.map(g => {
    const nomeReal = nomeExibicao(g);
    const nomeEsc  = escapeHtml(nomeReal);
    const jidEsc   = escapeHtml(g.idGrupo);
    const membrosTxt = g.membros != null ? `${g.membros} membro${g.membros === 1 ? '' : 's'}` : '';
    const xpTxt      = g.xpTotal != null ? `${formatNum(g.xpTotal)} XP total` : '';
    const prefixoAtual = escapeHtml(g.config?.prefixo || '!');

    return `
    <div class="grupo-card" data-jid="${jidEsc}">
      <div class="grupo-card-body" style="width:100%;">
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
          <div class="grupo-info" style="flex:1;min-width:180px;">
            <div class="grupo-nome-linha">
              <span class="grupo-nome">${nomeEsc}</span>
              <button class="btn-renomear" data-jid="${jidEsc}" data-nome="${nomeEsc}" title="Renomear grupo">✎</button>
            </div>
            <span class="grupo-jid">${jidEsc}<button class="btn-copiar-jid" data-jid="${jidEsc}">copiar</button></span>
            ${(membrosTxt || xpTxt) ? `<span class="grupo-meta">${[membrosTxt, xpTxt].filter(Boolean).join(' · ')}</span>` : ''}
            <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.4rem;">
              <button class="btn-ver-gold" data-jid="${jidEsc}">🪙 Ver Plata</button>
              <button class="btn-remover-membro" data-jid="${jidEsc}" style="background:var(--verm-dim);border:1px solid rgba(255,59,110,.3);color:var(--vermelho);border-radius:var(--radius-sm);padding:.35rem .7rem;font-size:.76rem;font-weight:600;cursor:pointer;">🚫 Remover Membro</button>
              <button class="btn-exportar-grupo" data-jid="${jidEsc}" style="background:var(--mint-dim);border:1px solid rgba(0,255,176,.3);color:var(--mint);border-radius:var(--radius-sm);padding:.35rem .7rem;font-size:.76rem;font-weight:600;cursor:pointer;">⬇ Exportar JSON</button>
            </div>
            <!-- Prefixo -->
            <div style="display:flex;align-items:center;gap:.4rem;margin-top:.5rem;flex-wrap:wrap;">
              <span style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">Prefixo:</span>
              <select class="prefixo-select" data-jid="${jidEsc}" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:.25rem .5rem;font-size:.82rem;cursor:pointer;outline:none;min-height:0;">
                <option value="!" ${prefixoAtual === '!' ? 'selected' : ''}>!</option>
                <option value="." ${prefixoAtual === '.' ? 'selected' : ''}>.</option>
                <option value="/" ${prefixoAtual === '/' ? 'selected' : ''}>/</option>
                <option value="," ${prefixoAtual === ',' ? 'selected' : ''}>,</option>
              </select>
              <button class="btn-salvar-prefixo" data-jid="${jidEsc}" style="background:var(--roxo-dim);border:1px solid rgba(184,85,255,.3);color:var(--roxo);border-radius:6px;padding:.25rem .6rem;font-size:.72rem;cursor:pointer;">Salvar</button>
            </div>
          </div>
          <div class="grupo-toggles">
            <label class="toggle-wrap">
              <span class="toggle-label">XP</span>
              <button class="toggle ${g.config?.xpAtivo !== false ? 'on' : ''}"
                data-jid="${jidEsc}" data-campo="xpAtivo"
                aria-pressed="${g.config?.xpAtivo !== false}"></button>
            </label>
            <label class="toggle-wrap">
              <span class="toggle-label">Anti-Link</span>
              <button class="toggle ${g.config?.antiLink ? 'on' : ''}"
                data-jid="${jidEsc}" data-campo="antiLink"
                aria-pressed="${!!g.config?.antiLink}"></button>
            </label>
            <label class="toggle-wrap">
              <span class="toggle-label">Boas-Vindas</span>
              <button class="toggle ${g.config?.boasVindas !== false ? 'on' : ''}"
                data-jid="${jidEsc}" data-campo="boasVindas"
                aria-pressed="${g.config?.boasVindas !== false}"></button>
            </label>
          </div>
        </div>

        <!-- Painel remover membro (oculto) -->
        <div class="remover-membro-painel hidden" id="rm-painel-${idSafe(g.idGrupo)}" style="margin-top:.85rem;border-top:1px solid var(--border);padding-top:.85rem;">
          <div style="font-size:.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem;">🚫 Remover membro do grupo</div>
          <div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end;">
            <div class="field" style="flex:1;min-width:180px;">
              <label>Número ou JID do membro</label>
              <input type="text" class="rm-membro-input" id="rm-input-${idSafe(g.idGrupo)}" placeholder="5511999... ou JID completo" />
            </div>
            <button class="btn-gold-rem rm-confirmar" data-jid="${jidEsc}" style="min-height:36px;">Remover do grupo</button>
          </div>
        </div>

        <!-- Painel gold (oculto) -->
        <div class="gold-painel hidden" id="gold-painel-${idSafe(g.idGrupo)}">
          <div class="gold-painel-titulo">🪙 Ranking de Plata</div>
          <div class="gold-loading" id="gold-loading-${idSafe(g.idGrupo)}"><div class="spinner"></div> Carregando...</div>
          <div class="gold-rank-lista" id="gold-rank-${idSafe(g.idGrupo)}"></div>
          <div class="gold-painel-titulo" style="margin-top:.85rem;">Ajustar Plata de Membro</div>
          <div class="gold-acoes">
            <div class="field" style="flex:2;min-width:160px;">
              <label>Membro (número ou JID)</label>
              <input type="text" class="gold-membro-input" id="gold-membro-${idSafe(g.idGrupo)}" placeholder="5511999..." />
            </div>
            <div class="field" style="max-width:110px;">
              <label>Quantidade</label>
              <input type="number" class="gold-qty-input" id="gold-qty-${idSafe(g.idGrupo)}" min="1" placeholder="100" />
            </div>
            <button class="btn-gold-dar"   data-jid="${jidEsc}" data-op="dar">+ Dar</button>
            <button class="btn-gold-rem"   data-jid="${jidEsc}" data-op="remover">− Remover</button>
            <button class="btn-gold-reset" data-jid="${jidEsc}" data-op="reset-membro" style="background:var(--verm-dim);border-color:rgba(255,59,110,.3);color:var(--vermelho);">🗑 Zerar membro</button>
            <button class="btn-gold-reset" data-jid="${jidEsc}" data-op="reset-grupo">🗑 Zerar grupo</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  /* Eventos */
  lista.querySelectorAll('.toggle').forEach(btn =>
    btn.addEventListener('click', () => alternarToggle(btn))
  );
  lista.querySelectorAll('.btn-renomear').forEach(btn =>
    btn.addEventListener('click', () => _c().abrirModalRenomear(btn.dataset.jid, btn.dataset.nome))
  );
  lista.querySelectorAll('.btn-copiar-jid').forEach(btn =>
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.jid); toast('JID copiado.'); }
      catch { toast('Não foi possível copiar o JID.', 'erro'); }
    })
  );
  lista.querySelectorAll('.btn-ver-gold').forEach(btn =>
    btn.addEventListener('click', () => toggleGoldPainel(btn.dataset.jid))
  );
  lista.querySelectorAll('.btn-gold-dar, .btn-gold-rem, .btn-gold-reset').forEach(btn =>
    btn.addEventListener('click', () => acaoGoldGrupo(btn.dataset.jid, btn.dataset.op))
  );
  lista.querySelectorAll('.btn-remover-membro').forEach(btn =>
    btn.addEventListener('click', () => toggleRemoverMembroPainel(btn.dataset.jid))
  );
  lista.querySelectorAll('.rm-confirmar').forEach(btn =>
    btn.addEventListener('click', () => removerMembroDoGrupo(btn.dataset.jid))
  );
  lista.querySelectorAll('.btn-exportar-grupo').forEach(btn =>
    btn.addEventListener('click', () => exportarGrupoJson(btn.dataset.jid))
  );
  lista.querySelectorAll('.btn-salvar-prefixo').forEach(btn =>
    btn.addEventListener('click', () => salvarPrefixo(btn.dataset.jid))
  );

  show('grupos-lista');
}

/* ── ID seguro para usar como sufixo de id HTML ─────────── */
function idSafe(jid) {
  if (!jid || typeof jid !== 'string') return 'jid_invalido';
  return jid.replace(/[^a-z0-9]/gi, '_').slice(0, 100);
}

/* ── Toggle ──────────────────────────────────────────────── */
async function alternarToggle(btn) {
  const jid       = btn.dataset.jid;
  const campo     = btn.dataset.campo;
  const novoValor = !btn.classList.contains('on');

  btn.disabled = true;
  btn.classList.toggle('on', novoValor);
  btn.setAttribute('aria-pressed', String(novoValor));

  try {
    const res = await fetch(`${API()}/admin/grupo/${encodeURIComponent(jid)}/config`, {
      method: 'PATCH', headers: adminHeaders(),
      body: JSON.stringify({ [campo]: novoValor })
    });
    if (!res.ok) throw new Error();
    const grupo = window.gruposCache.find(g => g.idGrupo === jid);
    if (grupo) grupo.config = { ...grupo.config, [campo]: novoValor };
    window.atualizarDashboard?.();
    toast('Configuração salva.');
  } catch {
    btn.classList.toggle('on', !novoValor);
    btn.setAttribute('aria-pressed', String(!novoValor));
    toast('Erro ao salvar configuração.', 'erro');
  } finally {
    btn.disabled = false;
  }
}

/* ── Prefixo ─────────────────────────────────────────────── */
async function salvarPrefixo(jid) {
  const safe = idSafe(jid);
  const sel  = document.querySelector(`.prefixo-select[data-jid="${CSS.escape(jid)}"]`);
  const prefixo = sel?.value || '!';

  try {
    const res = await fetch(`${API()}/admin/grupo/${encodeURIComponent(jid)}/config`, {
      method: 'PATCH', headers: adminHeaders(),
      body: JSON.stringify({ prefixo })
    });
    if (!res.ok) throw new Error();
    const grupo = window.gruposCache.find(g => g.idGrupo === jid);
    if (grupo) grupo.config = { ...grupo.config, prefixo };
    toast(`✅ Prefixo "${prefixo}" salvo para ${nomeGrupoPorJid(jid)}.`);
  } catch {
    toast('Erro ao salvar prefixo.', 'erro');
  }
}

/* ── Remover membro ──────────────────────────────────────── */
function toggleRemoverMembroPainel(jid) {
  const painel = document.getElementById(`rm-painel-${idSafe(jid)}`);
  if (!painel) return;
  painel.classList.toggle('hidden');
}

async function removerMembroDoGrupo(jid) {
  const input = document.getElementById(`rm-input-${idSafe(jid)}`);
  const membro = input?.value.trim();
  if (!membro) { toast('Digite o número ou JID do membro.', 'erro'); return; }

  const idWhatsApp = membro.includes('@') ? membro : `${membro}@s.whatsapp.net`;
  const nomeGrupo  = nomeGrupoPorJid(jid);

  abrirModal(
    '🚫 Remover membro',
    `Remover ${membro} do grupo "${nomeGrupo}"? O bot vai executar o kick agora.`,
    async () => {
      try {
        const res = await fetch(`${API()}/admin/grupo/${encodeURIComponent(jid)}/remover-membro`, {
          method: 'POST', headers: adminHeaders(),
          body: JSON.stringify({ idWhatsApp })
        });
        if (!res.ok) throw new Error();
        toast(`✅ Membro removido do grupo.`);
        if (input) input.value = '';
      } catch {
        toast('Erro ao remover membro. Verifique se o bot é admin do grupo.', 'erro');
      }
    }
  );
}

/* ── Exportar JSON do grupo ──────────────────────────────── */
async function exportarGrupoJson(jid) {
  toast('Exportando dados do grupo...');
  try {
    const res = await fetch(
      `${API()}/admin/grupo/${encodeURIComponent(jid)}/export`,
      { headers: adminHeaders() }
    );
    if (!res.ok) throw new Error();
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `grupo_${jid.split('@')[0]}_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('✅ JSON exportado com sucesso.');
  } catch {
    toast('Erro ao exportar dados do grupo.', 'erro');
  }
}

/* ── Gold painel ─────────────────────────────────────────── */
const goldPainelAberto = new Set();

async function toggleGoldPainel(jid) {
  const painel = document.getElementById(`gold-painel-${idSafe(jid)}`);
  if (!painel) return;
  if (painel.classList.contains('hidden')) {
    painel.classList.remove('hidden');
    goldPainelAberto.add(jid);
    await carregarGoldRanking(jid);
  } else {
    painel.classList.add('hidden');
    goldPainelAberto.delete(jid);
  }
}

async function carregarGoldRanking(jid) {
  const safe    = idSafe(jid);
  const loading = document.getElementById(`gold-loading-${safe}`);
  const lista   = document.getElementById(`gold-rank-${safe}`);
  if (!loading || !lista) return;

  loading.style.display = 'flex';
  lista.innerHTML = '';

  try {
    const res = await fetch(
      `${API()}/admin/grupo/${encodeURIComponent(jid)}/gold-ranking`,
      { headers: adminHeaders() }
    );
    if (!res.ok) throw new Error();
    const { ranking } = await res.json();
    loading.style.display = 'none';

    if (!ranking?.length) {
      lista.innerHTML = '<div class="dash-vazio">Nenhum membro com Plata neste grupo.</div>';
      return;
    }

    lista.innerHTML = ranking.map((m, i) => {
      const posClass    = i === 0 ? 'p1' : i === 1 ? 'p2' : i === 2 ? 'p3' : '';
      const jidEsc      = escapeHtml(m.idWhatsApp || '');
      const telefoneEsc = escapeHtml(m.telefone || m.idWhatsApp?.split('@')[0] || '—');
      return `
      <div class="gold-rank-item">
        <span class="gold-rank-pos ${posClass}">${i+1}</span>
        <div class="gold-rank-info">
          <span class="gold-rank-nome">${escapeHtml(m.nome || telefoneEsc)}</span>
          <span class="gold-rank-sub">📱 +${telefoneEsc} · ${jidEsc}</span>
        </div>
        <span class="gold-rank-val">🪙 ${formatNum(m.gold)}</span>
        <button class="btn-copiar-jid gold-rank-copiar" data-jid="${jidEsc}">copiar</button>
      </div>`;
    }).join('');

    lista.querySelectorAll('.gold-rank-copiar').forEach(btn =>
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(btn.dataset.jid); toast('JID copiado.'); }
        catch { toast('Não foi possível copiar.', 'erro'); }
      })
    );
  } catch {
    loading.style.display = 'none';
    lista.innerHTML = '<div class="estado-erro" style="font-size:.8rem;padding:.5rem .75rem;">Erro ao carregar ranking.</div>';
  }
}

async function acaoGoldGrupo(jid, op) {
  const safe = idSafe(jid);

  if (op === 'reset-grupo') {
    abrirModal(
      'Zerar Plata do grupo',
      `Isso vai zerar o Plata de TODOS os membros de "${nomeGrupoPorJid(jid)}". Não pode ser desfeito!`,
      async () => {
        try {
          const res = await fetch(`${API()}/admin/grupo/${encodeURIComponent(jid)}/gold/reset`, {
            method: 'DELETE', headers: adminHeaders()
          });
          if (!res.ok) throw new Error();
          toast('✅ Plata de todos os membros zerada.');
          await carregarGoldRanking(jid);
        } catch { toast('Erro ao zerar Plata do grupo.', 'erro'); }
      }
    );
    return;
  }

  if (op === 'reset-membro') {
    const membroInput = document.getElementById(`gold-membro-${safe}`);
    const membro = membroInput?.value.trim();
    if (!membro) { toast('Digite o número ou JID do membro.', 'erro'); return; }
    const jidMembro = membro.includes('@') ? membro : `${membro}@s.whatsapp.net`;
    abrirModal(
      'Zerar Plata do membro',
      `Zerar toda a Plata de ${membro} em "${nomeGrupoPorJid(jid)}"? Não pode ser desfeito!`,
      async () => {
        try {
          const res = await fetch(`${API()}/admin/usuario/gold/reset-grupo`, {
            method: 'POST', headers: adminHeaders(),
            body: JSON.stringify({ idWhatsApp: jidMembro, idGrupo: jid })
          });
          if (!res.ok) throw new Error();
          toast('✅ Plata do membro zerada.');
          if (membroInput) membroInput.value = '';
          await carregarGoldRanking(jid);
        } catch { toast('Erro ao zerar Plata do membro.', 'erro'); }
      }
    );
    return;
  }

  const membroInput = document.getElementById(`gold-membro-${safe}`);
  const qtyInput    = document.getElementById(`gold-qty-${safe}`);
  const membro = membroInput?.value.trim();
  const valor  = parseInt(qtyInput?.value, 10);

  if (!membro)          { toast('Digite o número ou JID do membro.', 'erro'); return; }
  if (!valor || valor <= 0) { toast('Digite uma quantidade válida.', 'erro'); return; }

  abrirModal(
    op === 'dar' ? 'Dar Plata' : 'Remover Plata',
    op === 'dar'
      ? `Dar ${formatNum(valor)} Plata para ${membro} em "${nomeGrupoPorJid(jid)}"?`
      : `Remover ${formatNum(valor)} Plata de ${membro} em "${nomeGrupoPorJid(jid)}"?`,
    async () => {
      try {
        const jidMembro = membro.includes('@') ? membro : `${membro}@s.whatsapp.net`;
        const res = await fetch(`${API()}/admin/usuario/${encodeURIComponent(jidMembro)}/gold`, {
          method: 'PATCH', headers: adminHeaders(),
          body: JSON.stringify({ idGrupo: jid, valor, operacao: op })
        });
        if (!res.ok) throw new Error();
        toast(`✅ Plata ${op === 'dar' ? 'adicionado' : 'removido'} com sucesso.`);
        if (membroInput) membroInput.value = '';
        if (qtyInput)    qtyInput.value    = '';
        await carregarGoldRanking(jid);
      } catch { toast('Erro ao ajustar Plata.', 'erro'); }
    }
  );
}

/* ── Ações em massa ──────────────────────────────────────── */
document.querySelectorAll('.bulk-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const [campo, valorStr] = btn.dataset.bulk.split(':');
    const valor = valorStr === 'true';
    if (!window.gruposCache.length) { toast('Nenhum grupo carregado ainda.', 'erro'); return; }
    abrirModal(
      'Ação em massa',
      `"${btn.textContent.trim()}" — atualiza ${window.gruposCache.length} grupo(s). Confirmar?`,
      () => executarBulk(campo, valor)
    );
  });
});

async function executarBulk(campo, valor) {
  document.querySelectorAll('.bulk-btn').forEach(b => b.disabled = true);
  let ok = 0, falhou = 0;

  await Promise.all(window.gruposCache.map(async g => {
    try {
      const res = await fetch(`${API()}/admin/grupo/${encodeURIComponent(g.idGrupo)}/config`, {
        method: 'PATCH', headers: adminHeaders(),
        body: JSON.stringify({ [campo]: valor })
      });
      if (!res.ok) throw new Error();
      g.config = { ...g.config, [campo]: valor };
      ok++;
    } catch { falhou++; }
  }));

  document.querySelectorAll('.bulk-btn').forEach(b => b.disabled = false);
  window.atualizarListaGrupos?.();
  window.atualizarDashboard?.();

  if (falhou === 0)    toast(`✅ ${ok} grupo(s) atualizado(s) com sucesso.`);
  else if (ok === 0)   toast(`❌ Falha ao atualizar todos os ${falhou} grupo(s).`, 'erro');
  else                 toast(`${ok} atualizado(s), ${falhou} falharam.`, 'erro');
}

/* ── Mensagens ───────────────────────────────────────────── */
window.popularSelectMensagens = function(grupos) {
  hide('msgs-loading');
  const sel = $('msgs-select-grupo');
  if (!sel) return;
  const valorAnterior = sel.value;

  if (!grupos.length) { hide('msgs-editor'); show('msgs-vazio'); return; }
  hide('msgs-vazio');

  sel.innerHTML = grupos.map(g =>
    `<option value="${escapeHtml(g.idGrupo)}">${escapeHtml(nomeExibicao(g))}</option>`
  ).join('');

  sel.value = grupos.some(g => g.idGrupo === valorAnterior) ? valorAnterior : grupos[0].idGrupo;
  show('msgs-editor');
  preencherMensagens(sel.value);
};

function preencherMensagens(jid) {
  const grupo = window.gruposCache.find(g => g.idGrupo === jid);
  $('msg-boas-vindas').value = grupo?.mensagens?.boasVindas || '';
  $('msg-regras').value      = grupo?.mensagens?.regras     || '';
  atualizarContadores();
  hide('msgs-preview');
}

function atualizarContadores() {
  $('contador-boas-vindas').textContent = `${$('msg-boas-vindas').value.length} / 5000`;
  $('contador-regras').textContent      = `${$('msg-regras').value.length} / 5000`;
}

$('msg-boas-vindas')?.addEventListener('input', atualizarContadores);
$('msg-regras')?.addEventListener('input', atualizarContadores);
$('msgs-select-grupo')?.addEventListener('change', e => preencherMensagens(e.target.value));

$('btn-preview-msgs')?.addEventListener('click', () => {
  const jid       = $('msgs-select-grupo').value;
  const grupo     = window.gruposCache.find(g => g.idGrupo === jid);
  const nomeGrupo = grupo ? nomeExibicao(grupo) : 'Grupo';
  const bv = $('msg-boas-vindas').value.replace(/\{nome\}/gi, 'João').replace(/\{grupo\}/gi, nomeGrupo);
  const rg = $('msg-regras').value.replace(/\{nome\}/gi, 'João').replace(/\{grupo\}/gi, nomeGrupo);
  $('preview-boas-vindas').textContent = bv || '(mensagem vazia)';
  $('preview-regras').textContent      = rg || '(mensagem vazia)';
  show('msgs-preview');
});

$('btn-salvar-msgs')?.addEventListener('click', async () => {
  const jid        = $('msgs-select-grupo').value;
  const boasVindas = $('msg-boas-vindas').value.trim();
  const regras     = $('msg-regras').value.trim();
  const feedback   = $('msgs-feedback');

  $('btn-salvar-msgs').disabled = true;
  hide('msgs-feedback');

  try {
    const res = await fetch(`${API()}/admin/grupo/${encodeURIComponent(jid)}/mensagens`, {
      method: 'PUT', headers: adminHeaders(),
      body: JSON.stringify({ boasVindas, regras })
    });
    if (!res.ok) throw new Error();
    const grupo = window.gruposCache.find(g => g.idGrupo === jid);
    if (grupo) grupo.mensagens = { boasVindas, regras };
    feedback.textContent = '✅ Salvo com sucesso!';
    feedback.className   = 'msgs-feedback ok';
    show('msgs-feedback');
    toast('Mensagens salvas com sucesso!');
  } catch {
    feedback.textContent = '❌ Erro ao salvar. Tente novamente.';
    feedback.className   = 'msgs-feedback erro';
    show('msgs-feedback');
    toast('Erro ao salvar mensagens.', 'erro');
  } finally {
    $('btn-salvar-msgs').disabled = false;
    setTimeout(() => hide('msgs-feedback'), 3500);
  }
});

/* ── Broadcast ───────────────────────────────────────────── */
window.iniciarBroadcast = function() {
  // Já renderizado no HTML — só inicializa contadores
  const ta = $('broadcast-texto');
  if (ta) {
    ta.addEventListener('input', () => {
      $('broadcast-counter').textContent = `${ta.value.length} / 4000`;
    });
  }
};

$('btn-enviar-broadcast')?.addEventListener('click', async () => {
  const mensagem = $('broadcast-texto')?.value.trim();
  if (!mensagem) { toast('Digite uma mensagem antes de enviar.', 'erro'); return; }
  if (mensagem.length > 4000) { toast('Mensagem muito longa (máx 4000 caracteres).', 'erro'); return; }

  abrirModal(
    '📢 Confirmar Broadcast',
    `Enviar esta mensagem para TODOS os grupos (${window.gruposCache.length} grupos)? Não pode ser desfeito.`,
    async () => {
      const btn = $('btn-enviar-broadcast');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        const res = await fetch(`${API()}/admin/broadcast`, {
          method: 'POST', headers: adminHeaders(),
          body: JSON.stringify({ mensagem })
        });
        if (!res.ok) throw new Error();
        const { enviados, falhas } = await res.json();
        toast(`✅ Enviado para ${enviados} grupo(s). Falhas: ${falhas}.`);
        if ($('broadcast-texto')) $('broadcast-texto').value = '';
        if ($('broadcast-counter')) $('broadcast-counter').textContent = '0 / 4000';
      } catch {
        toast('Erro ao enviar broadcast.', 'erro');
      } finally {
        btn.disabled = false;
        btn.textContent = '📢 Enviar para todos os grupos';
      }
    }
  );
});

/* ── Listeners de sort/busca ─────────────────────────────── */
$('btn-refresh-grupos')?.addEventListener('click', window.carregarGrupos);
$('btn-retry-grupos')?.addEventListener('click',   window.carregarGrupos);
$('btn-sync-grupos')?.addEventListener('click', async () => {
  toast('Sincronizando e limpando grupos...', 'ok');
  try {
    const res = await fetch(`${API()}/admin/grupos/sincronizar`, {
      method: 'POST',
      headers: adminHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      toast(data.mensagem || 'Grupos sincronizados!', 'ok');
      await window.carregarGrupos();
    } else {
      toast(data.error || 'Erro ao sincronizar grupos.', 'erro');
    }
  } catch (err) {
    toast('Erro ao conectar com o servidor.', 'erro');
  }
});
$('grupos-busca')?.addEventListener('input', window.atualizarListaGrupos);
$('grupos-sort')?.addEventListener('change', () => {
  window.grupoSortAtual = $('grupos-sort').value;
  window.atualizarListaGrupos();
});

})(); // fim IIFE admin-grupos.js