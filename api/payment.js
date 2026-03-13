/**
 * ==========================================
 * VERCEL SERVERLESS FUNCTION - AUTO PAYMENT (Sepay)
 * File: api/payment.js
 *
 * Tích hợp Sepay.vn để tự động nhận tiền nạp.
 * Sepay dùng Open Banking - KHÔNG cần mật khẩu IB.
 *
 * Flow:
 *   1. User nạp tiền → nhận mã ref ngẫu nhiên (BUILOCXXXXX)
 *   2. User chuyển khoản với nội dung chứa mã ref đó
 *   3. Frontend poll GET /api/payment?ref=BUILOCXXXXX mỗi 15s
 *   4. Server hỏi Sepay API → tìm giao dịch có chứa ref
 *   5. Nếu thấy → cộng tiền vào Firestore
 *
 * Webhook từ Sepay (POST /api/payment):
 *   Sepay phát hiện CK → POST real-time về đây
 *   → Tìm pending_deposit khớp ref → credit user
 * ==========================================
 */

const https = require('https');

// ==========================================
// CONFIG
// ==========================================
const SEPAY_TOKEN  = 'WW6NPUYVK0DSVDH5N2C8T9OAOAUMLIK4GVCJ5AE2SYMTTJIPFLCW4BKED3UEZBMR';
const BANK_ACCOUNT = '96247NDQTE';  // Số TK ảo BIDV (VA Sepay)
const REAL_ACCOUNT = '8837755253';  // Số TK BIDV thực
const BANK_NAME    = 'BIDV';

// Firebase project
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

  // GET: Frontend polling — kiểm tra xem ref đã được nạp chưa
  if (req.method === 'GET') return handlePolling(req, res);

  // POST: Webhook từ Sepay — có giao dịch mới
  if (req.method === 'POST') return handleWebhook(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
};

// ==========================================
// POLLING — Frontend gọi mỗi 15s
// GET /api/payment?ref=BUILOCXXXXX
// ==========================================
async function handlePolling(req, res) {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Missing ref' });

  try {
    // Lấy 20 giao dịch gần nhất từ Sepay
    const transactions = await fetchSepayTransactions(20);

    // Tìm giao dịch có nội dung chứa mã ref
    const match = transactions.find(tx =>
      (tx.transaction_content || '').toUpperCase().includes(ref.toUpperCase())
    );

    if (match) {
      const amount = parseFloat(match.amount_in || 0);
      const txId   = match.id || match.reference_number || ref;
      const desc   = match.transaction_content || '';

      // Cộng tiền user trong Firestore
      const result = await creditByRef(ref, amount, txId, desc);
      console.log(`[Payment] ✅ Khớp ref=${ref} amount=${amount} txId=${txId}`);
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
// Body: { id, gateway, transferAmount, content, transferType, ... }
// ==========================================
async function handleWebhook(req, res) {
  try {
    const body = req.body || {};

    console.log('[Webhook] Sepay payload:', JSON.stringify(body));

    // Chỉ xử lý giao dịch tiền VÀO
    if (body.transferType !== 'in') {
      return res.status(200).json({ success: true, skipped: 'not incoming' });
    }

    const content = (body.content || body.code || '').toUpperCase();
    const amount  = parseFloat(body.transferAmount || 0);
    const txId    = String(body.id || body.referenceCode || '');

    if (!content || amount <= 0) {
      return res.status(200).json({ success: true, skipped: 'no content or zero amount' });
    }

    // Tìm pending deposit khớp với nội dung chuyển khoản
    const pending = await findPendingByContent(content);

    if (!pending) {
      console.log(`[Webhook] Không tìm thấy pending deposit với content: ${content}`);
      return res.status(200).json({ success: true, skipped: 'no matching pending deposit' });
    }

    // Cộng tiền
    const result = await creditByRef(pending.ref, amount, txId, body.content || '');
    console.log(`[Webhook] ✅ Credited user ref=${pending.ref} amount=${amount}`);

    return res.status(200).json({ success: true, credited: true, amount, result });

  } catch (e) {
    console.error('[Webhook] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ==========================================
// SEPAY API — Lấy danh sách giao dịch
// GET https://my.sepay.vn/userapi/transactions/list
// ==========================================
async function fetchSepayTransactions(limit = 20) {
  return new Promise((resolve, reject) => {
    const path = `/userapi/transactions/list?limit=${limit}&account_number=${BANK_ACCOUNT}`;
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
          // Sepay trả về: { messages:{success:"1"}, transaction_list:[...] }
          const list = json.transaction_list || [];
          // Chỉ lấy giao dịch tiền vào (amount_in > 0)
          const incoming = list.filter(tx => parseFloat(tx.amount_in || 0) > 0);
          resolve(incoming);
        } catch (err) {
          resolve([]);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Sepay API timeout')); });
    req.end();
  });
}

// ==========================================
// FIRESTORE — Tìm pending deposit theo content
// ==========================================
async function findPendingByContent(upperContent) {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

  try {
    const queryBody = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'pending_deposits' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'pending' },
          },
        },
        limit: 50,
      },
    });

    const resp = await httpsPost(
      `firestore.googleapis.com`,
      `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_WEB_API_KEY}`,
      queryBody
    );

    const docs = JSON.parse(resp);
    for (const item of docs) {
      if (!item.document) continue;
      const fields = item.document.fields || {};
      const ref = fields.ref?.stringValue || '';
      if (ref && upperContent.includes(ref.toUpperCase())) {
        return { ref, docPath: item.document.name };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ==========================================
// FIRESTORE — Cộng tiền user theo ref code
// ==========================================
async function creditByRef(ref, amount, txId, description) {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

  try {
    // 1. Tìm pending deposit theo ref
    const queryBody = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'pending_deposits' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'ref' }, op: 'EQUAL', value: { stringValue: ref } } },
              { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
            ],
          },
        },
        limit: 1,
      },
    });

    const qResp = await httpsPost(
      'firestore.googleapis.com',
      `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_WEB_API_KEY}`,
      queryBody
    );

    const docs = JSON.parse(qResp);
    const doc  = docs.find(d => d.document)?.document;
    if (!doc) return { error: 'Pending deposit not found for ref: ' + ref };

    const fields  = doc.fields || {};
    const email   = fields.email?.stringValue;
    const docPath = doc.name;

    if (!email) return { error: 'No email in pending deposit' };

    // 2. Đánh dấu pending deposit = 'completed'
    const patchPath = docPath.replace('https://firestore.googleapis.com/v1/', '');
    await httpsRequest('PATCH',
      'firestore.googleapis.com',
      `/v1/${patchPath}?updateMask.fieldPaths=status&updateMask.fieldPaths=completedAt&updateMask.fieldPaths=txId&updateMask.fieldPaths=amount&key=${FIREBASE_WEB_API_KEY}`,
      JSON.stringify({
        fields: {
          status:      { stringValue: 'completed' },
          completedAt: { stringValue: new Date().toISOString() },
          txId:        { stringValue: String(txId) },
          amount:      { doubleValue: amount },
        },
      })
    );

    // 3. Tìm user theo email và cộng số dư
    const userQuery = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'email' },
            op: 'EQUAL',
            value: { stringValue: email },
          },
        },
        limit: 1,
      },
    });

    const uResp  = await httpsPost('firestore.googleapis.com', `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_WEB_API_KEY}`, userQuery);
    const uDocs  = JSON.parse(uResp);
    const uDoc   = uDocs.find(d => d.document)?.document;
    if (!uDoc) return { error: 'User not found: ' + email };

    const uFields  = uDoc.fields || {};
    const oldBal   = parseFloat(uFields.balance?.doubleValue || uFields.balance?.integerValue || 0);
    const newBal   = oldBal + amount;
    const uDocPath = uDoc.name.replace('https://firestore.googleapis.com/v1/', '');

    await httpsRequest('PATCH',
      'firestore.googleapis.com',
      `/v1/${uDocPath}?updateMask.fieldPaths=balance&key=${FIREBASE_WEB_API_KEY}`,
      JSON.stringify({ fields: { balance: { doubleValue: newBal } } })
    );

    // 4. Ghi log giao dịch
    await httpsPost(
      'firestore.googleapis.com',
      `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/transactions?key=${FIREBASE_WEB_API_KEY}`,
      JSON.stringify({
        fields: {
          email:       { stringValue: email },
          type:        { stringValue: 'deposit' },
          amount:      { doubleValue: amount },
          txId:        { stringValue: String(txId) },
          description: { stringValue: description || '' },
          ref:         { stringValue: ref },
          createdAt:   { stringValue: new Date().toISOString() },
          balanceBefore: { doubleValue: oldBal },
          balanceAfter:  { doubleValue: newBal },
          gateway:     { stringValue: 'Sepay/VCB' },
        },
      })
    );

    console.log(`[creditByRef] ✅ ${email} +${amount} VND (was ${oldBal} → ${newBal})`);
    return { success: true, email, amount, newBalance: newBal };

  } catch (e) {
    console.error('[creditByRef] Error:', e.message);
    return { error: e.message };
  }
}

// ==========================================
// HTTP HELPERS
// ==========================================
function httpsPost(hostname, path, body) {
  return httpsRequest('POST', hostname, path, body);
}

function httpsRequest(method, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body || '', 'utf8');
    const options = {
      hostname,
      port: 443,
      path,
      method,
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(buf);
    req.end();
  });
}
