/* CRM arq. mídia — vanilla JS, dados salvos no navegador (localStorage) */
(() => {
  const KEY = 'arq-crm-v1';

  const ETAPAS = [
    { id: 'novo',        nome: 'Novo lead' },
    { id: 'contato',     nome: 'Contato feito' },
    { id: 'diagnostico', nome: 'Diagnóstico / Reunião' },
    { id: 'proposta',    nome: 'Proposta enviada' },
    { id: 'negociacao',  nome: 'Negociação' },
    { id: 'fechado',     nome: 'Fechado' },
    { id: 'perdido',     nome: 'Perdido' },
  ];
  const ORIGENS = ['Black Friday', 'Instagram', 'TikTok', 'Indicação', 'Prospecção ativa', 'Google', 'WhatsApp', 'Outro'];
  const PLANOS = [
    { id: 'bf',    nome: 'Black Friday (R$ 397)', valor: 397 },
    { id: 'basico', nome: 'Básico' },
    { id: 'inter',  nome: 'Intermediário' },
    { id: 'premium', nome: 'Premium' },
    { id: 'avulso', nome: 'Serviço avulso' },
  ];
  const MOTIVOS = ['', 'Preço', 'Sem resposta', 'Fechou com outro', 'Sem verba agora', 'Não era o momento', 'Outro'];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const hoje = () => new Date().toISOString().slice(0, 10);
  const fmtData = d => d ? d.split('-').reverse().join('/') : '';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const planoNome = id => PLANOS.find(p => p.id === id)?.nome || '';
  const etapaNome = id => ETAPAS.find(e => e.id === id)?.nome || id;
  const ativo = l => l.etapa !== 'fechado' && l.etapa !== 'perdido';

  /* ---------- dados ---------- */
  let leads = [];
  try { leads = JSON.parse(localStorage.getItem(KEY)) || []; } catch { leads = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(leads)); } catch { toast('Não consegui salvar no navegador'); } render(); };

  /* ---------- estado de UI ---------- */
  let view = 'pipeline';
  let editId = null;
  let sortBy = { k: 'criado', dir: -1 };

  /* ---------- selects ---------- */
  const opts = (arr, map = x => [x, x]) => arr.map(x => { const [v, t] = map(x); return `<option value="${esc(v)}">${esc(t || '—')}</option>`; }).join('');
  $('#fOrigem').insertAdjacentHTML('beforeend', opts(ORIGENS));
  $('#fPlano').insertAdjacentHTML('beforeend', opts(PLANOS, p => [p.id, p.nome]));
  const f = $('#leadForm');
  f.origem.innerHTML = opts(ORIGENS);
  f.etapa.innerHTML = opts(ETAPAS, e => [e.id, e.nome]);
  f.plano.innerHTML = '<option value="">—</option>' + opts(PLANOS, p => [p.id, p.nome]);
  f.motivo.innerHTML = opts(MOTIVOS);

  /* ---------- filtros ---------- */
  const filtrados = () => {
    const q = $('#q').value.trim().toLowerCase();
    const o = $('#fOrigem').value, p = $('#fPlano').value;
    return leads.filter(l =>
      (!o || l.origem === o) && (!p || l.plano === p) &&
      (!q || [l.nome, l.empresa, l.whats, l.insta, l.cidade, l.segmento].join(' ').toLowerCase().includes(q)));
  };
  ['#q', '#fOrigem', '#fPlano'].forEach(s => $(s).addEventListener('input', render));

  /* ---------- follow-up ---------- */
  const fuStatus = l => {
    if (!l.followup || !ativo(l)) return null;
    const t = hoje();
    return l.followup < t ? 'late' : l.followup === t ? 'today' : 'next';
  };
  const fuPill = l => {
    const s = fuStatus(l);
    if (!s) return '';
    const txt = s === 'late' ? `Atrasado · ${fmtData(l.followup)}` : s === 'today' ? 'Follow-up hoje' : `Follow-up ${fmtData(l.followup)}`;
    return `<span class="pill ${s === 'next' ? '' : s}">${txt}</span>`;
  };

  /* ---------- WhatsApp ---------- */
  const waLink = l => {
    let n = String(l.whats || '').replace(/\D/g, '');
    if (!n) return '';
    if (n.length <= 11) n = '55' + n;
    const primeiro = (l.nome || '').split(' ')[0];
    const msg = `Oi, ${primeiro}! Aqui é o Rafael, da ARQ Mídia.`;
    return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
  };

  /* ---------- KPIs ---------- */
  function renderKpis(list) {
    const abertos = list.filter(ativo);
    const fechados = list.filter(l => l.etapa === 'fechado');
    const perdidos = list.filter(l => l.etapa === 'perdido');
    const decididos = fechados.length + perdidos.length;
    const conv = decididos ? Math.round(fechados.length / decididos * 100) : 0;
    const mrr = fechados.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const pipe = abertos.filter(l => ['proposta', 'negociacao'].includes(l.etapa)).reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const atrasados = list.filter(l => ['late', 'today'].includes(fuStatus(l))).length;
    $('#kpis').innerHTML = `
      <div class="kpi"><span>Leads em aberto</span><b>${abertos.length}</b></div>
      <div class="kpi"><span>Em proposta / negociação</span><b>${brl(pipe)}</b></div>
      <div class="kpi"><span>Clientes fechados</span><b>${fechados.length}</b></div>
      <div class="kpi dest"><span>Receita mensal fechada</span><b>${brl(mrr)}</b></div>
      <div class="kpi"><span>Taxa de fechamento</span><b>${conv}%</b></div>
      <div class="kpi"><span>Follow-ups p/ hoje ou atrasados</span><b style="color:${atrasados ? 'var(--vermelho)' : 'inherit'}">${atrasados}</b></div>`;
    const b = $('#fuBadge');
    b.hidden = !atrasados; b.textContent = atrasados;
  }

  /* ---------- funil (kanban) ---------- */
  const cardHTML = l => `
    <article class="card" draggable="true" data-id="${l.id}">
      <h4>${esc(l.nome)}</h4>
      ${l.empresa || l.segmento ? `<div class="emp">${esc([l.empresa, l.segmento].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="meta">
        ${l.origem ? `<span class="pill or">${esc(l.origem)}</span>` : ''}
        ${l.plano ? `<span class="pill">${esc(planoNome(l.plano))}</span>` : ''}
        ${fuPill(l)}
      </div>
      ${l.valor ? `<div class="val">${brl(l.valor)}/mês</div>` : ''}
      <select class="move" data-id="${l.id}" aria-label="Mover para">${ETAPAS.map(e => `<option value="${e.id}" ${e.id === l.etapa ? 'selected' : ''}>Mover: ${e.nome}</option>`).join('')}</select>
    </article>`;

  function renderBoard(list) {
    $('#view-pipeline').innerHTML = ETAPAS.map(e => {
      const items = list.filter(l => l.etapa === e.id)
        .sort((a, b) => (a.followup || '9') .localeCompare(b.followup || '9'));
      const soma = items.reduce((s, l) => s + (Number(l.valor) || 0), 0);
      return `<div class="col" data-etapa="${e.id}">
        <div class="col-head"><span><i class="dot"></i>${e.nome} (${items.length})</span>${soma ? `<small>${brl(soma)}</small>` : ''}</div>
        <div class="cards">${items.map(cardHTML).join('') || '<div class="empty">Arraste um lead para cá</div>'}</div>
      </div>`;
    }).join('');
  }

  // arrastar e soltar
  const board = $('#view-pipeline');
  board.addEventListener('dragstart', e => {
    const c = e.target.closest('.card'); if (!c) return;
    c.classList.add('dragging');
    e.dataTransfer.setData('text/plain', c.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  board.addEventListener('dragend', e => e.target.closest('.card')?.classList.remove('dragging'));
  board.addEventListener('dragover', e => {
    const col = e.target.closest('.col'); if (!col) return;
    e.preventDefault();
    $$('.col.over').forEach(c => c !== col && c.classList.remove('over'));
    col.classList.add('over');
  });
  board.addEventListener('dragleave', e => { const col = e.target.closest('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
  board.addEventListener('drop', e => {
    const col = e.target.closest('.col'); if (!col) return;
    e.preventDefault(); col.classList.remove('over');
    moverEtapa(e.dataTransfer.getData('text/plain'), col.dataset.etapa);
  });
  board.addEventListener('change', e => { if (e.target.matches('.move')) moverEtapa(e.target.dataset.id, e.target.value); });
  board.addEventListener('click', e => {
    if (e.target.matches('.move')) return;
    const c = e.target.closest('.card'); if (c) abrir(c.dataset.id);
  });

  function moverEtapa(id, etapa) {
    const l = leads.find(x => x.id === id);
    if (!l || l.etapa === etapa) return;
    l.hist = l.hist || [];
    l.hist.unshift({ d: new Date().toISOString(), t: `Etapa: ${etapaNome(l.etapa)} → ${etapaNome(etapa)}` });
    l.etapa = etapa;
    if (etapa === 'fechado' && !l.fechadoEm) l.fechadoEm = hoje();
    save();
    if (etapa === 'perdido') { abrir(id); toast('Marque o motivo da perda'); }
    else if (etapa === 'fechado') toast(`Fechado: ${l.nome}`);
  }

  /* ---------- lista ---------- */
  const COLS = [
    ['nome', 'Contato'], ['empresa', 'Empresa'], ['etapa', 'Etapa'], ['origem', 'Origem'],
    ['plano', 'Plano'], ['valor', 'Valor/mês'], ['followup', 'Follow-up'], ['criado', 'Entrou em'],
  ];
  function renderTable(list) {
    const { k, dir } = sortBy;
    const sorted = [...list].sort((a, b) => {
      const va = a[k] ?? '', vb = b[k] ?? '';
      return (k === 'valor' ? (Number(va) - Number(vb)) : String(va).localeCompare(String(vb))) * dir;
    });
    $('#table').innerHTML = `<thead><tr>${COLS.map(([c, t]) => `<th data-k="${c}">${t}${k === c ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
      <tbody>${sorted.map(l => `<tr data-id="${l.id}">
        <td><b>${esc(l.nome)}</b></td><td>${esc(l.empresa)}</td><td>${esc(etapaNome(l.etapa))}</td>
        <td>${esc(l.origem)}</td><td>${esc(planoNome(l.plano))}</td><td>${l.valor ? brl(l.valor) : ''}</td>
        <td>${fuPill(l) || fmtData(l.followup)}</td><td>${fmtData(l.criado)}</td></tr>`).join('')
        || `<tr><td colspan="${COLS.length}" class="empty">Nenhum lead encontrado</td></tr>`}</tbody>`;
  }
  $('#table').addEventListener('click', e => {
    const th = e.target.closest('th');
    if (th) { sortBy = { k: th.dataset.k, dir: sortBy.k === th.dataset.k ? -sortBy.dir : 1 }; return render(); }
    const tr = e.target.closest('tr[data-id]'); if (tr) abrir(tr.dataset.id);
  });

  /* ---------- follow-ups ---------- */
  function renderFollowups(list) {
    const grupos = [
      ['late', 'Atrasados'], ['today', 'Hoje'], ['next', 'Próximos'],
    ].map(([s, t]) => [t, list.filter(l => fuStatus(l) === s).sort((a, b) => a.followup.localeCompare(b.followup))]);
    const semData = list.filter(l => ativo(l) && !l.followup);
    grupos.push(['Sem follow-up marcado', semData]);
    $('#view-followups').innerHTML = grupos.map(([t, arr]) => arr.length ? `
      <div class="fu-group"><h3>${t}<small>${arr.length}</small></h3><div class="fu-list">
        ${arr.map(l => `<div class="fu" data-id="${l.id}">
          <div class="info"><b>${esc(l.nome)}</b><span>${esc(etapaNome(l.etapa))}${l.followup ? ' · ' + fmtData(l.followup) : ''}</span></div>
          ${waLink(l) ? `<a class="btn wa" href="${waLink(l)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${l.followup ? `<button class="btn ghost" data-feito="${l.id}" title="Registra o contato e joga o próximo follow-up para daqui a 2 dias">Feito</button>` : ''}
        </div>`).join('')}
      </div></div>` : '').join('') || '<div class="empty">Nenhum follow-up pendente. </div>';
  }
  $('#view-followups').addEventListener('click', e => {
    const done = e.target.closest('[data-feito]');
    if (done) {
      const l = leads.find(x => x.id === done.dataset.feito);
      const d = new Date(); d.setDate(d.getDate() + 2);
      l.hist = l.hist || [];
      l.hist.unshift({ d: new Date().toISOString(), t: 'Follow-up feito' });
      l.followup = d.toISOString().slice(0, 10);
      save(); toast(`Próximo follow-up: ${fmtData(l.followup)}`);
      return;
    }
    const info = e.target.closest('.info'); if (info) abrir(info.parentElement.dataset.id);
  });

  /* ---------- modal ---------- */
  const dlg = $('#leadDlg');
  let histTemp = [];
  function abrir(id) {
    editId = id || null;
    const l = leads.find(x => x.id === id) || { etapa: 'novo', origem: 'Black Friday', followup: hoje() };
    $('#dlgTitle').textContent = id ? l.nome : 'Novo lead';
    ['nome', 'empresa', 'segmento', 'whats', 'insta', 'cidade', 'origem', 'etapa', 'plano', 'valor', 'followup', 'motivo', 'obs']
      .forEach(k => f[k].value = l[k] ?? '');
    histTemp = [...(l.hist || [])];
    renderHist();
    $('#delLead').hidden = !id;
    atualizaWa(); toggleLost();
    dlg.showModal();
    if (!id) f.nome.focus();
  }
  const renderHist = () => {
    $('#histList').innerHTML = histTemp.map(h => `<li><time>${new Date(h.d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>${esc(h.t)}</li>`).join('');
  };
  const atualizaWa = () => {
    const link = waLink({ whats: f.whats.value, nome: f.nome.value });
    const b = $('#waBtn'); b.hidden = !link; if (link) b.href = link;
  };
  const toggleLost = () => f.classList.toggle('is-lost', f.etapa.value === 'perdido');
  f.whats.addEventListener('input', atualizaWa);
  f.nome.addEventListener('input', atualizaWa);
  f.etapa.addEventListener('change', toggleLost);
  f.plano.addEventListener('change', () => {
    const p = PLANOS.find(x => x.id === f.plano.value);
    if (p?.valor && !f.valor.value) f.valor.value = p.valor;
  });
  const addHist = () => {
    const t = $('#histInput').value.trim(); if (!t) return;
    histTemp.unshift({ d: new Date().toISOString(), t });
    $('#histInput').value = ''; renderHist();
  };
  $('#histAdd').addEventListener('click', addHist);
  $('#histInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addHist(); } });
  $$('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));

  f.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    data.nome = data.nome.trim();
    if (!data.nome) return;
    if (data.etapa !== 'perdido') data.motivo = '';
    if (editId) {
      const l = leads.find(x => x.id === editId);
      if (l.etapa !== data.etapa) histTemp.unshift({ d: new Date().toISOString(), t: `Etapa: ${etapaNome(l.etapa)} → ${etapaNome(data.etapa)}` });
      if (data.etapa === 'fechado' && !l.fechadoEm) data.fechadoEm = hoje();
      Object.assign(l, data, { hist: histTemp });
    } else {
      leads.unshift({ id: uid(), criado: hoje(), ...data, hist: [{ d: new Date().toISOString(), t: 'Lead criado' }, ...histTemp] });
    }
    dlg.close(); save(); toast('Salvo');
  });
  $('#delLead').addEventListener('click', () => {
    if (!confirm('Excluir este lead? Não dá para desfazer.')) return;
    leads = leads.filter(l => l.id !== editId);
    dlg.close(); save(); toast('Lead excluído');
  });
  $('#newLead').addEventListener('click', () => abrir());

  /* ---------- abas ---------- */
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    view = t.dataset.view;
    $$('.tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
    try { localStorage.setItem(KEY + '-view', view); } catch {}
  }));
  try { const v = localStorage.getItem(KEY + '-view'); if (v) $(`.tab[data-view="${v}"]`)?.click(); } catch {}

  /* ---------- menu: exportar / backup ---------- */
  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.hidden = true; });
  const baixar = (nome, conteudo, tipo) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    a.download = nome; a.click(); URL.revokeObjectURL(a.href);
  };
  menu.addEventListener('click', e => {
    const act = e.target.dataset.act; if (!act) return;
    menu.hidden = true;
    if (act === 'csv') {
      const cab = ['Contato', 'Empresa', 'Segmento', 'WhatsApp', 'Instagram', 'Cidade', 'Origem', 'Etapa', 'Plano', 'Valor mensal', 'Próximo follow-up', 'Motivo da perda', 'Entrou em', 'Observações'];
      const linhas = leads.map(l => [l.nome, l.empresa, l.segmento, l.whats, l.insta, l.cidade, l.origem, etapaNome(l.etapa), planoNome(l.plano), l.valor, fmtData(l.followup), l.motivo, fmtData(l.criado), l.obs]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
      baixar(`crm-arq-midia-${hoje()}.csv`, '﻿' + [cab.join(';'), ...linhas].join('\n'), 'text/csv');
    }
    if (act === 'backup') baixar(`crm-arq-midia-backup-${hoje()}.json`, JSON.stringify(leads, null, 2), 'application/json');
    if (act === 'demo') {
      if (leads.length && !confirm('Adicionar leads de exemplo junto com os seus?')) return;
      leads = [...demo(), ...leads]; save(); toast('Exemplos carregados');
    }
    if (act === 'clear') {
      if (!confirm('Apagar TODOS os leads? Baixe um backup antes. Não dá para desfazer.')) return;
      leads = []; save();
    }
  });
  $('#importFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const arr = JSON.parse(await file.text());
      if (!Array.isArray(arr)) throw 0;
      if (!confirm(`Restaurar ${arr.length} leads? Isso substitui os dados atuais.`)) return;
      leads = arr; save(); toast('Backup restaurado');
    } catch { toast('Arquivo inválido'); }
    e.target.value = ''; menu.hidden = true;
  });

  function demo() {
    const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const mk = (nome, empresa, segmento, origem, etapa, plano, valor, fu) =>
      ({ id: uid(), criado: d(-5), nome, empresa, segmento, origem, etapa, plano, valor, followup: fu, cidade: 'Torres', whats: '', insta: '', obs: '(exemplo)', hist: [] });
    return [
      mk('Exemplo Marina', 'Pousada Exemplo', 'Pousada / Hotel', 'Black Friday', 'novo', 'bf', 397, d(0)),
      mk('Exemplo Diego', 'Restaurante Exemplo', 'Restaurante', 'Instagram', 'contato', '', '', d(-1)),
      mk('Exemplo Paula', 'Clínica Exemplo', 'Clínica / Estética', 'Indicação', 'proposta', 'inter', '', d(2)),
      mk('Exemplo Jorge', 'Oficina Exemplo', 'Oficina / Autopeças', 'Prospecção ativa', 'fechado', 'bf', 397, ''),
    ];
  }

  /* ---------- toast ---------- */
  let tt;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2200);
  }

  /* ---------- render ---------- */
  function render() {
    const list = filtrados();
    renderKpis(list); renderBoard(list); renderTable(list); renderFollowups(list);
  }
  render();
})();
