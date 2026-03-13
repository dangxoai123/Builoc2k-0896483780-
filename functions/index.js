/**
 * ==========================================
 * FIREBASE CLOUD FUNCTIONS - DENYPANEL
 * ==========================================
 */

const { onRequest } = require('firebase-functions/v2/https');
const https = require('https');
const querystring = require('querystring');
const admin = require('firebase-admin');

// Khởi tạo Firebase Admin SDK (bypass security rules)
admin.initializeApp();
const db = admin.firestore();

// ==========================================
// CONFIG
// ==========================================
const DENY_PANEL_API_KEY = '3b341f23c723707da4ce67f673f4e2f8';
// Bí mật nội bộ giữa Vercel và Cloud Function
const INTERNAL_SECRET = 'DENYPANEL_INTERNAL_2026_SECRET_KEY';

// ==========================================
// FUNCTION 1: denyProxy — Proxy DenyPanel API
// ==========================================
exports.denyProxy = onRequest(
  { region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
      const bodyData = { ...req.body, key: DENY_PANEL_API_KEY };
      const postData = querystring.stringify(bodyData);
      const result = await callDenyPanel(postData);
      const parsed = JSON.parse(result);
      res.status(200).json(parsed);
    } catch (err) {
      res.status(500).json({ error: 'Proxy error: ' + err.message });
    }
  }
);

// ==========================================
// FUNCTION 2: creditUser — Cộng tiền user (Admin SDK)
// Được gọi từ Vercel api/payment.js
// POST body: { secret, ref, amount, txId, description }
// ==========================================
exports.creditUser = onRequest(
  { region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { secret, ref, amount, txId, description } = req.body || {};

    // Xác thực internal secret
    if (secret !== INTERNAL_SECRET) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (!ref || !amount) {
      return res.status(400).json({ error: 'Missing ref or amount' });
    }

    try {
      // 1. Tìm pending deposit theo ref
      const pendingSnap = await db.collection('pending_deposits')
        .where('ref', '==', ref)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (pendingSnap.empty) {
        return res.status(200).json({ success: false, reason: 'No pending deposit for ref: ' + ref });
      }

      const pendingDoc  = pendingSnap.docs[0];
      const pendingData = pendingDoc.data();
      const email       = pendingData.email;

      // 2. Đánh dấu pending deposit = 'completed'
      await pendingDoc.ref.update({
        status:      'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        txId:        String(txId || ref),
        amount:      parseFloat(amount),
      });

      // 3. Tìm user theo email
      const userSnap = await db.collection('users')
        .where('email', '==', email)
        .limit(1)
        .get();

      if (userSnap.empty) {
        return res.status(200).json({ success: false, reason: 'User not found: ' + email });
      }

      const userDoc  = userSnap.docs[0];
      const userData = userDoc.data();
      const oldBal   = parseFloat(userData.balance || 0);
      const newBal   = oldBal + parseFloat(amount);

      // 4. Cộng tiền vào balance
      await userDoc.ref.update({ balance: newBal });

      // 5. Ghi log giao dịch
      await db.collection('transactions').add({
        email,
        type:          'deposit',
        amount:        parseFloat(amount),
        txId:          String(txId || ref),
        description:   description || '',
        ref,
        createdAt:     admin.firestore.FieldValue.serverTimestamp(),
        balanceBefore: oldBal,
        balanceAfter:  newBal,
        gateway:       'Sepay/BIDV',
      });

      console.log(`[creditUser] ✅ ${email} +${amount} VND (${oldBal} → ${newBal})`);
      return res.status(200).json({ success: true, email, amount, newBalance: newBal });

    } catch (e) {
      console.error('[creditUser] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }
);

// ==========================================
// Helper: Gọi DenyPanel API
// ==========================================
function callDenyPanel(postData) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'denypanel.com',
      port: 443,
      path: '/api/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0',
      },
      rejectUnauthorized: false,
    };
    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}
