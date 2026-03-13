/**
 * ==========================================
 * DASHBOARD V2 - LOGIC
 * Tích hợp với DenyPanel API thực
 * API Key: 3b341f23c723707da4ce67f673f4e2f8
 * ==========================================
 */

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  if (!isLoggedIn()) { window.location.href = 'login.html'; return; }
  initDashboard();
});

async function initDashboard() {
  const user = getUserData();

  // Set welcome name
  const name = user.username || 'dangxoai';
  safeSet('welcomeName', name);
  safeSet('profileNameDisplay', name);
  safeSet('profileEmailDisplay', user.email || '');
  safeSet('settUsernameV2', name, 'value');
  safeSet('settEmailV2', user.email || '', 'value');
  safeSet('emptyOrdersUser', name);

  // Update top bar avatar initial
  const avatarBtn = document.getElementById('userAvatarBtn');
  if (avatarBtn) avatarBtn.textContent = name[0]?.toUpperCase() || 'D';

  // Affiliate link
  safeSet('affLinkV2', `https://denypanel.com/ref/${name}`, 'textContent');

  // Show home page
  showPage('home', document.getElementById('sb-home'));

  // Load data in order
  await refreshBalance();
  await loadAllServices();
  updateStats();
  loadOrdersPage();
}

// ==========================================
// BALANCE
// ==========================================
async function refreshBalance() {
  const result = await DenyPanelAPI.getBalance();
  const bal = parseFloat(result.balance || '0').toFixed(2);

  const user = getUserData();
  user.balance = bal;
  saveUserData(user);

  safeSet('balanceDisplay', bal);
  safeSet('balanceStat', '$' + bal);
}

// ==========================================
// STATS
// ==========================================
function updateStats() {
  const orders = getLocalOrders();
  safeSet('totalOrdersStat', orders.length);
  safeSet('profileOrders', orders.length);
  const user = getUserData();
  safeSet('profileBalance', '$' + parseFloat(user.balance || 0).toFixed(2));
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
    // Format giống DenyPanel thực: icon [ID] Tên - $rate/1k
    const icon = getPlatformIcon(s.category);
    opt.textContent = icon + ' ' + s.name + ' - $' + s.rate + '/1k';
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
  safeSet('homeCostDisplay', '$' + cost.toFixed(4));
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
Speed: ${speed}\nRefill: ${warranty}\nQuality: R\u1ea5t T\u1ed1t\nLink: URL / Link\n\nGi\u00e1: <span style="color:var(--green);font-weight:700">$${svc.rate}/1000 \u0111\u01a1n v\u1ecb</span>\nT\u1ed1i thi\u1ec3u: ${Number(svc.min).toLocaleString()} | T\u1ed1i \u0111a: ${Number(svc.max).toLocaleString()}\n\nLo\u1ea1i: ${svc.type}
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
  safeSet('pageCostDisplay', '$' + cost.toFixed(4));
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
  const user = getUserData();
  const balance = parseFloat(user.balance || 0);

  if (cost > balance) {
    showMsg(msgBox, `⚠️ Số dư không đủ! Cần $${cost.toFixed(4)}, bạn có $${balance.toFixed(2)}`, 'err');
    return;
  }

  // Disable buttons
  const btn = document.getElementById('btnDatHang') || document.querySelector(`#page-${prefix === 'home' ? 'home' : 'order'} .btn-dat-hang`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đặt hàng...'; }

  if (msgBox) msgBox.style.display = 'none';

  const result = await DenyPanelAPI.addOrder(opt.value, link, qty);

  if (result.success) {
    user.balance = (balance - cost).toFixed(4);
    saveUserData(user);

    const order = {
      id: result.orderId,
      serviceId: parseInt(opt.value),
      serviceName: opt.dataset.name || opt.textContent,
      link, quantity: qty,
      charge: cost.toFixed(4),
      status: 'pending',
      remains: qty,
      refill: false,
      createdAt: new Date().toISOString()
    };
    const orders = getLocalOrders();
    orders.push(order);
    saveLocalOrders(orders);

    showMsg(msgBox, `✅ Đặt hàng thành công! Order ID: #${result.orderId}${result.demo ? ' (Demo)' : ''}`, 'ok');
    showToastV2(`✅ Đặt hàng thành công! #${result.orderId}`, 'ok');

    // Reset
    sel.value = '';
    document.getElementById(`${prefix}OrderLink`).value = '';
    document.getElementById(`${prefix}OrderQty`).value = '';
    safeSet(`${prefix}CostDisplay`, '$0.00');

    await refreshBalance();
    updateStats();
    loadOrdersPage();

    // Simulate progress
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
function getLocalOrders() { try { return JSON.parse(localStorage.getItem('dp_orders') || '[]'); } catch { return []; } }
function saveLocalOrders(orders) { localStorage.setItem('dp_orders', JSON.stringify(orders)); }

function loadOrdersPage() {
  const orders = getLocalOrders().reverse();
  renderOrdersPage(orders);
  updateStats();
}

function renderOrdersPage(ordersIn) {
  const container = document.getElementById('ordersPageContainer');
  if (!container) return;

  const orders = ordersIn || getLocalOrders().reverse();
  const search = (document.getElementById('orderSearchInput')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('statusFilterSel')?.value || '';

  let filtered = orders;
  if (search) filtered = filtered.filter(o => o.serviceName?.toLowerCase().includes(search) || String(o.id).includes(search));
  if (statusFilter) filtered = filtered.filter(o => o.status === statusFilter);

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-orders-box">
        <p style="font-size:50px;margin-bottom:16px">📭</p>
        <p>Xin chào <strong>${getUserData().username || 'dangxoai'}</strong>, ${search || statusFilter ? 'không tìm thấy đơn hàng phù hợp.' : 'bạn chưa từng đặt hàng trước đây.'}<br>
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
              <td><span style="background:var(--green3);color:var(--green);padding:3px 8px;border-radius:6px;font-weight:700;font-size:12px">#${o.id}</span></td>
              <td style="max-width:200px;font-size:12px">${o.serviceName}</td>
              <td style="max-width:150px"><a href="${o.link}" target="_blank" style="color:var(--indigo);font-size:12px;white-space:nowrap;overflow:hidden;display:block;text-overflow:ellipsis;max-width:150px">${o.link}</a></td>
              <td>${Number(o.quantity).toLocaleString()}</td>
              <td style="color:var(--gray2)">${o.remains !== undefined ? Number(o.remains).toLocaleString() : '--'}</td>
              <td style="color:var(--green);font-weight:700">$${parseFloat(o.charge||0).toFixed(4)}</td>
              <td><span class="status-pill ${o.status}">${getStatusLabel(o.status)}</span></td>
              <td><button onclick="checkOrderById(${o.id})" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:5px 10px;color:var(--gray2);cursor:pointer;font-size:11px"><i class="fas fa-sync-alt"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function checkOrderById(id) {
  showToastV2('Đang kiểm tra...', 'info');
  const result = await DenyPanelAPI.getOrderStatus(id);
  if (result.success) {
    const orders = getLocalOrders();
    const o = orders.find(x => x.id == id);
    if (o) {
      o.status = (result.status || o.status).toLowerCase().replace(/ /g,'_');
      o.remains = result.remains || 0;
      saveLocalOrders(orders);
      loadOrdersPage();
    }
    showToastV2(`Trạng thái: ${result.status || 'Unknown'}`, 'ok');
  }
}

function toggleOrderFilter() { showToastV2('Bộ lọc nâng cao sắp ra mắt!', 'info'); }

// ==========================================
// ADD FUNDS
// ==========================================
function submitFundRequest() {
  const amount = parseFloat(document.getElementById('fundAmountInput')?.value);
  const msgBox = document.getElementById('fundErrorMsg');
  const method = document.getElementById('paymentMethod')?.value;

  if (!amount || amount < 2) { showMsg(msgBox, '⚠️ Số tiền tối thiểu là $2 cho người dùng mới!', 'err'); return; }

  showMsg(msgBox, '✅ Yêu cầu nạp tiền đã được gửi! Vui lòng liên hệ Admin để xác nhận.', 'ok');
  showToastV2('Yêu cầu nạp tiền đã gửi!', 'ok');
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
          <div class="svc-rate-v2">$${s.rate}</div>
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
    safeSet('modalSvcRate', '$' + s.rate);
    safeSet('modalSvcMin', Number(s.min).toLocaleString());
    safeSet('modalSvcMax', Number(s.max).toLocaleString());
    safeSet('modalSvcSpeed', '5k/Ngày');
    safeSet('modalSvcRefill', s.refill);
    safeSet('modalSvcQuality', 'Rất Tốt');
    const desc = `Speed: 5k/Ngày\nRefill: ${s.refill}\nQuality: Rất Tốt\nLink: URL\n\n${s.name}\nGiá: $${s.rate} / 1000 đơn vị\nTối thiểu: ${s.min} | Tối đa: ${s.max}`;
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
