'use strict';
/*
 * FLASH KRATOM Delivery — backend (v5)
 * ------------------------------------------------------------------
 * Node.js built-in ล้วน (http, https, crypto, fs) — ไม่ต้อง npm install
 *
 * ที่เก็บข้อมูล (เลือกอัตโนมัติจาก env):
 *   - ไม่ตั้ง SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY -> ใช้ไฟล์ db.json ในเครื่อง (โหมด dev, รันได้ทันทีไม่ต้องตั้งค่าอะไร)
 *   - ตั้งค่าแล้ว -> ใช้ Supabase (Postgres + Storage) เหมาะสำหรับ deploy จริง เพราะข้อมูลอยู่รอดแม้ host รีสตาร์ท/รีดีพลอย
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// โหลด .env สำหรับ dev ในเครื่อง (ไม่ overwrite ค่าที่ host จริงตั้งไว้แล้ว เช่น Render) — ไม่ต้องใช้ npm package
(function loadDotEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m || m[1].startsWith('#')) continue;
    let val = (m[2] || '').trim();
    if (val && ((val[0] === '"' && val.at(-1) === '"') || (val[0] === "'" && val.at(-1) === "'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
})();

const PORT = process.env.PORT || 3000;
const DEV = process.env.NODE_ENV !== 'production';
const DB_PATH = path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const SECRET = process.env.APP_SECRET || 'flash-smoke-dev-secret-change-me';

const LINE_LOGIN_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LINE_LOGIN_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LINE_LOGIN_REDIRECT = process.env.LINE_LOGIN_REDIRECT || ('http://localhost:' + PORT + '/api/auth/line/callback');
const LINE_PUSH_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_SHOP_TO = process.env.LINE_TO || '';

// รับ SUPABASE_URL ได้หลายรูปแบบ (มี/ไม่มี trailing slash, มี/ไม่มี /rest/v1 ต่อท้ายผิด ๆ) — ตัดให้เหลือแค่ base URL เสมอ
function normalizeSupabaseUrl(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '');
  for (const suffix of ['/rest/v1', '/storage/v1', '/auth/v1', '/rest', '/storage']) {
    if (u.toLowerCase().endsWith(suffix)) { u = u.slice(0, -suffix.length).replace(/\/+$/, ''); break; }
  }
  return u;
}
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

// อีเมล OTP ผ่าน Brevo (Sendinblue) HTTP API — ฟรี 300 อีเมล/วัน, ไม่ต้องมีโดเมน
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || '';
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'FLASH KRATOM';
const EMAIL_ENABLED = !!(BREVO_API_KEY && MAIL_FROM);

const ORDER_FLOW = ['received', 'preparing', 'delivering', 'completed'];
const STATUS_LABEL = {
  received: 'ได้รับออเดอร์แล้ว', preparing: 'กำลังเตรียมสินค้า', delivering: 'กำลังจัดส่ง',
  completed: 'จัดส่งสำเร็จ', cancelled: 'ยกเลิกแล้ว'
};

// ------------------------------------------------------------------
// Helpers (ไม่ขึ้นกับที่เก็บข้อมูล)
// ------------------------------------------------------------------
const uid = (p = '') => p + crypto.randomBytes(9).toString('hex');
const now = () => Date.now();
const normPhone = (s) => String(s || '').replace(/\D/g, '');
const shortId = (id) => String(id).replace(/^o_/, '').slice(0, 6).toUpperCase();

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return h.length === hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function sign(payload) {
  const body = b64url(JSON.stringify({ ...payload, iat: now() }));
  return body + '.' + b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (sig !== b64url(crypto.createHmac('sha256', SECRET).update(body).digest())) return null;
  try { return JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); } catch { return null; }
}
const gen4 = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

function httpsJson(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { let json = {}; try { json = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json, raw: d }); });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
function httpsRaw(options, buf) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, raw: d }));
    });
    r.on('error', reject);
    if (buf) r.write(buf);
    r.end();
  });
}

function seedProducts() {
  return [
    { id: 'p1', name: 'FLASH ICE เย็นซ่า', desc: 'พอตสูตรเย็นซ่า', price: 59, emoji: '🧊', tag: 'ขายดี', image: null, stock: 30 },
    { id: 'p2', name: 'PURPLE MIX', desc: 'สูตรองุ่นเบอร์รี่', price: 65, emoji: '🍇', tag: 'ใหม่', image: null, stock: 15 },
    { id: 'p3', name: 'MINT BREEZE', desc: 'เมนทอลเย็นสดชื่น', price: 55, emoji: '🍃', tag: '', image: null, stock: 4 },
    { id: 'p4', name: 'CLASSIC SODA', desc: 'โซดาต้นตำรับ', price: 45, emoji: '🥤', tag: '', image: null, stock: 20 }
  ];
}
const defaultSettings = () => ({ deliveryFee: 20, freeQty: 2, adImage: 'assets/banner.jpg', adEnabled: true, banners: ['assets/banner.jpg'] });

// ==================================================================
// Store — persistence layer. Two backends, same async interface.
// Route handlers only ever call `Store.*`, never touch files/DB directly.
// ==================================================================
const Store = { products: [], settings: defaultSettings() };

// ---------------- Backend A: local JSON file (zero-setup dev) ----------------
function makeFileStore() {
  let db;
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)), 50);
  }
  function seedAccountsSync() {
    const add = (phone, password, fullname, role) => {
      if (db.users.find((u) => u.phone === phone)) return null;
      const { salt, hash } = hashPassword(password);
      const u = { id: uid('u_'), fullname, phone, salt, hash, verified: true, role, lineUserId: null, avatar: '', createdAt: now() };
      db.users.push(u); return u;
    };
    const demo = add('0800000000', 'demo1234', 'ลูกค้าทดลอง', 'customer');
    add('0899999999', 'admin1234', 'ผู้ดูแลระบบ', 'admin');
    if (demo) db.addresses.push({ id: uid('a_'), userId: demo.id, label: 'บ้าน', kind: 'home', text: '99/1 ถ.ท่าตะเภา ต.ท่าตะเภา อ.เมืองชุมพร จ.ชุมพร 86000', detail: '', lat: 46, lng: 50, createdAt: now() });
  }
  return {
    async init() {
      try {
        db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        for (const k of ['users', 'otps', 'addresses', 'products', 'orders', 'settings']) if (!db[k]) db[k] = k === 'products' ? seedProducts() : k === 'settings' ? defaultSettings() : [];
        if (!db.products.length) db.products = seedProducts();
      } catch { db = { users: [], otps: [], addresses: [], products: seedProducts(), orders: [], settings: defaultSettings() }; }
      for (const p of db.products) { if (typeof p.stock !== 'number') p.stock = 20; if (p.image === undefined) p.image = null; }
      Object.assign(db.settings, { ...defaultSettings(), ...db.settings });
      seedAccountsSync();
      persist();
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      Store.products = db.products;
      Store.settings = db.settings;
    },
    async getUserByPhone(phone) { return db.users.find((u) => u.phone === phone && u.hash) || null; },
    async getUserById(id) { return db.users.find((u) => u.id === id) || null; },
    async getUserByLineId(lid) { return db.users.find((u) => u.lineUserId === lid) || null; },
    async insertUser(u) { db.users.push(u); persist(); return u; },
    async updateUser(id, patch) { const u = db.users.find((x) => x.id === id); if (!u) return null; Object.assign(u, patch); persist(); return u; },
    async phoneTaken(phone, excludeId) { return db.users.some((u) => u.phone === phone && u.id !== excludeId); },

    async getOtp(phone) { const o = db.otps.find((x) => x.phone === phone); return (o && now() <= o.expiresAt) ? o : (o ? o : null); },
    async upsertOtp(o) { db.otps = db.otps.filter((x) => x.phone !== o.phone); db.otps.push(o); persist(); return o; },
    async bumpOtpTries(phone) { const o = db.otps.find((x) => x.phone === phone); if (o) { o.tries++; persist(); } },
    async deleteOtp(phone) { db.otps = db.otps.filter((x) => x.phone !== phone); persist(); },

    async getAddresses(userId) { return db.addresses.filter((a) => a.userId === userId).sort((a, b) => b.createdAt - a.createdAt); },
    async insertAddress(a) { db.addresses.push(a); persist(); return a; },
    async getAddressById(id, userId) { return db.addresses.find((a) => a.id === id && a.userId === userId) || null; },
    async deleteAddress(id, userId) { const before = db.addresses.length; db.addresses = db.addresses.filter((a) => !(a.id === id && a.userId === userId)); persist(); return db.addresses.length !== before; },

    async insertProduct(p) { db.products.push(p); persist(); return p; },
    async updateProduct(id, patch) { const p = db.products.find((x) => x.id === id); if (!p) return null; Object.assign(p, patch); persist(); return p; },
    async deleteProduct(id) { const before = db.products.length; db.products = db.products.filter((p) => p.id !== id); persist(); return db.products.length !== before; },

    async updateSettings(patch) { Object.assign(db.settings, patch); persist(); return db.settings; },

    async getOrdersByUser(userId) { return db.orders.filter((o) => o.userId === userId).sort((a, b) => b.createdAt - a.createdAt); },
    async getAllOrders() { return [...db.orders].sort((a, b) => b.createdAt - a.createdAt); },
    async getOrderById(id) { return db.orders.find((o) => o.id === id) || null; },
    async insertOrder(o) { db.orders.push(o); persist(); return o; },
    async updateOrder(id, patch) { const o = db.orders.find((x) => x.id === id); if (!o) return null; Object.assign(o, patch); persist(); return o; },

    async uploadImage(idHint, dataUrl) {
      const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/.exec(dataUrl || '');
      if (!m) return null;
      const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
      const buf = Buffer.from(m[3], 'base64');
      if (buf.length > 3_000_000) return null;
      const fname = String(idHint).replace(/[^a-z0-9_]/gi, '') + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
      return '/uploads/' + fname;
    }
  };
}

// ---------------- Backend B: Supabase (Postgres REST + Storage) ----------------
function makeSupabaseStore() {
  function sb(method, tablePath, body, extraHeaders) {
    const u = new URL(SUPABASE_URL + tablePath);
    const data = body !== undefined ? JSON.stringify(body) : null;
    return httpsJson({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json', Prefer: 'return=representation',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(extraHeaders || {})
      }
    }, data).then((r) => {
      if (r.status >= 400) throw new Error('Supabase ' + method + ' ' + tablePath + ' -> ' + r.status + ': ' + r.raw.slice(0, 300));
      return r.json;
    });
  }
  const enc = (v) => encodeURIComponent(v);

  // ---- แปลง row (snake_case จาก Postgres) <-> object (camelCase ที่ API/ฝั่งหน้าเว็บใช้) ----
  const userOut = (r) => !r ? null : ({ id: r.id, fullname: r.fullname, phone: r.phone || '', email: r.email || '', salt: r.salt, hash: r.hash, verified: r.verified, role: r.role, lineUserId: r.line_user_id, avatar: r.avatar || '', createdAt: r.created_at });
  const userIn = (u) => ({ id: u.id, fullname: u.fullname, phone: u.phone || null, email: u.email || null, salt: u.salt || null, hash: u.hash || null, verified: !!u.verified, role: u.role, line_user_id: u.lineUserId || null, avatar: u.avatar || '', created_at: u.createdAt });
  const addrOut = (r) => !r ? null : ({ id: r.id, userId: r.user_id, label: r.label, kind: r.kind, text: r.text, detail: r.detail || '', lat: r.lat, lng: r.lng, createdAt: r.created_at });
  const addrIn = (a) => ({ id: a.id, user_id: a.userId, label: a.label, kind: a.kind, text: a.text, detail: a.detail || '', lat: a.lat, lng: a.lng, created_at: a.createdAt });
  const prodOut = (r) => !r ? null : ({ id: r.id, name: r.name, desc: r.description || '', price: r.price, emoji: r.emoji, tag: r.tag || '', image: r.image, stock: r.stock });
  const prodIn = (p) => ({ id: p.id, name: p.name, description: p.desc || '', price: p.price, emoji: p.emoji, tag: p.tag || '', image: p.image, stock: p.stock, created_at: p.createdAt || now() });
  const orderOut = (r) => !r ? null : ({ id: r.id, userId: r.user_id, customerName: r.customer_name || '', phone: r.phone || '', items: r.items || [], subtotal: r.subtotal, deliveryFee: r.delivery_fee, total: r.total, addressId: r.address_id, addressText: r.address_text, addrLat: r.addr_lat, addrLng: r.addr_lng, addrDetail: r.addr_detail || '', payment: r.payment || {}, slipImage: r.slip_image, status: r.status, statusHistory: r.status_history || [], createdAt: r.created_at });
  const orderIn = (o) => ({ id: o.id, user_id: o.userId, customer_name: o.customerName || '', phone: o.phone || '', items: o.items, subtotal: o.subtotal, delivery_fee: o.deliveryFee, total: o.total, address_id: o.addressId, address_text: o.addressText, addr_lat: o.addrLat, addr_lng: o.addrLng, addr_detail: o.addrDetail || '', payment: o.payment, slip_image: o.slipImage, status: o.status, status_history: o.statusHistory, created_at: o.createdAt });
  const settOut = (r) => ({ deliveryFee: r.delivery_fee, freeQty: r.free_qty, adImage: r.ad_image, adEnabled: r.ad_enabled, banners: (r.banners && r.banners.length) ? r.banners : ['assets/banner.jpg'] });

  async function seedAccountsAsync() {
    const demoExisting = await this.getUserByPhone('0800000000');
    if (!demoExisting) {
      const { salt, hash } = hashPassword('demo1234');
      const demo = { id: uid('u_'), fullname: 'ลูกค้าทดลอง', phone: '0800000000', salt, hash, verified: true, role: 'customer', lineUserId: null, avatar: '', createdAt: now() };
      await this.insertUser(demo);
      await this.insertAddress({ id: uid('a_'), userId: demo.id, label: 'บ้าน', kind: 'home', text: '99/1 ถ.ท่าตะเภา ต.ท่าตะเภา อ.เมืองชุมพร จ.ชุมพร 86000', detail: '', lat: 46, lng: 50, createdAt: now() });
    }
    const adminExisting = await this.getUserByPhone('0899999999');
    if (!adminExisting) {
      const { salt, hash } = hashPassword('admin1234');
      await this.insertUser({ id: uid('u_'), fullname: 'ผู้ดูแลระบบ', phone: '0899999999', salt, hash, verified: true, role: 'admin', lineUserId: null, avatar: '', createdAt: now() });
    }
  }

  const store = {
    async init() {
      let rows = await sb('GET', '/rest/v1/products?select=*');
      if (!rows.length) {
        const seed = seedProducts().map((p, i) => prodIn({ ...p, createdAt: now() + i }));
        rows = await sb('POST', '/rest/v1/products', seed);
      }
      Store.products = rows.map(prodOut);
      const s = await sb('GET', '/rest/v1/settings?id=eq.1&select=*');
      Store.settings = s && s[0] ? settOut(s[0]) : defaultSettings();
      await seedAccountsAsync.call(this);
    },
    async getUserByPhone(phone) { const r = await sb('GET', '/rest/v1/users?phone=eq.' + enc(phone) + '&select=*&limit=1'); return userOut(r[0]); },
    async getUserById(id) { const r = await sb('GET', '/rest/v1/users?id=eq.' + enc(id) + '&select=*&limit=1'); return userOut(r[0]); },
    async getUserByLineId(lid) { const r = await sb('GET', '/rest/v1/users?line_user_id=eq.' + enc(lid) + '&select=*&limit=1'); return userOut(r[0]); },
    async insertUser(u) { const r = await sb('POST', '/rest/v1/users', userIn(u)); return userOut(r[0]); },
    async updateUser(id, patch) {
      const row = {};
      if (patch.fullname !== undefined) row.fullname = patch.fullname;
      if (patch.phone !== undefined) row.phone = patch.phone || null;
      if (patch.email !== undefined) row.email = patch.email || null;
      if (patch.avatar !== undefined) row.avatar = patch.avatar;
      if (patch.verified !== undefined) row.verified = patch.verified;
      if (patch.salt !== undefined) row.salt = patch.salt;
      if (patch.hash !== undefined) row.hash = patch.hash;
      const r = await sb('PATCH', '/rest/v1/users?id=eq.' + enc(id), row);
      return userOut(r[0]);
    },
    async phoneTaken(phone, excludeId) {
      const r = await sb('GET', '/rest/v1/users?phone=eq.' + enc(phone) + '&select=id');
      return r.some((x) => x.id !== excludeId);
    },

    async getOtp(phone) { const r = await sb('GET', '/rest/v1/otps?phone=eq.' + enc(phone) + '&select=*&limit=1'); return r[0] ? { phone: r[0].phone, code: r[0].code, expiresAt: r[0].expires_at, tries: r[0].tries } : null; },
    async upsertOtp(o) { await sb('POST', '/rest/v1/otps', { phone: o.phone, code: o.code, expires_at: o.expiresAt, tries: o.tries }, { Prefer: 'resolution=merge-duplicates,return=minimal' }); return o; },
    async bumpOtpTries(phone) { const o = await this.getOtp(phone); if (o) await sb('PATCH', '/rest/v1/otps?phone=eq.' + enc(phone), { tries: o.tries + 1 }); },
    async deleteOtp(phone) { await sb('DELETE', '/rest/v1/otps?phone=eq.' + enc(phone), undefined, { Prefer: 'return=minimal' }); },

    async getAddresses(userId) { const r = await sb('GET', '/rest/v1/addresses?user_id=eq.' + enc(userId) + '&select=*&order=created_at.desc'); return r.map(addrOut); },
    async insertAddress(a) { const r = await sb('POST', '/rest/v1/addresses', addrIn(a)); return addrOut(r[0]); },
    async getAddressById(id, userId) { const r = await sb('GET', '/rest/v1/addresses?id=eq.' + enc(id) + '&user_id=eq.' + enc(userId) + '&select=*&limit=1'); return addrOut(r[0]); },
    async deleteAddress(id, userId) { const r = await sb('DELETE', '/rest/v1/addresses?id=eq.' + enc(id) + '&user_id=eq.' + enc(userId)); return r.length > 0; },

    async insertProduct(p) {
      const row = prodIn({ ...p, createdAt: now() });
      const r = await sb('POST', '/rest/v1/products', row);
      const out = prodOut(r[0]);
      Store.products.push(out);
      return out;
    },
    async updateProduct(id, patch) {
      const row = {};
      if (patch.stock !== undefined) row.stock = patch.stock;
      if (patch.image !== undefined) row.image = patch.image;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.desc !== undefined) row.description = patch.desc;
      if (patch.price !== undefined) row.price = patch.price;
      if (patch.emoji !== undefined) row.emoji = patch.emoji;
      if (patch.tag !== undefined) row.tag = patch.tag;
      const r = await sb('PATCH', '/rest/v1/products?id=eq.' + enc(id), row);
      const out = prodOut(r[0]);
      const i = Store.products.findIndex((p) => p.id === id);
      if (out && i >= 0) Store.products[i] = out;
      return out;
    },
    async deleteProduct(id) {
      const r = await sb('DELETE', '/rest/v1/products?id=eq.' + enc(id));
      Store.products = Store.products.filter((p) => p.id !== id);
      return r.length > 0;
    },

    async updateSettings(patch) {
      const row = {};
      if (patch.deliveryFee !== undefined) row.delivery_fee = patch.deliveryFee;
      if (patch.freeQty !== undefined) row.free_qty = patch.freeQty;
      if (patch.adImage !== undefined) row.ad_image = patch.adImage;
      if (patch.adEnabled !== undefined) row.ad_enabled = patch.adEnabled;
      if (patch.banners !== undefined) row.banners = patch.banners;
      const r = await sb('PATCH', '/rest/v1/settings?id=eq.1', row);
      Store.settings = settOut(r[0]);
      return Store.settings;
    },

    async getOrdersByUser(userId) { const r = await sb('GET', '/rest/v1/orders?user_id=eq.' + enc(userId) + '&select=*&order=created_at.desc'); return r.map(orderOut); },
    async getAllOrders() { const r = await sb('GET', '/rest/v1/orders?select=*&order=created_at.desc'); return r.map(orderOut); },
    async getOrderById(id) { const r = await sb('GET', '/rest/v1/orders?id=eq.' + enc(id) + '&select=*&limit=1'); return orderOut(r[0]); },
    async insertOrder(o) { const r = await sb('POST', '/rest/v1/orders', orderIn(o)); return orderOut(r[0]); },
    async updateOrder(id, patch) {
      const row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.statusHistory !== undefined) row.status_history = patch.statusHistory;
      if (patch.slipImage !== undefined) row.slip_image = patch.slipImage;
      const r = await sb('PATCH', '/rest/v1/orders?id=eq.' + enc(id), row);
      return orderOut(r[0]);
    },

    async uploadImage(idHint, dataUrl) {
      const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/.exec(dataUrl || '');
      if (!m) return null;
      const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
      const buf = Buffer.from(m[3], 'base64');
      if (buf.length > 3_000_000) return null;
      const fname = String(idHint).replace(/[^a-z0-9_]/gi, '') + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
      const u = new URL(SUPABASE_URL + '/storage/v1/object/' + SUPABASE_BUCKET + '/' + fname);
      const r = await httpsRaw({
        hostname: u.hostname, path: u.pathname, method: 'POST',
        headers: { Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'image/' + m[2], 'x-upsert': 'true', 'Content-Length': buf.length }
      }, buf);
      if (r.status >= 400) { console.error('[supabase storage] upload failed', r.status, r.raw.slice(0, 200)); return null; }
      return SUPABASE_URL + '/storage/v1/object/public/' + SUPABASE_BUCKET + '/' + fname;
    }
  };
  return store;
}

// ------------------------------------------------------------------
// LINE notification (Messaging API push)
// ------------------------------------------------------------------
function pushLine(to, text) {
  if (!LINE_PUSH_TOKEN || !to) return;
  const data = JSON.stringify({ to, messages: [{ type: 'text', text }] });
  const req = https.request({
    hostname: 'api.line.me', path: '/v2/bot/message/push', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_PUSH_TOKEN, 'Content-Length': Buffer.byteLength(data) }
  }, (res) => res.on('data', () => {}));
  req.on('error', (e) => console.error('[LINE] push error:', e.message));
  req.write(data); req.end();
}
function notifyShop(text) { console.log('[LINE→ร้าน] ' + text.replace(/\n/g, ' | ')); pushLine(LINE_SHOP_TO, text); }
function notifyUser(user, text) {
  if (user && user.lineUserId) { console.log('[LINE→ลูกค้า ' + user.fullname + '] ' + text.replace(/\n/g, ' | ')); pushLine(user.lineUserId, text); }
}

// ------------------------------------------------------------------
// ส่ง OTP ทางอีเมล (Brevo HTTP API)
// ------------------------------------------------------------------
function sendOtpEmail(email, code) {
  if (!email) return;
  if (!EMAIL_ENABLED) { console.log('[email] (ยังไม่ตั้งค่า Brevo) OTP สำหรับ ' + email + ' = ' + code); return; }
  const html = `<div style="font-family:'Prompt',Arial,sans-serif;max-width:440px;margin:auto;background:#0d0b15;border-radius:16px;padding:28px;color:#f2eefb">
    <div style="font-size:22px;font-weight:700;letter-spacing:1px;color:#c4b5fd">FLASH KRATOM</div>
    <p style="color:#b6acce;margin:14px 0 6px">รหัสยืนยันการสมัครสมาชิกของคุณคือ</p>
    <div style="font-size:38px;font-weight:800;letter-spacing:10px;color:#fff;margin:8px 0">${code}</div>
    <p style="color:#9a90b0;font-size:13px">รหัสนี้จะหมดอายุใน 5 นาที — หากคุณไม่ได้ทำรายการนี้ กรุณาละเว้นอีเมลฉบับนี้</p>
  </div>`;
  const body = JSON.stringify({
    sender: { name: MAIL_FROM_NAME, email: MAIL_FROM },
    to: [{ email }],
    subject: 'รหัสยืนยัน FLASH KRATOM: ' + code,
    htmlContent: html,
    textContent: 'รหัสยืนยัน FLASH KRATOM ของคุณคือ ' + code + ' (หมดอายุใน 5 นาที)'
  });
  const req = https.request({
    hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json', 'content-length': Buffer.byteLength(body) }
  }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => { if (res.statusCode >= 400) console.error('[email] ส่งไม่สำเร็จ', res.statusCode, d.slice(0, 250)); else console.log('[email] ส่ง OTP ไปที่ ' + email + ' แล้ว'); }); });
  req.on('error', (e) => console.error('[email] error', e.message));
  req.write(body); req.end();
}

// ------------------------------------------------------------------
// SSE (live stock + settings)
// ------------------------------------------------------------------
const sseClients = new Set();
function broadcastProducts() {
  const payload = 'event: products\ndata: ' + JSON.stringify(Store.products) + '\n\n';
  for (const c of sseClients) { try { c.write(payload); } catch {} }
}
function broadcastSettings() {
  const payload = 'event: settings\ndata: ' + JSON.stringify(Store.settings) + '\n\n';
  for (const c of sseClients) { try { c.write(payload); } catch {} }
}

// ------------------------------------------------------------------
// HTTP plumbing
// ------------------------------------------------------------------
function send(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}
// แคชผู้ใช้แบบสั้น ๆ (กัน round-trip ไป Supabase ซ้ำถี่ ๆ ในช่วงเวลาสั้น ๆ)
const authCache = new Map();
async function getAuthUser(req) {
  const h = req.headers['authorization'] || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!payload) return null;
  const hit = authCache.get(payload.uid);
  if (hit && now() < hit.exp) return hit.user;
  const u = await Store.getUserById(payload.uid);
  if (u) authCache.set(payload.uid, { user: u, exp: now() + 15000 });
  return u;
}
function invalidateAuthCache(id) { authCache.delete(id); }
async function requireAdmin(req) { const u = await getAuthUser(req); return u && u.role === 'admin' ? u : null; }
const publicUser = (u) => ({ id: u.id, fullname: u.fullname, phone: u.phone || '', email: u.email || '', verified: u.verified, role: u.role || 'customer', avatar: u.avatar || '', lineLinked: !!u.lineUserId });
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());
const query = (req) => new URL(req.url, 'http://x').searchParams;
const productById = (id) => Store.products.find((p) => p.id === id);

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------
const routes = {};
const route = (m, p, fn) => { routes[m + ' ' + p] = fn; };
const oauthStates = new Map();

// ---- Auth (phone) ----
route('POST', '/api/auth/register', async (req, res, body) => {
  const fullname = String(body.fullname || '').trim();
  const phone = normPhone(body.phone);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!fullname) return send(res, 400, { error: 'กรุณากรอกชื่อ-นามสกุล' });
  if (phone.length < 9) return send(res, 400, { error: 'เบอร์โทรไม่ถูกต้อง' });
  if (!isEmail(email)) return send(res, 400, { error: 'อีเมลไม่ถูกต้อง (ใช้รับรหัส OTP)' });
  if (password.length < 6) return send(res, 400, { error: 'รหัสผ่านอย่างน้อย 6 ตัวอักษร' });
  let user = await Store.getUserByPhone(phone);
  if (user && user.verified) return send(res, 409, { error: 'เบอร์นี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ' });
  const { salt, hash } = hashPassword(password);
  if (!user) { user = await Store.insertUser({ id: uid('u_'), fullname, phone, email, salt, hash, verified: false, role: 'customer', lineUserId: null, avatar: '', createdAt: now() }); }
  else { user = await Store.updateUser(user.id, { fullname, email, salt, hash }); }
  const code = gen4();
  await Store.upsertOtp({ phone, code, expiresAt: now() + 5 * 60 * 1000, tries: 0 });
  console.log(`[OTP] ${phone} (${email}) -> ${code} (สมัครสมาชิก)`);
  sendOtpEmail(email, code);
  send(res, 200, { ok: true, phone, email, devCode: DEV ? code : undefined });
});
route('POST', '/api/auth/otp/resend', async (req, res, body) => {
  const phone = normPhone(body.phone);
  const user = await Store.getUserByPhone(phone);
  if (!user) return send(res, 404, { error: 'ไม่พบเบอร์นี้ กรุณาสมัครใหม่' });
  const code = gen4();
  await Store.upsertOtp({ phone, code, expiresAt: now() + 5 * 60 * 1000, tries: 0 });
  console.log(`[OTP] ${phone} -> ${code} (ส่งอีกครั้ง)`);
  sendOtpEmail(user.email, code);
  send(res, 200, { ok: true, phone, devCode: DEV ? code : undefined });
});
route('POST', '/api/auth/otp/verify', async (req, res, body) => {
  const phone = normPhone(body.phone);
  const code = String(body.code || '').replace(/\D/g, '');
  const otp = await Store.getOtp(phone);
  if (!otp) return send(res, 400, { error: 'ไม่มีคำขอ OTP กรุณาขอรหัสใหม่' });
  if (now() > otp.expiresAt) return send(res, 400, { error: 'รหัสหมดอายุ กรุณาขอใหม่' });
  if (otp.tries >= 5) return send(res, 429, { error: 'ลองผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่' });
  if (code !== otp.code) { await Store.bumpOtpTries(phone); return send(res, 400, { error: 'รหัสไม่ถูกต้อง' }); }
  let user = await Store.getUserByPhone(phone);
  if (!user) return send(res, 404, { error: 'ไม่พบผู้ใช้' });
  user = await Store.updateUser(user.id, { verified: true });
  await Store.deleteOtp(phone);
  send(res, 200, { ok: true, token: sign({ uid: user.id }), user: publicUser(user) });
});
route('POST', '/api/auth/login', async (req, res, body) => {
  const phone = normPhone(body.phone);
  const password = String(body.password || '');
  const user = await Store.getUserByPhone(phone);
  if (!user || !verifyPassword(password, user.salt, user.hash)) return send(res, 401, { error: 'เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง' });
  if (!user.verified) {
    const code = gen4();
    await Store.upsertOtp({ phone, code, expiresAt: now() + 5 * 60 * 1000, tries: 0 });
    console.log(`[OTP] ${phone} -> ${code} (login ที่ยังไม่ยืนยัน)`);
    sendOtpEmail(user.email, code);
    return send(res, 403, { error: 'ยังไม่ได้ยืนยันเบอร์', needOtp: true, phone, email: user.email, devCode: DEV ? code : undefined });
  }
  send(res, 200, { ok: true, token: sign({ uid: user.id }), user: publicUser(user) });
});
route('GET', '/api/me', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return send(res, 401, { error: 'unauthorized' });
  send(res, 200, { user: publicUser(u) });
});

// ---- LINE Login (OAuth 2.0) ----
route('GET', '/api/auth/line/config', async (req, res) => send(res, 200, { configured: !!(LINE_LOGIN_ID && LINE_LOGIN_SECRET) }));
route('GET', '/api/auth/line/login', async (req, res) => {
  if (!LINE_LOGIN_ID || !LINE_LOGIN_SECRET) { res.writeHead(302, { Location: '/#lineerror=notconfigured' }); return res.end(); }
  const state = crypto.randomBytes(12).toString('hex');
  oauthStates.set(state, now() + 10 * 60 * 1000);
  const url = 'https://access.line.me/oauth2/v2.1/authorize?response_type=code'
    + '&client_id=' + encodeURIComponent(LINE_LOGIN_ID)
    + '&redirect_uri=' + encodeURIComponent(LINE_LOGIN_REDIRECT)
    + '&state=' + state + '&scope=' + encodeURIComponent('profile openid');
  res.writeHead(302, { Location: url }); res.end();
});
route('GET', '/api/auth/line/callback', async (req, res) => {
  const q = query(req);
  const code = q.get('code'), state = q.get('state');
  const exp = oauthStates.get(state);
  if (!code || !state || !exp || now() > exp) { res.writeHead(302, { Location: '/#lineerror=state' }); return res.end(); }
  oauthStates.delete(state);
  try {
    const form = 'grant_type=authorization_code&code=' + encodeURIComponent(code)
      + '&redirect_uri=' + encodeURIComponent(LINE_LOGIN_REDIRECT)
      + '&client_id=' + encodeURIComponent(LINE_LOGIN_ID)
      + '&client_secret=' + encodeURIComponent(LINE_LOGIN_SECRET);
    const tok = await httpsJson({ hostname: 'api.line.me', path: '/oauth2/v2.1/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) } }, form);
    const access = tok.json && tok.json.access_token;
    if (!access) throw new Error('token exchange failed: ' + tok.raw);
    const prof = await httpsJson({ hostname: 'api.line.me', path: '/v2/profile', method: 'GET', headers: { Authorization: 'Bearer ' + access } });
    const { userId, displayName, pictureUrl } = prof.json || {};
    if (!userId) throw new Error('no profile');
    let user = await Store.getUserByLineId(userId);
    if (!user) {
      user = await Store.insertUser({ id: uid('u_'), fullname: displayName || 'ผู้ใช้ LINE', phone: '', lineUserId: userId, avatar: pictureUrl || '', verified: true, role: 'customer', createdAt: now() });
    } else {
      const patch = {};
      if (displayName && !user.fullname) patch.fullname = displayName;
      if (pictureUrl) patch.avatar = pictureUrl;
      if (Object.keys(patch).length) user = await Store.updateUser(user.id, patch);
    }
    invalidateAuthCache(user.id);
    res.writeHead(302, { Location: '/#token=' + sign({ uid: user.id }) }); res.end();
  } catch (e) {
    console.error('[LINE login]', e.message);
    res.writeHead(302, { Location: '/#lineerror=failed' }); res.end();
  }
});

// ---- Products + live stock ----
route('GET', '/api/products', async (req, res) => send(res, 200, { products: Store.products }));
route('GET', '/api/settings', async (req, res) => send(res, 200, { settings: Store.settings }));
route('GET', '/api/stream', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write('retry: 3000\n\n');
  res.write('event: products\ndata: ' + JSON.stringify(Store.products) + '\n\n');
  res.write('event: settings\ndata: ' + JSON.stringify(Store.settings) + '\n\n');
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

// ---- Profile (customer แก้ไขโปรไฟล์ตัวเอง) ----
route('POST', '/api/me/update', async (req, res, body) => {
  const u = await getAuthUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
  const patch = {};
  const fullname = String(body.fullname || '').trim();
  if (fullname) patch.fullname = fullname.slice(0, 60);
  if (body.phone !== undefined) {
    const phone = normPhone(body.phone);
    if (phone && phone.length < 9) return send(res, 400, { error: 'เบอร์โทรไม่ถูกต้อง' });
    if (phone && await Store.phoneTaken(phone, u.id)) return send(res, 409, { error: 'เบอร์นี้ถูกใช้แล้ว' });
    patch.phone = phone;
  }
  if (body.avatarData) { const img = await Store.uploadImage('avatar_' + u.id, body.avatarData); if (img) patch.avatar = img; }
  else if (body.avatar !== undefined) patch.avatar = body.avatar ? String(body.avatar).slice(0, 500) : '';
  const updated = await Store.updateUser(u.id, patch);
  invalidateAuthCache(u.id);
  send(res, 200, { ok: true, user: publicUser(updated) });
});

// ---- Geocoding (OpenStreetMap Nominatim — ฟรี ไม่ต้องมี API key) ----
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, toR = (x) => x * Math.PI / 180;
  const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// สร้างที่อยู่แบบไทยเรียงลำดับจากส่วนประกอบ (บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์)
function formatThaiAddress(a) {
  if (!a) return null;
  const parts = [];
  const line1 = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  if (line1) parts.push(line1);
  const village = a.village || a.hamlet || a.neighbourhood || a.suburb;
  if (village && !parts.join(' ').includes(village)) parts.push(village);
  const tambon = a.subdistrict || a.quarter || a.city_district;
  if (tambon) parts.push('ต.' + tambon);
  const amphoe = a.county || a.city || a.town || a.municipality;
  if (amphoe) parts.push(amphoe.startsWith('อำเภอ') || amphoe.startsWith('เขต') ? amphoe : ('อ.' + amphoe));
  const province = a.province || a.state;
  if (province) parts.push(province.startsWith('จังหวัด') ? province : ('จ.' + province));
  if (a.postcode) parts.push(a.postcode);
  return parts.length ? parts.join(' ') : null;
}
// หา "จุดสังเกต" ที่ใกล้ที่สุดในรัศมี 150 เมตร (ร้าน/อาคาร/สถานที่ที่มีชื่อ) เพื่อเติมให้ที่อยู่ชัดขึ้น
async function nearestLandmark(lat, lng) {
  const ql = `[out:json][timeout:15];nwr(around:150,${lat},${lng})["name"]["highway"!~"."]["boundary"!~"."];out center 40;`;
  const body = 'data=' + encodeURIComponent(ql);
  try {
    const r = await httpsJson({
      hostname: 'overpass-api.de', path: '/api/interpreter', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'FlashSmokeDelivery/1.0' }
    }, body);
    const els = (r.json && r.json.elements) || [];
    let best = null;
    for (const e of els) {
      const la = e.lat != null ? e.lat : (e.center && e.center.lat);
      const lo = e.lon != null ? e.lon : (e.center && e.center.lon);
      const name = e.tags && e.tags.name;
      if (la == null || lo == null || !name) continue;
      const d = haversine(lat, lng, la, lo);
      if (!best || d < best.dist) best = { name: String(name).slice(0, 50), dist: Math.round(d) };
    }
    return best;
  } catch { return null; }
}
route('GET', '/api/geocode/reverse', async (req, res) => {
  const q = query(req);
  const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
  if (!isFinite(lat) || !isFinite(lng)) return send(res, 400, { error: 'พิกัดไม่ถูกต้อง' });
  try {
    const [nomi, landmark] = await Promise.all([
      httpsJson({
        hostname: 'nominatim.openstreetmap.org',
        path: `/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=th&zoom=18&addressdetails=1`,
        method: 'GET', headers: { 'User-Agent': 'FlashSmokeDelivery/1.0 (+https://flash-smoke.onrender.com)' }
      }),
      nearestLandmark(lat, lng)
    ]);
    const j = nomi.json || {};
    // ใช้ display_name (ครบที่สุดที่ OSM มี) เป็นหลัก ตัด ", ประเทศไทย" ท้ายออก แล้วค่อย fallback เป็นแบบจัดรูปเอง
    let address = (j.display_name ? j.display_name.replace(/,?\s*ประเทศไทย\s*$/, '').trim() : null) || formatThaiAddress(j.address) || null;
    if (landmark && (!address || !address.includes(landmark.name))) {
      const near = `ใกล้ ${landmark.name} ~${landmark.dist} ม.`;
      address = address ? `${address} (${near})` : near;
    }
    send(res, 200, { address, full: j.display_name || null, landmark });
  } catch (e) {
    console.error('[geocode] reverse failed', e.message);
    send(res, 502, { error: 'ค้นหาที่อยู่ไม่สำเร็จ' });
  }
});

// ---- สถานที่สำคัญใกล้เคียง (ร้านอาหาร/ร้านเหล้า/ร้านสะดวกซื้อ) จาก OpenStreetMap Overpass ----
function poiCategory(tags) {
  const a = tags.amenity, s = tags.shop;
  if (a === 'bar' || a === 'pub' || a === 'nightclub' || s === 'alcohol' || s === 'wine' || s === 'beverages') return { cat: 'drink', icon: '🍺' };
  if (a === 'cafe') return { cat: 'food', icon: '☕' };
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return { cat: 'food', icon: '🍜' };
  if (s === 'convenience' || s === 'supermarket' || s === 'mall' || s === 'department_store') return { cat: 'store', icon: '🏪' };
  return { cat: 'other', icon: '📍' };
}
route('GET', '/api/places', async (req, res) => {
  const q = query(req);
  const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
  let radius = Math.min(4000, Math.max(300, Number(q.get('radius')) || 1500));
  if (!isFinite(lat) || !isFinite(lng)) return send(res, 400, { error: 'พิกัดไม่ถูกต้อง' });
  const ql = `[out:json][timeout:20];(` +
    `node["amenity"~"^(restaurant|fast_food|cafe|food_court|bar|pub|nightclub)$"](around:${radius},${lat},${lng});` +
    `node["shop"~"^(alcohol|wine|beverages|convenience|supermarket|mall|department_store)$"](around:${radius},${lat},${lng});` +
    `);out body 80;`;
  const body = 'data=' + encodeURIComponent(ql);
  try {
    const r = await httpsJson({
      hostname: 'overpass-api.de', path: '/api/interpreter', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'FlashSmokeDelivery/1.0 (+https://flash-smoke.onrender.com)' }
    }, body);
    if (r.status !== 200) console.error('[places] overpass status', r.status, r.raw.slice(0, 120));
    const els = (r.json && r.json.elements) || [];
    const places = els.filter((e) => e.tags && e.tags.name && e.lat && e.lon).map((e) => {
      const c = poiCategory(e.tags);
      return { name: String(e.tags.name).slice(0, 60), lat: e.lat, lng: e.lon, cat: c.cat, icon: c.icon };
    }).slice(0, 80);
    send(res, 200, { places });
  } catch (e) {
    console.error('[places] overpass failed', e.message);
    send(res, 200, { places: [] }); // ไม่ให้ล้มทั้งแผนที่ ถ้า Overpass ล่ม
  }
});

// ---- Addresses ----
route('GET', '/api/addresses', async (req, res) => {
  const u = await getAuthUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
  send(res, 200, { addresses: await Store.getAddresses(u.id) });
});
route('POST', '/api/addresses', async (req, res, body) => {
  const u = await getAuthUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
  const text = String(body.text || '').trim();
  if (!text) return send(res, 400, { error: 'ไม่มีข้อมูลที่อยู่' });
  const kind = ['home', 'work', 'other'].includes(body.kind) ? body.kind : 'other';
  const addr = { id: uid('a_'), userId: u.id, label: String(body.label || 'ที่อยู่').slice(0, 40), kind, text: text.slice(0, 300), detail: String(body.detail || '').slice(0, 200), lat: Number(body.lat) || null, lng: Number(body.lng) || null, createdAt: now() };
  const saved = await Store.insertAddress(addr);
  send(res, 200, { ok: true, address: saved });
});
route('DELETE', '/api/addresses', async (req, res, body) => {
  const u = await getAuthUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
  const ok = await Store.deleteAddress(body.id, u.id);
  if (!ok) return send(res, 404, { error: 'ไม่พบที่อยู่' });
  send(res, 200, { ok: true });
});

// ---- Orders (customer) — with stock ----
route('POST', '/api/orders', async (req, res, body) => {
  const u = await getAuthUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
  if (!u.verified || !u.phone) return send(res, 403, { error: 'กรุณายืนยันเบอร์โทรก่อนสั่งซื้อ', needPhone: true });
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return send(res, 400, { error: 'ตะกร้าว่าง' });
  for (const it of items) {
    const p = productById(it.productId);
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    if (p && (p.stock || 0) < qty) return send(res, 409, { error: 'สินค้า "' + p.name + '" คงเหลือไม่พอ (เหลือ ' + (p.stock || 0) + ')' });
  }
  let subtotal = 0;
  const detailed = [];
  for (const it of items) {
    const p = productById(it.productId);
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    const price = p ? p.price : 0;
    subtotal += price * qty;
    if (p) { const newStock = Math.max(0, (p.stock || 0) - qty); await Store.updateProduct(p.id, { stock: newStock }); }
    detailed.push({ productId: it.productId, name: p ? p.name : 'สินค้า', emoji: p ? p.emoji : '📦', image: p ? p.image : null, price, qty });
  }
  const totalQty = detailed.reduce((n, d) => n + d.qty, 0);
  const deliveryFee = totalQty >= (Store.settings.freeQty || 2) ? 0 : (Store.settings.deliveryFee || 0);
  const addr = body.addressId ? await Store.getAddressById(body.addressId, u.id) : null;
  const payMethod = ['cod', 'transfer'].includes(body.payment && body.payment.method) ? body.payment.method : 'cod';
  const order = {
    id: uid('o_'), userId: u.id, customerName: u.fullname, phone: u.phone || '',
    items: detailed, subtotal, deliveryFee, total: subtotal + deliveryFee,
    addressId: addr ? addr.id : null, addressText: addr ? addr.text : (body.addressText || null),
    addrLat: addr ? addr.lat : null, addrLng: addr ? addr.lng : null, addrDetail: addr ? addr.detail : '',
    payment: { method: payMethod, note: String((body.payment && body.payment.note) || '').slice(0, 200) },
    slipImage: null,
    status: 'received', statusHistory: [{ status: 'received', at: now() }], createdAt: now()
  };
  const saved = await Store.insertOrder(order);
  broadcastProducts();
  notifyShop(`🛵 ออเดอร์ใหม่ #${shortId(saved.id)}\nลูกค้า: ${saved.customerName}${saved.phone ? ' (' + saved.phone + ')' : ''}\nรายการ: ${detailed.map((d) => d.name + ' x' + d.qty).join(', ')}\nยอดรวม: ฿${saved.total}\nส่งที่: ${saved.addressText || '-'}`);
  notifyUser(u, `✅ รับออเดอร์ #${shortId(saved.id)} แล้ว\nยอดรวม ฿${saved.total}\nเราจะแจ้งเมื่อสถานะเปลี่ยนแปลง`);
  send(res, 200, { ok: true, order: saved });
});
route('GET', '/api/orders', async (req, res) => {
  const u = await getAuthUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
  send(res, 200, { orders: await Store.getOrdersByUser(u.id) });
});
// อัปโหลดสลิปโอนเงิน
route('POST', '/api/orders/slip', async (req, res, body) => {
  const u = await getAuthUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
  const order = await Store.getOrderById(body.orderId);
  if (!order || order.userId !== u.id) return send(res, 404, { error: 'ไม่พบออเดอร์' });
  const img = await Store.uploadImage('slip_' + shortId(order.id), body.imageData);
  if (!img) return send(res, 400, { error: 'สลิปไม่ถูกต้องหรือใหญ่เกิน 3MB' });
  const updated = await Store.updateOrder(order.id, { slipImage: img });
  notifyShop(`🧾 ลูกค้าอัปโหลดสลิปแล้ว ออเดอร์ #${shortId(order.id)}\nลูกค้า: ${order.customerName}`);
  send(res, 200, { ok: true, order: updated });
});

// ---- Admin ----
route('GET', '/api/admin/orders', async (req, res) => {
  if (!await requireAdmin(req)) return send(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
  send(res, 200, { orders: await Store.getAllOrders() });
});
route('POST', '/api/admin/orders/status', async (req, res, body) => {
  if (!await requireAdmin(req)) return send(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
  const order = await Store.getOrderById(body.id);
  if (!order) return send(res, 404, { error: 'ไม่พบออเดอร์' });
  if (!STATUS_LABEL[body.status]) return send(res, 400, { error: 'สถานะไม่ถูกต้อง' });
  const history = [...(order.statusHistory || []), { status: body.status, at: now() }];
  const updated = await Store.updateOrder(order.id, { status: body.status, statusHistory: history });
  notifyShop(`📦 ออเดอร์ #${shortId(order.id)} -> ${STATUS_LABEL[body.status]}\nลูกค้า: ${order.customerName}`);
  const owner = await Store.getUserById(order.userId);
  notifyUser(owner, `📦 ออเดอร์ #${shortId(order.id)} ของคุณ\nสถานะ: ${STATUS_LABEL[body.status]}`);
  send(res, 200, { ok: true, order: updated });
});
route('POST', '/api/admin/settings', async (req, res, body) => {
  if (!await requireAdmin(req)) return send(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
  const patch = {};
  if (body.deliveryFee !== undefined) { const f = Number(body.deliveryFee); if (!(f >= 0)) return send(res, 400, { error: 'ค่าจัดส่งไม่ถูกต้อง' }); patch.deliveryFee = Math.round(f); }
  if (body.freeQty !== undefined) { const q = Number(body.freeQty); if (!(q >= 1)) return send(res, 400, { error: 'จำนวนขั้นต่ำไม่ถูกต้อง' }); patch.freeQty = Math.round(q); }
  if (body.adImageData) { const img = await Store.uploadImage('ad', body.adImageData); if (!img) return send(res, 400, { error: 'รูปโฆษณาไม่ถูกต้องหรือใหญ่เกิน 3MB' }); patch.adImage = img; }
  else if (body.adImage !== undefined) patch.adImage = body.adImage ? String(body.adImage).slice(0, 500) : null;
  if (body.adEnabled !== undefined) patch.adEnabled = !!body.adEnabled;
  // แบนเนอร์หน้าแรก (สไลด์รูปได้หลายรูป)
  if (body.addBannerData) {
    const img = await Store.uploadImage('banner', body.addBannerData);
    if (!img) return send(res, 400, { error: 'รูปแบนเนอร์ไม่ถูกต้องหรือใหญ่เกิน 3MB' });
    patch.banners = [...(Store.settings.banners || []), img];
  } else if (body.removeBanner !== undefined) {
    patch.banners = (Store.settings.banners || []).filter((u) => u !== body.removeBanner);
  }
  const settings = await Store.updateSettings(patch);
  broadcastSettings();
  send(res, 200, { ok: true, settings });
});
route('POST', '/api/admin/products', async (req, res, body) => {
  if (!await requireAdmin(req)) return send(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  if (!name) return send(res, 400, { error: 'กรุณากรอกชื่อสินค้า' });
  if (!(price >= 0)) return send(res, 400, { error: 'ราคาไม่ถูกต้อง' });
  const id = 'p_' + crypto.randomBytes(4).toString('hex');
  let image = null;
  if (body.imageData) image = await Store.uploadImage(id, body.imageData);
  else if (body.image) image = String(body.image).slice(0, 500);
  const product = await Store.insertProduct({ id, name: name.slice(0, 60), desc: String(body.desc || '').slice(0, 120), price: Math.round(price), emoji: String(body.emoji || '🛍️').slice(0, 4), tag: String(body.tag || '').slice(0, 20), image, stock: Math.max(0, Math.round(Number(body.stock) || 0)) });
  broadcastProducts();
  send(res, 200, { ok: true, product });
});
route('POST', '/api/admin/products/stock', async (req, res, body) => {
  if (!await requireAdmin(req)) return send(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
  if (!productById(body.id)) return send(res, 404, { error: 'ไม่พบสินค้า' });
  const stock = Math.max(0, Math.round(Number(body.stock) || 0));
  const product = await Store.updateProduct(body.id, { stock });
  broadcastProducts();
  send(res, 200, { ok: true, product });
});
route('POST', '/api/admin/products/image', async (req, res, body) => {
  if (!await requireAdmin(req)) return send(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
  if (!productById(body.id)) return send(res, 404, { error: 'ไม่พบสินค้า' });
  let patch;
  if (body.imageData) { const img = await Store.uploadImage(body.id, body.imageData); if (!img) return send(res, 400, { error: 'รูปไม่ถูกต้องหรือใหญ่เกิน 3MB' }); patch = { image: img }; }
  else if (body.image !== undefined) patch = { image: body.image ? String(body.image).slice(0, 500) : null };
  else patch = {};
  const product = await Store.updateProduct(body.id, patch);
  broadcastProducts();
  send(res, 200, { ok: true, product });
});
route('DELETE', '/api/admin/products', async (req, res, body) => {
  if (!await requireAdmin(req)) return send(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
  const ok = await Store.deleteProduct(body.id);
  if (!ok) return send(res, 404, { error: 'ไม่พบสินค้า' });
  broadcastProducts();
  send(res, 200, { ok: true });
});

// ------------------------------------------------------------------
// Static serving
// ------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };
// html/js/css ต้องไม่ถูกแคชนาน ๆ (มิฉะนั้นมือถือบางเครื่องจะยังเห็นโค้ดเก่าแม้ deploy ใหม่แล้ว)
// ส่วนรูปที่อัปโหลด (มีชื่อไฟล์สุ่มไม่ซ้ำ) แคชยาวได้ปลอดภัย เพราะเปลี่ยนรูป = ชื่อไฟล์ใหม่เสมอ
const NO_CACHE_EXT = new Set(['.html', '.js', '.css']);
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  const ext = path.extname(filePath).toLowerCase();
  const cacheHeader = NO_CACHE_EXT.has(ext) || ext === ''
    ? { 'Cache-Control': 'no-cache' }
    : { 'Cache-Control': 'public, max-age=604800' };
  fs.readFile(filePath, (err, data) => {
    if (err) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
      if (e2) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }); res.end(html);
    });
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...cacheHeader });
    res.end(data);
  });
}

// ------------------------------------------------------------------
// Server
// ------------------------------------------------------------------
async function main() {
  const backend = USE_SUPABASE ? makeSupabaseStore() : makeFileStore();
  Object.assign(Store, backend);
  await Store.init();

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const pathname = url.split('?')[0];
    if (pathname.startsWith('/api/')) {
      const handler = routes[req.method + ' ' + pathname];
      if (!handler) return send(res, 404, { error: 'ไม่พบ endpoint นี้' });
      try {
        const body = ['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        await handler(req, res, body);
      } catch (e) { console.error('API error:', e); if (!res.headersSent) send(res, 500, { error: 'server error' }); }
      return;
    }
    serveStatic(req, res, url);
  });

  server.listen(PORT, () => {
    console.log('');
    console.log('  🛵  FLASH KRATOM — สั่งพอตในตัวเมืองชุมพร (v5)');
    console.log('  ─────────────────────────────────────────────');
    console.log('  เปิดเว็บที่:  http://localhost:' + PORT);
    console.log('  โหมด:        ' + (DEV ? 'development (โชว์รหัส OTP)' : 'production'));
    console.log('  ที่เก็บข้อมูล: ' + (USE_SUPABASE ? 'Supabase (' + SUPABASE_URL + ')' : 'ไฟล์ในเครื่อง (db.json) — ตั้ง SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY เพื่อใช้ Supabase'));
    console.log('  บัญชีทดลอง:  ลูกค้า 0800000000/demo1234 · แอดมิน 0899999999/admin1234');
    console.log('  LINE Login:  ' + (LINE_LOGIN_ID && LINE_LOGIN_SECRET ? 'พร้อมใช้ (callback: ' + LINE_LOGIN_REDIRECT + ')' : 'ยังไม่ตั้งค่า (LINE_LOGIN_CHANNEL_ID/SECRET)'));
    console.log('  LINE Push:   ' + (LINE_PUSH_TOKEN ? 'พร้อมส่งจริง' : 'log-only (LINE_CHANNEL_ACCESS_TOKEN)'));
    console.log('  Email OTP:   ' + (EMAIL_ENABLED ? 'พร้อมส่งจริง (Brevo, from ' + MAIL_FROM + ')' : 'log-only (ตั้ง BREVO_API_KEY + MAIL_FROM)'));
    console.log('');
  });
}
main().catch((e) => { console.error('startup failed:', e); process.exit(1); });
