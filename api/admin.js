/**
 * Admin API
 * GET  /api/admin/users
 * GET  /api/admin/transactions
 * POST /api/admin/users/:uid/balance
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware, adminMiddleware, pool } = require('./auth');

router.use(authMiddleware);
router.use(adminMiddleware);

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, uid, username, email, balance, role, api_key, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/transactions
router.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.username, u.email FROM transactions t
       LEFT JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC LIMIT 200`
    );
    res.json({ transactions: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users/:uid/balance
router.post('/users/:uid/balance', async (req, res) => {
  const { uid }    = req.params;
  const { amount, type, description } = req.body;
  if (!amount || !type) return res.status(400).json({ error: 'Thiếu amount hoặc type' });

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE uid=$1', [uid]);
    const user    = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });

    const amountUSD    = parseFloat(amount);
    const currentBal   = parseFloat(user.balance || 0);
    let newBalance;
    if (type === 'add') newBalance = currentBal + amountUSD;
    else if (type === 'sub') newBalance = Math.max(0, currentBal - amountUSD);
    else newBalance = amountUSD; // set
    newBalance = parseFloat(newBalance.toFixed(6));

    await pool.query('UPDATE users SET balance=$1 WHERE uid=$2', [newBalance, uid]);

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, amount_usd, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, type === 'sub' ? 'deduct' : type, amountUSD, amountUSD, description || 'Admin adjustment']
    );

    res.json({ success: true, newBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users/:uid/info — Cập nhật username/role
router.post('/users/:uid/info', async (req, res) => {
  const { uid } = req.params;
  const { username, role } = req.body;
  try {
    await pool.query('UPDATE users SET username=$1, role=$2 WHERE uid=$3', [username, role, uid]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, orders, revenue] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM users'),
      pool.query('SELECT COUNT(*) as total FROM orders'),
      pool.query("SELECT COALESCE(SUM(amount_usd),0) as total FROM transactions WHERE type='deposit'"),
    ]);
    res.json({
      totalUsers:   parseInt(users.rows[0].total),
      totalOrders:  parseInt(orders.rows[0].total),
      totalRevenue: parseFloat(revenue.rows[0].total),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/orders - tất cả đơn hàng của mọi user
router.get('/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id,
             COALESCE(o.order_id::text, o.id::text)           AS order_id,
             COALESCE(o.service_id, 0)                         AS service_id,
             COALESCE(o.service_name, o.service::text, '')     AS service_name,
             o.link, o.quantity, o.charge, o.status,
             COALESCE(o.remains, o.quantity)                   AS remains,
             o.created_at,
             u.uid AS _uid, u.username AS _username, u.email AS _email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);
    res.json({ orders: result.rows });
  } catch (e) {
    console.error('[admin/orders]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
