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


const FIREBASE_PROJECT    = 'builoc2k-denypanel';
const FIREBASE_WEB_API_KEY = 'AIzaSyDA6SIIeT8jlzLMyp1r6WnefnsGQxMgygA';
const VND_DEPOSIT_RATE    = 26294.5;

// Credit user via Firestore REST API — đọc balance cũ rồi ghi balance mới (upsert)
// Hoạt động đúng với user mới chưa có document trong Firestore
async function creditByRef(ref, amount, txId, description) {
  const qKey = `?key=${FIREBASE_WEB_API_KEY}`;
  const rqPath = `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery${qKey}`;

  try {
    // 1. Tìm pending deposit theo ref
    const qResp = await httpPost('firestore.googleapis.com', rqPath, JSON.stringify({
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
    if (!uid) return { error: 'No uid in pending deposit' };

    const addUSD   = parseFloat((parseFloat(amount) / VND_DEPOSIT_RATE).toFixed(6));
    const uDocPath = `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}${qKey}`;

    // 2. Đọc balance hiện tại của user (GET)
    //    Nếu user mới chưa có document → balance = 0 (upsert khi ghi)
    let currentBalance = 0;
    try {
      const getResp = await httpGet('firestore.googleapis.com', uDocPath);
      const getJson = JSON.parse(getResp);
      if (!getJson.error) {
        currentBalance = parseFloat(
          getJson.fields?.balance?.doubleValue ||
          getJson.fields?.balance?.integerValue || 0
        );
      }
    } catch(e) {
      console.log('[credit] GET user doc failed, assume balance=0:', e.message);
    }

    const newBalance = parseFloat((currentBalance + addUSD).toFixed(6));
    console.log(`[credit] uid=${uid} balance: ${currentBalance} + ${addUSD} = ${newBalance}`);

    // 3. Commit batch: ghi balance mới (upsert) + đánh dấu pending completed
    const commitPath = `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:commit${qKey}`;
    const uFullPath  = `projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}`;
    const pFullName  = pDoc.name.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, '');

    const commitBody = JSON.stringify({
      writes: [
        // 3a. Cập nhật balance (updateMask → chỉ ghi field balance, không xóa các field khác)
        //     Nếu document chưa tồn tại → Firestore sẽ tạo mới (upsert)
        {
          update: {
            name: uFullPath,
            fields: { balance: { doubleValue: newBalance } }
          },
          updateMask: { fieldPaths: ['balance'] }
        },
        // 3b. Đánh dấu pending_deposits = completed
        {
          update: {
            name: `projects/${FIREBASE_PROJECT}/databases/(default)/documents/${pFullName}`,
            fields: {
              status:      { stringValue: 'completed' },
              txId:        { stringValue: String(txId || ref) },
              completedAt: { stringValue: new Date().toISOString() },
            }
          },
          updateMask: { fieldPaths: ['status', 'txId', 'completedAt'] }
        }
      ]
    });

    const commitResp = await httpPost('firestore.googleapis.com', commitPath, commitBody);
    const commitJson = JSON.parse(commitResp);

    if (commitJson.error) {
      console.error('[credit] commit error:', JSON.stringify(commitJson.error));
      return { error: commitJson.error.message || 'commit failed' };
    }

    // 4. Ghi log transaction
    await httpPost('firestore.googleapis.com',
      `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/transactions${qKey}`,
      JSON.stringify({ fields: {
        email:       { stringValue: email || '' },
        uid:         { stringValue: uid },
        type:        { stringValue: 'deposit' },
        amount:      { doubleValue: parseFloat(amount) },
        amountUSD:   { doubleValue: addUSD },
        txId:        { stringValue: String(txId || ref) },
        ref:         { stringValue: ref },
        description: { stringValue: description || '' },
        createdAt:   { stringValue: new Date().toISOString() },
        gateway:     { stringValue: 'Sepay/MBBank' },
      }})
    );

    console.log(`[credit] ✅ uid=${uid} +${amount}VND (+${addUSD}USD) newBal=${newBalance}`);
    return { success: true, email, amount, amountUSD: addUSD, newBalance };
  } catch(e) {
    console.error('[credit] ❌', e.message);
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
