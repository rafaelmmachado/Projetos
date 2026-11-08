// CRM ARQ Mídia: servidor único, sem dependências.
// - Serve a tela do CRM (public/index.html), protegida por senha (CRM_PASSWORD).
// - Recebe mensagens do WhatsApp (webhook), cria o lead e identifica a origem sozinho.
// - Dispara as mensagens agendadas (automação e follow-up) pela API oficial do WhatsApp.
// - Manda os eventos do funil para o Meta (API de Conversões para mensagens) quando o lead veio de anúncio.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const PORT = +env.PORT || 3000;
const GRAPH = (env.GRAPH_URL || 'https://graph.facebook.com') + '/' + (env.GRAPH_VERSION || 'v21.0');
const WA_TOKEN = env.WA_TOKEN || '';            // token do app (Meta) com permissão de WhatsApp
const PHONE_ID = env.WA_PHONE_NUMBER_ID || '';  // ID do número
const WABA_ID = env.WA_BUSINESS_ACCOUNT_ID || '';
const VERIFY_TOKEN = env.WA_VERIFY_TOKEN || ''; // senha que você inventa e coloca também no Meta (Webhook)
const APP_SECRET = env.META_APP_SECRET || '';   // opcional: confere a assinatura do webhook
const DATASET_ID = env.META_DATASET_ID || '';   // opcional: dataset da API de Conversões
const TEMPLATE = env.WA_TEMPLATE || '';         // modelo aprovado para mandar fora da janela de 24h (ex.: hello_world)
const TEMPLATE_LANG = env.WA_TEMPLATE_LANG || 'pt_BR';
const PASSWORD = env.CRM_PASSWORD || '';
const DATA = path.join(env.DATA_DIR || __dirname, 'data.json');

const DAY = 864e5, MIN = 6e4;
const PRICE = { 'tráfego pago': 1500, 'redes sociais': 1200, 'panfletagem': 800 };

/* ---------- dados ---------- */
let S = { v: 2, live: true, leads: [], queue: [], autos: null };
try { S = Object.assign(S, JSON.parse(fs.readFileSync(DATA, 'utf8'))); S.live = true; } catch (e) {}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(DATA, JSON.stringify(S), () => {}), 200); }
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const leadById = id => S.leads.find(l => l.id === id);
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- helpers ---------- */
const first = n => String(n || '').split(' ')[0];
const service = l => { const c = String(l.car || '').trim(); return !c || /a definir/i.test(c) ? 'nossos serviços' : c.toLowerCase(); };
const fill = (t, l) => String(t || '').replace(/\{\{nome\}\}/g, first(l.name)).replace(/\{\{servico\}\}/g, service(l)).replace(/\{\{empresa\}\}/g, l.city || 'sua empresa');
function fmtPhone(wa) {
  const d = String(wa).replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) { const n = d.slice(4); return '(' + d.slice(2, 4) + ') ' + n.slice(0, n.length - 4) + '-' + n.slice(-4); }
  return '+' + d;
}
function stepTime(start, st, prev) {
  if (st.delay.mode === 'min') return start + st.delay.v * MIN;
  const d = new Date(start); d.setHours(0, 0, 0, 0); d.setTime(d.getTime() + st.delay.d * DAY);
  const [h, m] = st.delay.at.split(':').map(Number); d.setHours(h, m, 0, 0);
  let t = d.getTime(); if (t <= prev) t = prev + 30 * MIN; return t;
}
function runAuto(id, l) {
  const a = (S.autos || []).find(x => x.id === id); if (!a || !a.on) return 0;
  let prev = Date.now(), n = 0;
  a.steps.forEach(st => { const t = stepTime(Date.now(), st, prev); prev = t; S.queue.push({ id: uid('q'), leadId: l.id, type: st.type, text: st.text, audio: st.audio || '', at: t, status: 'agendada', auto: a.id, step: st.id }); n++; });
  return n;
}
function cancelAuto(l) { S.queue.forEach(q => { if (q.leadId === l.id && q.status === 'agendada' && q.auto) q.status = 'cancelada'; }); }

/* ---------- origem automática ---------- */
function detectOrigin(msg) {
  const r = msg.referral;
  if (r) return { origin: 'meta', src: 'meta-ad', detail: 'Anúncio: ' + (r.headline || r.body || r.source_id || 'Meta'), ctwa: r.ctwa_clid || '' };
  const text = (msg.text && msg.text.body) || '';
  const ind = text.match(/\[IND-([^\]]+)\]/i);
  if (ind) return { origin: 'referral', src: 'indica', detail: 'Indicação · código [IND-' + ind[1].toUpperCase() + ']' };
  if (/\[IG\]/i.test(text)) return { origin: 'organic', src: 'insta', detail: 'Bio do Instagram · código [IG]' };
  if (/\[SITE\]/i.test(text)) return { origin: 'site', src: 'site', detail: 'Botão do site · código [SITE]' };
  return { origin: 'whatsapp', src: 'direto', detail: 'Chamou direto no número, sem código' };
}

/* ---------- WhatsApp ---------- */
async function graph(pathname, body) {
  const r = await fetch(GRAPH + pathname, { method: 'POST', headers: { Authorization: 'Bearer ' + WA_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return j;
}
async function uploadAudio(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || ''); if (!m) throw new Error('áudio inválido');
  let type = m[1].split(';')[0]; if (type === 'audio/webm') type = 'audio/ogg'; // WhatsApp aceita ogg/opus, mp3, aac, amr, mp4
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp'); fd.append('type', type);
  fd.append('file', new Blob([Buffer.from(m[2], 'base64')], { type }), 'audio.' + (type.split('/')[1] || 'ogg'));
  const r = await fetch(GRAPH + '/' + PHONE_ID + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + WA_TOKEN }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return j.id;
}
async function sendQueued(q) {
  const l = leadById(q.leadId); if (!l || !l.wa) throw new Error('lead sem WhatsApp');
  const open = l.lastIn && Date.now() - l.lastIn < 24 * 3600e3;
  if (!open) {
    if (!TEMPLATE) throw new Error('passou de 24h sem resposta: precisa de modelo aprovado (WA_TEMPLATE)');
    await graph('/' + PHONE_ID + '/messages', { messaging_product: 'whatsapp', to: l.wa, type: 'template', template: { name: TEMPLATE, language: { code: TEMPLATE_LANG } } });
    return 'modelo ' + TEMPLATE;
  }
  if (q.type === 'audio') {
    const id = await uploadAudio(q.audio);
    await graph('/' + PHONE_ID + '/messages', { messaging_product: 'whatsapp', to: l.wa, type: 'audio', audio: { id } });
    return 'áudio';
  }
  const body = fill(q.text, l);
  await graph('/' + PHONE_ID + '/messages', { messaging_product: 'whatsapp', to: l.wa, type: 'text', text: { body } });
  return body;
}
let busy = false;
async function tick() {
  if (busy || !WA_TOKEN || !PHONE_ID) return; busy = true;
  try {
    for (const q of S.queue.filter(x => x.status === 'agendada' && x.at <= Date.now())) {
      const l = leadById(q.leadId);
      if (q.auto && l && l.replied) { q.status = 'cancelada'; continue; }
      try {
        const sent = await sendQueued(q);
        q.status = 'enviada'; q.at = Date.now(); delete q.err;
        if (l) (l.chat = l.chat || []).push({ dir: 'out', text: q.type === 'audio' ? '🎤 áudio' : sent, at: Date.now() });
        log('enviada', q.id, 'para', l && l.wa);
      } catch (e) { q.status = 'erro'; q.err = e.message; log('erro ao enviar', q.id, e.message); }
      save();
    }
  } finally { busy = false; }
}
setInterval(tick, 10000);

/* ---------- API de Conversões (Meta) ---------- */
async function sendEvent(l, ev) {
  if (!l.metaLeadId) { ev.status = 'só no CRM'; return; }
  if (!DATASET_ID || !WABA_ID || !WA_TOKEN) { ev.status = 'pronto, aguardando integração'; return; }
  const data = { event_name: ev.name, event_time: Math.floor(ev.at / 1000), action_source: 'business_messaging', messaging_channel: 'whatsapp',
    user_data: { whatsapp_business_account_id: WABA_ID, ctwa_clid: l.metaLeadId } };
  if (ev.name === 'Purchase') data.custom_data = { currency: 'BRL', value: l.value || PRICE[String(l.car || '').toLowerCase()] || 1000 };
  try { await graph('/' + DATASET_ID + '/events', { data: [data] }); ev.status = 'enviado'; log('evento', ev.name, l.name); }
  catch (e) { ev.status = 'erro'; ev.err = e.message; log('erro evento', ev.name, e.message); }
  save();
}

/* ---------- webhook ---------- */
function onMessage(value) {
  const contacts = value.contacts || [];
  for (const msg of value.messages || []) {
    const wa = msg.from;
    const name = ((contacts.find(c => c.wa_id === wa) || {}).profile || {}).name || fmtPhone(wa);
    const text = msg.type === 'text' ? msg.text.body : msg.type === 'audio' ? '🎤 áudio' : msg.type === 'button' ? msg.button.text : '[' + msg.type + ']';
    let l = S.leads.find(x => x.wa === wa);
    if (!l) {
      const o = detectOrigin(msg);
      l = { id: uid('l'), wa, name, phone: fmtPhone(wa), car: 'Serviço a definir', city: '', origin: o.origin, src: o.src, detail: o.detail, stage: 0, at: Date.now(),
        replied: false, events: [{ name: 'LeadSubmitted', stage: 0, at: Date.now() }], metaLeadId: o.ctwa || '', chat: [], lastIn: Date.now() };
      S.leads.unshift(l);
      l.chat.push({ dir: 'in', text, at: Date.now() });
      runAuto('entrada', l);
      sendEvent(l, l.events[0]);
      log('lead novo', name, o.origin);
    } else {
      l.chat = l.chat || []; l.chat.push({ dir: 'in', text, at: Date.now() }); l.lastIn = Date.now();
      // a primeira mensagem já é a que criou o lead; a partir da segunda conta como resposta
      if (l.chat.filter(c => c.dir === 'in').length > 1 && !l.replied) { l.replied = true; cancelAuto(l); }
    }
  }
  save(); setTimeout(tick, 500);
}

/* ---------- tela ↔ servidor ---------- */
const evKey = e => e.name + '@' + e.at;
function merge(c) {
  if (Array.isArray(c.autos)) S.autos = c.autos;
  for (const cl of c.leads || []) {
    let sl = leadById(cl.id);
    if (!sl) {
      sl = Object.assign({}, cl, { chat: [], events: [] }); S.leads.unshift(sl);
      if (/\d{8,}/.test(String(cl.phone).replace(/\D/g, ''))) { const d = String(cl.phone).replace(/\D/g, ''); sl.wa = d.length <= 11 ? '55' + d : d; }
    }
    for (const k of ['name', 'car', 'city', 'stage', 'replied']) if (k in cl) sl[k] = cl[k];
    const have = new Set((sl.events || []).map(evKey));
    for (const e of cl.events || []) if (!have.has(evKey(e))) { const ne = { name: e.name, stage: e.stage, at: e.at }; (sl.events = sl.events || []).push(ne); sendEvent(sl, ne); }
  }
  for (const cq of c.queue || []) {
    const sq = S.queue.find(q => q.id === cq.id);
    if (!sq) { if (cq.status === 'agendada') S.queue.push(cq); continue; }
    if (sq.status === 'agendada') { if (cq.status === 'cancelada') sq.status = 'cancelada'; else if (cq.status === 'agendada') sq.at = cq.at; }
    if (sq.status === 'erro' && cq.status === 'agendada' && cq.retry) { sq.status = 'agendada'; sq.at = Date.now(); delete sq.err; }
  }
  save(); setTimeout(tick, 500);
}

/* ---------- http ---------- */
const INDEX = path.join(__dirname, 'public', 'index.html');
function authed(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  const [, b64] = h.split(' '); const pass = Buffer.from(b64 || '', 'base64').toString().split(':').slice(1).join(':');
  return pass.length === PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(PASSWORD));
}
function readBody(req, limit = 8e6) {
  return new Promise((res, rej) => { const ch = []; let n = 0; req.on('data', d => { n += d.length; if (n > limit) { rej(new Error('grande demais')); req.destroy(); } else ch.push(d); }); req.on('end', () => res(Buffer.concat(ch))); req.on('error', rej); });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/webhook' && req.method === 'GET') {
      if (u.searchParams.get('hub.mode') === 'subscribe' && VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === VERIFY_TOKEN) { res.writeHead(200); return res.end(u.searchParams.get('hub.challenge')); }
      res.writeHead(403); return res.end('token de verificação errado');
    }
    if (u.pathname === '/webhook' && req.method === 'POST') {
      const raw = await readBody(req, 2e6);
      if (APP_SECRET) {
        const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
        const got = req.headers['x-hub-signature-256'] || '';
        if (got.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(sig))) { res.writeHead(401); return res.end(); }
      }
      res.writeHead(200); res.end('ok');
      const body = JSON.parse(raw.toString() || '{}');
      for (const e of body.entry || []) for (const ch of e.changes || []) if (ch.value && ch.value.messages) onMessage(ch.value);
      return;
    }
    if (u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (!authed(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="CRM ARQ Midia"' }); return res.end('Senha necessária'); }
    if (u.pathname === '/api/state' && req.method === 'GET') return json(res, 200, S);
    if (u.pathname === '/api/state' && req.method === 'PUT') { merge(JSON.parse((await readBody(req)).toString())); return json(res, 200, S); }
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return fs.createReadStream(INDEX).pipe(res); }
    res.writeHead(404); res.end('não encontrado');
  } catch (e) { log('erro', e.message); if (!res.headersSent) json(res, 500, { error: e.message }); }
}).listen(PORT, () => log('CRM no ar na porta', PORT, WA_TOKEN ? '(WhatsApp ligado)' : '(sem WA_TOKEN: não envia)'));
