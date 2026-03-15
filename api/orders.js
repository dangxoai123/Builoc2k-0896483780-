/**
 * Orders API
 * GET  /api/orders        - lấy danh sách đơn hàng của user
 * POST /api/orders        - lưu đơn hàng đã đặt qua MMOpanel + trừ balance
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware, pool } = require('./auth');

router.use(authMiddleware);

// ──────────────────────────────────────────────
// GET /api/orders - lấy đơn hàng của user
// ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.order_id, o.service_id, o.service_name,
              o.link, o.quantity, o.charge, o.status, o.remains,
              o.created_at
       FROM orders o
       WHERE o.user_id = (SELECT id FROM users WHERE uid=$1)
       ORDER BY o.created_at DESC`,
      [req.user.uid]
    );
    res.json({ orders: result.rows });
  } catch (e) {
    console.error('[orders GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/orders - Nhận đơn hàng đã đặt thành công trên DenyPanel
// Body: { order_id, service_id, service_name, link, quantity, charge, status, demo }
// ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { order_id, service_id, service_name, link, quantity, charge, status, demo } = req.body;

  if (!order_id || !service_id || !link || !quantity || charge === undefined) {
    return res.status(400).json({ error: 'Thiếu thông tin đơn hàng' });
  }

  try {
    // Lấy user
    const userRes = await pool.query('SELECT * FROM users WHERE uid=$1', [req.user.uid]);
    const user    = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });

    const chargeVal = parseFloat(charge);
    const balVal    = parseFloat(user.balance || 0);

    // Kiểm tra số dư (bảo vệ server-side)
    if (!demo && chargeVal > balVal) {
      return res.status(400).json({ error: 'Số dư không đủ' });
    }

    // Trừ balance (chỉ trừ nếu không phải demo)
    const newBalance = demo ? balVal : parseFloat((balVal - chargeVal).toFixed(6));
    if (!demo) {
      await pool.query('UPDATE users SET balance=$1 WHERE uid=$2', [newBalance, req.user.uid]);
    }

    // Kiểm tra orders table có cột service_name không, nếu không thì tạo
    let insertSql;
    let insertParams;
    try {
      insertSql = `INSERT INTO orders
        (user_id, order_id, service_id, service_name, link, quantity, charge, status, remains)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (order_id) DO NOTHING
        RETURNING *`;
      insertParams = [
        user.id, String(order_id), parseInt(service_id),
        service_name || String(service_id), link,
        parseInt(quantity), chargeVal,
        status || 'pending', parseInt(quantity)
      ];
      const orderDb = await pool.query(insertSql, insertParams);

      // Ghi transaction
      if (!demo) {
        await pool.query(
          `INSERT INTO transactions (user_id, type, amount_usd, description)
           VALUES ($1,'deduct',$2,$3)`,
          [user.id, chargeVal, `Order #${order_id} - Service ${service_id}`]
        );
      }

      // Emit Socket.io cho admin
      if (global.emitToAdmin) {
        global.emitToAdmin('new_order', {
          order_id, service_id, service_name,
          link, quantity, charge: chargeVal,
          status: status || 'pending',
          user: { uid: req.user.uid, username: user.username }
        });
      }

      res.json({ success: true, order: orderDb.rows[0], newBalance });
    } catch (insertErr) {
      // Nếu lỗi do thiếu cột service_id hoặc service_name → thử schema cũ
      if (insertErr.message.includes('column') || insertErr.message.includes('does not exist')) {
        console.warn('[orders] Schema thiếu cột mới, dùng schema cũ:', insertErr.message);
        // Schema cũ chỉ có user_id, order_id, service, quantity, link, status, charge
        await pool.query(
          `INSERT INTO orders (user_id, order_id, service, quantity, link, status, charge)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (order_id) DO NOTHING`,
          [user.id, String(order_id), String(service_id), parseInt(quantity), link, status || 'pending', chargeVal]
        );
        if (!demo) {
          await pool.query(
            `INSERT INTO transactions (user_id, type, amount_usd, description)
             VALUES ($1,'deduct',$2,$3)`,
            [user.id, chargeVal, `Order #${order_id} - Service ${service_id}`]
          );
        }
        res.json({ success: true, newBalance });
      } else {
        throw insertErr;
      }
    }

  } catch (e) {
    console.error('[orders POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
