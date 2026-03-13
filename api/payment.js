/**
 * VERCEL SERVERLESS FUNCTION - AUTO PAYMENT (Sepay)
 * GET  /api/payment?ref=BUILOCXXXXXX → polling
 * POST /api/payment                  → Sepay webhook
 */

const https = require('https');

const SEPAY_TOKEN         = 'WW6NPUYVK0DSVDH5N2C8T9OAOAUMLIK4GVCJ5AE2SYMTTJIPFLCW4BKED3UEZBMR';
const REAL_ACCOUNT        = '8837755253';
// Tỷ giá nạp tiền (phải khớp với tỷ giá hiển thị trong dashboard để không bị mất tiền)
// Xem api/rate.js FALLBACK_RATE = 26294.5
const VND_DEPOSIT_RATE    = 26294.5; // 1 USD = 26,294.5 VND

const FIREBASE_PROJECT    = 'builoc2k-denypanel';
const FIREBASE_WEB_API_KEY = 'AIzaSyDA6SIIeT8jlzLMyp1r6WnefnsGQxMgygA';

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
    if (body.transferType !== 'in') return res.status(200).json({ skipped: 'not incoming' });
    const content = body.content || '';
    const amount  = parseFloat(body.transferAmount || 0);
    const txId    = String(body.id || '');
    if (!content || amount <= 0) return res.status(200).json({ skipped: 'empty' });
    const m = content.toUpperCase().match(/BUILOC[A-Z0-9]{6}/);
    if (!m) return res.status(200).json({ skipped: 'no ref' });
    const result = await creditByRef(m[0], amount, txId, content);
    return res.status(200).json({ success: true, amount, result });
  } catch(e) {
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

// Credit user via Firestore REST API
// Flow: pending_deposits/{ref} → get uid → users/{uid} PATCH balance
async function creditByRef(ref, amount, txId, description) {
  const rq   = `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_WEB_API_KEY}`;
  const qKey  = `?key=${FIREBASE_WEB_API_KEY}`;  // for paths with NO other params
  const aKey  = `&key=${FIREBASE_WEB_API_KEY}`;  // ⚠️ for paths that ALREADY have ?param=value
  try {
    // 1. Find pending deposit by ref (rules: read=true)
    const qResp = await httpPost('firestore.googleapis.com', rq, JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'pending_deposits' }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'ref' },    op: 'EQUAL', value: { stringValue: ref } } },
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
        ]}},
        limit: 1,
      },
    }));
    const pDoc = JSON.parse(qResp).find(d => d.document)?.document;
    if (!pDoc) return { error: `No pending deposit: ${ref}` };

    const uid   = pDoc.fields?.uid?.stringValue;
    const email = pDoc.fields?.email?.stringValue;
    // ⚠️ Firestore runQuery trả về name BÊN TRONG (không có /v1/)
    // Đúng: /v1/ + pDoc.name
    const pDocFullPath = `/v1/${pDoc.name}`;
    if (!uid) return { error: 'No uid in pending deposit' };

    // 2. Read current balance (use uid path directly — no email query needed)
    const uPath    = `projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}`;
    const uResp    = await httpGet('firestore.googleapis.com', `/v1/${uPath}${qKey}`);
    const uDoc     = JSON.parse(uResp);
    const oldBal   = parseFloat(uDoc.fields?.balance?.doubleValue || uDoc.fields?.balance?.integerValue || 0);
    // ⚠️ Sepay trả về amount bằng VND, balance lưu bằng USD
    // Ví dụ: nạp 10,000 VND → 10000 / 27000 ≈ $0.37 USD
    const amountUSD = parseFloat(amount) / VND_DEPOSIT_RATE;
    const newBal   = parseFloat((oldBal + amountUSD).toFixed(6));

    // 3. Mark pending deposit completed
    await httpPatch('firestore.googleapis.com',
      `${pDocFullPath}?updateMask.fieldPaths=status&updateMask.fieldPaths=txId&updateMask.fieldPaths=completedAt${aKey}`,
      JSON.stringify({ fields: { status: { stringValue: 'completed' }, txId: { stringValue: String(txId) }, completedAt: { stringValue: new Date().toISOString() } } })
    );

    // 4. Update balance (rules: balance-only update without auth is allowed)
    await httpPatch('firestore.googleapis.com',
      `/v1/${uPath}?updateMask.fieldPaths=balance${aKey}`,
      JSON.stringify({ fields: { balance: { doubleValue: newBal } } })
    );

    // 5. Log transaction (rules: create=true)
    await httpPost('firestore.googleapis.com',
      `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/transactions${qKey}`,
      JSON.stringify({ fields: {
        email:         { stringValue: email || '' },
        uid:           { stringValue: uid },
        type:          { stringValue: 'deposit' },
        amount:        { doubleValue: parseFloat(amount) },
        txId:          { stringValue: String(txId) },
        ref:           { stringValue: ref },
        description:   { stringValue: description || '' },
        createdAt:     { stringValue: new Date().toISOString() },
        balanceBefore: { doubleValue: oldBal },
        balanceAfter:  { doubleValue: newBal },
        gateway:       { stringValue: 'Sepay/BIDV' },
      }})
    );

    console.log(`[credit] ✅ uid=${uid} +${amount} → ${newBal}`);
    return { success: true, email, amount, newBalance: newBal };
  } catch(e) {
    console.error('[credit]', e.message);
    return { error: e.message };
  }
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
