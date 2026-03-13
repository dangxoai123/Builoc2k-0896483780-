/**
 * ==========================================
 * VERCEL SERVERLESS FUNCTION - DENYPANEL PROXY
 * File: api/proxy.js
 * 
 * Architecture:
 *   GitHub Pages / Vercel Frontend → /api/proxy → denypanel.com/api/v2
 * 
 * Free tier: 100k requests/day on Vercel Hobby plan (no credit card)
 * ==========================================
 */

const https = require('https');
const querystring = require('querystring');

// DenyPanel API config
const DENY_PANEL_API_KEY = '5c89dc0a79cbb981b6444ca9cdc106dc';
const DENY_PANEL_HOSTNAME = 'denypanel.com';
const DENY_PANEL_PATH = '/api/v2';

module.exports = async function handler(req, res) {
  // CORS headers - cho phép GitHub Pages và Vercel gọi
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Merge body + inject API key
    const bodyData = { ...req.body, key: DENY_PANEL_API_KEY };
    const postData = querystring.stringify(bodyData);

    console.log(`[DenyProxy] action=${req.body?.action}`);

    // Gọi DenyPanel API
    const result = await callDenyPanel(postData);
    const parsed = JSON.parse(result);

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[DenyProxy] Error:', err.message);
    return res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
};

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
        'User-Agent': 'Mozilla/5.0 (Vercel-DenyPanel-Proxy/1.0)',
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve(data));
    });

    request.on('error', reject);
    request.setTimeout(25000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    request.write(postData);
    request.end();
  });
}
