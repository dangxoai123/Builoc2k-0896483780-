/**
 * VERCEL SERVERLESS FUNCTION - AUTO PAYMENT (Sepay)
 * GET  /api/payment?ref=BUILOCXXXXXX → polling
 * POST /api/payment                  → Sepay webhook
 */

const https = require('https');

const SEPAY_TOKEN          = '1JSSV8HTJJNLKHWBAMKQG4YEWA2FPVA243UKLOYEPPRUMIL78UCBOW3EQGDGIRAX';
const REAL_ACCOUNT         = '0896483780';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET')     return handlePolling(req, res);
  if (req.method === 'POST')    return handleWebhook(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handlePolling(req, res) {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Missing ref' });
  try {
    const txs   = await fetchSepay(20);
    const match = txs.find(tx =>
      (tx.transaction_content || '').toUpperCase().includes(ref.toUpperCase())
    );
    if (match) {
      const amount = parseFloat(match.amount_in || 0);
      const txId   = String(match.id || ref);
      const result = await creditByRef(ref, amount, txId, match.transaction_content || '');
      return res.status(200).json({ found: true, amount, result });
    }
    return res.status(200).json({ found: false });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleWebhook(req, res) {
  try {
    const body = req.body || {};
    // Log toàn bộ webhook để debug (xem trong Vercel logs)
    console.log('[webhook] received:', JSON.stringify(body));

    // Bỏ qua nếu rõ ràng là giao dịch ra (out/debit)
    // Sepay có thể gửi: 'in', 'credit', 'Cr', '' hoặc không có field
    const tType = (body.transferType || body.type || '').toLowerCase();
    if (tType === 'out' || tType === 'debit' || tType === 'dr') {
      return res.status(200).json({ skipped: 'outgoing' });
    }

    // Amount: Sepay có thể dùng các field khác nhau tùy ngân hàng
    const amount = parseFloat(
      body.transferAmount || body.amount || body.value ||
      body.transactionAmount || body.creditAmount || 0
    );

    // Content: nội dung chuyển khoản
    const content = (
      body.content || body.description || body.transaction_content ||
      body.memo || body.remarks || body.addInfo || ''
    );

    const txId = String(body.id || body.transactionId || body.referenceCode || Date.now());

    console.log(`[webhook] amount=${amount}, content="${content}", type="${tType}"`);

    if (!content || amount <= 0) {
      console.log('[webhook] skipped: empty content or zero amount');
      return res.status(200).json({ skipped: 'empty' });
    }

    const m = content.toUpperCase().match(/BUILOC[A-Z0-9]{6}/);
    if (!m) {
      console.log('[webhook] skipped: no BUILOC ref in content');
      return res.status(200).json({ skipped: 'no ref' });
    }

    const result = await creditByRef(m[0], amount, txId, content);
    console.log('[webhook] credit result:', JSON.stringify(result));
    return res.status(200).json({ success: true, amount, result });
  } catch(e) {
    console.error('[webhook] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// Sepay API — ⚠️ returns 'transactions' (not 'transaction_list')
async function fetchSepay(limit = 20) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'my.sepay.vn', port: 443,
      path: `/userapi/transactions/list?limit=${limit}&account_number=${REAL_ACCOUNT}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${SEPAY_TOKEN}` },
    }, (resp) => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve((j.transactions || j.transaction_list || []).filter(tx => parseFloat(tx.amount_in || 0) > 0));
        } catch { resolve([]); }
      });
    });
    r.on('error', reject);
    r.setTimeout(12000, () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

// Credit user qua Cloud Function creditUser (Admin SDK - bypass Firestore rules)
const CREDIT_USER_URL    = 'https://us-central1-builoc2k-denypanel.cloudfunctions.net/creditUser';
const INTERNAL_SECRET    = 'DENYPANEL_INTERNAL_2026_SECRET_KEY';
const VND_DEPOSIT_RATE   = 26294.5; // duplicate để dùng ở đây

async function creditByRef(ref, amountVND, txId, description) {
  // Chuyển VND → USD trước khi gửi lên Cloud Function
  // Cloud Function sẽ cộng thẳng amount vào balance (đơn vị USD)
  const amountUSD = parseFloat(amountVND) / VND_DEPOSIT_RATE;

  const body = JSON.stringify({
    secret:      INTERNAL_SECRET,
    ref,
    amount:      parseFloat(amountUSD.toFixed(6)),
    txId:        String(txId || ref),
    description: description || '',
  });

  return new Promise((resolve, reject) => {
    const url  = new URL(CREDIT_USER_URL);
    const req  = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (resp) => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => {
        try {
          const json = JSON.parse(d);
          console.log(`[creditByRef] CloudFn response:`, JSON.stringify(json));
          resolve(json);
        } catch(e) {
          resolve({ raw: d });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('creditByRef timeout')); });
    req.write(body);
    req.end();
  });
}


function httpGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname, port: 443, path, method: 'GET', headers: { 'Content-Type': 'application/json' } }, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(d));
    });
    r.on('error', reject); r.setTimeout(12000, () => { r.destroy(); reject(new Error('timeout')); }); r.end();
  });
}
function httpPost(h, p, b)  { return httpReq('POST',  h, p, b); }
function httpPatch(h, p, b) { return httpReq('PATCH', h, p, b); }
function httpReq(method, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body || '', 'utf8');
    const r   = https.request({ hostname, port: 443, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length } }, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(d));
    });
    r.on('error', reject); r.setTimeout(12000, () => { r.destroy(); reject(new Error('timeout')); });
    r.write(buf); r.end();
  });
}
