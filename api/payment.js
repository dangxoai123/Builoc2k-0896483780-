/**
 * ==========================================
 * VERCEL SERVERLESS FUNCTION - AUTO PAYMENT (Sepay)
 * File: api/payment.js
 *
 * Tích hợp Sepay.vn để tự động nhận tiền nạp.
 * - GET /api/payment?ref=BUILOCXXXXX  → polling từ frontend
 * - POST /api/payment                 → webhook từ Sepay
 *
 * Credit được xử lý qua Firebase Cloud Function (creditUser)
 * để bypass Firestore security rules dùng Admin SDK.
 * ==========================================
 */

const https = require('https');

// ==========================================
// CONFIG
// ==========================================
const SEPAY_TOKEN  = 'WW6NPUYVK0DSVDH5N2C8T9OAOAUMLIK4GVCJ5AE2SYMTTJIPFLCW4BKED3UEZBMR';
const BANK_ACCOUNT = '96247NDQTE';   // Số TK ảo BIDV (VA Sepay)
const REAL_ACCOUNT = '8837755253';   // Số TK BIDV thực (dùng lấy giao dịch từ Sepay)

// Firebase Cloud Function (Admin SDK - bypass security rules)
const INTERNAL_SECRET     = 'DENYPANEL_INTERNAL_2026_SECRET_KEY';
const CREDIT_FUNCTION_URL  = 'us-central1-builoc2k-denypanel.cloudfunctions.net';
const CREDIT_FUNCTION_PATH = '/creditUser';

// ==========================================
// MAIN HANDLER
// ==========================================
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET')     return handlePolling(req, res);
  if (req.method === 'POST')    return handleWebhook(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
};

// ==========================================
// POLLING — Frontend gọi mỗi 15-20s
// GET /api/payment?ref=BUILOCXXXXX
// ==========================================
async function handlePolling(req, res) {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Missing ref' });

  try {
    const transactions = await fetchSepayTransactions(20);
    const match = transactions.find(tx =>
      (tx.transaction_content || '').toUpperCase().includes(ref.toUpperCase())
    );

    if (match) {
      const amount = parseFloat(match.amount_in || 0);
      const txId   = match.id || match.reference_number || ref;
      const desc   = match.transaction_content || '';
      const result = await creditByRef(ref, amount, txId, desc);
      console.log(`[Polling] ✅ ref=${ref} amount=${amount}`);
      return res.status(200).json({ found: true, amount, result });
    }

    return res.status(200).json({ found: false });
  } catch (e) {
    console.error('[Polling] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ==========================================
// WEBHOOK — Sepay gọi khi có giao dịch mới
// POST /api/payment
// Body: { id, transferAmount, content, transferType, ... }
// ==========================================
async function handleWebhook(req, res) {
  try {
    const body = req.body || {};
    console.log('[Webhook] Sepay payload:', JSON.stringify(body));

    if (body.transferType !== 'in') {
      return res.status(200).json({ success: true, skipped: 'not incoming' });
    }

    const content = body.content || '';
    const amount  = parseFloat(body.transferAmount || 0);
    const txId    = String(body.id || '');

    if (!content || amount <= 0) {
      return res.status(200).json({ success: true, skipped: 'no content or zero' });
    }

    // Tìm ref code (BUILOCXXXXXX) trong nội dung
    const refMatch = content.toUpperCase().match(/BUILOC[A-Z0-9]{6}/);
    if (!refMatch) {
      return res.status(200).json({ success: true, skipped: 'no BUILOC ref in content' });
    }

    const ref    = refMatch[0];
    const result = await creditByRef(ref, amount, txId, content);
    console.log(`[Webhook] ✅ ref=${ref} amount=${amount}`);
    return res.status(200).json({ success: true, credited: true, amount, result });

  } catch (e) {
    console.error('[Webhook] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ==========================================
// SEPAY API — Lấy giao dịch gần nhất
// ==========================================
async function fetchSepayTransactions(limit = 20) {
  return new Promise((resolve, reject) => {
    const path = `/userapi/transactions/list?limit=${limit}&account_number=${REAL_ACCOUNT}`;
    const options = {
      hostname: 'my.sepay.vn',
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SEPAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          // ⚠️ Sepay API trả về 'transactions' (KHÔNG phải 'transaction_list')
          const list = json.transactions || json.transaction_list || [];
          const incoming = list.filter(tx => parseFloat(tx.amount_in || 0) > 0);
          console.log(`[Sepay] Found ${incoming.length} incoming transactions`);
          resolve(incoming);
        } catch (err) {
          console.error('[Sepay] Parse error:', err.message);
          resolve([]);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Sepay timeout')); });
    req.end();
  });
}

// ==========================================
// CREDIT USER — Gọi Firebase Cloud Function
// Cloud Function dùng Admin SDK → bypass Firestore rules
// ==========================================
async function creditByRef(ref, amount, txId, description) {
  const body = JSON.stringify({ secret: INTERNAL_SECRET, ref, amount, txId, description });
  try {
    const resp   = await httpsRequest('POST', CREDIT_FUNCTION_URL, CREDIT_FUNCTION_PATH, body);
    const result = JSON.parse(resp);
    console.log(`[creditByRef] Result:`, result);
    return result;
  } catch (e) {
    console.error('[creditByRef] Error:', e.message);
    return { error: e.message };
  }
}

// ==========================================
// HTTP HELPER
// ==========================================
function httpsRequest(method, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body || '', 'utf8');
    const options = {
      hostname, port: 443, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': buf.length,
      },
    };
    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(buf);
    req.end();
  });
}
