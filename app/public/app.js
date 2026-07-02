/* FLASH SMOKE — สั่งพอตในตัวเมืองชุมพร (frontend v3)
 * รูปสินค้า + สต็อกเรียลไทม์ (SSE) + LINE Login + แอดมิน
 */
(() => {
'use strict';

const ORDER_FLOW = ['received', 'preparing', 'delivering', 'completed'];
const STATUS_LABEL = { received: 'ได้รับออเดอร์แล้ว', preparing: 'กำลังเตรียมสินค้า', delivering: 'กำลังจัดส่ง', completed: 'จัดส่งสำเร็จ', cancelled: 'ยกเลิกแล้ว' };
const PAY_LABEL = { cod: 'เก็บเงินปลายทาง', transfer: 'โอนเงิน / พร้อมเพย์' };
const BTN = 'linear-gradient(135deg,#a78bfa,#7c3aed)';
const BTN_OFF = '#2a2440';
const TAGLINE = 'สั่งพอตในตัวเมืองชุมพร';
const CHUMPHON_CENTER = { lat: 10.4930, lng: 99.1800 };
const TILE_STYLES = {
  violet: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
  mono: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
  night: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' }
};

// ---------------- API ----------------
const API = {
  token: localStorage.getItem('fs_token') || '',
  async call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.error || ('HTTP ' + res.status)), { data, status: res.status });
    return data;
  },
  get(p) { return this.call('GET', p); },
  post(p, b) { return this.call('POST', p, b); },
  del(p, b) { return this.call('DELETE', p, b); },
  setToken(t) { this.token = t || ''; if (t) localStorage.setItem('fs_token', t); else localStorage.removeItem('fs_token'); }
};

// ---------------- State ----------------
const S = {
  screen: 'welcome', user: null,
  fullname: '', phone: '', email: '', password: '',
  loginPhone: '', loginPassword: '',
  otp: ['', '', '', ''], devCode: '', otpEmail: '',
  pinLat: null, pinLng: null, currentAddr: '', addrLoading: false, wantsGeoLocate: false,
  addrDetail: '', addrLabel: 'บ้าน', mapStyle: 'violet', fromCheckout: false,
  saved: [], products: [], orders: [],
  settings: { deliveryFee: 20, freeQty: 2 },
  cart: JSON.parse(localStorage.getItem('fs_cart') || '[]'),
  checkoutAddressId: null, payMethod: 'cod', orderNote: '',
  adminTab: 'orders', adminOrders: [], adminOrderId: null,
  setDeliveryFee: '', setFreeQty: '',
  npName: '', npDesc: '', npPrice: '', npEmoji: '🛍️', npTag: '', npStock: '', npImageData: '', npImageName: '',
  pfName: '', pfPhone: '', pfAvatarData: '',
  toast: '', busy: false
};
let pendingLineError = '';
// สถานะแผนที่จริง (Leaflet) — คงอยู่นอก S เพราะเป็น DOM/instance ไม่ใช่ข้อมูลแอป
let leafletMap = null, leafletMarker = null, leafletTile = null;
let adminMiniMapInst = null;
let geocodeTimer = null, geocodeReqId = 0;

// ---------------- Helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastTimer = null;
function toast(msg) {
  const host = $('#toast-host');
  host.innerHTML = `<div style="position:absolute;bottom:96px;left:50%;transform:translateX(-50%);background:#231d38;border:1px solid rgba(139,92,246,.4);color:#f2eefb;font-size:13.5px;font-weight:500;padding:12px 20px;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.5);z-index:80;max-width:88%;text-align:center;animation:fs-toast 2.4s ease forwards">${esc(msg)}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { host.innerHTML = ''; }, 2400);
}
// ---------------- Popup โฆษณา (เฉพาะลูกค้า ตอนล็อกอิน) ----------------
let adShown = false;
function closeAd() { const h = document.getElementById('modal-host'); if (h) h.innerHTML = ''; }
function showAdPopup() {
  const url = S.settings && S.settings.adImage;
  if (!url) return;
  const host = document.getElementById('modal-host');
  host.innerHTML = `
  <div class="ad-backdrop" style="position:absolute;inset:0;z-index:90;background:rgba(5,4,9,.8);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:28px;animation:fs-fade .25s ease">
    <div style="position:relative;width:100%;max-width:320px;animation:fs-pop .35s ease">
      <img src="${esc(url)}" alt="โฆษณา" style="width:100%;border-radius:18px;border:1px solid rgba(255,255,255,.15);box-shadow:0 24px 60px -18px rgba(124,58,237,.85);display:block">
      <button class="ad-close" style="position:absolute;top:-13px;right:-6px;width:34px;height:34px;border-radius:50%;background:#1a1626;border:1px solid rgba(255,255,255,.2);color:#f2eefb;font-size:17px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.5);cursor:pointer">✕</button>
    </div>
  </div>`;
  const bd = host.querySelector('.ad-backdrop');
  bd.onclick = (e) => { if (e.target === bd) closeAd(); };
  host.querySelector('.ad-close').onclick = closeAd;
}
function maybeShowAd() {
  if (adShown) return;
  if (!(S.user && S.user.role !== 'admin')) return;             // เฉพาะลูกค้า ไม่ใช่แอดมิน
  if (!(S.settings && S.settings.adEnabled && S.settings.adImage)) return;
  adShown = true;
  showAdPopup();
}
const savedMeta = (kind) => kind === 'home' ? { emoji: '🏠', iconBg: 'rgba(139,92,246,.2)' } : kind === 'work' ? { emoji: '💼', iconBg: 'rgba(192,38,211,.2)' } : { emoji: '📍', iconBg: 'rgba(79,70,229,.22)' };
const kindFromLabel = (l) => l === 'บ้าน' ? 'home' : (l === 'ที่ทำงาน' ? 'work' : 'other');
const productById = (id) => S.products.find((p) => p.id === id);
const stockOf = (id) => { const p = productById(id); return p ? (p.stock || 0) : 0; };
function stockLabel(p) {
  const s = p.stock || 0;
  if (s <= 0) return { text: 'สินค้าหมด', color: '#f87171' };
  if (s <= 5) return { text: 'เหลือ ' + s + ' ชิ้น', color: '#fbbf24' };
  return { text: 'พร้อมส่ง · เหลือ ' + s, color: '#34d399' };
}
function productMedia(p, h) {
  h = h || 74;
  return p.image
    ? `<div style="height:${h}px;border-radius:12px;overflow:hidden;background:#0f0c18"><img src="${esc(p.image)}" style="width:100%;height:100%;object-fit:cover" alt=""></div>`
    : `<div style="height:${h}px;border-radius:12px;background:rgba(139,92,246,.1);display:flex;align-items:center;justify-content:center;font-size:38px">${esc(p.emoji || '🛍️')}</div>`;
}
// ---------------- แผนที่จริง (Leaflet + OpenStreetMap/CARTO, ฟรี ไม่ต้องใช้ API key) ----------------
function purpleDivIcon() {
  return L.divIcon({
    className: 'fs-leaflet-pin',
    html: '<svg width="38" height="46" viewBox="0 0 24 30" fill="none"><path d="M12 0C6 0 1.5 4.5 1.5 10.5C1.5 18 12 30 12 30S22.5 18 22.5 10.5C22.5 4.5 18 0 12 0Z" fill="#8b5cf6" stroke="#fff" stroke-width="1.4"></path><circle cx="12" cy="10.5" r="4" fill="#fff"></circle></svg>',
    iconSize: [38, 46], iconAnchor: [19, 46]
  });
}
function switchTileLayer() {
  if (!leafletMap) return;
  if (leafletTile) leafletMap.removeLayer(leafletTile);
  const style = TILE_STYLES[S.mapStyle] || TILE_STYLES.violet;
  leafletTile = L.tileLayer(style.url, { subdomains: 'abcd', maxZoom: 19, detectRetina: true, attribution: style.attribution }).addTo(leafletMap);
}
function updateStyleButtons(root) {
  const map = { violet: 'styleViolet', mono: 'styleMono', night: 'styleNight' };
  for (const s in map) { const btn = root.querySelector(`[data-act="${map[s]}"]`); if (btn) btn.style.borderColor = S.mapStyle === s ? '#fff' : 'rgba(255,255,255,.35)'; }
}
function updateLabelButtons(root) {
  const lbl = (a) => a ? { bg: 'rgba(139,92,246,.22)', fg: '#c4b5fd', bd: 'rgba(139,92,246,.55)' } : { bg: '#0f0c18', fg: '#9a90b0', bd: 'rgba(255,255,255,.08)' };
  const map = { labelHome: 'บ้าน', labelWork: 'ที่ทำงาน', labelOther: 'อื่นๆ' };
  for (const act in map) {
    const btn = root.querySelector(`[data-act="${act}"]`);
    if (!btn) continue;
    const s = lbl(S.addrLabel === map[act]);
    btn.style.background = s.bg; btn.style.color = s.fg; btn.style.borderColor = s.bd;
  }
}
function patchAddrText(text) { const el = document.querySelector('.map-addr'); if (el) el.textContent = text; }
function scheduleReverseGeocode(lat, lng) {
  S.addrLoading = true;
  patchAddrText('กำลังค้นหาที่อยู่...');
  clearTimeout(geocodeTimer);
  const myReq = ++geocodeReqId;
  geocodeTimer = setTimeout(async () => {
    let addr;
    try { const r = await API.get('/api/geocode/reverse?lat=' + lat + '&lng=' + lng); addr = r.address; } catch {}
    if (myReq !== geocodeReqId) return;
    S.currentAddr = addr || (lat.toFixed(5) + ', ' + lng.toFixed(5));
    S.addrLoading = false;
    patchAddrText(S.currentAddr);
  }, 600);
}
function setPin(lat, lng, fly) {
  S.pinLat = lat; S.pinLng = lng;
  if (fly && leafletMap) leafletMap.flyTo([lat, lng], Math.max(leafletMap.getZoom(), 16));
  scheduleReverseGeocode(lat, lng);
}
function locateAndCenter(showToast) {
  if (!navigator.geolocation) { toast('เบราว์เซอร์นี้ไม่รองรับ GPS'); return; }
  if (showToast) toast('กำลังค้นหาตำแหน่ง GPS...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (leafletMarker) leafletMarker.setLatLng([latitude, longitude]);
      setPin(latitude, longitude, true);
      if (showToast) toast('ปักหมุดที่ตำแหน่งของคุณแล้ว');
    },
    () => toast('ไม่สามารถเข้าถึงตำแหน่งได้ กรุณาอนุญาตการเข้าถึงตำแหน่ง'),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}
function initLeafletMap(root) {
  const container = root.querySelector('#leaflet-map');
  if (!container || typeof L === 'undefined') return;
  const startLat = S.pinLat != null ? S.pinLat : CHUMPHON_CENTER.lat;
  const startLng = S.pinLng != null ? S.pinLng : CHUMPHON_CENTER.lng;
  leafletMap = L.map(container, { zoomControl: false, attributionControl: true }).setView([startLat, startLng], S.pinLat != null ? 16 : 14);
  switchTileLayer();
  leafletMarker = L.marker([startLat, startLng], { draggable: true, icon: purpleDivIcon() }).addTo(leafletMap);
  leafletMarker.on('dragend', () => { const ll = leafletMarker.getLatLng(); setPin(ll.lat, ll.lng, false); });
  leafletMap.on('click', (e) => { leafletMarker.setLatLng(e.latlng); setPin(e.latlng.lat, e.latlng.lng, false); });
  // แก้บั๊กที่ Leaflet คำนวณขนาด container ผิดตอนสร้างครั้งแรก (มักเกิดเพราะ container ยังไม่มีขนาดจริงตอนนั้น) — วัดใหม่แล้วปักกึ่งกลางซ้ำ
  setTimeout(() => { if (leafletMap) { leafletMap.invalidateSize(); leafletMap.setView([startLat, startLng], leafletMap.getZoom()); } }, 0);
  updateStyleButtons(root);
  if (S.wantsGeoLocate) { S.wantsGeoLocate = false; locateAndCenter(true); }
  else { S.pinLat = startLat; S.pinLng = startLng; scheduleReverseGeocode(startLat, startLng); }
}
function renderAdminMiniMap(root, lat, lng) {
  const container = root.querySelector('#admin-mini-map');
  if (!container || typeof L === 'undefined' || lat == null || lng == null) return;
  if (adminMiniMapInst) { adminMiniMapInst.remove(); adminMiniMapInst = null; }
  adminMiniMapInst = L.map(container, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: false }).setView([lat, lng], 16);
  L.tileLayer(TILE_STYLES.violet.url, { subdomains: 'abcd', maxZoom: 19, detectRetina: true }).addTo(adminMiniMapInst);
  L.marker([lat, lng], { icon: purpleDivIcon() }).addTo(adminMiniMapInst);
  setTimeout(() => { if (adminMiniMapInst) { adminMiniMapInst.invalidateSize(); adminMiniMapInst.setView([lat, lng], 16); } }, 0);
}
function phoneMask(phone) {
  const p = phone.replace(/\D/g, '');
  if (!p) return '+66 8X-XXX-XXXX';
  return '+66 ' + p.replace(/^0/, '').slice(0, 2) + 'X-XXX-' + (p.slice(-3) || 'XXX');
}
const fmtDate = (t) => { const d = new Date(t); return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); };

// ---------------- Cart ----------------
function saveCart() { localStorage.setItem('fs_cart', JSON.stringify(S.cart)); }
function cartCount() { return S.cart.reduce((n, i) => n + i.qty, 0); }
function cartLines() { return S.cart.map((i) => { const p = productById(i.productId); return p ? { ...p, qty: i.qty, line: p.price * i.qty } : null; }).filter(Boolean); }
function cartSubtotal() { return cartLines().reduce((s, l) => s + l.line, 0); }
function cartFee() { const qty = cartCount(); return (qty === 0 || qty >= (S.settings.freeQty || 2)) ? 0 : (S.settings.deliveryFee || 0); }
function cartTotal() { return cartSubtotal() + cartFee(); }
function addToCart(id) {
  const stock = stockOf(id);
  const it = S.cart.find((i) => i.productId === id);
  const cur = it ? it.qty : 0;
  if (cur + 1 > stock) { toast('คงเหลือไม่พอ (เหลือ ' + stock + ')'); return false; }
  if (it) it.qty += 1; else S.cart.push({ productId: id, qty: 1 });
  saveCart(); return true;
}
function setQty(id, delta) {
  const it = S.cart.find((i) => i.productId === id);
  if (!it) return;
  if (delta > 0 && it.qty + 1 > stockOf(id)) { toast('คงเหลือไม่พอ'); return; }
  it.qty += delta;
  if (it.qty <= 0) S.cart = S.cart.filter((i) => i.productId !== id);
  saveCart();
}

// ---------------- Icons ----------------
const IC = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>',
  pin: (c, w) => `<svg width="${w || 14}" height="${w || 14}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"></path><circle cx="12" cy="10" r="2.4"></circle></svg>`,
  chevron: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5c5470" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg>'
};
function lineButton(label) {
  return `<button data-act="lineLogin" style="height:52px;border-radius:15px;background:#06C755;color:#fff;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:10px">
    <span style="background:#fff;color:#06C755;font-weight:800;border-radius:6px;padding:1px 7px;font-size:13px;line-height:1.4">LINE</span>${label}</button>`;
}
const LOGO = 'assets/logo.png';
const BANNER = 'assets/banner.jpg';

// ================================================================
// Async actions
// ================================================================
async function loadUserData() {
  try {
    const [a, p, o] = await Promise.all([API.get('/api/addresses'), API.get('/api/products'), API.get('/api/orders')]);
    S.saved = a.addresses || []; S.products = p.products || []; S.orders = o.orders || [];
  } catch {}
}
async function loadProducts() { try { const p = await API.get('/api/products'); S.products = p.products || []; } catch {} }
async function loadSettings() { try { const s = await API.get('/api/settings'); if (s.settings) S.settings = s.settings; } catch {} }
async function saveProfile() {
  if (S.busy) return;
  if (!S.pfName.trim()) return toast('กรุณากรอกชื่อ');
  S.busy = true;
  try {
    const r = await API.post('/api/me/update', { fullname: S.pfName, phone: S.pfPhone, avatarData: S.pfAvatarData || undefined });
    S.user = r.user; S.pfAvatarData = '';
    S.screen = 'home'; render(); toast('บันทึกโปรไฟล์แล้ว ✓');
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}
async function uploadSlip(orderId, imageData) {
  try { await API.post('/api/orders/slip', { orderId, imageData }); await loadUserData(); render(); toast('อัปโหลดสลิปแล้ว ✓ รอร้านตรวจสอบ'); }
  catch (e) { toast(e.message); }
}
async function adminSaveAd(body) {
  try { const r = await API.post('/api/admin/settings', body); S.settings = r.settings; render(); toast('อัปเดตโฆษณาแล้ว ✓'); }
  catch (e) { toast(e.message); }
}
async function adminSaveSettings() {
  if (S.busy) return; S.busy = true;
  try {
    const body = {};
    if (S.setDeliveryFee !== '') body.deliveryFee = Number(S.setDeliveryFee);
    if (S.setFreeQty !== '') body.freeQty = Number(S.setFreeQty);
    const r = await API.post('/api/admin/settings', body);
    S.settings = r.settings; S.setDeliveryFee = ''; S.setFreeQty = '';
    render(); toast('บันทึกค่าจัดส่งแล้ว ✓');
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}
async function doRegister() {
  if (S.busy) return;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(S.email.trim());
  const ok = S.fullname.trim() && S.phone.replace(/\D/g, '').length >= 9 && emailOk && S.password.length >= 6;
  if (!ok) return toast(emailOk ? 'กรุณากรอกข้อมูลให้ครบถ้วน' : 'กรุณากรอกอีเมลให้ถูกต้อง');
  S.busy = true;
  try {
    const r = await API.post('/api/auth/register', { fullname: S.fullname, phone: S.phone, email: S.email, password: S.password });
    S.devCode = r.devCode || ''; S.otpEmail = r.email || S.email.trim(); S.otp = ['', '', '', '']; S.screen = 'otp'; render();
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}
async function verifyOtp() {
  if (S.busy) return;
  if (S.otp.join('').length !== 4) return toast('กรอกรหัสให้ครบ 4 หลัก');
  S.busy = true;
  try {
    const r = await API.post('/api/auth/otp/verify', { phone: S.phone, code: S.otp.join('') });
    API.setToken(r.token); S.user = r.user; toast('ยืนยันสำเร็จ 🎉');
    await loadUserData();
    setTimeout(() => { S.screen = 'home'; render(); maybeShowAd(); }, 500);
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}
async function resendOtp() { try { const r = await API.post('/api/auth/otp/resend', { phone: S.phone }); S.devCode = r.devCode || ''; if (r.email) S.otpEmail = r.email; toast('ส่งรหัสใหม่แล้ว'); render(); } catch (e) { toast(e.message); } }
async function doLogin() {
  if (S.busy) return; S.busy = true;
  try {
    const r = await API.post('/api/auth/login', { phone: S.loginPhone, password: S.loginPassword });
    API.setToken(r.token); S.user = r.user;
    await afterLogin();
  } catch (e) {
    if (e.status === 403 && e.data && e.data.needOtp) { S.phone = e.data.phone; S.devCode = e.data.devCode || ''; S.otpEmail = e.data.email || ''; S.otp = ['', '', '', '']; S.screen = 'otp'; render(); toast('กรุณายืนยันอีเมลก่อน'); }
    else toast(e.message);
  } finally { S.busy = false; }
}
async function afterLogin() {
  if (S.user.role === 'admin') { await adminLoad(); S.screen = 'admin'; }
  else { await loadUserData(); S.screen = 'home'; }
  render();
  maybeShowAd();
}
function lineLogin() { window.location.href = '/api/auth/line/login'; }
async function saveAddress() {
  if (S.busy) return;
  if (S.pinLat == null || S.pinLng == null) return toast('กรุณาปักหมุดตำแหน่งก่อน');
  S.busy = true;
  const base = S.currentAddr || (S.pinLat.toFixed(5) + ', ' + S.pinLng.toFixed(5));
  const text = base + (S.addrDetail.trim() ? (' (' + S.addrDetail.trim() + ')') : '');
  try {
    const r = await API.post('/api/addresses', { label: S.addrLabel, kind: kindFromLabel(S.addrLabel), text, detail: S.addrDetail.trim(), lat: S.pinLat, lng: S.pinLng });
    S.addrDetail = ''; await loadUserData();
    if (S.fromCheckout) { S.fromCheckout = false; S.checkoutAddressId = r.address.id; S.screen = 'checkout'; } else S.screen = 'saved';
    render(); toast('บันทึกที่อยู่แล้ว ✓');
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}
async function deleteAddress(id) { try { await API.del('/api/addresses', { id }); await loadUserData(); render(); toast('ลบที่อยู่แล้ว'); } catch (e) { toast(e.message); } }
async function placeOrder() {
  if (S.busy) return;
  if (!S.cart.length) return toast('ตะกร้าว่าง');
  if (!S.checkoutAddressId) return toast('กรุณาเลือกที่อยู่จัดส่ง');
  S.busy = true;
  try {
    await API.post('/api/orders', { items: S.cart.map((i) => ({ productId: i.productId, qty: i.qty })), addressId: S.checkoutAddressId, payment: { method: S.payMethod, note: S.orderNote } });
    S.cart = []; saveCart(); S.orderNote = '';
    await loadUserData(); S.screen = 'orders'; render();
    toast('สั่งซื้อสำเร็จ 🎉 กำลังจัดเตรียม');
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}
async function refreshOrders() { await loadUserData(); render(); toast('อัปเดตแล้ว'); }
// admin
async function adminLoad() { try { const [o, p] = await Promise.all([API.get('/api/admin/orders'), API.get('/api/products')]); S.adminOrders = o.orders || []; S.products = p.products || []; } catch (e) { toast(e.message); } }
async function adminAddProduct() {
  if (S.busy) return;
  if (!S.npName.trim()) return toast('กรอกชื่อสินค้า');
  if (!(Number(S.npPrice) >= 0)) return toast('กรอกราคาให้ถูกต้อง');
  S.busy = true;
  try {
    await API.post('/api/admin/products', { name: S.npName, desc: S.npDesc, price: Number(S.npPrice), emoji: S.npEmoji, tag: S.npTag, stock: Number(S.npStock) || 0, imageData: S.npImageData || undefined });
    S.npName = ''; S.npDesc = ''; S.npPrice = ''; S.npTag = ''; S.npEmoji = '🛍️'; S.npStock = ''; S.npImageData = ''; S.npImageName = '';
    await adminLoad(); render(); toast('เพิ่มสินค้าแล้ว ✓');
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}
async function adminDeleteProduct(id) { try { await API.del('/api/admin/products', { id }); await adminLoad(); render(); toast('ลบสินค้าแล้ว'); } catch (e) { toast(e.message); } }
async function adminSetStatus(id, status) { try { await API.post('/api/admin/orders/status', { id, status }); await adminLoad(); render(); toast('อัปเดตสถานะแล้ว'); } catch (e) { toast(e.message); } }
async function adminSetStock(id, stock) { try { await API.post('/api/admin/products/stock', { id, stock: Number(stock) || 0 }); await adminLoad(); render(); toast('ปรับสต็อกแล้ว'); } catch (e) { toast(e.message); } }
async function adminSetImage(id, imageData) { try { await API.post('/api/admin/products/image', { id, imageData }); await adminLoad(); render(); toast('อัปเดตรูปแล้ว ✓'); } catch (e) { toast(e.message); } }

// ================================================================
// Screens
// ================================================================
function topbar(title, backAct) {
  return `<div style="padding:52px 20px 18px;background:linear-gradient(135deg,#3d2b6b,#1c1630);display:flex;align-items:center;gap:14px">
    ${backAct ? `<button data-act="${backAct}" style="width:38px;height:38px;border-radius:12px;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center">${IC.back}</button>` : ''}
    <span style="color:#fff;font-size:19px;font-weight:600">${esc(title)}</span></div>`;
}
function screenWelcome() {
  return `
  <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 22%,#3a2a63 0%,#1a1430 45%,#0b0912 100%);display:flex;flex-direction:column;animation:fs-fade .4s ease">
    <div style="position:absolute;top:-40px;right:-40px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,.35),transparent 70%);animation:fs-glow 4s ease-in-out infinite"></div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 34px;text-align:center;position:relative">
      <img src="${LOGO}" alt="FLASH SMOKE" style="width:270px;max-width:86%;filter:drop-shadow(0 18px 40px rgba(124,58,237,.55));animation:fs-pop .5s ease">
    </div>
    <div style="padding:0 26px 42px;display:flex;flex-direction:column;gap:11px;position:relative">
      <button data-act="goRegister" style="height:54px;border-radius:16px;background:${BTN};color:#fff;font-size:16px;font-weight:600;box-shadow:0 16px 30px -12px rgba(124,58,237,.9)">สมัครสมาชิก</button>
      ${lineButton('เข้าสู่ระบบด้วย LINE')}
      <button data-act="goLogin" style="height:44px;color:#b6acce;font-size:14px;font-weight:500;text-decoration:underline;text-underline-offset:3px">เข้าสู่ระบบด้วยเบอร์โทร</button>
    </div>
  </div>`;
}
function screenRegister() {
  const ok = S.fullname.trim() && S.phone.replace(/\D/g, '').length >= 9 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(S.email.trim()) && S.password.length >= 6;
  return `
  <div style="position:absolute;inset:0;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('สร้างบัญชีใหม่', 'goWelcome')}
    <div style="flex:1;overflow-y:auto;padding:26px 22px 24px">
      <div style="font-size:22px;font-weight:600;color:#f2eefb">ยินดีต้อนรับ 👋</div>
      <div style="font-size:14px;color:#9a90b0;margin-top:4px">กรอกข้อมูลเพื่อเริ่ม${TAGLINE}</div>
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:24px 0 7px">ชื่อ - นามสกุล</label>
      <input data-model="fullname" placeholder="กรอกชื่อ - นามสกุล" style="width:100%;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;font-size:15px;color:#f2eefb;outline:none">
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:18px 0 7px">เบอร์โทรศัพท์</label>
      <div style="display:flex;align-items:center;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;gap:10px">
        <span style="font-size:15px;color:#9a90b0;font-weight:500;border-right:1px solid rgba(255,255,255,.12);padding-right:10px">+66</span>
        <input data-model="phone" inputmode="numeric" placeholder="08X-XXX-XXXX" style="flex:1;border:none;outline:none;font-size:15px;color:#f2eefb;background:none;height:100%">
      </div>
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:18px 0 7px">อีเมล <span style="color:#6a6280;font-weight:400">(สำหรับรับรหัส OTP)</span></label>
      <input data-model="email" type="email" inputmode="email" placeholder="you@example.com" style="width:100%;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;font-size:15px;color:#f2eefb;outline:none">
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:18px 0 7px">ตั้งรหัสผ่าน</label>
      <input data-model="password" type="password" placeholder="อย่างน้อย 6 ตัวอักษร" style="width:100%;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;font-size:15px;color:#f2eefb;outline:none">
      <div style="display:flex;align-items:center;gap:9px;margin-top:20px;font-size:12.5px;color:#9a90b0;line-height:1.5">
        <span style="width:20px;height:20px;border-radius:6px;background:rgba(139,92,246,.18);display:flex;align-items:center;justify-content:center;flex:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg></span>
        ยอมรับ<span style="color:#a78bfa;font-weight:500">เงื่อนไขการใช้งาน</span>และนโยบายความเป็นส่วนตัว
      </div>
    </div>
    <div style="padding:12px 22px 30px">
      <button data-act="doRegister" style="width:100%;height:54px;border-radius:16px;background:${ok ? BTN : BTN_OFF};color:#fff;font-size:16px;font-weight:600;box-shadow:0 14px 26px -14px rgba(124,58,237,.9);transition:.2s">ขอรหัส OTP</button>
    </div>
  </div>`;
}
function screenLogin() {
  return `
  <div style="position:absolute;inset:0;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('เข้าสู่ระบบ', 'goWelcome')}
    <div style="flex:1;padding:30px 22px">
      <div style="font-size:22px;font-weight:600;color:#f2eefb">ยินดีต้อนรับกลับ 👋</div>
      <div style="font-size:14px;color:#9a90b0;margin-top:4px">เข้าสู่ระบบด้วยเบอร์และรหัสผ่าน หรือ LINE</div>
      <div style="margin:18px 0">${lineButton('เข้าสู่ระบบด้วย LINE')}</div>
      <div style="display:flex;align-items:center;gap:10px;color:#5c5470;font-size:12px;margin:6px 0 14px"><span style="flex:1;height:1px;background:rgba(255,255,255,.08)"></span>หรือ<span style="flex:1;height:1px;background:rgba(255,255,255,.08)"></span></div>
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:0 0 7px">เบอร์โทรศัพท์</label>
      <div style="display:flex;align-items:center;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;gap:10px">
        <span style="font-size:15px;color:#9a90b0;font-weight:500;border-right:1px solid rgba(255,255,255,.12);padding-right:10px">+66</span>
        <input data-model="loginPhone" inputmode="numeric" placeholder="08X-XXX-XXXX" style="flex:1;border:none;outline:none;font-size:15px;color:#f2eefb;background:none;height:100%">
      </div>
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:16px 0 7px">รหัสผ่าน</label>
      <input data-model="loginPassword" type="password" placeholder="รหัสผ่าน" style="width:100%;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;font-size:15px;color:#f2eefb;outline:none">
    </div>
    <div style="padding:12px 22px 30px">
      <button data-act="doLogin" style="width:100%;height:54px;border-radius:16px;background:${BTN};color:#fff;font-size:16px;font-weight:600;box-shadow:0 14px 26px -14px rgba(124,58,237,.9)">เข้าสู่ระบบ</button>
    </div>
  </div>`;
}
function screenOtp() {
  const done = S.otp.join('').length === 4;
  const hint = S.devCode ? `รหัส (โหมดทดสอบ): <span style="color:#a78bfa;font-weight:600">${esc(S.devCode)}</span>` : 'กรุณาตรวจสอบกล่องอีเมล (รวมถึงโฟลเดอร์สแปม)';
  return `
  <div style="position:absolute;inset:0;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('ยืนยันอีเมล', 'goRegister')}
    <div style="flex:1;padding:36px 26px;display:flex;flex-direction:column">
      <div style="width:64px;height:64px;border-radius:20px;background:rgba(139,92,246,.16);display:flex;align-items:center;justify-content:center;margin-bottom:22px"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"></rect><path d="M11 18h2"></path></svg></div>
      <div style="font-size:22px;font-weight:600;color:#f2eefb">ใส่รหัส 4 หลัก</div>
      <div style="font-size:14px;color:#9a90b0;margin-top:6px;line-height:1.5">เราส่งรหัสไปที่อีเมล <span style="color:#f2eefb;font-weight:500">${esc(S.otpEmail || 'อีเมลของคุณ')}</span><br>${hint}</div>
      <div style="display:flex;gap:12px;margin-top:30px">
        ${[0, 1, 2, 3].map((i) => `<input data-otp="${i}" inputmode="numeric" maxlength="1" style="width:60px;height:68px;border-radius:16px;border:1.5px solid rgba(255,255,255,.12);background:#1a1626;text-align:center;font-size:26px;font-weight:600;color:#f2eefb;outline:none">`).join('')}
      </div>
      <div style="margin-top:22px;font-size:13.5px;color:#9a90b0">ไม่ได้รับรหัส? <span data-act="resendOtp" style="color:#a78bfa;font-weight:600;cursor:pointer">ส่งอีกครั้ง</span></div>
      <div style="flex:1"></div>
      <button data-act="verifyOtp" style="width:100%;height:54px;border-radius:16px;background:${done ? BTN : BTN_OFF};color:#fff;font-size:16px;font-weight:600;box-shadow:0 14px 26px -14px rgba(124,58,237,.9);transition:.2s">ยืนยัน</button>
    </div>
  </div>`;
}
function screenHome() {
  const name = (S.user && S.user.fullname) || 'ลูกค้า FLASH SMOKE';
  const avatar = S.user && S.user.avatar
    ? `<img src="${esc(S.user.avatar)}" style="width:42px;height:42px;border-radius:13px;object-fit:cover" alt="">`
    : `<div style="width:42px;height:42px;border-radius:13px;background:rgba(139,92,246,.18);display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.8"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"></path></svg></div>`;
  const tiles = S.products.length ? S.products.map((p) => {
    const sl = stockLabel(p); const out = (p.stock || 0) <= 0;
    return `
    <div style="border-radius:16px;background:linear-gradient(160deg,#231d38,#1a1626);border:1px solid rgba(255,255,255,.06);padding:14px;display:flex;flex-direction:column;gap:6px">
      ${productMedia(p)}
      <div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;font-weight:600;color:#f2eefb">${esc(p.name)}</span>${p.tag ? `<span style="font-size:10px;color:#c4b5fd;background:rgba(139,92,246,.2);padding:1px 6px;border-radius:6px">${esc(p.tag)}</span>` : ''}</div>
      <div style="font-size:12px;color:#9a90b0">${esc(p.desc || '')}</div>
      <div style="font-size:11px;font-weight:600;color:${sl.color}">● ${sl.text}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px">
        <span style="font-size:15px;font-weight:700;color:#a78bfa">฿${esc(p.price)}</span>
        ${out ? `<span style="padding:6px 12px;border-radius:10px;background:#241f33;color:#6a6280;font-size:12px;font-weight:600">หมด</span>`
              : `<button data-act="addCart" data-id="${esc(p.id)}" style="padding:6px 12px;border-radius:10px;background:${BTN};color:#fff;font-size:12px;font-weight:600">＋ ตะกร้า</button>`}
      </div>
    </div>`;
  }).join('') : `<div style="grid-column:1/-1;text-align:center;color:#6a6280;font-size:13px;padding:20px">กำลังโหลดเมนู...</div>`;
  return `
  <div style="position:absolute;inset:0;bottom:76px;overflow-y:auto;background:#0d0b15;animation:fs-fade .3s ease">
    <div style="padding:46px 20px 46px;background:linear-gradient(135deg,#3d2b6b,#1c1630);border-radius:0 0 26px 26px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <img src="${LOGO}" alt="FLASH SMOKE" style="height:44px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.4))">
        <button data-act="logout" style="padding:0 14px;height:34px;border-radius:17px;border:1px solid rgba(255,255,255,.35);color:#fff;font-size:12px;font-weight:600">ออกจากระบบ</button>
      </div>
    </div>
    <button data-act="goProfile" style="width:calc(100% - 32px);text-align:left;margin:-30px 16px 0;background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:12px">
      ${avatar}
      <div style="line-height:1.3;flex:1"><div style="font-size:12px;color:#9a90b0">สวัสดี · แตะเพื่อแก้ไขโปรไฟล์</div><div style="font-size:15px;font-weight:600;color:#f2eefb">${esc(name)}</div></div>
      <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:#a78bfa;font-weight:500">${IC.pin('#a78bfa')}ชุมพร</div>
    </button>
    <div style="margin:16px 16px 0;height:150px;border-radius:18px;background:#14101f url('${BANNER}') center/cover;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:0 22px">
      <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,9,18,.82) 30%,rgba(11,9,18,.15) 100%)"></div>
      <div style="color:#fff;font-size:24px;font-weight:700;line-height:1.15;position:relative;text-shadow:0 2px 8px rgba(0,0,0,.6)">พร้อมส่ง<br>แล้ววันนี้</div>
      <div style="color:rgba(255,255,255,.92);font-size:13px;margin-top:8px;position:relative;text-shadow:0 1px 4px rgba(0,0,0,.6)">${TAGLINE} · ส่งฟรีเมื่อสั่งครบ ${S.settings.freeQty || 2} ตัว</div>
    </div>
    <div style="padding:20px 16px 8px;font-size:16px;font-weight:600;color:#f2eefb">เมนูแนะนำ</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 16px">${tiles}</div>
    <div style="margin:14px 16px 8px;background:linear-gradient(135deg,#231d38,#1a1626);border:1px solid rgba(139,92,246,.25);border-radius:16px;padding:16px;display:flex;align-items:center;gap:14px">
      <div style="width:46px;height:46px;border-radius:14px;background:${BTN};display:flex;align-items:center;justify-content:center;flex:none">${IC.pin('#fff', 24)}</div>
      <div style="flex:1;line-height:1.35"><div style="font-size:15px;font-weight:600;color:#f2eefb">ตั้งค่าที่อยู่จัดส่ง</div><div style="font-size:12.5px;color:#9a90b0">ปักหมุดตำแหน่ง แล้วบันทึกไว้ใช้ครั้งต่อไป</div></div>
      <button data-act="goMethod" style="padding:9px 15px;border-radius:12px;background:rgba(139,92,246,.2);color:#c4b5fd;font-size:13px;font-weight:600">เริ่ม</button>
    </div>
  </div>`;
}
function methodRow(act, grad, icon, title, sub) {
  return `<button data-act="${act}" style="text-align:left;background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:18px;display:flex;align-items:center;gap:15px">
    <span style="width:52px;height:52px;border-radius:15px;background:${grad};display:flex;align-items:center;justify-content:center;flex:none">${icon}</span>
    <span style="flex:1"><span style="display:block;font-size:16px;font-weight:600;color:#f2eefb">${title}</span><span style="display:block;font-size:12.5px;color:#9a90b0;margin-top:2px">${sub}</span></span>${IC.chevron}</button>`;
}
function screenMethod() {
  const gps = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>';
  const map = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"></path><path d="M9 4v14M15 6v14"></path></svg>';
  const book = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>';
  return `
  <div style="position:absolute;inset:0;bottom:76px;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('เลือกที่อยู่จัดส่ง', S.fromCheckout ? 'goCheckout' : 'goHome')}
    <div style="padding:28px 18px;display:flex;flex-direction:column;gap:14px">
      ${methodRow('useCurrentThenMap', 'linear-gradient(135deg,#a78bfa,#7c3aed)', gps, 'เลือกจากตำแหน่งปัจจุบัน', 'ใช้ GPS ปักหมุดให้อัตโนมัติ')}
      ${methodRow('goMap', 'linear-gradient(135deg,#f0abfc,#c026d3)', map, 'เลือกจากแผนที่', 'ลากหมุดเลือกจุดส่งเอง')}
      ${methodRow('goSaved', 'linear-gradient(135deg,#818cf8,#4f46e5)', book, 'เลือกจากที่บันทึกไว้', S.saved.length + ' ที่อยู่')}
    </div>
  </div>`;
}
function screenMap() {
  const bd = (s) => S.mapStyle === s ? '#fff' : 'rgba(255,255,255,.35)';
  const lbl = (a) => a ? { bg: 'rgba(139,92,246,.22)', fg: '#c4b5fd', bd: 'rgba(139,92,246,.55)' } : { bg: '#0f0c18', fg: '#9a90b0', bd: 'rgba(255,255,255,.08)' };
  const lh = lbl(S.addrLabel === 'บ้าน'), lw = lbl(S.addrLabel === 'ที่ทำงาน'), lo = lbl(S.addrLabel === 'อื่นๆ');
  const addrText = S.addrLoading ? 'กำลังค้นหาที่อยู่...' : (S.currentAddr || 'แตะบนแผนที่เพื่อปักหมุด');
  return `
  <div style="position:absolute;inset:0;bottom:76px;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('ปักหมุดตำแหน่ง', 'goMethod')}
    <div style="position:relative;flex:1;overflow:hidden;background:#14101f">
      <div id="leaflet-map" style="position:absolute;inset:0"></div>
      <div style="position:absolute;top:12px;right:12px;display:flex;flex-direction:column;gap:8px;z-index:1000">
        <button data-act="styleViolet" style="width:38px;height:38px;border-radius:11px;border:2px solid ${bd('violet')};background:linear-gradient(135deg,#3a2f5c,#7c3aed);box-shadow:0 4px 10px rgba(0,0,0,.4)"></button>
        <button data-act="styleMono" style="width:38px;height:38px;border-radius:11px;border:2px solid ${bd('mono')};background:linear-gradient(135deg,#3a3a3a,#8a8a8a);box-shadow:0 4px 10px rgba(0,0,0,.4)"></button>
        <button data-act="styleNight" style="width:38px;height:38px;border-radius:11px;border:2px solid ${bd('night')};background:linear-gradient(135deg,#0b1024,#20306b);box-shadow:0 4px 10px rgba(0,0,0,.4)"></button>
      </div>
      <button data-act="useCurrent" style="position:absolute;right:14px;bottom:16px;width:48px;height:48px;border-radius:14px;background:#1a1626;border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,.5);z-index:1000"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg></button>
      <div style="position:absolute;left:14px;bottom:16px;background:rgba(13,11,21,.82);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:8px 12px;font-size:11.5px;color:#c4b5fd;font-weight:500;z-index:1000;pointer-events:none">แตะหรือลากหมุดเพื่อเลือกตำแหน่ง</div>
    </div>
    <div style="background:#161221;border-radius:22px 22px 0 0;border-top:1px solid rgba(255,255,255,.08);padding:14px 20px 18px;box-shadow:0 -12px 30px rgba(0,0,0,.4);z-index:20">
      <div style="width:40px;height:4px;border-radius:2px;background:#39304d;margin:0 auto 14px"></div>
      <div style="display:flex;align-items:flex-start;gap:11px">
        <div style="width:36px;height:36px;border-radius:11px;background:rgba(139,92,246,.18);display:flex;align-items:center;justify-content:center;flex:none;margin-top:2px">${IC.pin('#a78bfa', 19)}</div>
        <div style="flex:1;line-height:1.4"><div style="font-size:12px;color:#9a90b0">ตำแหน่งที่เลือก</div><div class="map-addr" style="font-size:14px;font-weight:500;color:#f2eefb">${esc(addrText)}</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button data-act="labelHome" style="flex:1;height:38px;border-radius:11px;font-size:13px;font-weight:500;background:${lh.bg};color:${lh.fg};border:1px solid ${lh.bd}">🏠 บ้าน</button>
        <button data-act="labelWork" style="flex:1;height:38px;border-radius:11px;font-size:13px;font-weight:500;background:${lw.bg};color:${lw.fg};border:1px solid ${lw.bd}">💼 ที่ทำงาน</button>
        <button data-act="labelOther" style="flex:1;height:38px;border-radius:11px;font-size:13px;font-weight:500;background:${lo.bg};color:${lo.fg};border:1px solid ${lo.bd}">📍 อื่นๆ</button>
      </div>
      <input data-model="addrDetail" placeholder="รายละเอียดเพิ่มเติม เช่น ตึก B ชั้น 3, จุดสังเกต" style="width:100%;height:46px;border-radius:12px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none;margin-top:10px">
      <button data-act="saveAddr" style="width:100%;height:52px;border-radius:15px;background:${BTN};color:#fff;font-size:16px;font-weight:600;box-shadow:0 12px 24px -12px rgba(124,58,237,.9);margin-top:12px">บันทึกที่อยู่นี้</button>
    </div>
  </div>`;
}
function screenSaved() {
  const rows = S.saved.length ? S.saved.map((a) => {
    const m = savedMeta(a.kind);
    return `<div style="background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px;display:flex;align-items:flex-start;gap:13px;margin-bottom:12px">
      <div style="width:44px;height:44px;border-radius:13px;background:${m.iconBg};display:flex;align-items:center;justify-content:center;flex:none;font-size:20px">${m.emoji}</div>
      <div style="flex:1;line-height:1.4;min-width:0"><div style="font-size:15px;font-weight:600;color:#f2eefb">${esc(a.label)}</div><div style="font-size:12.5px;color:#9a90b0;margin-top:2px">${esc(a.text)}</div>
        <div style="display:flex;gap:8px;margin-top:11px">
          <button data-act="selectAddr" data-id="${esc(a.id)}" data-label="${esc(a.label)}" style="padding:7px 15px;border-radius:10px;background:${BTN};color:#fff;font-size:12.5px;font-weight:600">${S.fromCheckout ? 'ใช้ที่อยู่นี้' : 'จัดส่งที่นี่'}</button>
          <button data-act="deleteAddr" data-id="${esc(a.id)}" style="padding:7px 13px;border-radius:10px;background:rgba(255,255,255,.06);color:#9a90b0;font-size:12.5px;font-weight:500">ลบ</button>
        </div></div></div>`;
  }).join('') : `<div style="text-align:center;color:#6a6280;font-size:13px;padding:30px 0">ยังไม่มีที่อยู่ที่บันทึกไว้</div>`;
  return `
  <div style="position:absolute;inset:0;bottom:76px;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('ที่อยู่ที่บันทึกไว้', 'goMethod')}
    <div style="flex:1;overflow-y:auto;padding:20px 18px 24px">${rows}
      <button data-act="goMethod" style="width:100%;height:52px;border-radius:15px;border:1.5px dashed rgba(139,92,246,.5);background:rgba(139,92,246,.08);color:#c4b5fd;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>เพิ่มที่อยู่ใหม่</button>
    </div>
  </div>`;
}
function screenProfile() {
  const av = S.pfAvatarData || (S.user && S.user.avatar) || '';
  const avEl = av ? `<img src="${esc(av)}" style="width:88px;height:88px;border-radius:26px;object-fit:cover" alt="">`
    : `<div style="width:88px;height:88px;border-radius:26px;background:rgba(139,92,246,.18);display:flex;align-items:center;justify-content:center"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.6"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"></path></svg></div>`;
  return `
  <div style="position:absolute;inset:0;bottom:76px;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('โปรไฟล์ของฉัน', 'goHome')}
    <div style="flex:1;overflow-y:auto;padding:26px 22px">
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px">
        <div style="position:relative">${avEl}
          <label style="position:absolute;right:-4px;bottom:-4px;width:32px;height:32px;border-radius:50%;background:${BTN};display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,.4)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 7h3l2-2h6l2 2h3v12H4z"></path><circle cx="12" cy="13" r="3.2"></circle></svg><input type="file" accept="image/*" data-file="avatar" style="display:none"></label>
        </div>
        ${S.user && S.user.lineLinked ? '<span style="font-size:11px;color:#06C755;font-weight:600">● เชื่อมต่อกับ LINE แล้ว</span>' : ''}
      </div>
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:24px 0 7px">ชื่อ - นามสกุล</label>
      <input data-model="pfName" placeholder="ชื่อ - นามสกุล" style="width:100%;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;font-size:15px;color:#f2eefb;outline:none">
      <label style="display:block;font-size:13px;font-weight:500;color:#b6acce;margin:18px 0 7px">เบอร์โทรศัพท์</label>
      <div style="display:flex;align-items:center;height:52px;border-radius:14px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 16px;gap:10px">
        <span style="font-size:15px;color:#9a90b0;font-weight:500;border-right:1px solid rgba(255,255,255,.12);padding-right:10px">+66</span>
        <input data-model="pfPhone" inputmode="numeric" placeholder="08X-XXX-XXXX" style="flex:1;border:none;outline:none;font-size:15px;color:#f2eefb;background:none;height:100%">
      </div>
    </div>
    <div style="padding:12px 22px 24px">
      <button data-act="saveProfile" style="width:100%;height:54px;border-radius:16px;background:${BTN};color:#fff;font-size:16px;font-weight:600;box-shadow:0 14px 26px -14px rgba(124,58,237,.9)">บันทึกโปรไฟล์</button>
    </div>
  </div>`;
}
function screenCart() {
  const lines = cartLines();
  const body = lines.length ? lines.map((l) => `
    <div style="background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:14px;display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div style="width:52px;height:52px;border-radius:13px;overflow:hidden;flex:none">${l.image ? `<img src="${esc(l.image)}" style="width:100%;height:100%;object-fit:cover">` : `<div style="width:100%;height:100%;background:rgba(139,92,246,.12);display:flex;align-items:center;justify-content:center;font-size:26px">${esc(l.emoji)}</div>`}</div>
      <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:#f2eefb">${esc(l.name)}</div><div style="font-size:13px;color:#a78bfa;font-weight:600;margin-top:2px">฿${esc(l.price)}</div><div style="font-size:10.5px;color:#6a6280;margin-top:2px">คงเหลือ ${l.stock}</div></div>
      <div style="display:flex;align-items:center;gap:10px">
        <button data-act="decQty" data-id="${esc(l.id)}" style="width:30px;height:30px;border-radius:9px;background:#0f0c18;border:1px solid rgba(255,255,255,.1);color:#f2eefb;font-size:18px;line-height:1">−</button>
        <span style="min-width:18px;text-align:center;color:#f2eefb;font-weight:600">${l.qty}</span>
        <button data-act="incQty" data-id="${esc(l.id)}" style="width:30px;height:30px;border-radius:9px;background:#0f0c18;border:1px solid rgba(255,255,255,.1);color:#f2eefb;font-size:18px;line-height:1">＋</button>
      </div>
    </div>`).join('') : `<div style="text-align:center;color:#6a6280;font-size:14px;padding:50px 0">ตะกร้ายังว่างอยู่<br><button data-act="goHome" style="margin-top:14px;color:#a78bfa;font-weight:600;text-decoration:underline">ไปเลือกสินค้า</button></div>`;
  const summary = lines.length ? `
    <div style="border-top:1px solid rgba(255,255,255,.08);padding:16px 20px 18px;background:#120f1c">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#9a90b0;margin-bottom:6px"><span>ยอดสินค้า</span><span>฿${cartSubtotal()}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#9a90b0;margin-bottom:10px"><span>ค่าจัดส่ง</span><span>${cartFee() ? '฿' + cartFee() : 'ฟรี'}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;color:#f2eefb"><span>รวมทั้งหมด</span><span>฿${cartTotal()}</span></div>
      <button data-act="goCheckout" style="width:100%;height:52px;border-radius:15px;background:${BTN};color:#fff;font-size:16px;font-weight:600;margin-top:14px;box-shadow:0 12px 24px -12px rgba(124,58,237,.9)">ดำเนินการชำระเงิน</button>
    </div>` : '';
  return `
  <div style="position:absolute;inset:0;bottom:76px;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('ตะกร้าสินค้า', 'goHome')}
    <div style="flex:1;overflow-y:auto;padding:18px 18px 24px">${body}</div>${summary}
  </div>`;
}
function screenCheckout() {
  const lines = cartLines();
  const addrPick = S.saved.length ? S.saved.map((a) => {
    const on = S.checkoutAddressId === a.id; const m = savedMeta(a.kind);
    return `<button data-act="pickAddr" data-id="${esc(a.id)}" style="width:100%;text-align:left;background:${on ? 'rgba(139,92,246,.14)' : '#1a1626'};border:1.5px solid ${on ? 'rgba(139,92,246,.6)' : 'rgba(255,255,255,.06)'};border-radius:14px;padding:13px;display:flex;align-items:flex-start;gap:11px;margin-bottom:9px">
      <span style="width:34px;height:34px;border-radius:10px;background:${m.iconBg};display:flex;align-items:center;justify-content:center;font-size:16px;flex:none">${m.emoji}</span>
      <span style="flex:1;min-width:0"><span style="display:block;font-size:14px;font-weight:600;color:#f2eefb">${esc(a.label)}</span><span style="display:block;font-size:12px;color:#9a90b0;margin-top:1px">${esc(a.text)}</span></span>
      ${on ? '<span style="color:#a78bfa;font-size:18px">✓</span>' : ''}</button>`;
  }).join('') : `<div style="font-size:13px;color:#9a90b0;padding:6px 0 10px">ยังไม่มีที่อยู่</div>`;
  const payBtn = (m, label, icon) => { const on = S.payMethod === m; return `<button data-act="pay_${m}" style="width:100%;text-align:left;background:${on ? 'rgba(139,92,246,.14)' : '#1a1626'};border:1.5px solid ${on ? 'rgba(139,92,246,.6)' : 'rgba(255,255,255,.06)'};border-radius:14px;padding:14px;display:flex;align-items:center;gap:11px;margin-bottom:9px"><span style="font-size:20px">${icon}</span><span style="flex:1;font-size:14px;font-weight:600;color:#f2eefb">${label}</span>${on ? '<span style="color:#a78bfa;font-size:18px">✓</span>' : ''}</button>`; };
  return `
  <div style="position:absolute;inset:0;bottom:76px;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('ชำระเงิน', 'goCart')}
    <div style="flex:1;overflow-y:auto;padding:20px 18px 20px">
      <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:10px">📍 ที่อยู่จัดส่ง</div>
      ${addrPick}
      <button data-act="addAddrFromCheckout" style="width:100%;height:44px;border-radius:12px;border:1.5px dashed rgba(139,92,246,.5);background:rgba(139,92,246,.08);color:#c4b5fd;font-size:14px;font-weight:600;margin-bottom:20px">＋ เพิ่มที่อยู่ใหม่</button>
      <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:10px">💳 วิธีชำระเงิน</div>
      ${payBtn('cod', 'เก็บเงินปลายทาง', '💵')}${payBtn('transfer', 'โอนเงิน / พร้อมเพย์', '🏦')}
      <div style="font-size:14px;font-weight:600;color:#f2eefb;margin:16px 0 10px">📝 หมายเหตุถึงร้าน</div>
      <input data-model="orderNote" placeholder="เช่น โทรก่อนส่ง" style="width:100%;height:48px;border-radius:12px;border:1.5px solid rgba(255,255,255,.1);background:#1a1626;padding:0 14px;font-size:14px;color:#f2eefb;outline:none">
      <div style="margin-top:20px;background:#15111f;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px">
        <div style="font-size:13px;font-weight:600;color:#f2eefb;margin-bottom:10px">สรุปคำสั่งซื้อ</div>
        ${lines.map((l) => `<div style="display:flex;justify-content:space-between;font-size:13px;color:#9a90b0;margin-bottom:5px"><span>${esc(l.name)} x${l.qty}</span><span>฿${l.line}</span></div>`).join('')}
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#9a90b0;margin:6px 0;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)"><span>ค่าจัดส่ง</span><span>${cartFee() ? '฿' + cartFee() : 'ฟรี'}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;color:#f2eefb"><span>รวม</span><span>฿${cartTotal()}</span></div>
      </div>
    </div>
    <div style="padding:12px 18px 18px;border-top:1px solid rgba(255,255,255,.08)">
      <button data-act="placeOrder" style="width:100%;height:54px;border-radius:16px;background:${BTN};color:#fff;font-size:16px;font-weight:600;box-shadow:0 14px 26px -14px rgba(124,58,237,.9)">ยืนยันสั่งซื้อ · ฿${cartTotal()}</button>
    </div>
  </div>`;
}
function statusTimeline(o) {
  if (o.status === 'cancelled') return `<div style="font-size:13px;color:#f87171;font-weight:600;margin-top:8px">✕ ${STATUS_LABEL.cancelled}</div>`;
  const idx = ORDER_FLOW.indexOf(o.status);
  return `<div style="display:flex;align-items:center;margin-top:12px">${ORDER_FLOW.map((s, i) => {
    const done = i <= idx, isLast = i === ORDER_FLOW.length - 1;
    return `<div style="display:flex;align-items:center;${isLast ? '' : 'flex:1'}"><div style="display:flex;flex-direction:column;align-items:center;gap:4px"><div style="width:24px;height:24px;border-radius:50%;background:${done ? BTN : '#241f33'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${done ? '#fff' : '#5c5470'}">${done ? '✓' : (i + 1)}</div><div style="font-size:9px;color:${done ? '#c4b5fd' : '#5c5470'};text-align:center;width:52px;line-height:1.2">${STATUS_LABEL[s]}</div></div>${isLast ? '' : `<div style="flex:1;height:2px;background:${i < idx ? '#7c3aed' : '#241f33'};margin:0 2px 18px"></div>`}</div>`;
  }).join('')}</div>`;
}
function screenOrders() {
  const rows = S.orders.length ? S.orders.map((o) => `
    <div style="background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div style="font-size:14px;font-weight:600;color:#f2eefb">ออเดอร์ #${esc(String(o.id).replace(/^o_/, '').slice(0, 6).toUpperCase())}</div><div style="font-size:11.5px;color:#6a6280;margin-top:2px">${esc(fmtDate(o.createdAt))}</div></div>
        <div style="font-size:15px;font-weight:700;color:#a78bfa">฿${o.total}</div>
      </div>
      <div style="font-size:12.5px;color:#9a90b0;margin-top:8px">${o.items.map((i) => esc((i.emoji || '') + ' ' + i.name + ' x' + i.qty)).join(' · ')}</div>
      <div style="font-size:11.5px;color:#6a6280;margin-top:6px">${esc(o.addressText || '-')} · ${esc(PAY_LABEL[o.payment && o.payment.method] || '')}</div>
      ${o.payment && o.payment.method === 'transfer' ? (o.slipImage
        ? `<div style="margin-top:9px;display:flex;align-items:center;gap:8px"><img src="${esc(o.slipImage)}" style="width:38px;height:50px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.1)"><span style="font-size:11.5px;color:#34d399;font-weight:600">✓ อัปโหลดสลิปแล้ว</span></div>`
        : `<label style="margin-top:9px;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:10px;background:rgba(139,92,246,.16);color:#c4b5fd;font-size:12.5px;font-weight:600;cursor:pointer">🧾 อัปโหลดสลิปโอนเงิน<input type="file" accept="image/*" data-file="slip:${esc(o.id)}" style="display:none"></label>`) : ''}
      ${statusTimeline(o)}
    </div>`).join('') : `<div style="text-align:center;color:#6a6280;font-size:14px;padding:50px 0">ยังไม่มีออเดอร์<br><button data-act="goHome" style="margin-top:14px;color:#a78bfa;font-weight:600;text-decoration:underline">เริ่มสั่งเลย</button></div>`;
  return `
  <div style="position:absolute;inset:0;bottom:76px;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    <div style="padding:52px 20px 18px;background:linear-gradient(135deg,#3d2b6b,#1c1630);display:flex;align-items:center;justify-content:space-between">
      <span style="color:#fff;font-size:19px;font-weight:600">ออเดอร์ของฉัน</span>
      <button data-act="refreshOrders" style="padding:0 14px;height:32px;border-radius:16px;border:1px solid rgba(255,255,255,.3);color:#fff;font-size:12px;font-weight:600">รีเฟรช</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:18px">${rows}</div>
  </div>`;
}
function screenAdminOrder() {
  const o = S.adminOrders.find((x) => x.id === S.adminOrderId);
  if (!o) { S.adminOrderId = null; return screenAdmin(); }
  const items = o.items.map((i) => `<div style="display:flex;justify-content:space-between;font-size:13px;color:#c9c2da;margin-bottom:6px"><span>${esc((i.emoji || '') + ' ' + i.name)} x${i.qty}</span><span>฿${i.price * i.qty}</span></div>`).join('');
  const btns = [...ORDER_FLOW, 'cancelled'].map((s) => `<button data-act="adminStatus" data-id="${esc(o.id)}" data-status="${s}" style="padding:7px 11px;border-radius:9px;font-size:11.5px;font-weight:600;background:${o.status === s ? BTN : '#0f0c18'};color:${o.status === s ? '#fff' : '#9a90b0'};border:1px solid rgba(255,255,255,.08)">${STATUS_LABEL[s]}</button>`).join('');
  const hist = (o.statusHistory || []).map((h) => `<div style="font-size:11.5px;color:#6a6280">• ${STATUS_LABEL[h.status]} — ${esc(fmtDate(h.at))}</div>`).join('');
  const slip = o.payment && o.payment.method === 'transfer'
    ? (o.slipImage ? `<div style="margin-top:8px"><a href="${esc(o.slipImage)}" target="_blank"><img src="${esc(o.slipImage)}" style="max-width:160px;border-radius:10px;border:1px solid rgba(255,255,255,.12)"></a></div>` : `<div style="font-size:12px;color:#fbbf24;margin-top:6px">⏳ ลูกค้ายังไม่อัปโหลดสลิป</div>`)
    : '';
  return `
  <div style="position:absolute;inset:0;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    ${topbar('รายละเอียดออเดอร์ #' + String(o.id).replace(/^o_/, '').slice(0, 6).toUpperCase(), 'adminCloseOrder')}
    <div style="flex:1;overflow-y:auto;padding:18px">
      <div style="background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:15px;font-weight:700;color:#f2eefb">${esc(o.customerName || '')}</div><div style="font-size:16px;font-weight:700;color:#a78bfa">฿${o.total}</div></div>
        <div style="font-size:12px;color:#9a90b0;margin-top:2px">${esc(o.phone || 'ผู้ใช้ LINE')} · ${esc(fmtDate(o.createdAt))}</div>
        <div style="font-size:12px;color:#c4b5fd;font-weight:600;margin-top:8px">สถานะปัจจุบัน: ${STATUS_LABEL[o.status]}</div>
      </div>
      <div style="font-size:13px;font-weight:600;color:#f2eefb;margin-bottom:8px">ตำแหน่งจัดส่ง</div>
      ${o.addrLat != null && o.addrLng != null
        ? `<div style="position:relative;height:170px;border-radius:14px;overflow:hidden;background:#14101f;border:1px solid rgba(255,255,255,.08)"><div id="admin-mini-map" style="position:absolute;inset:0"></div><div style="position:absolute;left:10px;bottom:10px;background:rgba(13,11,21,.85);border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:6px 10px;font-size:11px;color:#c4b5fd;font-weight:500;z-index:1000;pointer-events:none">📍 ตำแหน่งที่ลูกค้าปักหมุด</div></div>`
        : `<div style="height:90px;border-radius:14px;background:#14101f;border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;color:#6a6280;font-size:12.5px">ไม่มีข้อมูลพิกัด</div>`}
      <div style="font-size:12.5px;color:#9a90b0;margin-top:8px;line-height:1.5">${esc(o.addressText || '-')}</div>
      ${o.addrLat != null ? `<div style="font-size:11px;color:#6a6280;margin-top:3px">พิกัดหมุด: ${Number(o.addrLat).toFixed(5)}, ${Number(o.addrLng).toFixed(5)}</div>` : ''}
      <div style="background:#15111f;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px;margin-top:14px">
        <div style="font-size:13px;font-weight:600;color:#f2eefb;margin-bottom:10px">รายการสินค้า</div>${items}
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#9a90b0;margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)"><span>ค่าจัดส่ง</span><span>${o.deliveryFee ? '฿' + o.deliveryFee : 'ฟรี'}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#9a90b0;margin-top:8px"><span>ชำระเงิน</span><span>${esc(PAY_LABEL[o.payment && o.payment.method] || '')}</span></div>
        ${o.payment && o.payment.note ? `<div style="font-size:12px;color:#9a90b0;margin-top:6px">หมายเหตุ: ${esc(o.payment.note)}</div>` : ''}
        ${slip}
      </div>
      <div style="font-size:13px;font-weight:600;color:#f2eefb;margin:16px 0 8px">อัปเดตสถานะ</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${btns}</div>
      <div style="margin-top:16px;background:#15111f;border-radius:12px;padding:12px">${hist}</div>
    </div>
  </div>`;
}
function computeSales() {
  const orders = S.adminOrders || [];
  const valid = orders.filter((o) => o.status !== 'cancelled');
  const revenue = valid.reduce((s, o) => s + o.total, 0);
  const completed = orders.filter((o) => o.status === 'completed');
  const byDayMap = {};
  valid.forEach((o) => {
    const d = new Date(o.createdAt);
    const key = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    if (!byDayMap[key]) byDayMap[key] = { revenue: 0, count: 0, ts: new Date(o.createdAt).setHours(0, 0, 0, 0) };
    byDayMap[key].revenue += o.total; byDayMap[key].count++;
  });
  const byDay = Object.entries(byDayMap).map(([day, v]) => ({ day, ...v })).sort((a, b) => b.ts - a.ts);
  const prodMap = {};
  valid.forEach((o) => o.items.forEach((it) => {
    if (!prodMap[it.name]) prodMap[it.name] = { qty: 0, revenue: 0, emoji: it.emoji || '📦' };
    prodMap[it.name].qty += it.qty; prodMap[it.name].revenue += it.price * it.qty;
  }));
  const topProducts = Object.entries(prodMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty);
  return { revenue, orders: valid.length, completed: completed.length, cancelled: orders.length - valid.length, avg: valid.length ? Math.round(revenue / valid.length) : 0, byDay, topProducts };
}
function screenAdmin() {
  if (S.adminOrderId) return screenAdminOrder();
  const tab = S.adminTab;
  const tabBtn = (id, label) => `<button data-act="adminTab_${id}" style="flex:1;height:40px;border-radius:11px;font-size:13.5px;font-weight:600;background:${tab === id ? BTN : '#1a1626'};color:${tab === id ? '#fff' : '#9a90b0'};border:1px solid rgba(255,255,255,.06)">${label}</button>`;
  let content = '';
  if (tab === 'sales') {
    const s = computeSales();
    const maxDay = Math.max(1, ...s.byDay.map((d) => d.revenue));
    const card = (label, val, color) => `<div style="flex:1;background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px"><div style="font-size:11px;color:#9a90b0">${label}</div><div style="font-size:19px;font-weight:700;color:${color};margin-top:4px">${val}</div></div>`;
    const dayRows = s.byDay.length ? s.byDay.map((d) => `
      <div style="margin-bottom:11px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#c9c2da;margin-bottom:4px"><span>${esc(d.day)} · ${d.count} ออเดอร์</span><span style="font-weight:600;color:#a78bfa">฿${d.revenue.toLocaleString()}</span></div>
        <div style="height:8px;border-radius:4px;background:#241f33;overflow:hidden"><div style="height:100%;width:${Math.round(d.revenue / maxDay * 100)}%;background:${BTN};border-radius:4px"></div></div>
      </div>`).join('') : `<div style="color:#6a6280;font-size:13px;text-align:center;padding:16px 0">ยังไม่มียอดขาย</div>`;
    const maxQty = Math.max(1, ...s.topProducts.map((p) => p.qty));
    const prodRows = s.topProducts.length ? s.topProducts.slice(0, 8).map((p, i) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="width:22px;height:22px;border-radius:7px;background:${i < 3 ? 'rgba(139,92,246,.25)' : '#241f33'};color:${i < 3 ? '#c4b5fd' : '#9a90b0'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none">${i + 1}</span>
        <span style="font-size:18px;flex:none">${esc(p.emoji)}</span>
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#f2eefb">${esc(p.name)}</div><div style="height:6px;border-radius:3px;background:#241f33;overflow:hidden;margin-top:3px"><div style="height:100%;width:${Math.round(p.qty / maxQty * 100)}%;background:linear-gradient(90deg,#818cf8,#c026d3);border-radius:3px"></div></div></div>
        <div style="text-align:right;flex:none"><div style="font-size:13px;font-weight:700;color:#a78bfa">${p.qty} ชิ้น</div><div style="font-size:11px;color:#6a6280">฿${p.revenue.toLocaleString()}</div></div>
      </div>`).join('') : `<div style="color:#6a6280;font-size:13px;text-align:center;padding:16px 0">ยังไม่มีข้อมูล</div>`;
    content = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="font-size:15px;font-weight:700;color:#f2eefb">ภาพรวมยอดขาย</span><button data-act="adminRefresh" style="padding:0 12px;height:30px;border-radius:15px;border:1px solid rgba(255,255,255,.2);color:#c4b5fd;font-size:12px;font-weight:600">รีเฟรช</button></div>
      <div style="background:linear-gradient(135deg,#2a1f52,#7c3aed);border-radius:16px;padding:18px;margin-bottom:12px">
        <div style="font-size:12px;color:rgba(255,255,255,.8)">ยอดขายรวม (ไม่รวมที่ยกเลิก)</div>
        <div style="font-size:32px;font-weight:800;color:#fff;margin-top:2px">฿${s.revenue.toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:18px">
        ${card('ออเดอร์', s.orders, '#f2eefb')}${card('สำเร็จแล้ว', s.completed, '#34d399')}${card('เฉลี่ย/ออเดอร์', '฿' + s.avg, '#a78bfa')}
      </div>
      <div style="background:#15111f;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px;margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:14px">📊 ยอดขายรายวัน</div>${dayRows}
      </div>
      <div style="background:#15111f;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px">
        <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:14px">🏆 สินค้าขายดี</div>${prodRows}
      </div>`;
  } else if (tab === 'products') {
    const list = S.products.map((p) => `
      <div style="background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:48px;height:48px;border-radius:11px;overflow:hidden;flex:none">${p.image ? `<img src="${esc(p.image)}" style="width:100%;height:100%;object-fit:cover">` : `<div style="width:100%;height:100%;background:rgba(139,92,246,.12);display:flex;align-items:center;justify-content:center;font-size:22px">${esc(p.emoji || '🛍️')}</div>`}</div>
          <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:#f2eefb">${esc(p.name)}${p.tag ? ` <span style="font-size:10px;color:#c4b5fd">(${esc(p.tag)})</span>` : ''}</div><div style="font-size:12px;color:#9a90b0">฿${esc(p.price)} · ${esc(p.desc || '')}</div></div>
          <button data-act="adminDelProduct" data-id="${esc(p.id)}" style="padding:7px 12px;border-radius:10px;background:rgba(248,113,113,.14);color:#f87171;font-size:12px;font-weight:600">ลบ</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
          <span style="font-size:12px;color:#9a90b0">สต็อก:</span>
          <input data-stock-input="${esc(p.id)}" value="${esc(p.stock || 0)}" inputmode="numeric" style="width:64px;height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:#0f0c18;text-align:center;font-size:13px;color:#f2eefb;outline:none">
          <button data-act="adminSetStock" data-id="${esc(p.id)}" style="padding:7px 12px;border-radius:9px;background:rgba(139,92,246,.2);color:#c4b5fd;font-size:12px;font-weight:600">ตั้ง</button>
          <label style="margin-left:auto;padding:7px 12px;border-radius:9px;background:#0f0c18;border:1px solid rgba(255,255,255,.1);color:#c4b5fd;font-size:12px;font-weight:600;cursor:pointer">${p.image ? 'เปลี่ยนรูป' : '＋ เพิ่มรูป'}<input type="file" accept="image/*" data-file="prod:${esc(p.id)}" style="display:none"></label>
        </div>
      </div>`).join('');
    const preview = S.npImageData ? `<div style="margin-top:9px;display:flex;align-items:center;gap:8px"><img src="${esc(S.npImageData)}" style="width:44px;height:44px;border-radius:9px;object-fit:cover"><span style="font-size:12px;color:#9a90b0">${esc(S.npImageName)}</span></div>` : '';
    content = `
      <div style="background:#15111f;border:1px solid rgba(139,92,246,.25);border-radius:16px;padding:16px;margin-bottom:18px">
        <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:4px">🚚 ตั้งค่าการจัดส่ง</div>
        <div style="font-size:11.5px;color:#9a90b0;margin-bottom:12px">ปัจจุบัน: ค่าส่ง ฿${S.settings.deliveryFee} · ส่งฟรีเมื่อสั่งครบ ${S.settings.freeQty} ตัว</div>
        <div style="display:flex;gap:9px;align-items:center">
          <div style="flex:1"><div style="font-size:11px;color:#9a90b0;margin-bottom:4px">ค่าจัดส่ง (บาท)</div><input data-model="setDeliveryFee" inputmode="numeric" placeholder="${S.settings.deliveryFee}" style="width:100%;height:44px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none"></div>
          <div style="flex:1"><div style="font-size:11px;color:#9a90b0;margin-bottom:4px">ส่งฟรีเมื่อครบ (ตัว)</div><input data-model="setFreeQty" inputmode="numeric" placeholder="${S.settings.freeQty}" style="width:100%;height:44px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none"></div>
        </div>
        <button data-act="adminSaveSettings" style="width:100%;height:44px;border-radius:11px;background:rgba(139,92,246,.2);color:#c4b5fd;font-size:14px;font-weight:600;margin-top:12px">บันทึกค่าจัดส่ง</button>
      </div>
      <div style="background:#15111f;border:1px solid rgba(139,92,246,.25);border-radius:16px;padding:16px;margin-bottom:18px">
        <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:4px">📢 รูปโฆษณา (ป๊อปอัพตอนลูกค้าเข้า)</div>
        <div style="font-size:11.5px;color:${S.settings.adEnabled ? '#34d399' : '#f87171'};margin-bottom:12px">${S.settings.adEnabled ? '● กำลังแสดงให้ลูกค้าเห็นตอนล็อกอิน' : '○ ปิดการแสดงอยู่'}</div>
        ${S.settings.adImage ? `<img src="${esc(S.settings.adImage)}" alt="โฆษณา" style="width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.1);margin-bottom:10px;display:block">` : `<div style="height:90px;border-radius:12px;border:1.5px dashed rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;color:#6a6280;font-size:13px;margin-bottom:10px">ยังไม่มีรูปโฆษณา</div>`}
        <div style="display:flex;gap:8px">
          <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;height:44px;border-radius:11px;border:1.5px dashed rgba(139,92,246,.5);background:rgba(139,92,246,.08);color:#c4b5fd;font-size:13.5px;font-weight:600;cursor:pointer">📷 ${S.settings.adImage ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}<input type="file" accept="image/*" data-file="ad" style="display:none"></label>
          <button data-act="adminToggleAd" style="width:110px;height:44px;border-radius:11px;background:${S.settings.adEnabled ? 'rgba(248,113,113,.14)' : 'rgba(52,211,153,.14)'};color:${S.settings.adEnabled ? '#f87171' : '#34d399'};font-size:13px;font-weight:600">${S.settings.adEnabled ? 'ปิดโฆษณา' : 'เปิดโฆษณา'}</button>
        </div>
        ${S.settings.adImage ? `<button data-act="adminRemoveAd" style="width:100%;height:38px;border-radius:11px;background:#0f0c18;border:1px solid rgba(255,255,255,.08);color:#9a90b0;font-size:12.5px;font-weight:600;margin-top:8px">ลบรูปโฆษณา</button>` : ''}
      </div>
      <div style="background:#15111f;border:1px solid rgba(139,92,246,.25);border-radius:16px;padding:16px;margin-bottom:18px">
        <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:12px">＋ เพิ่มสินค้าใหม่</div>
        <input data-model="npName" placeholder="ชื่อสินค้า" style="width:100%;height:46px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none;margin-bottom:9px">
        <input data-model="npDesc" placeholder="คำอธิบาย" style="width:100%;height:46px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none;margin-bottom:9px">
        <div style="display:flex;gap:9px;margin-bottom:9px">
          <input data-model="npPrice" inputmode="numeric" placeholder="ราคา (บาท)" style="flex:1;height:46px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none">
          <input data-model="npStock" inputmode="numeric" placeholder="สต็อก" style="width:90px;height:46px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none">
          <input data-model="npEmoji" placeholder="😀" style="width:64px;height:46px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;text-align:center;font-size:18px;color:#f2eefb;outline:none">
        </div>
        <input data-model="npTag" placeholder="ป้าย เช่น ขายดี / ใหม่ (ไม่ใส่ก็ได้)" style="width:100%;height:46px;border-radius:11px;border:1.5px solid rgba(255,255,255,.1);background:#0f0c18;padding:0 14px;font-size:14px;color:#f2eefb;outline:none;margin-bottom:9px">
        <label style="display:flex;align-items:center;justify-content:center;gap:8px;height:46px;border-radius:11px;border:1.5px dashed rgba(139,92,246,.5);background:rgba(139,92,246,.08);color:#c4b5fd;font-size:14px;font-weight:600;cursor:pointer">📷 อัปโหลดรูปสินค้า (ไม่บังคับ)<input type="file" accept="image/*" data-file="new" style="display:none"></label>
        ${preview}
        <button data-act="adminAddProduct" style="width:100%;height:48px;border-radius:12px;background:${BTN};color:#fff;font-size:15px;font-weight:600;margin-top:12px">บันทึกสินค้า</button>
      </div>
      <div style="font-size:14px;font-weight:600;color:#f2eefb;margin-bottom:12px">สินค้าทั้งหมด (${S.products.length})</div>${list}`;
  } else {
    const orders = S.adminOrders;
    const list = orders.length ? orders.map((o) => {
      const btns = [...ORDER_FLOW, 'cancelled'].map((s) => `<button data-act="adminStatus" data-id="${esc(o.id)}" data-status="${s}" style="padding:6px 10px;border-radius:9px;font-size:11px;font-weight:600;background:${o.status === s ? BTN : '#0f0c18'};color:${o.status === s ? '#fff' : '#9a90b0'};border:1px solid rgba(255,255,255,.08)">${STATUS_LABEL[s]}</button>`).join('');
      return `<div style="background:#1a1626;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:15px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:14px;font-weight:600;color:#f2eefb">#${esc(String(o.id).replace(/^o_/, '').slice(0, 6).toUpperCase())} · ${esc(o.customerName || '')}</div><div style="font-size:11.5px;color:#6a6280;margin-top:2px">${esc(o.phone || 'ผู้ใช้ LINE')} · ${esc(fmtDate(o.createdAt))}</div></div><div style="font-size:15px;font-weight:700;color:#a78bfa">฿${o.total}</div></div>
        <div style="font-size:12.5px;color:#9a90b0;margin-top:8px">${o.items.map((i) => esc(i.name + ' x' + i.qty)).join(', ')}</div>
        <div style="font-size:11.5px;color:#6a6280;margin-top:5px">${esc(o.addressText || '-')} · ${esc(PAY_LABEL[o.payment && o.payment.method] || '')}${o.payment && o.payment.method === 'transfer' ? (o.slipImage ? ' · 🧾 มีสลิป' : ' · ⏳ รอสลิป') : ''}</div>
        <button data-act="adminOpenOrder" data-id="${esc(o.id)}" style="width:100%;margin-top:10px;height:38px;border-radius:10px;background:rgba(139,92,246,.15);color:#c4b5fd;font-size:12.5px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px">🗺️ ดูรายละเอียด + ตำแหน่งหมุด</button>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:9px">${btns}</div>
      </div>`;
    }).join('') : `<div style="text-align:center;color:#6a6280;font-size:14px;padding:40px 0">ยังไม่มีออเดอร์</div>`;
    content = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="font-size:14px;font-weight:600;color:#f2eefb">ออเดอร์ทั้งหมด (${orders.length})</span><button data-act="adminRefresh" style="padding:0 12px;height:30px;border-radius:15px;border:1px solid rgba(255,255,255,.2);color:#c4b5fd;font-size:12px;font-weight:600">รีเฟรช</button></div>${list}`;
  }
  return `
  <div style="position:absolute;inset:0;background:#0d0b15;display:flex;flex-direction:column;animation:fs-fade .3s ease">
    <div style="padding:50px 20px 18px;background:linear-gradient(135deg,#3d2b6b,#1c1630)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><div style="color:#fff;font-size:19px;font-weight:700">แผงผู้ดูแลระบบ</div><div style="color:#c4b5fd;font-size:12px;margin-top:2px">FLASH SMOKE · ${esc((S.user && S.user.fullname) || '')}</div></div>
        <button data-act="logout" style="padding:0 14px;height:34px;border-radius:17px;border:1px solid rgba(255,255,255,.35);color:#fff;font-size:12px;font-weight:600">ออก</button>
      </div>
      <div style="display:flex;gap:7px;margin-top:16px">${tabBtn('orders', 'ออเดอร์')}${tabBtn('products', 'สินค้า')}${tabBtn('sales', 'ยอดขาย')}</div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:18px">${content}</div>
  </div>`;
}
function navBar() {
  if (!['home', 'cart', 'checkout', 'orders', 'method', 'map', 'saved', 'profile'].includes(S.screen)) return '';
  const c = (a) => a ? '#a78bfa' : '#6a6280';
  const homeA = S.screen === 'home', cartA = ['cart', 'checkout'].includes(S.screen), orderA = S.screen === 'orders';
  const badge = cartCount();
  return `
  <div style="position:absolute;left:0;right:0;bottom:0;height:76px;background:#141020;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:flex-start;padding:12px 10px 0;z-index:40">
    <button data-act="goHome" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c(homeA)}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"></path><path d="M5 10v10h14V10"></path></svg><span style="font-size:11px;color:${c(homeA)};font-weight:500">หน้าแรก</span></button>
    <button data-act="goCart" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;position:relative"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c(cartA)}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"></circle><circle cx="18" cy="20" r="1.4"></circle><path d="M2 3h3l2.4 12.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 7H6"></path></svg><span style="font-size:11px;color:${c(cartA)};font-weight:500">ตะกร้า</span>${badge ? `<span style="position:absolute;top:-4px;right:calc(50% - 22px);min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#f0abfc;color:#3b0764;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center">${badge}</span>` : ''}</button>
    <button data-act="goOrders" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c(orderA)}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path><rect x="9" y="3" width="6" height="4" rx="1"></rect><path d="M9 12h6M9 16h4"></path></svg><span style="font-size:11px;color:${c(orderA)};font-weight:500">ออเดอร์</span></button>
  </div>`;
}

// ================================================================
// Actions
// ================================================================
function go(s) { S.screen = s; render(); }
const ACT = {
  goWelcome: () => go('welcome'), goRegister: () => go('register'), goLogin: () => go('login'),
  goHome: () => go('home'), goMethod: () => go('method'), goMap: () => go('map'), goSaved: () => go('saved'),
  goCart: () => go('cart'), goCheckout: () => go('checkout'), goOrders: () => go('orders'),
  goProfile: () => { S.pfName = (S.user && S.user.fullname) || ''; S.pfPhone = (S.user && S.user.phone) || ''; S.pfAvatarData = ''; go('profile'); },
  saveProfile, adminSaveSettings,
  adminOpenOrder: (el) => { S.adminOrderId = el.dataset.id; render(); },
  adminCloseOrder: () => { S.adminOrderId = null; render(); },
  doRegister, verifyOtp, resendOtp, doLogin, lineLogin, saveAddr: saveAddress, placeOrder, refreshOrders,
  logout: () => { API.setToken(''); S.user = null; S.saved = []; S.orders = []; S.adminOrders = []; adShown = false; closeAd(); go('welcome'); },
  closeAd: () => closeAd(),
  adminToggleAd: () => adminSaveAd({ adEnabled: !S.settings.adEnabled }),
  adminRemoveAd: () => adminSaveAd({ adImage: '' }),
  addCart: (el) => { if (addToCart(el.dataset.id)) { const p = productById(el.dataset.id); render(); toast('เพิ่ม ' + (p ? p.name : 'สินค้า') + ' ลงตะกร้าแล้ว ✓'); } },
  incQty: (el) => { setQty(el.dataset.id, 1); render(); },
  decQty: (el) => { setQty(el.dataset.id, -1); render(); },
  useCurrent: () => locateAndCenter(true),
  useCurrentThenMap: () => { S.wantsGeoLocate = true; S.screen = 'map'; render(); },
  styleViolet: () => { S.mapStyle = 'violet'; switchTileLayer(); updateStyleButtons($('#screen')); },
  styleMono: () => { S.mapStyle = 'mono'; switchTileLayer(); updateStyleButtons($('#screen')); },
  styleNight: () => { S.mapStyle = 'night'; switchTileLayer(); updateStyleButtons($('#screen')); },
  labelHome: () => { S.addrLabel = 'บ้าน'; updateLabelButtons($('#screen')); }, labelWork: () => { S.addrLabel = 'ที่ทำงาน'; updateLabelButtons($('#screen')); }, labelOther: () => { S.addrLabel = 'อื่นๆ'; updateLabelButtons($('#screen')); },
  selectAddr: (el) => { if (S.fromCheckout) { S.fromCheckout = false; S.checkoutAddressId = el.dataset.id; go('checkout'); } else toast('เลือก ' + (el.dataset.label || 'ที่อยู่') + ' เป็นที่จัดส่ง ✓'); },
  deleteAddr: (el) => deleteAddress(el.dataset.id),
  pickAddr: (el) => { S.checkoutAddressId = el.dataset.id; render(); },
  addAddrFromCheckout: () => { S.fromCheckout = true; go('method'); },
  pay_cod: () => { S.payMethod = 'cod'; render(); }, pay_transfer: () => { S.payMethod = 'transfer'; render(); },
  adminTab_orders: () => { S.adminTab = 'orders'; render(); }, adminTab_products: () => { S.adminTab = 'products'; render(); }, adminTab_sales: () => { S.adminTab = 'sales'; render(); },
  adminAddProduct, adminRefresh: async () => { await adminLoad(); render(); toast('อัปเดตแล้ว'); },
  adminDelProduct: (el) => adminDeleteProduct(el.dataset.id),
  adminStatus: (el) => adminSetStatus(el.dataset.id, el.dataset.status),
  adminSetStock: (el) => { const inp = document.querySelector(`[data-stock-input="${el.dataset.id}"]`); adminSetStock(el.dataset.id, inp ? inp.value : 0); }
};

// ================================================================
// Render + wiring
// ================================================================
function render() {
  // ทำลาย instance แผนที่จริงเมื่อออกจากหน้าที่ใช้มัน (กัน leak + ไม่ให้ค้างอ้างอิง DOM ที่ถูกแทนที่)
  if (leafletMap && S.screen !== 'map') { leafletMap.remove(); leafletMap = null; leafletMarker = null; leafletTile = null; clearTimeout(geocodeTimer); }
  if (adminMiniMapInst && !(S.screen === 'admin' && S.adminOrderId)) { adminMiniMapInst.remove(); adminMiniMapInst = null; }
  const screens = { welcome: screenWelcome, register: screenRegister, login: screenLogin, otp: screenOtp, home: screenHome, method: screenMethod, map: screenMap, saved: screenSaved, profile: screenProfile, cart: screenCart, checkout: screenCheckout, orders: screenOrders, admin: screenAdmin };
  if (S.screen === 'checkout' && !S.checkoutAddressId && S.saved.length) S.checkoutAddressId = S.saved[0].id;
  $('#screen').innerHTML = (screens[S.screen] || screenWelcome)();
  $('#nav').innerHTML = S.screen === 'admin' ? '' : navBar();
  wire();
}
function wire() {
  const root = $('#screen'), nav = $('#nav');
  [root, nav].forEach((r) => r.querySelectorAll('[data-act]').forEach((el) => { el.onclick = () => { const fn = ACT[el.dataset.act]; if (fn) fn(el); }; }));
  root.querySelectorAll('[data-model]').forEach((el) => { const k = el.dataset.model; el.value = S[k] == null ? '' : S[k]; el.oninput = () => { S[k] = el.value; }; });
  root.querySelectorAll('[data-otp]').forEach((el) => {
    const i = Number(el.dataset.otp); el.value = S.otp[i] || '';
    el.oninput = () => { const v = (el.value || '').replace(/\D/g, '').slice(-1); S.otp[i] = v; el.value = v; const btn = root.querySelector('[data-act="verifyOtp"]'); if (btn) btn.style.background = S.otp.join('').length === 4 ? BTN : BTN_OFF; if (v && i < 3) { const n = root.querySelector(`[data-otp="${i + 1}"]`); if (n) n.focus(); } };
    el.onkeydown = (e) => { if (e.key === 'Backspace' && !el.value && i > 0) { const p = root.querySelector(`[data-otp="${i - 1}"]`); if (p) p.focus(); } };
  });
  root.querySelectorAll('[data-file]').forEach((el) => {
    el.onchange = () => {
      const f = el.files && el.files[0]; if (!f) return;
      if (f.size > 3_000_000) { toast('ไฟล์ใหญ่เกินไป (เกิน 3MB)'); el.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result, target = el.dataset.file;
        if (target === 'new') { S.npImageData = data; S.npImageName = f.name; render(); }
        else if (target === 'avatar') { S.pfAvatarData = data; render(); }
        else if (target === 'ad') adminSaveAd({ adImageData: data });
        else if (target.startsWith('prod:')) adminSetImage(target.slice(5), data);
        else if (target.startsWith('slip:')) uploadSlip(target.slice(5), data);
      };
      reader.readAsDataURL(f);
    };
  });
  if (root.querySelector('#leaflet-map')) initLeafletMap(root);
  if (root.querySelector('#admin-mini-map') && S.adminOrderId) {
    const ord = S.adminOrders.find((x) => x.id === S.adminOrderId);
    if (ord) renderAdminMiniMap(root, ord.addrLat, ord.addrLng);
  }
}

// รักษาขนาด/จุดกึ่งกลางแผนที่ให้ถูกต้องเมื่อหน้าจอเปลี่ยนขนาด (หมุนจอ, ปรับขนาดหน้าต่าง)
window.addEventListener('resize', () => {
  if (leafletMap) { leafletMap.invalidateSize(); if (S.pinLat != null && S.pinLng != null) leafletMap.setView([S.pinLat, S.pinLng], leafletMap.getZoom()); }
  if (adminMiniMapInst) adminMiniMapInst.invalidateSize();
});

// ---------------- Live stock (SSE) ----------------
function connectStream() {
  try {
    const es = new EventSource('/api/stream');
    es.addEventListener('products', (e) => {
      let list; try { list = JSON.parse(e.data); } catch { return; }
      S.products = list;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return; // อย่ารบกวนตอนพิมพ์
      if (['home', 'cart'].includes(S.screen) || (S.screen === 'admin' && S.adminTab === 'products')) render();
    });
    es.addEventListener('settings', (e) => {
      try { S.settings = JSON.parse(e.data); } catch { return; }
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      if (['home', 'cart', 'checkout'].includes(S.screen)) render();
    });
  } catch {}
}

// ================================================================
// จำกัดให้ใช้บนมือถือเท่านั้น (มีลิงก์เล็ก ๆ ให้เปิดบนคอมต่อได้)
// ================================================================
function isMobileDevice() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod|iPad|IEMobile|BlackBerry|Opera Mini|Mobile|webOS/i.test(ua)) return true;
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  return !!coarse && Math.min(window.innerWidth, window.innerHeight) <= 820;
}
function showDesktopBlock() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0a0910;background-image:radial-gradient(circle at 30% 15%,#1a1526,#08070d);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px;color:#f2eefb;font-family:\'Prompt\',sans-serif';
  d.innerHTML = `<img src="assets/logo.png" alt="FLASH SMOKE" style="width:230px;max-width:72%;filter:drop-shadow(0 18px 40px rgba(124,58,237,.5))">
    <div style="font-size:21px;font-weight:700;margin-top:26px">เว็บนี้ใช้งานผ่านมือถือเท่านั้น 📱</div>
    <div style="font-size:14px;color:#9a90b0;margin-top:10px;line-height:1.6;max-width:340px">กรุณาเปิดลิงก์นี้บนสมาร์ทโฟน<br>เพื่อสั่งพอตในตัวเมืองชุมพร</div>
    <button id="fs-desktop-continue" style="margin-top:30px;color:#6a6280;font-size:12.5px;text-decoration:underline;text-underline-offset:3px;background:none;border:none;cursor:pointer;font-family:inherit">เข้าใช้งานบนคอมพิวเตอร์ต่อไป</button>`;
  document.body.appendChild(d);
  d.querySelector('#fs-desktop-continue').onclick = () => { localStorage.setItem('fs_allow_desktop', '1'); location.reload(); };
}

// ================================================================
// Boot
// ================================================================
function readHash() {
  const h = location.hash || '';
  if (h.startsWith('#token=')) { API.setToken(h.slice(7)); history.replaceState(null, '', location.pathname); return true; }
  const m = h.match(/lineerror=(\w+)/);
  if (m) { pendingLineError = m[1]; history.replaceState(null, '', location.pathname); }
  return false;
}
async function boot() {
  if (!isMobileDevice() && localStorage.getItem('fs_allow_desktop') !== '1') { showDesktopBlock(); return; }
  readHash();
  connectStream();
  await loadSettings();
  if (API.token) {
    try {
      const me = await API.get('/api/me'); S.user = me.user;
      if (me.user.role === 'admin') { await adminLoad(); S.screen = 'admin'; }
      else { await loadUserData(); S.screen = 'home'; }
    } catch { API.setToken(''); S.screen = 'welcome'; }
  } else { await loadProducts(); }
  render();
  maybeShowAd();
  if (pendingLineError) {
    const msg = { notconfigured: 'ยังไม่ได้ตั้งค่า LINE Login (ผู้ดูแลต้องใส่ Channel ID/Secret)', state: 'เซสชันหมดอายุ ลองเข้าสู่ระบบใหม่', failed: 'เข้าสู่ระบบด้วย LINE ไม่สำเร็จ' }[pendingLineError] || 'เข้าสู่ระบบ LINE ไม่สำเร็จ';
    toast(msg); pendingLineError = '';
  }
}
boot();
})();
