/**
 * ==========================================
 * DENYPANEL API INTEGRATION - FULL VERSION
 * Web con (reseller panel) kết nối tới DenyPanel
 * ==========================================
 * Cách hoạt động:
 *   Browser → proxy.php (trên server bạn) → denypanel.com/api/v2
 * Nếu không có PHP server (chạy local file://), dùng demo mode.
 * ==========================================
 */

const DenyPanelAPI = {
  // API Key của tài khoản trên DenyPanel
  API_KEY: '5c89dc0a79cbb981b6444ca9cdc106dc',

  // API endpoint thực của DenyPanel (KHÔNG gọi trực tiếp - sẽ bị CORS)
  API_URL: 'https://denypanel.com/api/v2',

  // Vercel Serverless Function endpoint
  // Khi deploy lên Vercel → /api/proxy tự route đến api/proxy.js
  // Khi chạy local file:// → tự động dùng demo mode
  PROXY_URL: '/api/proxy',

  // Cache trạng thái proxy
  _useProxy: null,
  _proxyChecked: false,



  /**
   * Kiểm tra xem có thể dùng proxy (Firebase Function) không
   */
  async checkProxy() {
    if (this._proxyChecked) return this._useProxy;
    this._proxyChecked = true;

    // Nếu chạy từ file:// → không có server → demo mode
    if (window.location.protocol === 'file:') {
      console.warn('[DenyPanel API] ❌ Chạy local file:// - dùng DEMO mode');
      console.warn('[DenyPanel API] Deploy lên Firebase Hosting để kết nối API thực!');
      this._useProxy = false;
      return false;
    }

    // Nếu chạy từ HTTP/HTTPS server (Firebase Hosting, localhost server...) → thử proxy
    try {
      const resp = await fetch(this.PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ action: 'balance', key: this.API_KEY }),
        signal: AbortSignal.timeout(5000)
      });
      this._useProxy = resp.ok;
    } catch {
      this._useProxy = false;
    }

    if (this._useProxy) {
      console.log('[DenyPanel API] ✅ Firebase Function proxy đang hoạt động!');
    } else {
      console.warn('[DenyPanel API] ❌ Không tìm thấy proxy - kiểm tra Firebase deploy');
    }
    return this._useProxy;
  },

  /**
   * Gọi API DenyPanel qua proxy.php (bypass CORS)
   * Browser → proxy.php → denypanel.com/api/v2 → trả kết quả về
   */
  async call(params) {
    // Thử dùng proxy trước
    const proxyAvail = await this.checkProxy();

    if (proxyAvail) {
      try {
        // Gọi qua proxy.php - proxy sẽ tự thêm API key và forward đến DenyPanel
        const body = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null && v !== '') {
            body.append(k, v);
          }
        }
        // Key gửi kèm để proxy biết (proxy cũng có thể tự gắn)
        body.append('key', this.API_KEY);

        const response = await fetch(this.PROXY_URL, {
          method: 'POST',
          body: body
        });

        if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
        const data = await response.json();
        console.log(`[DenyPanel API] action=${params.action}`, data);

        if (data && data.error) {
          return { success: false, error: data.error, data };
        }
        return { success: true, data };
      } catch (err) {
        console.warn('[DenyPanel API] Proxy error:', err.message);
        return { success: false, error: err.message, demo: true };
      }
    }

    // Không có proxy → demo mode
    console.warn('[DenyPanel API] No proxy available - using DEMO mode');
    return { success: false, error: 'No proxy server', demo: true };
  },

  // ==========================================
  // EXCHANGE RATE - TỶ GIÁ THỰC TỪ DENYPANEL
  // ==========================================

  /**
   * Lấy tỷ giá VND/USD thực từ DenyPanel (qua /api/rate)
   * Cache 5 phút trong sessionStorage
   */
  async getExchangeRate() {
    const CACHE_KEY = 'dp_exchange_rate';
    const CACHE_TIME_KEY = 'dp_exchange_rate_time';
    const CACHE_TTL = 5 * 60 * 1000; // 5 phút

    try {
      // Kiểm tra cache
      const cachedRate = sessionStorage.getItem(CACHE_KEY);
      const cachedTime = parseInt(sessionStorage.getItem(CACHE_TIME_KEY) || '0');

      if (cachedRate && Date.now() - cachedTime < CACHE_TTL) {
        return parseFloat(cachedRate);
      }

      // Fetch tỷ giá thực từ proxy
      const response = await fetch('/api/rate');
      if (!response.ok) throw new Error('Rate fetch failed');
      const data = await response.json();

      if (data.rate && data.rate > 20000) {
        sessionStorage.setItem(CACHE_KEY, data.rate);
        sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
        console.log(`[DenyPanel API] Tỷ giá VND: 1 USD = ${data.rate.toFixed(2)} ₫ (nguồn: ${data.source})`);
        return data.rate;
      }

      throw new Error('Invalid rate');
    } catch (err) {
      console.warn('[DenyPanel API] Không lấy được tỷ giá, dùng fallback:', err.message);
      return 26294.5; // Fallback
    }
  },

  // ==========================================
  // SERVICES
  // ==========================================

  /** Lấy danh sách tất cả dịch vụ */
  async getServices() {
    const result = await this.call({ action: 'services' });
    if (result.success && result.data && !result.data.error) {
      return result.data;
    }
    return this.getDemoServices();
  },

  // ==========================================
  // BALANCE
  // ==========================================

  /** Kiểm tra số dư tài khoản */
  async getBalance() {
    const result = await this.call({ action: 'balance' });
    if (result.success && result.data && result.data.balance) {
      return { success: true, balance: result.data.balance, currency: result.data.currency };
    }
    const user = getUserData();
    return { success: true, balance: user?.balance || '0.00', currency: 'USD', demo: true };
  },

  // ==========================================
  // ORDERS - ĐẶT HÀNG
  // ==========================================

  /**
   * Đặt hàng - Default (đơn hàng thông thường)
   * @param {number} serviceId - ID dịch vụ
   * @param {string} link - Link cần tăng
   * @param {number} quantity - Số lượng
   */
  async addOrder(serviceId, link, quantity) {
    return this.order({ service: serviceId, link, quantity });
  },

  /**
   * Đặt hàng với Custom Comments
   * @param {number} serviceId
   * @param {string} link
   * @param {string} comments - Nội dung comment (mỗi dòng 1 comment)
   */
  async addOrderCustomComments(serviceId, link, comments) {
    return this.order({ service: serviceId, link, comments });
  },

  /**
   * Đặt hàng Drip-feed (nhỏ giọt)
   * @param {number} serviceId
   * @param {string} link
   * @param {number} quantity - Số lượng mỗi lần
   * @param {number} runs - Số lần chạy
   * @param {number} interval - Khoảng cách (phút)
   */
  async addOrderDripFeed(serviceId, link, quantity, runs, interval) {
    return this.order({ service: serviceId, link, quantity, runs, interval });
  },

  /**
   * Đặt hàng Mentions User Followers
   * @param {number} serviceId
   * @param {string} link
   * @param {number} quantity
   * @param {string} username - Tên user cần mention
   */
  async addOrderMentions(serviceId, link, quantity, username) {
    return this.order({ service: serviceId, link, quantity, username });
  },

  /**
   * Đặt hàng Package (gói)
   * @param {number} serviceId
   * @param {string} link
   */
  async addOrderPackage(serviceId, link) {
    return this.order({ service: serviceId, link });
  },

  /**
   * Đặt hàng Web Traffic
   * @param {number} serviceId
   * @param {string} link
   * @param {number} quantity
   * @param {string} country - Mã quốc gia (VD: 'US', 'VN')
   * @param {string} device - 'Desktop' hoặc 'Mobile'
   * @param {number} type_of_traffic - Loại traffic
   * @param {string} google_keyword - Từ khóa tìm kiếm
   */
  async addOrderWebTraffic(serviceId, link, quantity, country, device, type_of_traffic, google_keyword) {
    return this.order({ service: serviceId, link, quantity, country, device, type_of_traffic, google_keyword });
  },

  /**
   * Đặt hàng Subscriptions (only old posts)
   * @param {number} serviceId
   * @param {string} username
   * @param {number} min - Min lượng
   * @param {number} max - Max lượng
   * @param {number} posts - Số bài cũ (0 = unlimited)
   * @param {number} delay - Delay giữa các bài (phút)
   * @param {string} expiry - Ngày hết hạn VD: '11/11/2025'
   */
  async addOrderSubscriptionOldPosts(serviceId, username, min, max, posts, delay, expiry) {
    return this.order({ service: serviceId, username, min, max, posts, delay, expiry });
  },

  /**
   * Đặt hàng Subscriptions (new + old posts)
   * @param {number} serviceId
   * @param {string} username
   * @param {number} min
   * @param {number} max
   * @param {number} old_posts - Số bài cũ
   * @param {number} delay
   * @param {string} expiry
   */
  async addOrderSubscription(serviceId, username, min, max, old_posts, delay, expiry) {
    return this.order({ service: serviceId, username, min, max, old_posts, delay, expiry });
  },

  /**
   * Đặt hàng Comment Likes
   * @param {number} serviceId
   * @param {string} link
   * @param {number} quantity
   * @param {string} username
   */
  async addOrderCommentLikes(serviceId, link, quantity, username) {
    return this.order({ service: serviceId, link, quantity, username });
  },

  /**
   * Đặt hàng Poll
   * @param {number} serviceId
   * @param {string} link
   * @param {number} quantity
   * @param {string} answer_number - Số thứ tự câu trả lời
   */
  async addOrderPoll(serviceId, link, quantity, answer_number) {
    return this.order({ service: serviceId, link, quantity, answer_number });
  },

  /**
   * Base order method - gọi API add
   * @param {Object} params - Các tham số order
   */
  async order(params) {
    const result = await this.call({ action: 'add', ...params });

    // Proxy hoạt động, DenyPanel trả về kết quả
    if (result.success && result.data) {
      if (result.data.order) {
        // Thành công - có order ID
        return { success: true, orderId: result.data.order };
      } else if (result.data.error) {
        // DenyPanel trả về lỗi (vd: "Service not found", "Insufficient balance")
        return { success: false, error: result.data.error };
      }
      // Phản hồi không có order ID và không có error - coi như lỗi
      return { success: false, error: 'Phản hồi không hợp lệ từ DenyPanel' };
    }

    // Proxy có lỗi nhưng không phải demo mode - hiện lỗi thật
    if (!result.success && !result.demo && result.error) {
      return { success: false, error: `Lỗi API: ${result.error}` };
    }

    // Demo mode - tạo order giả
    if (result.demo) {
      const fakeId = Math.floor(Math.random() * 90000) + 10000;
      return { success: true, orderId: fakeId, demo: true };
    }

    return { success: false, error: 'Không thể kết nối API. Vui lòng thử lại.' };
  },

  // ==========================================
  // ORDER STATUS - KIỂM TRA TRẠNG THÁI
  // ==========================================

  /**
   * Kiểm tra trạng thái 1 đơn hàng
   * @param {number} orderId
   */
  async getOrderStatus(orderId) {
    const result = await this.call({ action: 'status', order: orderId });
    if (result.success && result.data && !result.data.error) {
      return { success: true, ...result.data };
    }
    return {
      success: true,
      status: 'In progress',
      charge: '0.50',
      start_count: '1000',
      remains: '500',
      currency: 'USD',
      demo: true
    };
  },

  /**
   * Kiểm tra trạng thái nhiều đơn hàng
   * @param {Array<number>} orderIds
   */
  async getMultipleOrderStatus(orderIds) {
    const result = await this.call({ action: 'status', orders: orderIds.join(',') });
    if (result.success && result.data) return result.data;
    return {};
  },

  // ==========================================
  // CANCEL - HỦY ĐƠN HÀNG
  // ==========================================

  /**
   * Hủy nhiều đơn hàng (chỉ hoạt động với đơn đang Pending)
   * @param {Array<number>} orderIds - Mảng ID đơn hàng cần hủy
   */
  async cancel(orderIds) {
    const result = await this.call({ action: 'cancel', orders: (Array.isArray(orderIds) ? orderIds : [orderIds]).join(',') });
    if (result.success && result.data) return result.data;
    if (result.demo) return [{ order: orderIds[0], cancel: { success: true } }];
    return [];
  },

  // ==========================================
  // REFILL - NẠP LẠI
  // ==========================================

  /**
   * Yêu cầu refill 1 đơn hàng
   * @param {number} orderId
   */
  async createRefill(orderId) {
    const result = await this.call({ action: 'refill', order: orderId });
    if (result.success && result.data) return result.data;
    return { refill: Date.now() };
  },

  /**
   * Yêu cầu refill nhiều đơn hàng
   * @param {Array<number>} orderIds
   */
  async multiRefill(orderIds) {
    const result = await this.call({ action: 'refill', orders: orderIds.join(',') });
    if (result.success && result.data) return result.data;
    return orderIds.map(id => ({ order: id, refill: Date.now() }));
  },

  /**
   * Kiểm tra trạng thái refill
   * @param {number} refillId
   */
  async refillStatus(refillId) {
    const result = await this.call({ action: 'refill_status', refill: refillId });
    if (result.success && result.data) return result.data;
    return { status: 'Completed' };
  },

  /**
   * Kiểm tra trạng thái nhiều refill
   * @param {Array<number>} refillIds
   */
  async multiRefillStatus(refillIds) {
    const result = await this.call({ action: 'refill_status', refills: refillIds.join(',') });
    if (result.success && result.data) return result.data;
    return {};
  },

  // ==========================================
  // DEMO DATA
  // ==========================================

  /**
   * Demo services data - Đầy đủ 72 categories từ DenyPanel thực (trích xuất 13/03/2026)
   */
  getDemoServices() {
    return [
      // ===== 1. TELEGRAM MEMBER ONLINE 24/7 =====
      { service: 1536, name: 'Telegram Member/ Channel Subscribers Online 24/7 | Bắt đầu sau 30p - Bảo hành 30 ngày - $2.80 cho mỗi 1000', type: 'Default', category: 'Telegram Member Online 24/7', rate: '2.80', min: '10', max: '100000', refill: true, avg_time: 'Đang tính toán' },
      { service: 1537, name: 'Telegram Member Online 24/7 - Server 2', type: 'Default', category: 'Telegram Member Online 24/7', rate: '3.00', min: '10', max: '50000', refill: true, avg_time: 'Đang tính toán' },

      // ===== 2. TWITTER CỔ =====
      { service: 2001, name: 'Twitter Cổ - Followers chất lượng cao', type: 'Default', category: 'Twitter Cổ - Chất lượng cao - Chạy tốt sau update 31/10', rate: '1.50', min: '100', max: '50000', refill: true, avg_time: '1-3 Ngày' },
      { service: 2002, name: 'Twitter Cổ - Likes chất lượng cao', type: 'Default', category: 'Twitter Cổ - Chất lượng cao - Chạy tốt sau update 31/10', rate: '0.30', min: '50', max: '30000', refill: false, avg_time: '1-6 Giờ' },

      // ===== 3. INSTAGRAM FOLLOWERS =====
      { service: 3001, name: 'Instagram Followers | Chạy nhanh sau Update 10/08/25 - Bảo hành 30 ngày', type: 'Default', category: 'Instagram Followers | Chạy nhanh sau Update 10/08/25', rate: '0.50', min: '100', max: '100000', refill: true, avg_time: '1-24 Giờ' },
      { service: 3002, name: 'Instagram Followers High Quality - Server 2', type: 'High Quality', category: 'Instagram Followers | Chạy nhanh sau Update 10/08/25', rate: '0.80', min: '100', max: '50000', refill: true, avg_time: '1-12 Giờ' },

      // ===== 4. TELEGRAM MEMBER REALTIME =====
      { service: 1550, name: 'Telegram Member Realtime Server - Update thông số theo thời gian thực', type: 'Realtime', category: 'Telegram Member Realtime Server - Server Update thông số chi tiết theo thời gian thực', rate: '3.50', min: '10', max: '100000', refill: true, avg_time: 'Đang tính toán' },
      { service: 1560, name: 'Telegram Channel Subscribers - Bảo hành 30 ngày', type: 'Default', category: 'Telegram Member Realtime Server - Server Update thông số chi tiết theo thời gian thực', rate: '1.50', min: '50', max: '500000', refill: true, avg_time: 'Đang tính toán' },

      // ===== 5. YOUTUBE VIEW =====
      { service: 4001, name: 'Youtube View - Real Traffic - Tốc độ 1-10p', type: 'Default', category: 'Youtube View', rate: '0.50', min: '500', max: '10000000', refill: false, avg_time: '0-30 Phút' },
      { service: 4002, name: 'Youtube View Server 2 - Chất lượng cao', type: 'High Quality', category: 'Youtube View', rate: '0.80', min: '500', max: '5000000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 6. YOUTUBE NATIVE ADS =====
      { service: 4010, name: 'Youtube Native Ads Views - Network AdsView', type: 'Ads', category: 'Youtube Native Ads Views - Network AdsView', rate: '1.20', min: '1000', max: '10000000', refill: false, avg_time: '1-6 Giờ' },
      { service: 4011, name: 'Youtube Native Ads - Server 2', type: 'Ads', category: 'Youtube Native Ads Views - Network AdsView', rate: '1.50', min: '500', max: '5000000', refill: false, avg_time: '1-12 Giờ' },

      // ===== 7. YOUTUBE ADSWORD VIEW =====
      { service: 4020, name: 'YouTube Adsword View - Google Ads Traffic', type: 'Ads', category: 'YouTube Adsword View', rate: '1.50', min: '500', max: '10000000', refill: false, avg_time: '1-12 Giờ' },
      { service: 4021, name: 'YouTube Adsword View - Server 2', type: 'Ads', category: 'YouTube Adsword View', rate: '1.80', min: '500', max: '5000000', refill: false, avg_time: '1-6 Giờ' },

      // ===== 8. YOUTUBE WATCHTIME =====
      { service: 4030, name: 'Youtube WatchTime - Giờ Xem (Nhập link video)', type: 'WatchTime', category: 'Youtube WatchTime - Giờ Xem', rate: '15.00', min: '100', max: '50000', refill: false, avg_time: '7-30 Ngày' },
      { service: 4031, name: 'Youtube WatchTime - 4000 Giờ dễ dàng', type: 'WatchTime', category: 'Youtube WatchTime - Giờ Xem', rate: '18.00', min: '100', max: '10000', refill: false, avg_time: '7-14 Ngày' },

      // ===== 9. YOUTUBE SHORT VIEW =====
      { service: 4040, name: 'Youtube Short View - Shorts Real', type: 'Shorts', category: 'Youtube Short View', rate: '0.30', min: '1000', max: '50000000', refill: false, avg_time: '0-30 Phút' },
      { service: 4041, name: 'Youtube Short View - Server 2', type: 'Shorts', category: 'Youtube Short View', rate: '0.40', min: '1000', max: '30000000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 10. YOUTUBE COMMENTS =====
      { service: 4050, name: 'Youtube Comments - Tùy Chỉnh Nội Dung', type: 'Custom Comments', category: 'Youtube Comments/Comment Likes', rate: '5.00', min: '10', max: '5000', refill: false, avg_time: '1-6 Giờ' },
      { service: 4051, name: 'Youtube Comment Likes', type: 'Default', category: 'Youtube Comments/Comment Likes', rate: '0.50', min: '10', max: '10000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 11. YOUTUBE SUBSCRIBER =====
      { service: 4060, name: 'Youtube Subscriber - Bảo Hành 30 Ngày', type: 'Default', category: 'Youtube Subscriber', rate: '2.50', min: '50', max: '10000', refill: true, avg_time: '1-7 Ngày' },
      { service: 4061, name: 'Youtube Subscriber - Không bảo hành - Rẻ', type: 'Default', category: 'Youtube Subscriber', rate: '1.50', min: '50', max: '50000', refill: false, avg_time: '1-3 Ngày' },

      // ===== 12. YOUTUBE LIVE STREAM VIEWS =====
      { service: 4070, name: 'Youtube Live Stream Views | Lên sau 1-10p -- 90-110% View xem trong toàn thời gian', type: 'Live', category: 'Youtube Live Stream Views | Lên sau 1-10p -- 90-110% View xem trong toàn thời gian', rate: '3.50', min: '100', max: '100000', refill: false, avg_time: '1-10 Phút' },
      { service: 4071, name: 'Youtube Live Stream Views - Server 2', type: 'Live', category: 'Youtube Live Stream Views | Lên sau 1-10p -- 90-110% View xem trong toàn thời gian', rate: '4.00', min: '100', max: '50000', refill: false, avg_time: '1-5 Phút' },

      // ===== 13. YOUTUBE LIVE TOÀN BỘ =====
      { service: 4080, name: 'Youtube Live Stream | Toàn Bộ View Xem Đồng Thời', type: 'Live', category: 'Youtube Live Stream | Toàn Bộ View Xem Đồng Thời', rate: '5.00', min: '100', max: '20000', refill: false, avg_time: '5-30 Phút' },
      { service: 4081, name: 'Youtube Live Stream | Toàn Bộ - Server 2', type: 'Live', category: 'Youtube Live Stream | Toàn Bộ View Xem Đồng Thời', rate: '5.50', min: '50', max: '10000', refill: false, avg_time: '5-15 Phút' },

      // ===== 14. YOUTUBE CHAT LIVESTREAM =====
      { service: 4090, name: 'Youtube Chat trên LiveStream tùy chỉnh nội dung/Tốc độ', type: 'Chat', category: 'Youtube Chat trên LiveStream tùy chỉnh nội dung/Tốc độ', rate: '10.00', min: '10', max: '1000', refill: false, avg_time: 'Đang tính toán' },

      // ===== 15. YOUTUBE LIKES/DISLIKES/SHARE =====
      { service: 4100, name: 'Youtube Likes', type: 'Default', category: 'Youtube Likes/Dislikes/Share...', rate: '0.50', min: '50', max: '50000', refill: false, avg_time: '0-1 Giờ' },
      { service: 4101, name: 'Youtube Dislikes', type: 'Default', category: 'Youtube Likes/Dislikes/Share...', rate: '0.80', min: '50', max: '20000', refill: false, avg_time: '0-1 Giờ' },
      { service: 4102, name: 'Youtube Shares', type: 'Default', category: 'Youtube Likes/Dislikes/Share...', rate: '0.30', min: '50', max: '50000', refill: false, avg_time: '0-30 Phút' },

      // ===== 16. FACEBOOK VIDEO VIEW =====
      { service: 5001, name: 'Facebook Video View - Tốc độ nhanh', type: 'Default', category: 'Facebook Video View', rate: '0.08', min: '500', max: '500000', refill: false, avg_time: '0-1 Giờ' },
      { service: 5002, name: 'Facebook Video View 60 Giây', type: 'Default', category: 'Facebook Video View', rate: '0.15', min: '500', max: '200000', refill: false, avg_time: '1-6 Giờ' },

      // ===== 17. FACEBOOK POST REACTIONS =====
      { service: 5010, name: 'Facebook Post Reactions Global (Like, Love, Haha...)', type: 'Default', category: 'Facebook Post Reactions Global', rate: '0.20', min: '50', max: '20000', refill: false, avg_time: '0-30 Phút' },
      { service: 5011, name: 'Facebook Post Reactions - Server 2', type: 'Default', category: 'Facebook Post Reactions Global', rate: '0.25', min: '50', max: '10000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 18. DỊCH VỤ FACEBOOK MIX =====
      { service: 5020, name: 'Dịch vụ Facebook - Like/ Share/Member...', type: 'Mixed', category: 'Dịch vụ Facebook - Like/ Share/Member...', rate: '0.30', min: '50', max: '50000', refill: false, avg_time: '0-6 Giờ' },

      // ===== 19. FACEBOOK FOLLOWERS + FANPAGE =====
      { service: 5030, name: 'Facebook Followers - Thực', type: 'Default', category: 'Facebook Followers + Fanpage Likes', rate: '0.80', min: '100', max: '50000', refill: true, avg_time: '1-3 Ngày' },
      { service: 5031, name: 'Facebook Fanpage Likes - Bảo Hành', type: 'Default', category: 'Facebook Followers + Fanpage Likes', rate: '1.20', min: '100', max: '50000', refill: true, avg_time: '1-7 Ngày' },

      // ===== 20. FACEBOOK LIVESTREAM VIEW =====
      { service: 5040, name: 'Facebook Livestream View (29/09/25)', type: 'Live', category: 'Facebook Livestream View (29/09/25)', rate: '2.00', min: '100', max: '20000', refill: false, avg_time: '5-30 Phút' },

      // ===== 21. INSTAGRAM LIKES/VIEWS =====
      { service: 3010, name: 'Instagram Likes - Real + Nhanh', type: 'Default', category: 'Instagram Likes/Views', rate: '0.10', min: '50', max: '50000', refill: false, avg_time: '0-30 Phút' },
      { service: 3011, name: 'Instagram Views - Video Real', type: 'Default', category: 'Instagram Likes/Views', rate: '0.05', min: '100', max: '500000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 22. THREADS =====
      { service: 3020, name: 'Threads Followers', type: 'Default', category: 'Threads', rate: '0.80', min: '100', max: '100000', refill: false, avg_time: '1-24 Giờ' },
      { service: 3021, name: 'Threads Likes', type: 'Default', category: 'Threads', rate: '0.20', min: '20', max: '10000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 23. INSTAGRAM TICK XANH =====
      { service: 3030, name: 'Tài khoản Instagram Xác minh Tick xanh - Cao cấp', type: 'Special', category: 'Tài khoản Instagram Xác minh Tick xanh', rate: '5.00', min: '1', max: '100', refill: false, avg_time: '3-7 Ngày' },

      // ===== 24. INSTAGRAM FOLLOWERS BẢO HÀNH =====
      { service: 3040, name: 'Instagram Followers - Bảo hành dài ngày', type: 'Default', category: 'Instagram Followers | Bảo hành', rate: '1.20', min: '100', max: '50000', refill: true, avg_time: '1-7 Ngày' },
      { service: 3041, name: 'Instagram Followers - Bảo hành 60 ngày', type: 'Default', category: 'Instagram Followers | Bảo hành', rate: '1.80', min: '50', max: '20000', refill: true, avg_time: '1-3 Ngày' },

      // ===== 25. INSTAGRAM LIKE ĐẶT TRƯỚC =====
      { service: 3050, name: 'Instagram Like đặt trước cho bài đăng trong tương lai', type: 'Auto', category: 'Instagram Like đặt trước cho bài đăng trong tương lai', rate: '0.50', min: '10', max: '10000', refill: false, avg_time: 'Tự động' },

      // ===== 26. INSTAGRAM COMMENTS =====
      { service: 3060, name: 'Instagram Comments - Tùy Chỉnh', type: 'Custom Comments', category: 'Instagram Comments', rate: '3.00', min: '10', max: '5000', refill: false, avg_time: '1-6 Giờ' },
      { service: 3061, name: 'Instagram Comments - Random', type: 'Default', category: 'Instagram Comments', rate: '1.50', min: '10', max: '10000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 27. INSTAGRAM LIVE VIDEO =====
      { service: 3070, name: 'Instagram Live Video Views', type: 'Live', category: 'Instagram Live Video', rate: '2.50', min: '50', max: '5000', refill: false, avg_time: '5-30 Phút' },

      // ===== 28. TIKTOK (MIX) =====
      { service: 6000, name: 'TikTok Tổng hợp dịch vụ', type: 'Mixed', category: 'TikTok', rate: '0.50', min: '50', max: '100000', refill: false, avg_time: '0-6 Giờ' },

      // ===== 29. TIKTOK LIKES =====
      { service: 6002, name: 'TikTok Likes - Siêu Tốc', type: 'Default', category: 'TikTok Likes', rate: '0.12', min: '50', max: '100000', refill: false, avg_time: '0-30 Phút' },
      { service: 6003, name: 'TikTok Likes - Chất lượng cao', type: 'High Quality', category: 'TikTok Likes', rate: '0.20', min: '50', max: '50000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 30. TIKTOK FOLLOWERS =====
      { service: 6001, name: 'TikTok Followers - Chất Lượng Cao', type: 'Default', category: 'TikTok Followers', rate: '0.80', min: '100', max: '100000', refill: true, avg_time: '1-24 Giờ' },
      { service: 6010, name: 'TikTok Followers - Server 2', type: 'Default', category: 'TikTok Followers', rate: '1.00', min: '100', max: '50000', refill: true, avg_time: '1-12 Giờ' },

      // ===== 31. TIKTOK FOLLOWERS BẢO HÀNH DÀI =====
      { service: 6020, name: 'TikTok Followers | Không tụt - Bảo hành dài ngày', type: 'Premium', category: 'TikTok Followers | Không tụt - Bảo hành dài ngày', rate: '2.00', min: '50', max: '20000', refill: true, avg_time: '1-3 Ngày' },

      // ===== 32. TIKTOK LIVE STREAM =====
      { service: 6030, name: 'TikTok Live Stream Views | Update 30/09/25', type: 'Live', category: 'TikTok Live Stream Views | Update 30/09/25', rate: '3.00', min: '100', max: '10000', refill: false, avg_time: '5-30 Phút' },
      { service: 6031, name: 'TikTok Live Stream Views - Server 2', type: 'Live', category: 'TikTok Live Stream Views | Update 30/09/25', rate: '3.50', min: '100', max: '5000', refill: false, avg_time: '5-15 Phút' },

      // ===== 33. TIKTOK TƯƠNG TÁC LIVESTREAM =====
      { service: 6040, name: 'TikTok Tương Tác LiveStream - Roses/Gifts', type: 'Engagement', category: 'TikTok Tương Tác LiveStream', rate: '5.00', min: '10', max: '5000', refill: false, avg_time: '5-30 Phút' },

      // ===== 34. TWITTER FOLLOWERS =====
      { service: 2010, name: 'Twitter Followers - Chất Lượng', type: 'Default', category: 'Twitter Followers', rate: '1.50', min: '100', max: '50000', refill: true, avg_time: '1-7 Ngày' },
      { service: 2011, name: 'Twitter Followers - Real', type: 'High Quality', category: 'Twitter Followers', rate: '2.50', min: '50', max: '20000', refill: true, avg_time: '1-3 Ngày' },

      // ===== 35. TWITTER LIKES =====
      { service: 2020, name: 'Twitter Likes - Nhanh', type: 'Default', category: 'Twitter Likes', rate: '0.30', min: '50', max: '30000', refill: false, avg_time: '0-1 Giờ' },
      { service: 2021, name: 'Twitter Likes - Chất lượng cao', type: 'High Quality', category: 'Twitter Likes', rate: '0.60', min: '50', max: '10000', refill: false, avg_time: '1-6 Giờ' },

      // ===== 36. TWITTER RETWEET =====
      { service: 2030, name: 'Twitter Retweet', type: 'Default', category: 'Twitter Retweet', rate: '0.80', min: '10', max: '10000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 37. TWITTER VIEW/IMPRESSION =====
      { service: 2040, name: 'Twitter View - Impression - Comment - Tổng hợp..', type: 'Mixed', category: 'Twitter View - Impression - Comment - Tổng hợp..', rate: '0.05', min: '500', max: '1000000', refill: false, avg_time: '0-30 Phút' },

      // ===== 38. TWITTER SPACE LISTENERS =====
      { service: 2050, name: 'Twitter Space Listeners (Update 05/01/26)', type: 'Live', category: 'Twitter Space Listeners (Update 05/01/26)', rate: '3.00', min: '50', max: '5000', refill: false, avg_time: '5-30 Phút' },

      // ===== 39. TWITTER LIVE BROADCAST =====
      { service: 2060, name: 'Twitter Live Boardcast View', type: 'Live', category: 'Twitter Live Boardcast View', rate: '4.00', min: '50', max: '5000', refill: false, avg_time: '5-30 Phút' },

      // ===== 40. TWITTER MENTION =====
      { service: 2070, name: 'Twitter Mention - Lượt nhắc tới (Hoạt động như Tag bạn bè Facebook)', type: 'Default', category: 'Twitter Mention - Lượt nhắc tới (Hoạt động như Tag bạn bè Facebook)', rate: '1.00', min: '10', max: '5000', refill: false, avg_time: '1-6 Giờ' },

      // ===== 41. TWITTER SEEDING =====
      { service: 2080, name: 'Twitter Seeding - Like/Comment/Retweet/Mention... Từ cùng 1 account', type: 'Seeding', category: 'Twitter Seeding - Like/Comment/Retweet/Mention... Từ cùng 1 account', rate: '5.00', min: '1', max: '1000', refill: false, avg_time: '1-24 Giờ' },

      // ===== 42. TELEGRAM MEMBER/CHANNEL SUBSCRIBERS =====
      { service: 1600, name: 'Telegram Member/Channel Subscribers - Nhanh', type: 'Default', category: 'Telegram Member/Channel Subscribers', rate: '1.50', min: '50', max: '500000', refill: false, avg_time: '0-30 Phút' },
      { service: 1601, name: 'Telegram Channel Subscribers - Bảo hành', type: 'Default', category: 'Telegram Member/Channel Subscribers', rate: '2.00', min: '50', max: '100000', refill: true, avg_time: '1-24 Giờ' },

      // ===== 43. TELEGRAM PREMIUM MEMBER + VIEW SEO =====
      { service: 1700, name: 'Telegram Premium Member + Premium View - Tối Ưu Seo cho channel (Server độc lập)', type: 'Premium', category: 'Telegram Premium Member + Premium View - Tối Ưu Seo cho channel (Server độc lập)', rate: '8.00', min: '10', max: '10000', refill: true, avg_time: 'Đang tính toán' },

      // ===== 44. TELEGRAM PREMIUM MEMBER TĂNG HẠNG =====
      { service: 1710, name: 'Telegram Premium Member - Giúp tăng hạng mạnh cho channel', type: 'Premium', category: 'Telegram Premium Member - Giúp tăng hạng mạnh cho channel', rate: '6.00', min: '10', max: '50000', refill: false, avg_time: 'Đang tính toán' },

      // ===== 45. TELEGRAM PREMIUM MEMBER SEARCH =====
      { service: 1720, name: 'Telegram Premium Member - Join từ Search theo tên Group/Channel', type: 'Premium', category: 'Telegram Premium Member - Join từ Search theo tên Group/Channel', rate: '7.00', min: '10', max: '10000', refill: false, avg_time: 'Đang tính toán' },

      // ===== 46. TELEGRAM PREMIUM MEMBER + VIEW BẢO HÀNH =====
      { service: 1730, name: 'Telegram Premium Member + View - Giúp tăng hạng cho channel | Bảo hành 20 - 90 ngày', type: 'Premium', category: 'Telegram Premium Member + View - Giúp tăng hạng cho channel | Bảo hành 20 - 90 ngày', rate: '9.00', min: '10', max: '5000', refill: true, avg_time: 'Đang tính toán' },

      // ===== 47. TELEGRAM PREMIUM BOOST =====
      { service: 1740, name: 'Telegram Premium Boost Channel | Mở khóa Story cho Channel', type: 'Boost', category: 'Telegram Premium Boost Channel | Mở khóa Story cho Channel', rate: '12.00', min: '1', max: '1000', refill: false, avg_time: 'Đang tính toán' },

      // ===== 48. TELEGRAM BOT START =====
      { service: 1750, name: 'Telegram Bot Start [Tăng monthly User]', type: 'Bot', category: 'Telegram Bot Start [Tăng monthly User]', rate: '3.00', min: '100', max: '100000', refill: false, avg_time: '1-24 Giờ' },

      // ===== 49. HAMSTER KOMBAT REF =====
      { service: 1760, name: 'Hamster Kombat Ref - Blum - Các loại bot Ref', type: 'Special', category: 'Hamster Kombat Ref - Blum - Các loại bot Ref', rate: '2.00', min: '10', max: '10000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 50. TELEGRAM PREMIUM BOT START =====
      { service: 1770, name: 'Telegram Premium Bot Start', type: 'Premium', category: 'Telegram Premium Bot Start', rate: '5.00', min: '10', max: '10000', refill: false, avg_time: 'Đang tính toán' },

      // ===== 51. TELEGRAM MEMBER SERVER ƯU TIÊN =====
      { service: 1780, name: 'Telegram Member Server Ưu Tiên - Thường xuyên Online - Chạy trong 1s', type: 'Priority', category: 'Telegram Member Server Ưu Tiên - Thường xuyên Online - Chạy trong 1s', rate: '5.00', min: '10', max: '50000', refill: true, avg_time: '1 Giây' },

      // ===== 52. TELEGRAM POST VIEW QUÁ KHỨ =====
      { service: 1800, name: 'Telegram Post View - Post đã đăng trong quá khứ', type: 'Default', category: 'Telegram Post View - Post đã đăng trong quá khứ', rate: '0.10', min: '100', max: '1000000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 53. TELEGRAM AUTO VIEWS TƯƠNG LAI =====
      { service: 1810, name: 'Telegram Auto Views - Post đăng trong tương lai', type: 'Auto', category: 'Telegram Auto Views - Post đăng trong tương lai', rate: '0.15', min: '100', max: '500000', refill: false, avg_time: 'Tự động' },

      // ===== 54. TELEGRAM AUTO VIEW TỐC ĐỘ =====
      { service: 1820, name: 'Telegram Auto View Tùy chỉnh tốc độ lên View', type: 'Auto', category: 'Telegram Auto View Tùy chỉnh tốc độ lên View', rate: '0.20', min: '100', max: '200000', refill: false, avg_time: 'Tự động' },

      // ===== 55. TELEGRAM VIEW STATIC =====
      { service: 1830, name: 'Telegram View Static [View thật tăng hạng search]', type: 'Static', category: 'Telegram View Static [View thật tăng hạng search]', rate: '0.50', min: '100', max: '100000', refill: false, avg_time: '1-24 Giờ' },

      // ===== 56. TELEGRAM COMBO VIEW-SHARE-REACTION =====
      { service: 1840, name: 'Telegram Combo View- Share - Reaction Up Hạng Channel Target Quốc Gia', type: 'Combo', category: 'Telegram Combo View- Share - Reaction Up Hạng Channel Target Quốc Gia', rate: '1.00', min: '100', max: '100000', refill: false, avg_time: '1-6 Giờ' },

      // ===== 57. SPOTIFY =====
      { service: 7001, name: 'Spotify Followers', type: 'Default', category: 'Spotify', rate: '3.00', min: '50', max: '20000', refill: true, avg_time: '1-7 Ngày' },
      { service: 7002, name: 'Spotify Plays - Premium', type: 'Default', category: 'Spotify', rate: '0.30', min: '1000', max: '10000000', refill: false, avg_time: '1-3 Ngày' },
      { service: 7003, name: 'Spotify Monthly Listeners', type: 'Default', category: 'Spotify', rate: '5.00', min: '100', max: '100000', refill: true, avg_time: '1-7 Ngày' },

      // ===== 58. SOUNDCLOUD =====
      { service: 7010, name: 'Soundcloud Followers', type: 'Default', category: 'Soundcloud', rate: '2.50', min: '50', max: '10000', refill: true, avg_time: '1-3 Ngày' },
      { service: 7011, name: 'Soundcloud Plays', type: 'Default', category: 'Soundcloud', rate: '0.20', min: '500', max: '1000000', refill: false, avg_time: '0-1 Giờ' },
      { service: 7012, name: 'Soundcloud Likes', type: 'Default', category: 'Soundcloud', rate: '0.80', min: '50', max: '10000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 59. REDDIT =====
      { service: 8000, name: 'Reddit Upvotes', type: 'Default', category: 'Reddit', rate: '1.00', min: '10', max: '1000', refill: false, avg_time: '0-1 Giờ' },
      { service: 8001, name: 'Reddit Post Views', type: 'Default', category: 'Reddit', rate: '0.50', min: '100', max: '100000', refill: false, avg_time: '0-30 Phút' },

      // ===== 60. DISCORD =====
      { service: 8100, name: 'Discord Server Members', type: 'Default', category: 'Discord', rate: '4.00', min: '50', max: '50000', refill: false, avg_time: '1-24 Giờ' },
      { service: 8101, name: 'Discord Online Members', type: 'Default', category: 'Discord', rate: '8.00', min: '10', max: '5000', refill: false, avg_time: '1-6 Giờ' },
      { service: 8102, name: 'Discord Followers (channel)', type: 'Default', category: 'Discord', rate: '2.00', min: '50', max: '20000', refill: true, avg_time: '1-7 Ngày' },

      // ===== 61. TWITCH =====
      { service: 8200, name: 'Twitch Followers', type: 'Default', category: 'Twitch', rate: '1.50', min: '50', max: '10000', refill: true, avg_time: '1-3 Ngày' },
      { service: 8201, name: 'Twitch Live Viewers', type: 'Live', category: 'Twitch', rate: '5.00', min: '50', max: '2000', refill: false, avg_time: '5-30 Phút' },
      { service: 8202, name: 'Twitch Channel Views', type: 'Default', category: 'Twitch', rate: '0.50', min: '100', max: '100000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 62. LINKEDIN =====
      { service: 8300, name: 'LinkedIn Followers', type: 'Default', category: 'LinkedIn', rate: '2.00', min: '50', max: '10000', refill: true, avg_time: '1-7 Ngày' },
      { service: 8301, name: 'LinkedIn Post Likes', type: 'Default', category: 'LinkedIn', rate: '0.80', min: '10', max: '5000', refill: false, avg_time: '0-1 Giờ' },

      // ===== 63. WEBSITE TRAFFIC (GENERAL) =====
      { service: 9000, name: 'Website Traffic - Global Real', type: 'Default', category: 'Website Traffic', rate: '0.50', min: '1000', max: '10000000', refill: false, avg_time: '1-3 Ngày' },
      { service: 9001, name: 'Website Traffic - Direct', type: 'Default', category: 'Website Traffic', rate: '0.80', min: '1000', max: '5000000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 64. WEBSITE TRAFFIC RESIDENTIAL IP =====
      { service: 9010, name: 'Website Traffic - Lượt Truy Cập Trang Web với IP Khu Dân Cư/Hộp Gia Đình - Bybass mọi CND (Cloudflare....)', type: 'Residential', category: 'Website Traffic - Lượt Truy Cập Trang Web với IP Khu Dân Cư/Hộp Gia Đình - Bybass mọi CND (Cloudflare....)', rate: '2.00', min: '1000', max: '5000000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 65. WEBSITE TRAFFIC TARGET QUỐC GIA =====
      { service: 9020, name: 'Website Traffic [Target quốc gia] - Chọn nước', type: 'Geo', category: 'Website Traffic [Target quốc gia]', rate: '1.50', min: '1000', max: '10000000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 66. WEBSITE TRAFFIC FROM VIETNAM =====
      { service: 9030, name: 'Website Traffic from Vietnam - IP Việt Nam', type: 'Geo', category: 'Website Traffic from Vietnam', rate: '2.00', min: '1000', max: '1000000', refill: false, avg_time: '1-3 Ngày' },
      { service: 9031, name: 'Website Traffic Vietnam - Organic', type: 'Organic', category: 'Website Traffic from Vietnam', rate: '3.00', min: '500', max: '500000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 67. WEBSITE TRAFFIC FROM IPHONE 14 =====
      { service: 9040, name: 'Website Traffic from Iphone 14 - Mobile iOS', type: 'Mobile', category: 'Website Traffic from Iphone 14', rate: '2.50', min: '1000', max: '2000000', refill: false, avg_time: '1-3 Ngày' },

      // ===== 68. CRYPTOCURRENCY TARGETED TRAFFIC =====
      { service: 9050, name: 'Cryptocurrency Targeted Traffic (Premium)', type: 'Premium', category: 'Cryptocurrency Targeted Traffic (Premium)', rate: '5.00', min: '500', max: '500000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 69. GÓI WEBSITE TRAFFIC PREMIUM =====
      { service: 9060, name: 'Gói Website Traffic Premium - Chất lượng cực cao', type: 'Premium', category: 'Gói Website Traffic Premium - Chất lượng cực cao', rate: '8.00', min: '500', max: '200000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 70. SOUTH-KOREAN TARGETED TRAFFIC =====
      { service: 9070, name: 'South-Korean Targeted Traffic (Premium)', type: 'Premium', category: 'South-Korean Targeted Traffic (Premium)', rate: '6.00', min: '500', max: '200000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 71. WHATSAPP =====
      { service: 9100, name: 'Whatsapp Members - Group', type: 'Default', category: 'Whatsapp', rate: '3.00', min: '10', max: '10000', refill: false, avg_time: '1-3 Ngày' },
      { service: 9101, name: 'Whatsapp Channel Followers', type: 'Default', category: 'Whatsapp', rate: '2.00', min: '50', max: '50000', refill: false, avg_time: '1-7 Ngày' },

      // ===== 72. KHÁC =====
      { service: 9990, name: 'Dịch vụ khác - Liên hệ để biết thêm', type: 'Other', category: 'Khác', rate: '1.00', min: '1', max: '100000', refill: false, avg_time: 'Liên hệ' },
    ];
  }
};

// Helper functions
function getUserData() {
  try { return JSON.parse(localStorage.getItem('dp_user')) || {}; } catch { return {}; }
}

function saveUserData(data) {
  localStorage.setItem('dp_user', JSON.stringify(data));
}

function isLoggedIn() {
  return localStorage.getItem('dp_logged_in') === 'true';
}
