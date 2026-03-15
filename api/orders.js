/**
 * Orders API
 * GET  /api/orders        - lấy đơn hàng của user
 * POST /api/orders        - tạo đơn hàng mới
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { authMiddleware, pool } = require('./auth');

router.use(authMiddleware);

const DENY_PANEL_API_KEY = process.env.DENY_PANEL_API_KEY || '';
const DENY_PANEL_URL     = 'denypanel.com';

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE user_id=(SELECT id FROM users WHERE uid=$1) ORDER BY created_at DESC',
      [req.user.uid]
    );
    res.json({ orders: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orders - Đặt hàng
router.post('/', async (req, res) => {
  const { service, quantity, link } = req.body;
  if (!service || !quantity || !link) {
    return res.status(400).json({ error: 'Thiếu thông tin đặt hàng' });
  }

  try {
    // Lấy user + balance
    const userRes = await pool.query('SELECT * FROM users WHERE uid=$1', [req.user.uid]);
    const user    = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });

    // Gọi DenyPanel API để lấy giá service
    const svcInfo = await callDenyPanel({ action: 'services' });
    const svc     = (svcInfo.services || []).find(s => String(s.service) === String(service));
    if (!svc) return res.status(400).json({ error: 'Dịch vụ không tồn tại' });

    const charge = parseFloat(((svc.rate / 1000) * quantity).toFixed(6));
    if (parseFloat(user.balance) < charge) {
      return res.status(400).json({ error: 'Số dư không đủ' });
    }

    // Đặt hàng lên DenyPanel
    const orderRes = await callDenyPanel({
      action: 'add', service, quantity, link,
      key: DENY_PANEL_API_KEY
    });

    const orderId = orderRes.order ? String(orderRes.order) : null;

    // Trừ balance
    const newBalance = parseFloat((parseFloat(user.balance) - charge).toFixed(6));
    await pool.query('UPDATE users SET balance=$1 WHERE uid=$2', [newBalance, req.user.uid]);

    // Lưu đơn hàng
    const orderDb = await pool.query(
      `INSERT INTO orders (user_id, order_id, service, quantity, link, status, charge)
       VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING *`,
      [user.id, orderId, service, quantity, link, charge]
    );

    // Ghi transaction
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount_usd, description)
       VALUES ($1,'deduct',$2,$3)`,
      [user.id, charge, `Order #${orderId} - Service ${service}`]
    );

    res.json({ success: true, order: orderDb.rows[0], newBalance });
  } catch (e) {
    console.error('[orders]', e.message);
    res.status(500).json({ error: e.message });
  }
});

function callDenyPanel(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ key: DENY_PANEL_API_KEY, ...params }).toString();
    const req  = https.request({
      hostname: DENY_PANEL_URL, port: 443, path: '/api/v2',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length }
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = router;
