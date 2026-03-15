/**
 * GET /api/services
 * Lấy danh sách dịch vụ từ DenyPanel, cache 10 phút
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const qs      = require('querystring');

const SERVICES_API_KEY = process.env.DENYPANEL_KEY || 'fa92015088b93cbede91594df8006018';
const CACHE_TTL        = 10 * 60 * 1000; // 10 phút
let _cache     = null;
let _cacheTime = 0;

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=600');

  // Trả cache nếu còn hiệu lực
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return res.json(_cache);
  }

  try {
    const raw    = await fetchServices();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid response from DenyPanel');

    _cache     = parsed;
    _cacheTime = Date.now();
    console.log(`[Services] Fetched ${parsed.length} services from DenyPanel`);
    res.json(parsed);
  } catch (err) {
    console.error('[Services] Error:', err.message);
    if (_cache) return res.json(_cache);          // Dùng cache cũ
    res.status(500).json({ error: err.message });
  }
});

function fetchServices() {
  return new Promise((resolve, reject) => {
    const postData = qs.stringify({ action: 'services', key: SERVICES_API_KEY });
    const req = https.request({
      hostname: 'denypanel.com',
      port: 443,
      path: '/api/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      rejectUnauthorized: false,
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

module.exports = router;
