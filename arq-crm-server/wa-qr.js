// Conexão do WhatsApp pelo QR code (o mesmo jeito do WhatsApp Web, igual ao Trizup).
// Não é a API oficial: usar com cuidado (só responder quem chamou, poucas mensagens por lead).
const fs = require('fs');
const QR = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const status = { state: 'iniciando', qr: '', me: '' };
let sock = null, dir = '', onMsg = () => {}, retry = 0;

function textOf(m) {
  const msg = m.message || {};
  const inner = (msg.ephemeralMessage && msg.ephemeralMessage.message) || (msg.viewOnceMessage && msg.viewOnceMessage.message) || msg;
  const text = inner.conversation || (inner.extendedTextMessage && inner.extendedTextMessage.text) || (inner.imageMessage && (inner.imageMessage.caption || '📷 imagem')) || (inner.videoMessage && (inner.videoMessage.caption || '🎬 vídeo')) || (inner.audioMessage && '🎤 áudio') || (inner.documentMessage && '📄 documento') || (inner.stickerMessage && 'figurinha') || '';
  const ctxSrc = inner.extendedTextMessage || inner.imageMessage || inner.videoMessage || inner.audioMessage || inner;
  const ctx = (ctxSrc && ctxSrc.contextInfo) || {};
  const ad = ctx.externalAdReply;
  return { text, ad: ad ? { title: ad.title || '', body: ad.body || '', sourceId: ad.sourceId || '', sourceUrl: ad.sourceUrl || '', ctwaClid: ad.ctwaClid || '' } : null };
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  let version; try { version = (await fetchLatestBaileysVersion()).version; } catch (e) {}
  sock = makeWASocket({ auth: state, version, logger: pino({ level: 'warn' }), browser: ['CRM ARQ Mídia', 'Chrome', '1.0'], markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async u => {
    if (u.qr) { status.state = 'aguardando QR'; status.qr = await QR.toDataURL(u.qr, { margin: 1, width: 280 }); }
    if (u.connection === 'open') { retry = 0; status.state = 'conectado'; status.qr = ''; status.me = (sock.user && sock.user.id || '').split(':')[0].split('@')[0]; console.log('WhatsApp conectado', status.me); }
    if (u.connection === 'close') {
      const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
      status.state = 'desconectado'; status.me = '';
      if (code === DisconnectReason.loggedOut) { console.log('WhatsApp desconectado pelo celular; vai pedir QR de novo'); fs.rmSync(dir, { recursive: true, force: true }); }
      retry++; setTimeout(connect, Math.min(60000, 2000 * retry));
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      const jid = m.key.remoteJid || '';
      if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) continue; // ignora grupos, status e canais
      const pn = jid.endsWith('@s.whatsapp.net') ? jid : (m.key.senderPn || '');
      const { text, ad } = textOf(m);
      if (!text && !ad) continue;
      onMsg({ jid, wa: pn ? pn.split('@')[0] : '', name: m.pushName || '', text, ad, fromMe: !!m.key.fromMe });
    }
  });
}

module.exports = {
  status,
  async start(authDir, handler) { dir = authDir; onMsg = handler; fs.mkdirSync(dir, { recursive: true }); await connect(); },
  ready: () => status.state === 'conectado',
  async sendText(jid, text) {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    await new Promise(r => setTimeout(r, Math.min(6000, 1200 + text.length * 40))); // "digitando..." como uma pessoa
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
    await sock.sendMessage(jid, { text });
  },
  async sendAudio(jid, dataUrl) {
    const m = /^data:([^;]+)[^,]*;base64,(.*)$/.exec(dataUrl || ''); if (!m) throw new Error('áudio inválido');
    await sock.sendPresenceUpdate('recording', jid).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
    await sock.sendMessage(jid, { audio: Buffer.from(m[2], 'base64'), mimetype: 'audio/ogg; codecs=opus', ptt: true });
  },
  async logout() { if (sock) await sock.logout().catch(() => {}); }
};
