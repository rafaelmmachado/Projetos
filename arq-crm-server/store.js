// Onde os dados ficam salvos.
// - Sem MONGODB_URI: num arquivo (data.json) e na pasta whatsapp-sessao. Bom pro seu PC ou servidor com disco.
// - Com MONGODB_URI: num banco MongoDB (o Atlas grátis serve). Bom pro Render grátis, que apaga os arquivos quando reinicia.
const fs = require('fs');
const path = require('path');
const { initAuthCreds, BufferJSON, proto, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const URI = process.env.MONGODB_URI || '';
let db = null;

async function init() {
  if (!URI) return;
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'arq_crm');
  console.log('Dados no MongoDB');
}

async function loadState(file) {
  if (db) { const d = await db.collection('crm').findOne({ _id: 'state' }); return d ? JSON.parse(d.v) : null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
let writing = Promise.resolve();
function saveState(file, S) {
  const v = JSON.stringify(S);
  if (db) { writing = writing.then(() => db.collection('crm').updateOne({ _id: 'state' }, { $set: { v, at: new Date() } }, { upsert: true })).catch(e => console.log('erro ao salvar no banco', e.message)); return; }
  fs.writeFile(file, v, () => {});
}

// sessão do WhatsApp (pra não pedir QR de novo a cada reinício)
async function authState(dir) {
  if (!db) {
    fs.mkdirSync(dir, { recursive: true });
    const r = await useMultiFileAuthState(dir);
    return Object.assign(r, { clear: async () => fs.rmSync(dir, { recursive: true, force: true }) });
  }
  const col = db.collection('whatsapp');
  const read = async id => { const d = await col.findOne({ _id: id }); return d ? JSON.parse(d.v, BufferJSON.reviver) : null; };
  const write = (id, val) => col.updateOne({ _id: id }, { $set: { v: JSON.stringify(val, BufferJSON.replacer) } }, { upsert: true });
  const del = id => col.deleteOne({ _id: id });
  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async id => { let v = await read(type + '-' + id); if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v); data[id] = v; }));
          return data;
        },
        set: async data => {
          const t = [];
          for (const c in data) for (const id in data[c]) { const v = data[c][id]; t.push(v ? write(c + '-' + id, v) : del(c + '-' + id)); }
          await Promise.all(t);
        }
      }
    },
    saveCreds: () => write('creds', creds),
    clear: () => col.deleteMany({})
  };
}

module.exports = { init, loadState, saveState, authState, usingDb: () => !!db };
