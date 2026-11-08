// CRM ARQ Mídia: servidor único.
// - Serve a tela do CRM (public/index.html), protegida por senha (CRM_PASSWORD).
// - Conecta no WhatsApp de dois jeitos: pelo QR code (padrão, igual WhatsApp Web) ou pela API oficial (se WA_TOKEN existir).
// - Lead que chega pelo anúncio do Meta vira lead e recebe a automação. Os outros contatos não são tocados (AUTO_ONLY_META).
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
const MODE = WA_TOKEN ? 'oficial' : 'qr';
const AUTO_ONLY_META = env.AUTO_ONLY_META !== 'false'; // padrão: só responde quem veio do anúncio do Meta
const waqr = MODE === 'qr' ? require('./wa-qr') : null;
const DATA = path.join(env.DATA_DIR || __dirname, 'data.json');

const DAY = 864e5, MIN = 6e4;
const PRICE = { 'tráfego pago': 1500, 'redes sociais': 1200, 'panfletagem': 800 };

/* ---------- dados ---------- */
const store = require('./store');
let S = { v: 2, live: true, leads: [], queue: [], autos: null };
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.saveState(DATA, S), 300); }
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
function detectOrigin(ad, text) {
  if (ad) return { origin: 'meta', src: 'meta-ad', detail: 'Anúncio: ' + (ad.title || ad.body || ad.sourceId || 'Meta'), ctwa: ad.ctwaClid || '', adId: ad.sourceId || '' };
  text = text || '';
  const ind = text.match(/\[IND-([^\]]+)\]/i);
  if (ind) return { origin: 'referral', src: 'indica', detail: 'Indicação · código [IND-' + ind[1].toUpperCase() + ']' };
  if (/\[IG\]/i.test(text)) return { origin: 'organic', src: 'insta', detail: 'Bio do Instagram · código [IG]' };
  if (/\[SITE\]/i.test(text)) return { origin: 'site', src: 'site', detail: 'Botão do site · código [SITE]' };
  return { origin: 'whatsapp', src: 'direto', detail: 'Chamou direto no número, sem código', none: true };
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
  const l = leadById(q.leadId); if (!l || !(l.wa || l.jid)) throw new Error('lead sem WhatsApp');
  if (MODE === 'qr') {
    if (!waqr.ready()) throw new Error('WhatsApp desconectado: escaneie o QR em Rastreamento');
    const jid = l.jid || (l.wa + '@s.whatsapp.net');
    if (q.type === 'audio') { await waqr.sendAudio(jid, q.audio); return 'áudio'; }
    const body = fill(q.text, l); await waqr.sendText(jid, body); return body;
  }
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
  if (busy) return;
  if (MODE === 'oficial' ? !PHONE_ID : !waqr.ready()) return;
  busy = true;
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
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000)); // intervalo entre envios
    }
  } finally { busy = false; }
}
setInterval(tick, 10000);

/* ---------- Trackeamento: Pixel + token (API de Conversões do Meta) ---------- */
// O CRM não fala com o Meta. Só o Trackeamento manda os eventos do funil, com o Pixel e o token configurados na tela.
const pixel = () => ({ id: (S.settings && S.settings.pixelId) || DATASET_ID, token: (S.settings && S.settings.capiToken) || env.META_CAPI_TOKEN || '', test: (S.settings && S.settings.testCode) || '' });
const sha = v => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
function eventPayload(l, ev) {
  const user = { ph: l.wa ? [sha(l.wa)] : [], external_id: [sha(l.id)] };
  const fn = first(l.name); if (fn && !/^\(|\+/.test(fn)) user.fn = [sha(fn)];
  if (l.utm && l.utm.fbclid) user.fbc = 'fb.1.' + l.at + '.' + l.utm.fbclid;
  const data = { event_name: ev.name, event_time: Math.floor(ev.at / 1000), event_id: l.id + '-' + ev.name, action_source: 'system_generated', user_data: user,
    custom_data: { lead_event_source: 'CRM ARQ Mídia', event_source: 'crm', funnel_stage: ev.stage + 1 } };
  if (l.adId) data.custom_data.ad_id = l.adId;
  if (ev.name === 'Purchase') Object.assign(data.custom_data, { currency: 'BRL', value: l.value || PRICE[String(l.car || '').toLowerCase()] || 1000 });
  return data;
}
async function postEvents(data) {
  const px = pixel(); const body = { data }; if (px.test) body.test_event_code = px.test;
  const r = await fetch(GRAPH + '/' + px.id + '/events?access_token=' + encodeURIComponent(px.token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && (j.error.error_user_msg || j.error.message)) || ('HTTP ' + r.status));
  return j;
}
async function sendEvent(l, ev) {
  if (l.origin !== 'meta') { ev.status = 'só no CRM'; return; }
  const px = pixel();
  if (!px.id || !px.token) { ev.status = 'pronto, aguardando integração'; return; }
  try { await postEvents([eventPayload(l, ev)]); ev.status = 'enviado'; delete ev.err; log('evento', ev.name, l.name); }
  catch (e) { ev.status = 'erro'; ev.err = e.message; log('erro evento', ev.name, e.message); }
  save();
}
// quando o Pixel é conectado depois, manda o que ficou esperando
async function flushEvents() {
  for (const l of S.leads) for (const ev of l.events || []) if (l.origin === 'meta' && ev.status === 'pronto, aguardando integração') await sendEvent(l, ev);
}

/* ---------- mensagens que chegam ---------- */
// m = { jid, wa, name, text, ad, fromMe }
function inbound(m) {
  let l = S.leads.find(x => (m.jid && x.jid === m.jid) || (m.wa && x.wa === m.wa));
  if (m.fromMe) { if (l) { (l.chat = l.chat || []).push({ dir: 'out', text: m.text, at: Date.now(), manual: true }); save(); } return; }
  if (!l) {
    const o = detectOrigin(m.ad, m.text);
    const fromAd = o.origin === 'meta';
    if (AUTO_ONLY_META && !fromAd && o.none) return; // conversa comum (amigo, cliente antigo): não vira lead
    l = { id: uid('l'), jid: m.jid || '', wa: m.wa || '', name: m.name || (m.wa ? fmtPhone(m.wa) : 'Sem nome'), phone: m.wa ? fmtPhone(m.wa) : '', car: 'Serviço a definir', city: '',
      origin: o.origin, src: o.src, detail: o.detail, stage: 0, at: Date.now(), replied: false, events: [{ name: 'LeadSubmitted', stage: 0, at: Date.now() }],
      metaLeadId: o.ctwa || '', adId: o.adId || '', chat: [{ dir: 'in', text: m.text || '(clicou no anúncio)', at: Date.now() }], lastIn: Date.now() };
    S.leads.unshift(l);
    if (fromAd || !AUTO_ONLY_META) runAuto('entrada', l);
    sendEvent(l, l.events[0]);
    log('lead novo', l.name, o.origin);
  } else {
    l.chat = l.chat || []; l.chat.push({ dir: 'in', text: m.text, at: Date.now() }); l.lastIn = Date.now();
    if (!l.jid && m.jid) l.jid = m.jid;
    if (l.chat.filter(c => c.dir === 'in').length > 1 && !l.replied) { l.replied = true; cancelAuto(l); }
  }
  save(); setTimeout(tick, 1500);
}
// formulário do site (ou página de captura): manda nome, WhatsApp e os parâmetros do link (utm_*, gclid, fbclid)
function fromForm(f) {
  const wa = String(f.whatsapp || f.phone || f.telefone || '').replace(/\D/g, '');
  const num = wa.length && wa.length <= 11 ? '55' + wa : wa;
  const src = String(f.utm_source || '').toLowerCase();
  let origin = 'site', sid = 'site', detail = 'Formulário do site';
  if (f.gclid || src === 'google') { origin = 'google'; sid = 'google'; detail = 'Google Ads' + (f.utm_term ? ' · pesquisa: ' + f.utm_term : f.utm_campaign ? ' · ' + f.utm_campaign : ''); }
  else if (f.fbclid || /facebook|instagram|meta|fb|ig/.test(src)) { origin = /instagram|ig/.test(src) && !/cpc|paid|ads/.test(String(f.utm_medium || '')) ? 'organic' : 'meta'; sid = origin === 'meta' ? 'meta-ad' : 'insta'; detail = (origin === 'meta' ? 'Anúncio: ' : 'Instagram · ') + (f.utm_campaign || f.utm_content || 'formulário'); }
  else if (src) detail = 'Formulário do site · ' + src + (f.utm_campaign ? ' / ' + f.utm_campaign : '');
  let l = num && S.leads.find(x => x.wa === num);
  if (l) return l;
  l = { id: uid('l'), jid: '', wa: num, name: String(f.nome || f.name || 'Sem nome').slice(0, 80), phone: num ? fmtPhone(num) : '', car: String(f.servico || f.service || 'Serviço a definir').slice(0, 60), city: String(f.empresa || f.company || '').slice(0, 80),
    origin, src: sid, detail, stage: 0, at: Date.now(), replied: false, events: [{ name: 'LeadSubmitted', stage: 0, at: Date.now() }], metaLeadId: '', chat: [], lastIn: 0,
    utm: { source: f.utm_source || '', medium: f.utm_medium || '', campaign: f.utm_campaign || '', content: f.utm_content || '', term: f.utm_term || '', gclid: f.gclid || '', fbclid: f.fbclid || '' } };
  S.leads.unshift(l);
  if (!AUTO_ONLY_META || origin === 'meta') runAuto('entrada', l);
  sendEvent(l, l.events[0]); save(); setTimeout(tick, 1500); log('lead do formulário', l.name, origin);
  return l;
}
function onOfficial(value) {
  const contacts = value.contacts || [];
  for (const msg of value.messages || []) {
    const wa = msg.from, r = msg.referral;
    const name = ((contacts.find(c => c.wa_id === wa) || {}).profile || {}).name || '';
    const text = msg.type === 'text' ? msg.text.body : msg.type === 'audio' ? '🎤 áudio' : msg.type === 'button' ? msg.button.text : '[' + msg.type + ']';
    inbound({ wa, name, text, ad: r ? { title: r.headline || '', body: r.body || '', sourceId: r.source_id || '', sourceUrl: r.source_url || '', ctwaClid: r.ctwa_clid || '' } : null });
  }
}

/* ---------- tela ↔ servidor ---------- */
const evKey = e => e.name + '@' + e.at;
function merge(c) {
  delete c.wa; delete c.settings;
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
const view = () => Object.assign({}, S, { settings: { pixelId: pixel().id, tokenSet: !!pixel().token, tokenEnd: pixel().token.slice(-4), testCode: pixel().test }, wa: MODE === 'qr' ? Object.assign({ mode: 'qr', onlyMeta: AUTO_ONLY_META }, waqr.status) : { mode: 'oficial', state: PHONE_ID ? 'conectado' : 'sem configuração', onlyMeta: AUTO_ONLY_META } });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
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
      for (const e of body.entry || []) for (const ch of e.changes || []) if (ch.value && ch.value.messages) onOfficial(ch.value);
      return;
    }
    if (u.pathname === '/lead') {
      // aberto de propósito: o formulário do site manda pra cá (sem senha)
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
      const raw = (await readBody(req, 2e4)).toString();
      const f = (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
      if (!String(f.whatsapp || f.phone || f.telefone || '').replace(/\D/g, '')) { res.writeHead(400, cors); return res.end('falta o WhatsApp'); }
      fromForm(f);
      if (f.redirect && /^https?:\/\//.test(f.redirect)) { res.writeHead(303, Object.assign({ Location: f.redirect }, cors)); return res.end(); }
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); return res.end('{"ok":true}');
    }
    if (u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (!authed(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="CRM ARQ Midia"' }); return res.end('Senha necessária'); }
    if (u.pathname === '/api/state' && req.method === 'GET') return json(res, 200, view());
    if (u.pathname === '/api/state' && req.method === 'PUT') { merge(JSON.parse((await readBody(req)).toString())); return json(res, 200, view()); }
    if (u.pathname === '/api/pixel' && req.method === 'POST') {
      const f = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      S.settings = S.settings || {};
      if ('pixelId' in f) S.settings.pixelId = String(f.pixelId).replace(/\D/g, '');
      if (f.capiToken) S.settings.capiToken = String(f.capiToken).trim();
      if ('testCode' in f) S.settings.testCode = String(f.testCode || '').trim();
      if (f.disconnect) S.settings = {};
      save(); flushEvents();
      return json(res, 200, view());
    }
    if (u.pathname === '/api/pixel/test' && req.method === 'POST') {
      const px = pixel(); if (!px.id || !px.token) return json(res, 400, { error: 'Preencha o ID do Pixel e o token.' });
      try { const j = await postEvents([{ event_name: 'LeadSubmitted', event_time: Math.floor(Date.now() / 1000), event_id: 'teste-' + Date.now(), action_source: 'system_generated', user_data: { external_id: [sha('teste')] }, custom_data: { lead_event_source: 'CRM ARQ Mídia', event_source: 'crm' } }]);
        return json(res, 200, { ok: true, received: j.events_received }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (u.pathname === '/api/wa/logout' && req.method === 'POST') { if (waqr) await waqr.logout(); return json(res, 200, view()); }
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return fs.createReadStream(INDEX).pipe(res); }
    res.writeHead(404); res.end('não encontrado');
  } catch (e) { log('erro', e.message); if (!res.headersSent) json(res, 500, { error: e.message }); }
});
(async () => {
  await store.init();
  const saved = await store.loadState(DATA); if (saved) { S = Object.assign(S, saved); S.live = true; }
  server.listen(PORT, () => {
  log('CRM no ar na porta', PORT, 'WhatsApp:', MODE === 'qr' ? 'QR code' : 'API oficial', AUTO_ONLY_META ? '(só responde anúncio do Meta)' : '');
  // Render grátis dorme depois de 15 min sem visita: o próprio CRM se visita a cada 10 min pra continuar acordado
  if (env.RENDER_EXTERNAL_URL) setInterval(() => fetch(env.RENDER_EXTERNAL_URL + '/health').catch(() => {}), 10 * 60 * 1000);
  if (waqr) waqr.start(path.join(env.DATA_DIR || __dirname, 'whatsapp-sessao'), inbound).catch(e => log('erro WhatsApp', e.message));
});
})().catch(e => { console.error('Não consegui iniciar:', e.message); process.exit(1); });
