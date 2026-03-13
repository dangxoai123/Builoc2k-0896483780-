/**
 * ==========================================
 * VERCEL SERVERLESS FUNCTION - AUTO PAYMENT
 * File: api/payment.js
 * 
 * Nhận webhook từ web2m.com (sPayment) khi có
 * giao dịch chuyển khoản VCB mới.
 * 
 * Cơ chế:
 *   web2m phát hiện CK → POST webhook về đây
 *   → Parse nội dung → Tìm user → Cộng tiền Firestore
 * 
 * Nội dung CK user cần ghi: NAP <email>
 * Ví dụ: NAP user@gmail.com
 * ==========================================
 */

const https = require('https');

// ==========================================
// CONFIG
// ==========================================
const WEB2M_TOKEN = '457F855D-4890-5004-77B0-7B07614D845E'; // VCB token (web2m)
const VCB_ACCOUNT = '1016232687';                              // Số TK VCB
const VCB_PASSWORD = 'Locbui2k@';                             // Mật khẩu Internet Banking
const WEB2M_API_PATH = 'historyapivcbv3';                       // API v3 (mới nhất)

// Firebase Admin SDK via REST API (không cần firebase-admin package)
const FIREBASE_PROJECT = 'builoc2k-denypanel';
const FIREBASE_WEB_API_KEY = 'AIzaSyDA6SIIeT8jlzLMyp1r6WnefnsGQxMgygA';

// ==========================================
// MAIN HANDLER
// ==========================================
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── GET: Kiểm tra giao dịch mới từ web2m (polling)
  if (req.method === 'GET') {
    return await handlePolling(req, res);
  }

  // ── POST: Nhận webhook từ web2m
  if (req.method === 'POST') {
    return await handleWebhook(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// ==========================================
// WEBHOOK HANDLER (web2m gọi vào đây)
// ==========================================
async function handleWebhook(req, res) {
  try {
    const body = req.body;
    console.log('[Payment Webhook]', JSON.stringify(body));

    // Xác thực token từ web2m
    const token = req.headers['authorization'] || req.headers['x-token'] || body?.token;
    if (token && token !== WEB2M_TOKEN && token !== `Bearer ${WEB2M_TOKEN}`) {
      return res.status(200).json({ code: '01', message: 'Invalid token' });
    }

    // Chỉ xử lý giao dịch chuyển tiền vào (transferType = in)
    const transferType = (body?.transferType || body?.type || '').toLowerCase();
    if (transferType && transferType !== 'in') {
      return res.status(200).json({ code: '00', message: 'Skipped (not incoming)' });
    }

    const amount = parseFloat(body?.amount || body?.value || 0);
    const description = (body?.description || body?.content || '').toLowerCase().trim();
    const transactionId = body?.id || body?.referenceCode || Date.now().toString();

    if (!amount || amount <= 0) {
      return res.status(200).json({ code: '00', message: 'Amount = 0, skipped' });
    }

    // Parse email user từ nội dung chuyển khoản
    // Định dạng: NAP <email> hoặc NAP<email>
    const email = parseEmailFromDesc(description);
    if (!email) {
      console.log('[Payment] Cannot parse email from description:', description);
      return res.status(200).json({ code: '00', message: 'Cannot parse user from description' });
    }

    // Tìm user trong Firestore và cộng tiền
    const result = await creditUserBalance(email, amount, transactionId, description);
    return res.status(200).json({ code: '00', message: result });

  } catch (e) {
    console.error('[Payment Webhook Error]', e.message);
    return res.status(200).json({ code: '00', message: 'Error: ' + e.message });
  }
}

// ==========================================
// POLLING (Frontend gọi để check giao dịch mới)
// GET /api/payment?ref=BUILOCXXXXXX
// ==========================================
async function handlePolling(req, res) {
  const { ref } = req.query;
  if (!ref) {
    return res.status(400).json({ error: 'Missing ref' });
  }

  try {
    // Gọi web2m API lấy lịch sử giao dịch VCB
    const txData = await callWeb2mAPI(VCB_ACCOUNT);
    const transactions = normalizeTransactions(txData);

    if (!transactions.length) {
      return res.status(200).json({ found: false, debug: 'no transactions' });
    }

    // Tìm giao dịch có nội dung chứa mã ref (BUILOC...)
    const match = transactions.find(tx =>
      (tx.description || '').toUpperCase().includes(ref.toUpperCase())
    );

    if (match) {
      // Credit vào user qua Firestore pending_deposits
      const result = await creditByRef(ref, match.amount, match.id, match.description);
      return res.status(200).json({ found: true, amount: match.amount, result });
    }

    return res.status(200).json({ found: false });
  } catch (e) {
    console.error('[Polling] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ==========================================
// WEB2M API CALL - Lấy lịch sử giao dịch VCB
// URL format: /historyapivcb/{password}/{sotaikhoan}/{token}
// ==========================================
async function callWeb2mAPI(account) {
  return new Promise((resolve, reject) => {
    // URL mới: /historyapivcbv3/{password}/{sotaikhoan}/{token}
    const cleanToken = WEB2M_TOKEN.trim().replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
    const path = `/${WEB2M_API_PATH}/${encodeURIComponent(VCB_PASSWORD)}/${account}/${cleanToken}`;
    const options = {
      hostname: 'api.web2m.com',
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    };
    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', c => data += c);
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

/**
 * Normalize giao dịch từ web2m VCB API về dạng chuẩn
 * API trả về: data.chiTietGiaoDich[]
 * Mỗi item: { SoThamChieu, SoTienGhiCo, MoTa, NgayGiaoDich, CD }
 */
function normalizeTransactions(apiResp) {
  if (!apiResp?.status) return [];
  const list = apiResp?.data?.chiTietGiaoDich || apiResp?.transactions || [];
  return list
    .filter(tx => (tx.CD || tx.cd || '+') === '+') // Chỉ lấy giao dịch Cộng tiền (+)
    .map(tx => ({
      id: tx.SoThamChieu || tx.id,
      amount: parseFloat((tx.SoTienGhiCo || tx.amount || '0').toString().replace(/[^0-9.]/g, '')),
      description: tx.MoTa || tx.description || tx.content || '',
      date: tx.NgayGiaoDich || tx.date || '',
    }));
}

// ==========================================
// FIRESTORE REST API - Cộng tiền user
// ==========================================
async function creditUserBalance(email, amount, txId, description) {
  // Tìm user theo email trong Firestore
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

  // Query users where email == email
  const queryBody = JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'email' },
          op: 'EQUAL',
          value: { stringValue: email }
        }
      },
      limit: 1
    }
  });

  const userDoc = await httpsPost(
    `${firestoreBase}:runQuery?key=${FIREBASE_WEB_API_KEY}`,
    queryBody
  );

  const parsed = JSON.parse(userDoc);
  if (!parsed[0]?.document) {
    return `User not found: ${email}`;
  }

  const docName = parsed[0].document.name;
  const currentBalance = parseFloat(parsed[0].document.fields?.balance?.doubleValue || parsed[0].document.fields?.balance?.integerValue || 0);
  const newBalance = currentBalance + amount;

  // Kiểm tra giao dịch đã được xử lý chưa (tránh cộng 2 lần)
  const txCheck = await httpGet(
    `${firestoreBase}/transactions/${txId}?key=${FIREBASE_WEB_API_KEY}`
  );
  const txParsed = JSON.parse(txCheck);
  if (txParsed?.fields) {
    return `Transaction ${txId} already processed`;
  }

  // Cập nhật số dư user
  const uid = docName.split('/').pop();
  const updateBody = JSON.stringify({
    fields: { balance: { doubleValue: newBalance } }
  });
  await httpsPatch(
    `${firestoreBase}/users/${uid}?updateMask.fieldPaths=balance&key=${FIREBASE_WEB_API_KEY}`,
    updateBody
  );

  // Lưu lịch sử giao dịch để tránh cộng 2 lần
  const logBody = JSON.stringify({
    fields: {
      uid: { stringValue: uid },
      email: { stringValue: email },
      type: { stringValue: 'bank_transfer' },
      amount: { doubleValue: amount },
      balanceBefore: { doubleValue: currentBalance },
      balanceAfter: { doubleValue: newBalance },
      note: { stringValue: description },
      gateway: { stringValue: 'VietcomBank' },
      processed: { booleanValue: true },
      createdAt: { timestampValue: new Date().toISOString() }
    }
  });
  await httpsPost(
    `${firestoreBase}/transactions?documentId=${txId}&key=${FIREBASE_WEB_API_KEY}`,
    logBody
  );

  console.log(`[Payment] Credited ${amount} VND to ${email}. New balance: ${newBalance}`);
  return `OK: Credited ${amount} VND to ${email}`;
}

// Credit tiền dựa vào mã REF (BUILOC...) từ Firestore pending_deposits
async function creditByRef(ref, amount, txId, description) {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

  // Tìm pending_deposit theo ref
  const depositDoc = await httpGet(
    `${firestoreBase}/pending_deposits/${ref}?key=${FIREBASE_WEB_API_KEY}`
  );
  const deposit = JSON.parse(depositDoc);
  if (!deposit?.fields) return `Deposit ref ${ref} not found`;
  if (deposit.fields.status?.stringValue === 'completed') return `Already processed: ${ref}`;

  const uid = deposit.fields.uid?.stringValue;
  const depositAmount = parseFloat(deposit.fields.amount?.doubleValue || deposit.fields.amount?.integerValue || amount);

  // Lấy số dư hiện tại của user
  const userDoc = await httpGet(`${firestoreBase}/users/${uid}?key=${FIREBASE_WEB_API_KEY}`);
  const user = JSON.parse(userDoc);
  const currentBalance = parseFloat(user?.fields?.balance?.doubleValue || user?.fields?.balance?.integerValue || 0);
  const newBalance = currentBalance + depositAmount;

  // Cập nhật số dư
  await httpsPatch(
    `${firestoreBase}/users/${uid}?updateMask.fieldPaths=balance&key=${FIREBASE_WEB_API_KEY}`,
    JSON.stringify({ fields: { balance: { doubleValue: newBalance } } })
  );

  // Đánh dấu deposit là completed
  await httpsPatch(
    `${firestoreBase}/pending_deposits/${ref}?updateMask.fieldPaths=status&key=${FIREBASE_WEB_API_KEY}`,
    JSON.stringify({ fields: { status: { stringValue: 'completed' } } })
  );

  // Ghi transaction log
  await httpsPost(
    `${firestoreBase}/transactions?documentId=${ref}&key=${FIREBASE_WEB_API_KEY}`,
    JSON.stringify({
      fields: {
        uid: { stringValue: uid },
        type: { stringValue: 'bank_transfer' },
        amount: { doubleValue: depositAmount },
        balanceBefore: { doubleValue: currentBalance },
        balanceAfter: { doubleValue: newBalance },
        ref: { stringValue: ref },
        note: { stringValue: description },
        gateway: { stringValue: 'VietcomBank' },
        processed: { booleanValue: true },
        createdAt: { timestampValue: new Date().toISOString() }
      }
    })
  );

  console.log(`[Payment] Ref ${ref}: +${depositAmount} VND → uid ${uid}. Balance: ${newBalance}`);
  return `OK: +${depositAmount} VND to uid ${uid}`;
}

// ==========================================
// PARSE EMAIL TỪ NỘI DUNG CHUYỂN KHOẢN
// ==========================================
function parseEmailFromDesc(description) {
  // Tìm pattern: NAP email@domain.com
  const patterns = [
    /nap\s+([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    /([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    /nap\s+([^\s]+)/i,
  ];
  for (const p of patterns) {
    const m = description.match(p);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// ==========================================
// HTTP HELPERS
// ==========================================
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsPatch(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
