/**
 * ==========================================
 * DASHBOARD V2 - LOGIC
 * Tích hợp với DenyPanel API thực
 * ==========================================
 */

/**
 * ==========================================
 * CURRENCY SWITCHER - USD ↔ VND
 * ==========================================
 */
// Tỷ giá USD → VND (sẽ được cập nhật thực từ DenyPanel khi load trang)
let VND_RATE = 26294.5; // Tỷ giá DenyPanel thực (cập nhật động từ /api/rate)

/** Lấy đơn vị tiền hiện tại từ localStorage */
function getCurrency() {
  return localStorage.getItem('currency') || 'USD';
}

/** Đặt đơn vị tiền và refresh giá */
function setCurrency(currency) {
  localStorage.setItem('currency', currency);
  refreshPrices();
  updateCurrencyUI();
}

/** Format tiền theo đơn vị hiện tại (số dư, chi phí) */
function formatMoney(usdAmount) {
  const amount = parseFloat(usdAmount || 0);
  if (getCurrency() === 'VND') {
    const vnd = amount * VND_RATE;
    // Dùng dấu phẩy ngăn cách nghìn (kiểu quốc tế): 1,314,725 ₫
    return vnd.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' ₫';
  }
  return '$' + amount.toFixed(2);
}

/** Format giá dịch vụ /1000 đơn vị (giống DenyPanel: 73617.60 ₫) */
function formatRate(usdRate) {
  const rate = parseFloat(usdRate || 0);
  if (getCurrency() === 'VND') {
    const vnd = rate * VND_RATE;
    // Giống DenyPanel: không dùng dấu phân cách nghìn, 2 chữ số thập phân
    return vnd.toFixed(2) + ' ₫';
  }
  return '$' + rate;
}

/** Cập nhật hiển thị nút currency trong UI */
function updateCurrencyUI() {
  const cur = getCurrency();
  const btn = document.getElementById('currencyToggleBtn');
  if (btn) {
    btn.innerHTML = cur === 'VND'
      ? '<i class="fas fa-dong-sign"></i> VND'
      : '<i class="fas fa-dollar-sign"></i> USD';
  }
  // Ẩn icon $ khi dùng VND (vì số tiền đã kèm ₫ rồi)
  const balIcon = document.getElementById('balanceCurrencyIcon');
  if (balIcon) balIcon.style.display = cur === 'VND' ? 'none' : 'inline';

  // Update dropdown options
  const optUSD = document.getElementById('currencyOptUSD');
  const optVND = document.getElementById('currencyOptVND');
  if (optUSD) optUSD.classList.toggle('active', cur === 'USD');
  if (optVND) optVND.classList.toggle('active', cur === 'VND');
}

/** Refresh lại tất cả giá trên trang */
function refreshPrices() {
  // Rebuild service dropdowns với giá mới
  const homeC = document.getElementById('homeCategorySelect');
  const pageC = document.getElementById('pageCategorySelect');
  if (homeC?.value) populateServiceSel('homeServiceSelect', homeC.value);
  // Re-render services page với giá đúng
  if (allServicesData.length) renderSvcPage();
  if (pageC?.value) populateServiceSel('pageServiceSelect', pageC.value);

  // Recalc cost
  homeCalcCost();
  pageCalcCost();

  // Balance
  const user = getUserData();
  const bal = parseFloat(user.balance || 0);
  safeSet('balanceDisplay', formatMoney(bal));
  safeSet('balanceStat', formatMoney(bal));
  safeSet('profileBalance', formatMoney(bal));
}


// ==========================================
// INIT - Firebase Auth
// ==========================================

// Biến global lưu thông tin user từ Firebase
let _firebaseUser = null;
let _userProfile = null;

document.addEventListener('DOMContentLoaded', () => {
  // Dùng Firebase Auth thay vì localStorage
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    _firebaseUser = user;
    // Load profile từ Firestore
    _userProfile = await getUserProfile(user.uid);
    if (!_userProfile) {
      // Tạo profile mặc định nếu chưa có (fallback)
      _userProfile = {
        username: user.email.split('@')[0],
        email: user.email,
        balance: 0,
        role: 'user',
        totalOrders: 0
      };
    }
    initDashboard();
  });
});

/** Toggle dropdown tiền tệ */
function toggleCurrencyDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('currencyDropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

async function initDashboard() {
  const profile = _userProfile;
  const name = profile.username || 'User';

  // Set welcome name
  safeSet('welcomeName', name);
  safeSet('profileNameDisplay', name);
  safeSet('profileEmailDisplay', profile.email || '');
  safeSet('settUsernameV2', name, 'value');
  safeSet('settEmailV2', profile.email || '', 'value');
  safeSet('emptyOrdersUser', name);

  // Update top bar avatar initial
  const avatarBtn = document.getElementById('userAvatarBtn');
  if (avatarBtn) avatarBtn.textContent = name[0]?.toUpperCase() || 'D';

  // Affiliate link
  safeSet('affLinkV2', `https://denypanel.com/ref/${name}`, 'textContent');

  // Show home page
  showPage('home', document.getElementById('sb-home'));

  // Load data in order
  VND_RATE = await DenyPanelAPI.getExchangeRate();

  await refreshBalance();
  await loadAllServices();
  updateStats();
  loadOrdersPage();

  // Init currency UI
  updateCurrencyUI();

  // Close currency dropdown khi click ngoài
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.currency-switcher-wrap')) {
      const dd = document.getElementById('currencyDropdown');
      if (dd) dd.style.display = 'none';
    }
  });

  // Bắt đầu auto-refresh trạng thái đơn hàng mỗi 60s
  startAutoRefreshOrders();
}

// ==========================================
// BALANCE - Quản lý số dư web con (độc lập với DenyPanel)
// ==========================================
async function refreshBalance() {
  // Lấy số dư từ Firestore (do admin quản lý)
  if (_firebaseUser) {
    const fresh = await getUserProfile(_firebaseUser.uid);
    if (fresh) _userProfile = fresh;
  }
  const bal = parseFloat(_userProfile?.balance || 0);
  safeSet('balanceDisplay', formatMoney(bal));
  safeSet('balanceStat', formatMoney(bal));
}

// ==========================================
// STATS
// ==========================================
function updateStats() {
  const orders = getLocalOrders();
  safeSet('totalOrdersStat', orders.length);
  safeSet('profileOrders', _userProfile?.totalOrders || orders.length);
  safeSet('profileBalance', formatMoney(_userProfile?.balance || 0));
}

// ==========================================
// SERVICES DATA
// ==========================================
let allServicesData = [];
let currentSvcFilter = 'all';

async function loadAllServices() {
  allServicesData = await DenyPanelAPI.getServices();
  buildCategorySelects();
  buildCustomCategoryDropdown(); // Build custom icon dropdown
  renderSvcPage();
}


// ==========================================
// PLATFORM ICON MAPPING (Exact match DenyPanel)
// ==========================================
function getPlatformIcon(category) {
  const cat = (category || '').toLowerCase();

  // Telegram
  if (cat.includes('telegram')) return '\u2708\uFE0F';

  // Twitter/X
  if (cat.includes('twitter') || cat.includes('x c\u1ed5') || cat.includes('x - ')) return '\uD83D\uDC26';

  // Instagram
  if (cat.includes('instagram') || cat.includes('threads') || cat.includes('tick xanh')) return '\uD83D\uDCF7';

  // TikTok
  if (cat.includes('tiktok')) return '\uD83C\uDFB5';

  // YouTube (all sub-types)
  if (cat.includes('youtube') || cat.includes('yt') || cat.includes('native ads') || cat.includes('adsword') || cat.includes('watchtime') || cat.includes('short view') || cat.includes('livestream') || cat.includes('live stream') || cat.includes('subscriber')) return '\u25B6\uFE0F';

  // Facebook
  if (cat.includes('facebook') || cat.includes('fanpage') || cat.includes('dich vu facebook') || cat.includes('d\u1ecbch v\u1ee5 facebook')) return 'f';

  // Spotify
  if (cat.includes('spotify')) return '\uD83C\uDFB6';

  // SoundCloud
  if (cat.includes('soundcloud')) return '\u2601\uFE0F';

  // Discord
  if (cat.includes('discord')) return '\uD83D\uDC7E';

  // Twitch
  if (cat.includes('twitch')) return '\uD83D\uDFE3';

  // Reddit
  if (cat.includes('reddit')) return '\uD83D\uDC7D';

  // Snapchat
  if (cat.includes('snapchat')) return '\uD83D\uDC7B';

  // Pinterest
  if (cat.includes('pinterest')) return '\uD83D\uDCCC';

  // LinkedIn
  if (cat.includes('linkedin')) return '\uD83D\uDCBC';

  // Website Traffic
  if (cat.includes('website') || cat.includes('traffic') || cat.includes('web traffic')) return '\uD83C\uDF10';

  // Other
  return '\u26AA';
}

function buildCategorySelects() {
  const categories = [...new Set(allServicesData.map(s => s.category))];

  const homeC = document.getElementById('homeCategorySelect');
  const pageC = document.getElementById('pageCategorySelect');

  [homeC, pageC].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Ch\u1ecdn m\u1ee5c --</option>';
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = getPlatformIcon(cat) + ' ' + cat;
      sel.appendChild(opt);
    });
  });
}

function getServicesByCategory(cat) {
  return allServicesData.filter(s => s.category === cat);
}

function populateServiceSel(selId, cat) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Ch\u1ecdn d\u1ecbch v\u1ee5 --</option>';
  getServicesByCategory(cat).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.service;
    // Format: icon Tên - rate VND/1k
    const icon = getPlatformIcon(s.category);
    opt.textContent = icon + ' ' + s.name + ' - ' + formatRate(s.rate) + '/1k';
    opt.dataset.rate = s.rate;
    opt.dataset.min = s.min;
    opt.dataset.max = s.max;
    opt.dataset.name = s.name;
    opt.dataset.desc = s.name; // store for description
    sel.appendChild(opt);
  });
}

// Home page
function homeOnCategoryChange() {
  const cat = document.getElementById('homeCategorySelect')?.value;
  populateServiceSel('homeServiceSelect', cat);
}

function homeOnServiceChange() {
  homeCalcCost();
}

function homeCalcCost() {
  const sel = document.getElementById('homeServiceSelect');
  const opt = sel?.options[sel.selectedIndex];
  const qty = parseInt(document.getElementById('homeOrderQty')?.value) || 0;
  const cost = opt?.dataset?.rate && qty ? (qty / 1000) * parseFloat(opt.dataset.rate) : 0;
  safeSet('homeCostDisplay', formatMoney(cost));
}

// Order page
function pageOnCategoryChange() {
  const cat = document.getElementById('pageCategorySelect')?.value;
  populateServiceSel('pageServiceSelect', cat);
}

function pageOnServiceChange() {
  const sel = document.getElementById('pageServiceSelect');
  const opt = sel?.options[sel.selectedIndex];
  if (!opt?.value) {
    safeSet('sipId', '-');
    safeSet('sipName', '-');
    safeSet('sipMinMax', '-- \u2022 --');
    document.getElementById('sipHeader').style.display = 'none';
    safeSet('sipDesc', '<h4>M\u00f4 t\u1ea3</h4><p style="color:var(--gray);font-style:italic">Ch\u1ecdn m\u1ed9t d\u1ecbch v\u1ee5 \u0111\u1ec3 xem th\u00f4ng tin chi ti\u1ebft...</p>', 'innerHTML');
    safeSet('sipTime', '--');
    safeSet('sipQuality', 'R\u1ea5t t\u1ed1t');
    safeSet('sipSpeed', '--');
    safeSet('sipWarranty', '--');
    safeSet('sipLink', '--');
    pageCalcCost();
    return;
  }

  // Show service info panel
  document.getElementById('sipHeader').style.display = 'flex';
  const svcId = opt.value;
  safeSet('sipId', svcId);
  safeSet('sipName', opt.dataset.name || opt.textContent);
  safeSet('sipMinMax', `${opt.dataset.min} \u2022 ${opt.dataset.max}`);

    // Set input min/max
  const qtyInput = document.getElementById('pageOrderQty');
  if (qtyInput) {
    qtyInput.min = opt.dataset.min;
    qtyInput.max = opt.dataset.max;
    if (!qtyInput.value || parseInt(qtyInput.value) < parseInt(opt.dataset.min)) {
      qtyInput.value = opt.dataset.min;
      pageCalcCost();
    }
  }

  // Find full service info from API data
  const svc = allServicesData.find(s => s.service == svcId);
  if (svc) {
    const speed = svc.avg_time ? svc.avg_time : '5k/Ng\u00e0y';
    const warranty = svc.refill ? '30 Ng\u00e0y' : 'Kh\u00f4ng b\u1ea3o h\u00e0nh';
    const icon = getPlatformIcon(svc.category);

    safeSet('sipSpeed', speed);
    safeSet('sipWarranty', warranty);
    safeSet('sipLink', 'URL / Link');
    safeSet('sipTime', svc.avg_time || '\u0110ang t\u00ednh to\u00e1n');
    safeSet('sipQuality', 'R\u1ea5t T\u1ed1t');

    // Build chi ti\u1ebft m\u00f4 t\u1ea3
    const descHtml = `
      <h4>M\u00f4 t\u1ea3</h4>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:12px;color:var(--gray2);line-height:1.9;white-space:pre-line">
        <strong style="color:var(--white)">${icon} ${esc(svc.name)}</strong>\n\n
Speed: ${speed}\nRefill: ${warranty}\nQuality: Rất Tốt\nLink: URL / Link\n\nGiá: <span style="color:var(--green);font-weight:700">${formatRate(svc.rate)}/1000 đơn vị</span>\nTối thiểu: ${Number(svc.min).toLocaleString()} | Tối đa: ${Number(svc.max).toLocaleString()}\n\nLoại: ${svc.type}
      </div>`;
    safeSet('sipDesc', descHtml, 'innerHTML');
  }

  pageCalcCost();
}

function pageCalcCost() {
  const sel = document.getElementById('pageServiceSelect');
  const opt = sel?.options[sel.selectedIndex];
  const qty = parseInt(document.getElementById('pageOrderQty')?.value) || 0;
  const cost = opt?.dataset?.rate && qty ? (qty / 1000) * parseFloat(opt.dataset.rate) : 0;
  safeSet('pageCostDisplay', formatMoney(cost));
}

// ==========================================
// PLACE ORDER
// ==========================================
async function homePlaceOrder() { await _placeOrder('home'); }
async function pagePlaceOrder() { await _placeOrder('page'); }
function homeAddToCart() { showToastV2('Đã thêm vào giỏ hàng!', 'ok'); }

async function _placeOrder(prefix) {
  const sel = document.getElementById(`${prefix}ServiceSelect`);
  const link = document.getElementById(`${prefix}OrderLink`)?.value.trim();
  const qty = parseInt(document.getElementById(`${prefix}OrderQty`)?.value);
  const msgBox = document.getElementById(`${prefix}OrderMsg`);
  const opt = sel?.options[sel.selectedIndex];

  if (!opt?.value) { showMsg(msgBox, '⚠️ Vui lòng chọn dịch vụ!', 'err'); return; }
  if (!link) { showMsg(msgBox, '⚠️ Vui lòng nhập link!', 'err'); return; }

  const min = parseInt(opt.dataset.min || 1);
  const max = parseInt(opt.dataset.max || 999999);
  if (!qty || qty < min || qty > max) {
    showMsg(msgBox, `⚠️ Số lượng phải từ ${min.toLocaleString()} đến ${max.toLocaleString()}!`, 'err');
    return;
  }

  const cost = (qty / 1000) * parseFloat(opt.dataset.rate);

  // Lấy số dư mới nhất từ Firestore (tránh dùng cache cũ)
  if (_firebaseUser) {
    const fresh = await getUserProfile(_firebaseUser.uid);
    if (fresh) _userProfile = fresh;
  }
  const balance = parseFloat(_userProfile?.balance || 0);

  if (cost > balance) {
    showMsg(msgBox,
      `⚠️ Số dư không đủ!<br>💰 Cần: <strong>${formatMoney(cost)}</strong><br>💳 Số dư hiện tại: <strong>${formatMoney(balance)}</strong><br>→ Còn thiếu: <strong>${formatMoney(cost - balance)}</strong>`,
      'err');
    return;
  }

  // Disable buttons
  const btn = document.getElementById('btnDatHang') || document.querySelector(`#page-${prefix === 'home' ? 'home' : 'order'} .btn-dat-hang`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đặt hàng...'; }

  if (msgBox) msgBox.style.display = 'none';

  const result = await DenyPanelAPI.addOrder(opt.value, link, qty);

  if (result.success) {
    // Trừ số dư trong Firestore (không dùng localStorage)
    const newBalance = (balance - cost);
    if (_firebaseUser) {
      await updateBalance(_firebaseUser.uid, newBalance);
      _userProfile.balance = newBalance;
    }

    const order = {
      orderId: result.orderId,
      serviceId: parseInt(opt.value),
      serviceName: opt.dataset.name || opt.textContent.split(' - ')[0],
      link,
      quantity: qty,
      charge: parseFloat(cost.toFixed(4)),
      status: 'pending',
      remains: qty,
      refill: false,
      demo: result.demo || false
    };

    // Lưu đơn vào Firestore theo từng user (cô lập hoàn toàn)
    if (_firebaseUser) {
      await saveOrder(_firebaseUser.uid, order);
    }

    showMsg(msgBox, `✅ Đặt hàng thành công! Order ID: #${result.orderId}${result.demo ? ' (Demo)' : ''}`, 'ok');
    showToastV2(`✅ Đặt hàng thành công! #${result.orderId}`, 'ok');

    // Reset form
    sel.value = '';
    document.getElementById(`${prefix}OrderLink`).value = '';
    document.getElementById(`${prefix}OrderQty`).value = '';
    safeSet(`${prefix}CostDisplay`, '0 ₫');

    await refreshBalance();
    updateStats();
    loadOrdersPage();

    simulateProgress(result.orderId);
  } else {
    showMsg(msgBox, `❌ Lỗi: ${result.error || 'Không thể đặt hàng'}`, 'err');
    showToastV2('❌ Đặt hàng thất bại!', 'err');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shopping-bag"></i> Đặt hàng'; }
}

function simulateProgress(orderId) {
  setTimeout(() => {
    const orders = getLocalOrders();
    const o = orders.find(x => x.id == orderId);
    if (o && o.status === 'pending') { o.status = 'in_progress'; saveLocalOrders(orders); loadOrdersPage(); }
  }, 8000);
  setTimeout(() => {
    const orders = getLocalOrders();
    const o = orders.find(x => x.id == orderId);
    if (o && o.status === 'in_progress') {
      o.status = 'completed'; o.remains = 0;
      saveLocalOrders(orders); loadOrdersPage();
      showToastV2(`✅ Đơn hàng #${orderId} hoàn thành!`, 'ok');
    }
  }, 60000);
}

// ==========================================
// ORDERS PAGE
// ==========================================
// Firestore orders (per-user, cô lập hoàn toàn)
async function loadOrdersPage() {
  let orders = [];
  if (_firebaseUser) {
    orders = await getUserOrders(_firebaseUser.uid);
  }
  renderOrdersPage(orders);
  updateStats();
}

// Legacy localStorage (chỉ dùng cho simulateProgress)
function getLocalOrders() { try { return JSON.parse(localStorage.getItem('dp_orders_' + (_firebaseUser?.uid||'')) || '[]'); } catch { return []; } }
function saveLocalOrders(orders) { localStorage.setItem('dp_orders_' + (_firebaseUser?.uid||''), JSON.stringify(orders)); }

function renderOrdersPage(ordersIn) {
  const container = document.getElementById('ordersPageContainer');
  if (!container) return;

  const orders = ordersIn || [];
  const search = (document.getElementById('orderSearchInput')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('statusFilterSel')?.value || '';

  let filtered = orders;
  if (search) filtered = filtered.filter(o => o.serviceName?.toLowerCase().includes(search) || String(o.orderId||o.id).includes(search));
  if (statusFilter) filtered = filtered.filter(o => o.status === statusFilter);

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-orders-box">
        <p style="font-size:50px;margin-bottom:16px">📭</p>
        <p>Xin chào <strong>${_userProfile?.username || 'bạn'}</strong>, ${search || statusFilter ? 'không tìm thấy đơn hàng phù hợp.' : 'bạn chưa từng đặt hàng trước đây.'}<br>
        ${!search && !statusFilter ? 'Bạn có thể thêm số dư và đặt bất kỳ dịch vụ nào trên trang <strong>Đơn đặt hàng mới.</strong>' : ''}</p>
        ${!search && !statusFilter ? '<br><button class="btn-dat-hang" style="display:inline-flex;padding:12px 28px" onclick="showPage(\'funds\',null)"><i class="fas fa-wallet"></i> Nạp tiền</button>' : ''}
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow-x:auto">
      <table class="data-table-v2">
        <thead>
          <tr>
            <th>ID</th><th>Dịch vụ</th><th>Link</th><th>Số lượng</th><th>Còn lại</th><th>Chi phí</th><th>Trạng thái</th><th>Hành động</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(o => `
            <tr>
              <td><span style="background:var(--green3);color:var(--green);padding:3px 8px;border-radius:6px;font-weight:700;font-size:12px">#${o.orderId||o.id}</span></td>
              <td style="max-width:200px;font-size:12px">${o.serviceName}</td>
              <td style="max-width:150px"><a href="${o.link}" target="_blank" style="color:var(--indigo);font-size:12px;white-space:nowrap;overflow:hidden;display:block;text-overflow:ellipsis;max-width:150px">${o.link}</a></td>
              <td>${Number(o.quantity).toLocaleString()}</td>
              <td style="color:var(--gray2)">${o.remains !== undefined ? Number(o.remains).toLocaleString() : '--'}</td>
              <td style="color:var(--green);font-weight:700">${formatMoney(o.charge||0)}</td>
              <td><span class="status-pill ${o.status}">${getStatusLabel(o.status)}</span></td>
              <td><button onclick="checkOrderById(${o.orderId||o.id})" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:5px 10px;color:var(--gray2);cursor:pointer;font-size:11px"><i class="fas fa-sync-alt"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

// Map trạng thái DenyPanel → code nội bộ
function mapDenyPanelStatus(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'completed') return 'completed';
  if (s === 'canceled' || s === 'cancelled') return 'canceled';
  if (s === 'partial') return 'partial';
  if (s === 'in progress') return 'in_progress';
  if (s === 'processing') return 'in_progress';
  return 'pending';
}

async function checkOrderById(orderId) {
  if (!orderId) return;
  showToastV2('🔄 Đang đồng bộ trạng thái...', 'info');

  try {
    const result = await DenyPanelAPI.getOrderStatus(orderId);
    if (!result.success) { showToastV2('❌ Không lấy được trạng thái', 'err'); return; }

    const newStatus = mapDenyPanelStatus(result.status);
    const remains = parseInt(result.remains) || 0;

    // Cập nhật Firestore
    if (_firebaseUser) {
      const ordersSnap = await db.collection('users').doc(_firebaseUser.uid)
        .collection('orders').where('orderId', '==', parseInt(orderId)).get();

      if (!ordersSnap.empty) {
        await ordersSnap.docs[0].ref.update({ status: newStatus, remains });
      }
    }

    // Reload UI
    await loadOrdersPage();

    const statusVi = { completed:'Hoàn thành ✅', in_progress:'Đang chạy ⚡', canceled:'Đã hủy ❌', partial:'Hoàn thành một phần ⚠️', pending:'Chờ xử lý 🕐' };
    showToastV2(`Đơn #${orderId}: ${statusVi[newStatus] || newStatus}`, newStatus === 'completed' ? 'ok' : 'info');
  } catch(e) {
    showToastV2('Lỗi: ' + e.message, 'err');
  }
}

// Auto-refresh trạng thái đơn đang chờ/đang chạy (mỗi 60 giây)
let _autoRefreshTimer = null;
async function startAutoRefreshOrders() {
  clearInterval(_autoRefreshTimer);
  _autoRefreshTimer = setInterval(async () => {
    if (!_firebaseUser) return;
    const orders = await getUserOrders(_firebaseUser.uid);
    const activeOrders = orders.filter(o => o.status === 'pending' || o.status === 'in_progress');
    if (!activeOrders.length) return;

    for (const o of activeOrders) {
      await checkOrderById(o.orderId);
      await new Promise(r => setTimeout(r, 500)); // Delay giữa các request
    }
  }, 60000); // 60 giây
}

function toggleOrderFilter() { showToastV2('Bộ lọc nâng cao sắp ra mắt!', 'info'); }

// ==========================================
// ADD FUNDS - VCB QR Auto Deposit
// ==========================================
// Tài khoản nhận tiền (Sepay API Banking):
const VCB_ACCOUNT   = '96247NDQTE';   // Số TK ảo BIDV (VA - Virtual Account Sepay)
const VCB_OWNER     = 'LE XUAN DANG';
const VCB_BANK_CODE = 'BIDV';          // Mã ngân hàng VietQR
const REAL_ACCOUNT  = '8837755253';   // Số TK BIDV thực (dùng Sepay API)
const DEPOSIT_TIMEOUT_MS = 15 * 60 * 1000; // 15 phút
const POLL_INTERVAL_MS   = 20 * 1000;       // Poll mỗi 20 giây

let _depositTimer    = null; // countdown interval
let _depositPoll     = null; // polling interval
let _depositExpiry   = null; // expiry timestamp
let _depositRef      = null; // mã giao dịch
let _depositAmount   = 0;

// Sinh mã ngẫu nhiên 8 ký tự in hoa
function genRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = 'BUILOC';
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function previewFundUsd() {
  const vnd = parseFloat(document.getElementById('fundAmountInput')?.value) || 0;
  const el = document.getElementById('fundUsdPreview');
  if (el) el.textContent = vnd > 0 ? `≈ $${(vnd / 26294.5).toFixed(2)} USD` : '';
}

async function startDeposit() {
  const msgBox = document.getElementById('fundErrorMsg');
  const amount = parseFloat(document.getElementById('fundAmountInput')?.value);

  if (!amount || amount < 10000) {
    showMsg(msgBox, '⚠️ Số tiền tối thiểu là 10,000 ₫', 'err');
    return;
  }
  if (!_firebaseUser) {
    showMsg(msgBox, '⚠️ Bạn chưa đăng nhập!', 'err');
    return;
  }
  if (msgBox) msgBox.style.display = 'none';

  _depositAmount = amount;
  _depositRef    = genRef();
  _depositExpiry = Date.now() + DEPOSIT_TIMEOUT_MS;

  // Lưu lệnh nạp tiền vào Firestore (để server có thể match)
  try {
    await db.collection('pending_deposits').doc(_depositRef).set({
      uid: _firebaseUser.uid,
      email: _userProfile?.email || _firebaseUser.email,
      amount: _depositAmount,
      ref: _depositRef,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(_depositExpiry)
    });
  } catch(e) { console.warn('Deposit Firestore save:', e.message); }

  // Hiển thị modal
  const modal = document.getElementById('qrPayModal');
  document.getElementById('qrAmountDisplay').textContent = amount.toLocaleString('vi-VN') + ' ₫';
  document.getElementById('qrRefCode').textContent = _depositRef;

  // QR dùng VietQR.io: tự điền sẵn số tiền + nội dung
  const qrUrl = `https://img.vietqr.io/image/${VCB_BANK_CODE}-${VCB_ACCOUNT}-qr_only.jpg?amount=${amount}&addInfo=${encodeURIComponent(_depositRef)}&accountName=${encodeURIComponent(VCB_OWNER)}`;
  document.getElementById('qrCodeImg').src = qrUrl;

  modal.style.display = 'flex';
  document.getElementById('qrStatus').textContent = 'Hệ thống đang tự động kiểm tra giao dịch...';

  // Countdown timer
  _depositTimer = setInterval(() => {
    const remaining = _depositExpiry - Date.now();
    if (remaining <= 0) {
      expireDeposit();
      return;
    }
    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);
    const el = document.getElementById('qrCountdown');
    if (el) el.textContent = `${min}:${sec.toString().padStart(2,'0')}`;
  }, 1000);

  // Polling mỗi 20 giây
  _depositPoll = setInterval(pollDeposit, POLL_INTERVAL_MS);
}

async function pollDeposit() {
  if (!_depositRef || !_firebaseUser) return;

  try {
    // Kiểm tra Firestore xem admin/webhook đã duyệt chưa
    const doc = await db.collection('pending_deposits').doc(_depositRef).get();
    if (!doc.exists) return;
    const data = doc.data();

    if (data.status === 'completed') {
      clearDeposit();
      // Reload balance
      const fresh = await getUserProfile(_firebaseUser.uid);
      if (fresh) _userProfile = fresh;
      refreshBalance();
      document.getElementById('qrPayModal').style.display = 'none';
      showToastV2(`✅ Nạp tiền thành công! +${_depositAmount.toLocaleString('vi-VN')} ₫`, 'ok');
      return;
    }

    // Cũng gọi API kiểm tra trực tiếp
    const resp = await fetch(`/api/payment?ref=${_depositRef}`);
    const result = await resp.json();

    if (result.found) {
      clearDeposit();
      const fresh = await getUserProfile(_firebaseUser.uid);
      if (fresh) _userProfile = fresh;
      refreshBalance();
      document.getElementById('qrPayModal').style.display = 'none';
      showToastV2(`✅ Nạp tiền thành công! +${_depositAmount.toLocaleString('vi-VN')} ₫`, 'ok');
    }
  } catch(e) {
    console.warn('Poll deposit:', e.message);
  }
}

function expireDeposit() {
  clearDeposit();
  const el = document.getElementById('qrStatus');
  const countdown = document.getElementById('qrCountdown');
  if (el) el.innerHTML = '❌ <span style="color:#ff4444">Hết thời gian! Lệnh nạp đã hủy.</span>';
  if (countdown) { countdown.textContent = '00:00'; countdown.style.color = '#ff4444'; }

  // Đánh dấu expired trong Firestore
  if (_depositRef) {
    db.collection('pending_deposits').doc(_depositRef).update({ status: 'expired' }).catch(()=>{});
  }

  setTimeout(() => {
    document.getElementById('qrPayModal').style.display = 'none';
  }, 4000);
}

function cancelDeposit() {
  clearDeposit();
  if (_depositRef) {
    db.collection('pending_deposits').doc(_depositRef).update({ status: 'cancelled' }).catch(()=>{});
  }
  document.getElementById('qrPayModal').style.display = 'none';
}

function clearDeposit() {
  clearInterval(_depositTimer);
  clearInterval(_depositPoll);
  _depositTimer = null;
  _depositPoll  = null;
  _depositRef   = null;
}

function copyRefCode() {
  const code = document.getElementById('qrRefCode')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => showToastV2('✅ Đã copy mã!', 'ok'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToastV2('✅ Đã copy mã!', 'ok');
    });
}

function copyText(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim()).then(() => {
    showToastV2('✅ Đã copy!', 'ok');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = el.textContent.trim();
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToastV2('✅ Đã copy!', 'ok');
  });
}

function submitFundRequest() {
  // Legacy - không dùng nữa
  showToastV2('Vui lòng dùng chuyển khoản VCB tự động!', 'info');
}

// ==========================================
// SERVICES PAGE
// ==========================================
function filterSvcPage(platform, btn) {
  currentSvcFilter = platform;
  document.querySelectorAll('.plat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSvcPage();
}

function renderSvcPage() {
  const container = document.getElementById('svcPageBody');
  if (!container || !allServicesData.length) return;

  const search = (document.getElementById('svcPageSearch')?.value || '').toLowerCase();
  let filtered = allServicesData;

  if (currentSvcFilter !== 'all') filtered = filtered.filter(s => s.category.toLowerCase().includes(currentSvcFilter.toLowerCase()));
  if (search) filtered = filtered.filter(s => s.name.toLowerCase().includes(search) || String(s.service).includes(search));

  if (!filtered.length) { container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--gray)">Không tìm thấy dịch vụ</div>'; return; }

  const cats = {};
  filtered.forEach(s => { if (!cats[s.category]) cats[s.category] = []; cats[s.category].push(s); });

  let html = '';
  for (const [cat, services] of Object.entries(cats)) {
    html += `<div class="svc-category-row"><i class="fas fa-tag"></i> ${esc(cat)}</div>`;
    services.forEach(s => {
      const avgTime = s.avg_time || 'Đang tính toán';
      const refillText = s.refill ? '30 Ngày' : 'Không bảo hành';
      const dataStr = encodeURIComponent(JSON.stringify({
        id: s.service, name: s.name, rate: s.rate,
        min: s.min, max: s.max, refill: refillText,
        avg_time: avgTime, type: s.type
      }));
      html += `
        <div class="svc-service-row" style="grid-template-columns:30px 80px 1fr 130px 80px 100px 130px auto">
          <div><button class="fav-btn" onclick="this.classList.toggle('active')" title="Yêu thích"><i class="fas fa-heart"></i></button></div>
          <div><span class="svc-id-tag">${s.service}</span></div>
          <div>
            <div class="svc-name-main">${esc(s.name)}</div>
            ${s.type && s.type !== 'Default' ? `<div class="svc-type-tag">${esc(s.type)}</div>` : ''}
          </div>
          <div class="svc-rate-v2">${formatRate(s.rate)}<span style="font-size:10px;color:var(--gray);font-weight:400">/1k</span></div>
          <div class="svc-num-v2">${Number(s.min).toLocaleString()}</div>
          <div class="svc-num-v2">${Number(s.max).toLocaleString()}</div>
          <div class="svc-time">${avgTime}</div>
          <div style="display:flex;gap:6px;align-items:flex-start;flex-wrap:nowrap">
            <button class="req-svc-btn" style="padding:6px 12px;white-space:nowrap;font-size:11px" onclick="openSvcDetailModal('${dataStr}')">Chi tiết</button>
            <button class="btn-dat-hang" style="padding:6px 14px;font-size:11px;border-radius:8px;box-shadow:none;white-space:nowrap" onclick="buyNowSvc(${s.service})">Mua ngay</button>
          </div>
        </div>`;
    });
  }
  container.innerHTML = html;
}

// ==========================================
// SERVICE DETAIL MODAL
// ==========================================
let _currentModalSvc = null;

function openSvcDetailModal(dataStr) {
  try {
    const s = JSON.parse(decodeURIComponent(dataStr));
    _currentModalSvc = s;
    safeSet('modalSvcId', s.id);
    safeSet('modalSvcName', s.name);
    safeSet('modalSvcRate', formatRate(s.rate) + ' /1k');
    safeSet('modalSvcMin', Number(s.min).toLocaleString());
    safeSet('modalSvcMax', Number(s.max).toLocaleString());
    safeSet('modalSvcSpeed', '5k/Ngày');
    safeSet('modalSvcRefill', s.refill);
    safeSet('modalSvcQuality', 'Rất Tốt');
    const desc = `Speed: 5k/Ngày\nRefill: ${s.refill}\nQuality: Rất Tốt\nLink: URL\n\n${s.name}\nGiá: ${formatRate(s.rate)} / 1000 đơn vị  ($${s.rate} USD)\nTối thiểu: ${s.min} | Tối đa: ${s.max}`;
    safeSet('modalSvcDesc', desc);
    const modal = document.getElementById('svcDetailModal');
    if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
  } catch(e) { console.error(e); }
}

function closeSvcModal() {
  const modal = document.getElementById('svcDetailModal');
  if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
}

function modalBuyNow() {
  closeSvcModal();
  if (_currentModalSvc) {
    buyNowSvc(_currentModalSvc.id);
  }
}

function buyNowSvc(serviceId) {
  // Chuyển sang trang đặt hàng và pre-select dịch vụ
  closeSvcModal();
  showPage('order', null);

  // Chờ trang load xong rồi chọn dịch vụ
  setTimeout(() => {
    const svc = allServicesData.find(s => s.service == serviceId);
    if (!svc) return;

    // Chọn mục
    const catSel = document.getElementById('pageCategorySelect');
    if (catSel) {
      catSel.value = svc.category;
      pageOnCategoryChange();
    }
    // Chờ options load rồi chọn service
    setTimeout(() => {
      const svcSel = document.getElementById('pageServiceSelect');
      if (svcSel) {
        svcSel.value = serviceId;
        pageOnServiceChange();
      }
    }, 100);
  }, 200);
}

// ==========================================
// REQUEST NEW SERVICE MODAL
// ==========================================
function openReqSvcModal() {
  const modal = document.getElementById('reqSvcModal');
  if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}

function closeReqSvcModal() {
  const modal = document.getElementById('reqSvcModal');
  if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
}

function submitReqSvc() {
  const name = document.getElementById('reqSvcName')?.value.trim();
  const price = document.getElementById('reqSvcPrice')?.value.trim();
  const target = document.getElementById('reqSvcTarget')?.value.trim();
  const msgBox = document.getElementById('reqSvcMsg');

  if (!name) { showMsg(msgBox, '⚠️ Vui lòng nhập tên dịch vụ!', 'err'); return; }

  showMsg(msgBox, '✅ Yêu cầu đã được gửi! Admin sẽ xem xét trong 24-48h.', 'ok');
  showToastV2('Yêu cầu dịch vụ đã được gửi!', 'ok');
  setTimeout(closeReqSvcModal, 2000);
}

// Close modals on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.id === 'svcDetailModal') closeSvcModal();
  if (e.target.id === 'reqSvcModal') closeReqSvcModal();
});

// ==========================================
// API TEST
// ==========================================
async function testApiCall() {
  const action = document.getElementById('testActionSel')?.value;
  const resultDiv = document.getElementById('apiTestResultV2');
  resultDiv.style.display = 'block';
  resultDiv.textContent = '⏳ Đang gọi API...';

  try {
    let result;
    if (action === 'balance') {
      result = await DenyPanelAPI.getBalance();
    } else {
      result = await DenyPanelAPI.getServices();
      if (Array.isArray(result)) result = result.slice(0, 3);
    }
    resultDiv.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    resultDiv.textContent = 'Lỗi: ' + err.message;
  }
}

// ==========================================
// PROFILE
// ==========================================
function saveProfileV2() {
  const newPass = document.getElementById('newPassV2')?.value;
  const confirmPass = document.getElementById('confirmPassV2')?.value;
  const msgBox = document.getElementById('profileMsgV2');

  if (newPass || confirmPass) {
    if (newPass !== confirmPass) { showMsg(msgBox, '⚠️ Mật khẩu xác nhận không khớp!', 'err'); return; }
    if (newPass.length < 6) { showMsg(msgBox, '⚠️ Mật khẩu phải ít nhất 6 ký tự!', 'err'); return; }
  }

  const user = getUserData();
  if (newPass) user.password = newPass;
  saveUserData(user);

  showMsg(msgBox, '✅ Lưu thành công!', 'ok');
  showToastV2('Cập nhật thành công!', 'ok');
}

// ==========================================
// NAVIGATION
// ==========================================
const PAGE_TITLES = {
  home: 'Đặt hàng',
  order: 'Đặt hàng mới',
  orders: 'Đơn Hàng',
  sub: 'Đặt Hàng Lớn',
  funds: 'Nạp tiền',
  services: 'Dịch vụ',
  api: 'API',
  affiliate: 'Đại lý',
  profile: 'Tài khoản'
};

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  if (btn) btn.classList.add('active');
  else {
    const sbBtn = document.getElementById('sb-' + name);
    if (sbBtn) sbBtn.classList.add('active');
  }
  safeSet('topTitle', PAGE_TITLES[name] || name);

  // Close expanded sidebar on mobile
  if (window.innerWidth < 768) {
    document.getElementById('sidebar')?.classList.remove('expanded');
  }

  if (name === 'orders') loadOrdersPage();
  if (name === 'funds') initFundsPage();
  if (name === 'profile') {
    const user = getUserData();
    safeSet('profileNameDisplay', user.username || 'dangxoai');
    safeSet('profileEmailDisplay', user.email || '');
    safeSet('settUsernameV2', user.username || 'dangxoai', 'value');
    safeSet('settEmailV2', user.email || '', 'value');
    if (document.getElementById('profileOrders')) document.getElementById('profileOrders').textContent = getLocalOrders().length;
    if (document.getElementById('profileBalance')) document.getElementById('profileBalance').textContent = '$' + parseFloat((getUserData().balance||0)).toFixed(2);
  }
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('expanded');
}

function logout() {
  localStorage.removeItem('dp_logged_in');
  window.location.href = 'login.html';
}

// Home page quick search by service ID
function filterHomeOrder() {
  const q = (document.getElementById('homeOrderSearch')?.value || '').toLowerCase().trim();
  if (!q) return;
  // Switch to service dropdown if typing ID
  const numId = parseInt(q);
  if (!isNaN(numId)) {
    const svc = allServicesData.find(s => s.service == numId);
    if (svc) {
      const catSel = document.getElementById('homeCategorySelect');
      if (catSel) { catSel.value = svc.category; homeOnCategoryChange(); }
      setTimeout(() => {
        const svcSel = document.getElementById('homeServiceSelect');
        if (svcSel) { svcSel.value = svc.service; homeCalcCost(); }
      }, 100);
    }
  }
}

// Order page search by service ID
function filterOrderSearch() {
  const q = (document.getElementById('orderPageSearch')?.value || '').toLowerCase().trim();
  if (!q) return;
  const numId = parseInt(q);
  if (!isNaN(numId)) {
    const svc = allServicesData.find(s => s.service == numId);
    if (svc) {
      const catSel = document.getElementById('pageCategorySelect');
      if (catSel) { catSel.value = svc.category; pageOnCategoryChange(); }
      setTimeout(() => {
        const svcSel = document.getElementById('pageServiceSelect');
        if (svcSel) { svcSel.value = svc.service; pageOnServiceChange(); }
      }, 100);
    } else {
      showToastV2('Không tìm thấy dịch vụ ID: ' + numId, 'err');
    }
  }
}


// ==========================================
// HELPERS
// ==========================================
function safeSet(id, val, prop = 'textContent') {
  const el = document.getElementById(id);
  if (el) el[prop] = val;
}

function showMsg(el, msg, type) {
  if (!el) return;
  el.className = type === 'ok' ? 'msg-ok' : 'msg-err';
  el.textContent = msg;
  el.style.display = 'block';
}

let toastTimer;
function showToastV2(msg, type = 'ok') {
  const toast = document.getElementById('toastV2');
  const msgEl = document.getElementById('toastMsg');
  if (!toast || !msgEl) return;
  clearTimeout(toastTimer);
  const icons = { ok: 'fa-check-circle', err: 'fa-times-circle', info: 'fa-info-circle' };
  toast.className = `toast-v2 ${type} show`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.ok}"></i> <span>${msg}</span>`;
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function getStatusLabel(status) {
  const map = {
    pending: '<i class="fas fa-clock"></i> Chờ xử lý',
    in_progress: '<i class="fas fa-spinner fa-spin"></i> Đang xử lý',
    processing: '<i class="fas fa-spinner fa-spin"></i> Đang xử lý',
    completed: '<i class="fas fa-check-circle"></i> Hoàn thành',
    partial: '<i class="fas fa-adjust"></i> Một phần',
    cancelled: '<i class="fas fa-times-circle"></i> Đã hủy'
  };
  return map[status] || status;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToastV2('✅ Đã sao chép!', 'ok'))
    .catch(() => showToastV2('Không thể sao chép', 'err'));
}

function toggleTheme() { showToastV2('Dark mode mặc định 🌙', 'info'); }

// Auto refresh balance every 60s
setInterval(refreshBalance, 60000);

// ==========================================
// CUSTOM ICON DROPDOWN (giống Select2 DenyPanel)
// ==========================================
function getCsiClass(category) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('telegram')) return 'csi-telegram';
  if (cat.includes('twitter') || cat.includes('x cổ') || cat.includes('x - ')) return 'csi-twitter';
  if (cat.includes('instagram') || cat.includes('threads') || cat.includes('tick xanh')) return 'csi-instagram';
  if (cat.includes('tiktok')) return 'csi-tiktok';
  if (cat.includes('youtube') || cat.includes('yt') || cat.includes('native ads') || cat.includes('adsword') || cat.includes('watchtime') || cat.includes('live stream') || cat.includes('subscriber') || cat.includes('short view')) return 'csi-youtube';
  if (cat.includes('facebook') || cat.includes('fanpage')) return 'csi-facebook';
  if (cat.includes('spotify')) return 'csi-spotify';
  if (cat.includes('soundcloud')) return 'csi-soundcloud';
  if (cat.includes('discord')) return 'csi-discord';
  if (cat.includes('twitch')) return 'csi-twitch';
  if (cat.includes('reddit')) return 'csi-reddit';
  if (cat.includes('linkedin')) return 'csi-linkedin';
  if (cat.includes('website') || cat.includes('traffic')) return 'csi-website';
  return 'csi-other';
}

function getCsiIconHtml(category) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('telegram')) return '<i class="fab fa-telegram-plane"></i>';
  if (cat.includes('twitter') || cat.includes('x cổ') || cat.includes('x - ')) return '<i class="fab fa-twitter"></i>';
  if (cat.includes('instagram') || cat.includes('threads') || cat.includes('tick xanh')) return '<i class="fab fa-instagram"></i>';
  if (cat.includes('tiktok')) return '<i class="fab fa-tiktok"></i>';
  if (cat.includes('youtube') || cat.includes('yt') || cat.includes('native ads') || cat.includes('adsword') || cat.includes('watchtime') || cat.includes('live stream') || cat.includes('subscriber') || cat.includes('short view')) return '<i class="fab fa-youtube"></i>';
  if (cat.includes('facebook') || cat.includes('fanpage')) return '<i class="fab fa-facebook-f"></i>';
  if (cat.includes('spotify')) return '<i class="fab fa-spotify"></i>';
  if (cat.includes('soundcloud')) return '<i class="fab fa-soundcloud"></i>';
  if (cat.includes('discord')) return '<i class="fab fa-discord"></i>';
  if (cat.includes('twitch')) return '<i class="fab fa-twitch"></i>';
  if (cat.includes('reddit')) return '<i class="fab fa-reddit-alien"></i>';
  if (cat.includes('linkedin')) return '<i class="fab fa-linkedin-in"></i>';
  if (cat.includes('website') || cat.includes('traffic')) return '<i class="fas fa-globe"></i>';
  return '<i class="fas fa-circle"></i>';
}

function buildCustomCategoryDropdown() {
  const categories = [...new Set(allServicesData.map(s => s.category))];

  ['homeCatDrop', 'pageCatDrop'].forEach((dropId, idx) => {
    const drop = document.getElementById(dropId);
    if (!drop) return;

    drop.innerHTML = '';

    // Default / empty item
    const emptyItem = document.createElement('div');
    emptyItem.className = 'custom-sel-item';
    emptyItem.innerHTML = `<span style="color:var(--gray);font-size:12px">-- Chọn mục --</span>`;
    emptyItem.onclick = () => {
      selectCustomCategory('', dropId, idx === 0 ? 'home' : 'page');
    };
    drop.appendChild(emptyItem);

    // All categories
    categories.forEach(cat => {
      const item = document.createElement('div');
      item.className = 'custom-sel-item';
      const csiClass = getCsiClass(cat);
      const iconHtml = getCsiIconHtml(cat);
      item.innerHTML = `
        <span class="csi-icon ${csiClass}">${iconHtml}</span>
        <span>${esc(cat)}</span>
      `;
      item.dataset.value = cat;
      item.onclick = () => {
        selectCustomCategory(cat, dropId, idx === 0 ? 'home' : 'page');
      };
      drop.appendChild(item);
    });
  });
}

function selectCustomCategory(cat, dropId, prefix) {
  const isHome = prefix === 'home';
  const triggerId = isHome ? 'homeCatTrigger' : 'pageCatTrigger';
  const iconId = isHome ? 'homeCatIcon' : 'pageCatIcon';
  const textId = isHome ? 'homeCatText' : 'pageCatText';
  const arrowId = isHome ? 'homeCatArrow' : 'pageCatArrow';
  const nativeSelId = isHome ? 'homeCategorySelect' : 'pageCategorySelect';

  // Update trigger display
  const iconEl = document.getElementById(iconId);
  const textEl = document.getElementById(textId);
  const arrowEl = document.getElementById(arrowId);

  if (cat) {
    const csiClass = getCsiClass(cat);
    const iconHtml = getCsiIconHtml(cat);
    if (iconEl) iconEl.innerHTML = `<span class="csi-icon ${csiClass}">${iconHtml}</span>`;
    if (textEl) { textEl.textContent = cat; textEl.classList.remove('placeholder'); }
  } else {
    if (iconEl) iconEl.innerHTML = '<i class="fas fa-th" style="color:#aaa"></i>';
    if (textEl) { textEl.textContent = '-- Chọn mục --'; textEl.classList.add('placeholder'); }
  }

  // Mark selected item in list
  const drop = document.getElementById(dropId);
  if (drop) {
    drop.querySelectorAll('.custom-sel-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.value === cat);
    });
  }

  // Close dropdown
  if (drop) drop.style.display = 'none';
  const trigger = document.getElementById(triggerId);
  if (trigger) { trigger.classList.remove('open'); }
  if (arrowEl) arrowEl.classList.remove('rotated');

  // Sync with hidden native select
  const nativeSel = document.getElementById(nativeSelId);
  if (nativeSel) {
    nativeSel.value = cat;
    // Trigger change
    if (isHome) homeOnCategoryChange();
    else pageOnCategoryChange();
  }
}

function toggleCustomDrop(dropId, triggerId) {
  const drop = document.getElementById(dropId);
  const trigger = document.getElementById(triggerId);
  if (!drop || !trigger) return;

  const isOpen = drop.style.display !== 'none';

  // Close all other dropdowns first
  ['homeCatDrop', 'pageCatDrop'].forEach(id => {
    const d = document.getElementById(id);
    if (d && id !== dropId) { d.style.display = 'none'; }
  });
  ['homeCatTrigger', 'pageCatTrigger'].forEach(id => {
    const t = document.getElementById(id);
    if (t && id !== triggerId) t.classList.remove('open');
  });
  ['homeCatArrow', 'pageCatArrow'].forEach(id => {
    const a = document.getElementById(id);
    if (a && id !== triggerId.replace('Trigger','Arrow')) a.classList.remove('rotated');
  });

  if (isOpen) {
    drop.style.display = 'none';
    trigger.classList.remove('open');
    const arrowId = triggerId.replace('Trigger', 'Arrow');
    document.getElementById(arrowId)?.classList.remove('rotated');
  } else {
    drop.style.display = 'block';
    trigger.classList.add('open');
    const arrowId = triggerId.replace('Trigger', 'Arrow');
    document.getElementById(arrowId)?.classList.add('rotated');
  }
}

// Close custom dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select-wrap')) {
    ['homeCatDrop', 'pageCatDrop'].forEach(id => {
      const d = document.getElementById(id);
      if (d) d.style.display = 'none';
    });
    ['homeCatTrigger', 'pageCatTrigger'].forEach(id => {
      document.getElementById(id)?.classList.remove('open');
    });
    ['homeCatArrow', 'pageCatArrow'].forEach(id => {
      document.getElementById(id)?.classList.remove('rotated');
    });
  }
});
