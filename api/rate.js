/**
 * ==========================================
 * VERCEL SERVERLESS FUNCTION - EXCHANGE RATE
 * GET /api/rate
 *
 * Lấy tỷ giá VND/USD thực từ DenyPanel
 * Cách hoạt động:
 *   1. Gọi DenyPanel API để lấy giá USD của dịch vụ tham chiếu (ID 1536)
 *   2. Fetch trang DenyPanel với cookie user_currency=VND để lấy giá VND
 *   3. Tính rate = VND / USD → trả về tỷ giá chính xác của DenyPanel
 * Cache: 5 phút
 * ==========================================
 */

const https = require('https');
const querystring = require('querystring');

const API_KEY = '2a6149e2e8ff0be95ded16a8e408e2d6';      // Key đặt hàng (cũ)
const SERVICES_API_KEY = '58788d220d60bd1d1110e7871f5871d3'; // Key đồng bộ giá (mới)
// Service tham chiếu để tính tỷ giá (ID ổn định, có trên DenyPanel)
const REF_SERVICE_ID = '1536';
// Fallback nếu không lấy được tỷ giá từ DenyPanel
const FALLBACK_RATE = 27000; // Tỷ giá chính thức DenyPanel: 1 USD = 27,000 VND

// Cache trong memory (tối đa 5 phút)
let cachedRate = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 phút

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Trả cache nếu còn hiệu lực
  if (cachedRate && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json({ rate: cachedRate, source: 'cache' });
  }

  try {
    // Bước 1: Lấy giá USD của dịch vụ tham chiếu từ DenyPanel API
    const servicesRaw = await callDenyPanelAPI({ action: 'services', key: SERVICES_API_KEY });
    const services = JSON.parse(servicesRaw);
    const refService = services.find(s => String(s.service) === REF_SERVICE_ID);

    if (!refService) throw new Error('Reference service not found');
    const usdRate = parseFloat(refService.rate);

    // Bước 2: Fetch trang DenyPanel với cookie VND để lấy giá hiển thị
    const html = await fetchDenyPanelPage();

    // Bước 3: Tìm giá VND trong HTML (tìm pattern: số thập phân dài gần service 1536)
    const rate = parseExchangeRate(html, usdRate);

    if (rate && rate > 20000 && rate < 35000) {
      cachedRate = rate;
      cacheTime = Date.now();
      console.log(`[Rate] Fetched from DenyPanel: 1 USD = ${rate} VND`);
      return res.status(200).json({ rate, usdRate, source: 'denypanel' });
    }

    throw new Error('Could not parse VND rate from DenyPanel page');

  } catch (err) {
    console.warn('[Rate] Error, using fallback:', err.message);
    cachedRate = FALLBACK_RATE;
    cacheTime = Date.now();
    return res.status(200).json({ rate: FALLBACK_RATE, source: 'fallback', error: err.message });
  }
};

/**
 * Gọi DenyPanel API
 */
function callDenyPanelAPI(params) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(params);
    const options = {
      hostname: 'denypanel.com',
      port: 443,
      path: '/api/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      rejectUnauthorized: false,
    };
    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch trang DenyPanel /new-order với cookie VND để lấy giá VND
 */
function fetchDenyPanelPage() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'denypanel.com',
      port: 443,
      path: '/new-order',
      method: 'GET',
      headers: {
        'Cookie': 'user_currency=VND',
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'vi-VN,vi;q=0.9',
      },
      rejectUnauthorized: false,
    };
    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Page fetch timeout')); });
    req.end();
  });
}

/**
 * Parse tỷ giá từ HTML của DenyPanel
 * Tìm giá VND cho dịch vụ tham chiếu và tính tỷ giá
 */
function parseExchangeRate(html, usdRate) {
  try {
    // Pattern 1: Tìm số trực tiếp (kiểu: 73624.60)
    // DenyPanel hiển thị giá VND dạng số thập phân gần service 1536
    // Tỷ giá nằm trong khoảng 25000-30000 VND/USD
    // Giá VND/1000 của service 1536 ≈ usdRate * exchange_rate
    // Tìm pattern số trong khoảng hợp lý
    const vndExpected = usdRate * FALLBACK_RATE;
    const tolerance = vndExpected * 0.05; // 5% tolerance

    // Tìm tất cả số thập phân trong HTML
    const numbers = html.matchAll(/(\d{4,6}\.?\d{0,4})/g);
    for (const match of numbers) {
      const num = parseFloat(match[1]);
      if (num > vndExpected - tolerance && num < vndExpected + tolerance) {
        const calculatedRate = num / usdRate;
        if (calculatedRate > 25000 && calculatedRate < 30000) {
          return calculatedRate;
        }
      }
    }

    // Pattern 2: Tìm trực tiếp tỷ giá trong JS source
    const ratePatterns = [
      /exchange_rate['":\s]+(\d{5}\.?\d*)/,
      /vnd_rate['":\s]+(\d{5}\.?\d*)/,
      /currency_rate['":\s]+(\d{5}\.?\d*)/,
      /"rate":\s*(\d{5}\.?\d*)/,
    ];
    for (const pattern of ratePatterns) {
      const m = html.match(pattern);
      if (m) {
        const rate = parseFloat(m[1]);
        if (rate > 25000 && rate < 30000) return rate;
      }
    }

    return null;
  } catch {
    return null;
  }
}
