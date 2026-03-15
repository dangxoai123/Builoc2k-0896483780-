/**
 * Payment API - Sepay Webhook + Polling
 * GET  /api/payment?ref=BUILOCXXXXXX → polling kiểm tra
 * POST /api/payment                  → Sepay webhook tự động
 * 
 * Database: PostgreSQL (thay Firestore)
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { pool } = require('./auth');

const SEPAY_TOKEN   = process.env.SEPAY_TOKEN || '1JSSV8HTJJNLKHWBAMKQG4YEWA2FPVA243UKLOYEPPRUMIL78UCBOW3EQGDGIRAX';
const REAL_ACCOUNT  = process.env.REAL_ACCOUNT || '0896483780';
const VND_RATE      = 26294.5;

// ==========================================
// GET /api/payment?ref=BUILOCXXXXXX — Polling
// ==========================================
router.get('/', async (req, res) => {
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
      return res.json({ found: true, amount, result });
    }
    return res.json({ found: false });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

// ==========================================
// POST /api/payment — Sepay Webhook
// ==========================================
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[webhook] received:', JSON.stringify(body));

    // Bỏ qua giao dịch ra
    const tType = (body.transferType || body.type || '').toLowerCase();
    if (tType === 'out' || tType === 'debit' || tType === 'dr') {
      return res.json({ skipped: 'outgoing' });
    }

    const amount = parseFloat(
      body.transferAmount || body.amount || body.value ||
      body.transactionAmount || body.creditAmount || 0
    );
    const content = (
      body.content || body.description || body.transaction_content ||
      body.memo || body.remarks || body.addInfo || ''
    );
    const txId = String(body.id || body.transactionId || body.referenceCode || Date.now());

    console.log(`[webhook] amount=${amount}, content="${content}", type="${tType}"`);

    if (!content || amount <= 0) {
      return res.json({ skipped: 'empty' });
    }

    const m = content.toUpperCase().match(/BUILOC[A-Z0-9]{6}/);
    if (!m) {
      return res.json({ skipped: 'no ref' });
    }

    const result = await creditByRef(m[0], amount, txId, content);
    console.log('[webhook] credit result:', JSON.stringify(result));
    return res.json({ success: true, amount, result });
  } catch(e) {
    console.error('[webhook] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ==========================================
// POST /api/payment/create-pending — Dashboard tạo pending deposit
// ==========================================
const { authMiddleware } = require('./auth');

router.post('/create-pending', authMiddleware, async (req, res) => {
  const { ref, amount } = req.body;
  if (!ref || !amount) return res.status(400).json({ error: 'Thiếu ref hoặc amount' });
  try {
    const userRes = await pool.query('SELECT id FROM users WHERE uid=$1', [req.user.uid]);
    const user    = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });

    // Upsert để tránh duplicate
    await pool.query(
      `INSERT INTO pending_deposits (user_id, ref, amount) VALUES ($1,$2,$3)
       ON CONFLICT (ref) DO NOTHING`,
      [user.id, ref.toUpperCase(), parseFloat(amount)]
    );
    res.json({ success: true, ref: ref.toUpperCase() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// creditByRef — Ghi balance vào PostgreSQL
// ==========================================
async function creditByRef(ref, amount, txId, description) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Tìm pending_deposits theo ref (status = pending)
    const pendRes = await client.query(
      "SELECT pd.*, u.id as uid_db, u.uid, u.email, u.balance FROM pending_deposits pd JOIN users u ON pd.user_id = u.id WHERE pd.ref=$1 AND pd.status='pending' LIMIT 1",
      [ref]
    );
    if (!pendRes.rows[0]) {
      await client.query('ROLLBACK');
      return { error: `No pending deposit for ref: ${ref}` };
    }

    const pend       = pendRes.rows[0];
    const addUSD     = parseFloat((amount / VND_RATE).toFixed(6));
    const curBalance = parseFloat(pend.balance || 0);
    const newBalance = parseFloat((curBalance + addUSD).toFixed(6));

    console.log(`[credit] uid=${pend.uid} balance: ${curBalance} + ${addUSD} = ${newBalance}`);

    // 2. Cập nhật balance user
    await client.query('UPDATE users SET balance=$1 WHERE id=$2', [newBalance, pend.uid_db]);

    // 3. Đánh dấu pending_deposits = completed
    await client.query(
      "UPDATE pending_deposits SET status='completed', ref=$1 WHERE id=$2",
      [txId || ref, pend.id]
    );

    // 4. Ghi log transaction
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, amount_usd, ref, description)
       VALUES ($1,'deposit',$2,$3,$4,$5)`,
      [pend.uid_db, parseFloat(amount), addUSD, String(txId || ref), description || '']
    );

    await client.query('COMMIT');

    // 5. Thông báo real-time (nếu có Socket.io)
    if (global.emitToAdmin) {
      global.emitToAdmin('balance_update', { uid: pend.uid, newBalance });
    }

    console.log(`[credit] ✅ uid=${pend.uid} +${amount}VND (+${addUSD}USD) newBal=${newBalance}`);
    return { success: true, email: pend.email, amount, amountUSD: addUSD, newBalance };
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('[credit] ❌', e.message);
    return { error: e.message };
  } finally {
    client.release();
  }
}

// ==========================================
// fetchSepay — Lấy danh sách giao dịch
// ==========================================
function fetchSepay(limit = 20) {
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

module.exports = router;
