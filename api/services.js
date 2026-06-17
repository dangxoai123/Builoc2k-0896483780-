/**
 * GET /api/services
 * Lấy danh sách dịch vụ từ DenyPanel, cache 10 phút
 * Áp markup từ DB vào giá trước khi trả về user
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const qs      = require('querystring');

const SERVICES_API_KEY = process.env.DENYPANEL_KEY || 'fa92015088b93cbede91594df8006018';
const CACHE_TTL        = 10 * 60 * 1000; // 10 phút cache raw services
const MARKUP_CACHE_TTL =  1 * 60 * 1000; //  1 phút cache markup

let _rawCache     = null;
let _rawCacheTime = 0;
let _markupCache     = null;
let _markupCacheTime = 0;

// Hàm lấy markup từ DB (có cache 1 phút)
async function getMarkupSettings() {
  if (_markupCache && Date.now() - _markupCacheTime < MARKUP_CACHE_TTL) {
    return _markupCache;
  }
  try {
    const { pool } = require('./auth');
    // Tạo bảng settings nếu chưa có
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    const result = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('markup_global', 'markup_data')"
    );
    const s = {};
    result.rows.forEach(r => { s[r.key] = r.value; });
    _markupCache = {
      globalMarkup: parseFloat(s.markup_global || '0'),
      markupData:   s.markup_data ? JSON.parse(s.markup_data) : {}
    };
    _markupCacheTime = Date.now();
    return _markupCache;
  } catch(e) {
    console.warn('[Services] Không lấy được markup:', e.message);
    return { globalMarkup: 0, markupData: {} };
  }
}

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); // Tắt Cloudflare cache vì giá thay đổi theo markup

  // Lấy raw services (cache 10 phút)
  let parsed = null;
  if (_rawCache && Date.now() - _rawCacheTime < CACHE_TTL) {
    parsed = _rawCache;
  } else {
    try {
      const raw = await fetchServices();
      try { parsed = JSON.parse(raw); } catch { parsed = null; }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.warn('[Services] DenyPanel returned non-array, raw:', raw.slice(0, 120));
        if (_rawCache) parsed = _rawCache;
        else return res.status(502).json({ error: 'DenyPanel API không khả dụng', raw: raw.slice(0, 120) });
      } else {
        _rawCache     = parsed;
        _rawCacheTime = Date.now();
        console.log(`[Services] Fetched ${parsed.length} services from DenyPanel`);
      }
    } catch (err) {
      console.error('[Services] Error:', err.message);
      if (_rawCache) parsed = _rawCache;
      else return res.status(500).json({ error: err.message });
    }
  }

  // Áp markup vào giá
  const { globalMarkup, markupData } = await getMarkupSettings();
  const priced = parsed.map(svc => {
    const mk = markupData[svc.service] !== undefined ? markupData[svc.service] : globalMarkup;
    if (!mk) return svc;
    return {
      ...svc,
      rate: (parseFloat(svc.rate) * (1 + mk / 100)).toFixed(4)
    };
  });

  res.json(priced);
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

