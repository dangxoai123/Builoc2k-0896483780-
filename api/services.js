/**
 * ==========================================
 * VERCEL SERVERLESS FUNCTION - SERVICES CACHE
 * GET /api/services
 *
 * Lấy danh sách dịch vụ từ DenyPanel với API key
 * của tài khoản reseller (giá đúng cho web con).
 * Cache 10 phút để tránh gọi API quá nhiều.
 * ==========================================
 */

const https = require('https');
const querystring = require('querystring');

// Key reseller - giá DenyPanel đúng cho web con
const SERVICES_API_KEY = 'fa92015088b93cbede91594df8006018';

// In-memory cache (10 phút)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Return cache nếu còn hiệu lực
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return res.status(200).json(_cache);
  }

  try {
    const data = await fetchServices();
    const parsed = JSON.parse(data);

    if (!Array.isArray(parsed)) throw new Error('Invalid response from DenyPanel');

    _cache = parsed;
    _cacheTime = Date.now();

    console.log(`[Services] Fetched ${parsed.length} services from DenyPanel`);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[Services] Error:', err.message);

    // Nếu có cache cũ thì dùng tạm
    if (_cache) return res.status(200).json(_cache);

    return res.status(500).json({ error: err.message });
  }
};

function fetchServices() {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      action: 'services',
      key: SERVICES_API_KEY,
    });
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}
