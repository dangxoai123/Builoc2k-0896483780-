/**
 * ==========================================
 * FIREBASE CLOUD FUNCTION - DENYPANEL PROXY
 * Backend: Firebase Functions (Node.js 20)
 * Frontend: GitHub Pages
 *
 * Architecture:
 *   GitHub Pages (frontend) → Firebase Function URL → denypanel.com/api/v2
 * ==========================================
 */

const { onRequest } = require('firebase-functions/v2/https');
const https = require('https');
const querystring = require('querystring');

// ==========================================
// CẤU HÌNH - Cập nhật theo project của bạn
// ==========================================
const DENY_PANEL_API_KEY = '3b341f23c723707da4ce67f673f4e2f8';
const DENY_PANEL_HOSTNAME = 'denypanel.com';
const DENY_PANEL_PATH = '/api/v2';

// Các domain được phép gọi (GitHub Pages domain của bạn)
// Thêm domain GitHub Pages thực của bạn vào đây: 'https://USERNAME.github.io'
const ALLOWED_ORIGINS = [
  'https://localhost',
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5500',        // VS Code Live Server
  'http://127.0.0.1:5500',
  'https://127.0.0.1',
];

// Hàm kiểm tra origin có được phép không
function isAllowedOrigin(origin) {
  if (!origin) return true; // curl / postman
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Cho phép tất cả GitHub Pages domain: *.github.io
  if (origin.endsWith('.github.io')) return true;
  // Cho phép tất cả Firebase App domains
  if (origin.endsWith('.web.app') || origin.endsWith('.firebaseapp.com')) return true;
  return false;
}

/**
 * Firebase HTTPS Function: denyProxy
 *
 * Sau khi deploy, URL sẽ có dạng:
 * https://denyproxy-RANDOM-uc.a.run.app
 * hoặc:
 * https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/denyProxy
 */
exports.denyProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    // KHÔNG dùng cors: true để tự xử lý whitelist
  },
  async (req, res) => {
    const origin = req.headers.origin || '';

    // Set CORS headers
    if (isAllowedOrigin(origin)) {
      res.set('Access-Control-Allow-Origin', origin || '*');
    } else {
      res.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
    }
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');

    // Xử lý preflight
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // Chỉ chấp nhận POST
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      // Merge body + API key
      const bodyData = { ...req.body, key: DENY_PANEL_API_KEY };
      const postData = querystring.stringify(bodyData);

      console.log(`[denyProxy] action=${req.body.action} from ${origin}`);

      // Gọi DenyPanel API
      const result = await callDenyPanel(postData);
      const parsed = JSON.parse(result);

      console.log(`[denyProxy] response:`, JSON.stringify(parsed).substring(0, 200));
      res.status(200).json(parsed);

    } catch (err) {
      console.error('[denyProxy] Error:', err.message);
      res.status(500).json({ error: 'Proxy error: ' + err.message });
    }
  }
);

/**
 * Gọi DenyPanel API qua HTTPS native Node.js
 */
function callDenyPanel(postData) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: DENY_PANEL_HOSTNAME,
      port: 443,
      path: DENY_PANEL_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (DenyPanel-Firebase-Proxy/2.0)',
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        console.log(`[denyProxy] HTTP ${response.statusCode} - ${data.substring(0, 100)}`);
        resolve(data);
      });
    });

    request.on('error', reject);
    request.setTimeout(25000, () => {
      request.destroy();
      reject(new Error('Request timeout after 25s'));
    });

    request.write(postData);
    request.end();
  });
}
