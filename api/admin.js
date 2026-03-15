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

    const amountUSD  = parseFloat(amount);
    const newBalance = parseFloat(
      type === 'add' ? user.balance + amountUSD : user.balance - amountUSD
    ).toFixed(6);

    await pool.query('UPDATE users SET balance=$1 WHERE uid=$2', [newBalance, uid]);

    // Ghi log transaction
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, amount_usd, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, type === 'add' ? 'add' : 'deduct', amountUSD, amountUSD, description || 'Admin adjustment']
    );

    res.json({ success: true, newBalance: parseFloat(newBalance) });
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

module.exports = router;
