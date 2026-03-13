/**
 * ==========================================
 * VERCEL SERVERLESS FUNCTION - AUTO PAYMENT (Sepay)
 * File: api/payment.js
 *
 * Tích hợp Sepay.vn để tự động nhận tiền nạp.
 * - GET /api/payment?ref=BUILOCXXXXX  → polling từ frontend
 * - POST /api/payment                 → webhook từ Sepay
 *
 * Firestore rules đã được cập nhật để cho phép:
 *   - balance update mà không cần auth
 *   - pending_deposits read/update không cần auth
 * ==========================================
 */

const https = require('https');

// ==========================================
// CONFIG
// ==========================================
const SEPAY_TOKEN  = 'WW6NPUYVK0DSVDH5N2C8T9OAOAUMLIK4GVCJ5AE2SYMTTJIPFLCW4BKED3UEZBMR';
const REAL_ACCOUNT = '8837755253';   // Số TK BIDV thực

const FIREBASE_PROJECT    = 'builoc2k-denypanel';
const FIREBASE_WEB_API_KEY = 'AIzaSyDA6SIIeT8jlzLMyp1r6WnefnsGQxMgygA';

// ==========================================
// MAIN HANDLER
// ==========================================
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET')  return handlePolling(req, res);
  if (req.method === 'POST') return handleWebhook(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};

// ==========================================
// POLLING
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
      const txId   = String(match.id || ref);
      const desc   = match.transaction_content || '';
      const result = await creditByRef(ref, amount, txId, desc);
      return res.status(200).json({ found: true, amount, result });
    }

    return res.status(200).json({ found: false });
  } catch (e) {
    console.error('[Polling]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ==========================================
// WEBHOOK
// ==========================================
async function handleWebhook(req, res) {
  try {
    const body = req.body || {};
    if (body.transferType !== 'in') return res.status(200).json({ success: true, skipped: 'not incoming' });

    const content = body.content || '';
    const amount  = parseFloat(body.transferAmount || 0);
    const txId    = String(body.id || '');

    if (!content || amount <= 0) return res.status(200).json({ success: true, skipped: 'empty' });

    const refMatch = content.toUpperCase().match(/BUILOC[A-Z0-9]{6}/);
    if (!refMatch) return res.status(200).json({ success: true, skipped: 'no ref' });

    const ref    = refMatch[0];
    const result = await creditByRef(ref, amount, txId, content);
    return res.status(200).json({ success: true, amount, result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ==========================================
// SEPAY API
// ==========================================
async function fetchSepayTransactions(limit = 20) {
  return new Promise((resolve, reject) => {
    const path = `/userapi/transactions/list?limit=${limit}&account_number=${REAL_ACCOUNT}`;
    const req  = https.request({
      hostname: 'my.sepay.vn', port: 443, path, method: 'GET',
      headers: { 'Authorization': `Bearer ${SEPAY_TOKEN}`, 'Content-Type': 'application/json' },
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          // ⚠️ Sepay trả về 'transactions' không phải 'transaction_list'
          const list = json.transactions || json.transaction_list || [];
          resolve(list.filter(tx => parseFloat(tx.amount_in || 0) > 0));
        } catch { resolve([]); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ==========================================
// CREDIT USER — Firestore REST API
// (rules đã mở cho phép balance update + pending_deposits read/write)
// ==========================================
async function creditByRef(ref, amount, txId, description) {
  const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
  const key  = `?key=${FIREBASE_WEB_API_KEY}`;

  try {
    // 1. Tìm pending deposit theo ref
    const qBody = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'pending_deposits' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'ref' },    op: 'EQUAL', value: { stringValue: ref } } },
              { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
            ],
          },
        },
        limit: 1,
      },
    });

    const qResp  = await post(`firestore.googleapis.com`, `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery${key}`, qBody);
    const qDocs  = JSON.parse(qResp);
    const pDoc   = qDocs.find(d => d.document)?.document;
    if (!pDoc) return { error: 'No pending deposit for ref: ' + ref };

    const email   = pDoc.fields?.email?.stringValue;
    if (!email)   return { error: 'No email in pending deposit' };
    const pPath   = pDoc.name.split('/v1/')[1];

    // 2. Đánh dấu pending deposit = completed
    await patch(`firestore.googleapis.com`,
      `/v1/${pPath}?updateMask.fieldPaths=status&updateMask.fieldPaths=txId&updateMask.fieldPaths=completedAt${key}`,
      JSON.stringify({ fields: { status: { stringValue: 'completed' }, txId: { stringValue: txId }, completedAt: { stringValue: new Date().toISOString() } } })
    );

    // 3. Tìm user theo email
    const uBody = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
        limit: 1,
      },
    });
    const uResp  = await post('firestore.googleapis.com', `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery${key}`, uBody);
    const uDocs  = JSON.parse(uResp);
    const uDoc   = uDocs.find(d => d.document)?.document;
    if (!uDoc) return { error: 'User not found: ' + email };

    const oldBal = parseFloat(uDoc.fields?.balance?.doubleValue || uDoc.fields?.balance?.integerValue || 0);
    const newBal = oldBal + parseFloat(amount);
    const uPath  = uDoc.name.split('/v1/')[1];

    // 4. Cộng tiền
    await patch('firestore.googleapis.com',
      `/v1/${uPath}?updateMask.fieldPaths=balance${key}`,
      JSON.stringify({ fields: { balance: { doubleValue: newBal } } })
    );

    // 5. Ghi log
    await post('firestore.googleapis.com',
      `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/transactions${key}`,
      JSON.stringify({ fields: {
        email:       { stringValue: email },
        type:        { stringValue: 'deposit' },
        amount:      { doubleValue: parseFloat(amount) },
        txId:        { stringValue: txId },
        ref:         { stringValue: ref },
        description: { stringValue: description || '' },
        createdAt:   { stringValue: new Date().toISOString() },
        balanceBefore: { doubleValue: oldBal },
        balanceAfter:  { doubleValue: newBal },
        gateway:     { stringValue: 'Sepay/BIDV' },
      }})
    );

    console.log(`[credit] ✅ ${email} +${amount} → ${newBal}`);
    return { success: true, email, amount, newBalance: newBal };

  } catch (e) {
    console.error('[credit] Error:', e.message);
    return { error: e.message };
  }
}

function post(hostname, path, body)       { return req('POST',  hostname, path, body); }
function patch(hostname, path, body)      { return req('PATCH', hostname, path, body); }
function req(method, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body || '', 'utf8');
    const r   = https.request({ hostname, port: 443, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length } }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    r.on('error', reject);
    r.setTimeout(12000, () => { r.destroy(); reject(new Error('Timeout')); });
    if (body) r.write(buf);
    r.end();
  });
}
