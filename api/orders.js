/**
 * Orders API
 * GET  /api/orders            - lấy danh sách đơn hàng của user
 * POST /api/orders/place      - đặt hàng lên DenyPanel + trừ balance + lưu DB
 * POST /api/orders            - (legacy) lưu order đã đặt sẵn
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { authMiddleware, pool } = require('./auth');

router.use(authMiddleware);

const DENY_KEY = process.env.DENY_PANEL_API_KEY || '2a6149e2e8ff0be95ded16a8e408e2d6';

// ──────────────────────────────────────────────
// GET /api/orders
// ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id,
              COALESCE(order_id::text, id::text) AS order_id,
              COALESCE(service_id, 0)             AS service_id,
              COALESCE(service_name, service::text, '') AS service_name,
              link, quantity, charge, status,
              COALESCE(remains, quantity)          AS remains,
              created_at
       FROM orders
       WHERE user_id = (SELECT id FROM users WHERE uid=$1)
       ORDER BY created_at DESC`,
      [req.user.uid]
    );
    res.json({ orders: result.rows });
  } catch (e) {
    console.error('[orders GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/orders/:orderId/status - kiểm tra trạng thái từ DenyPanel
router.get('/:orderId/status', async (req, res) => {
  const { orderId } = req.params;
  try {
    const dpRes = await callDenyPanel({ action: 'status', key: DENY_KEY, order: orderId });
    if (dpRes.error) return res.status(400).json({ error: dpRes.error });

    const newStatus = mapStatus(dpRes.status || '');
    const remains   = parseInt(dpRes.remains) || 0;

    // Cập nhật DB dùng PostgreSQL transaction để đảm bảo hoàn tiền chính xác và duy nhất một lần
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Khóa và đọc thông tin đơn hàng cùng thông tin số dư của user
      const lockRes = await client.query(
        `SELECT o.id, o.status, o.charge, o.user_id, u.balance
         FROM orders o
         JOIN users u ON o.user_id = u.id
         WHERE o.order_id = $1 AND o.user_id = (SELECT id FROM users WHERE uid = $2)
         FOR UPDATE`,
        [String(orderId), req.user.uid]
      );

      if (lockRes.rows.length > 0) {
        const dbOrder = lockRes.rows[0];
        const dbCurrentStatus = dbOrder.status;
        const dbCharge = parseFloat(dbOrder.charge || 0);
        const dbUserId = dbOrder.user_id;
        const dbCurrentBalance = parseFloat(dbOrder.balance || 0);

        // Chỉ hoàn tiền khi trạng thái mới là 'canceled' và trạng thái cũ chưa phải 'canceled'
        if (newStatus === 'canceled' && dbCurrentStatus !== 'canceled') {
          const refundAmount = dbCharge;
          const updatedBalance = parseFloat((dbCurrentBalance + refundAmount).toFixed(6));

          // 1. Cập nhật số dư user
          await client.query(
            'UPDATE users SET balance = $1 WHERE id = $2',
            [updatedBalance, dbUserId]
          );

          // 2. Ghi nhận giao dịch hoàn tiền
          await client.query(
            `INSERT INTO transactions (user_id, type, amount_usd, description)
             VALUES ($1, 'refund', $2, $3)`,
            [dbUserId, refundAmount, `Refund for Canceled Order #${orderId}`]
          );

          console.log(`[Refund Success] Refunded $${refundAmount} to user ${dbUserId} for canceled order #${orderId}`);
        }
      }

      // Cập nhật trạng thái đơn hàng
      await client.query(
        `UPDATE orders SET status=$1, remains=$2
         WHERE order_id=$3 AND user_id=(SELECT id FROM users WHERE uid=$4)`,
        [newStatus, remains, String(orderId), req.user.uid]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ success: true, status: newStatus, remains, raw: dpRes.status });
  } catch (e) {
    console.error('[orders status]', e.message);
    res.status(500).json({ error: e.message });
  }
});

function mapStatus(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'completed') return 'completed';
  if (s === 'canceled' || s === 'cancelled') return 'canceled';
  if (s === 'partial') return 'partial';
  if (s === 'in progress' || s === 'processing') return 'in_progress';
  if (s === 'waiting') return 'waiting';
  return 'pending';
}


// ──────────────────────────────────────────────
// POST /api/orders/place  ← ĐẶT HÀNG THỰC
// Body: { service_id, service_name, link, quantity, charge }
// ──────────────────────────────────────────────
router.post('/place', async (req, res) => {
  const { service_id, service_name, link, quantity, charge } = req.body;
  if (!service_id || !link || !quantity) {
    return res.status(400).json({ error: 'Thiếu thông tin đặt hàng' });
  }

  try {
    // Lấy user + balance
    const userRes = await pool.query('SELECT * FROM users WHERE uid=$1', [req.user.uid]);
    const user    = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });

    const chargeVal = parseFloat(charge || 0);
    const balVal    = parseFloat(user.balance || 0);

    // Kiểm tra số dư
    if (chargeVal > balVal + 0.000001) {
      return res.status(400).json({ error: `Số dư không đủ. Cần $${chargeVal.toFixed(4)}, hiện có $${balVal.toFixed(4)}` });
    }

    // Đặt hàng lên DenyPanel từ server
    let orderId = null;
    let demo    = false;
    try {
      const dpResult = await callDenyPanel({
        action: 'add', key: DENY_KEY,
        service: service_id, link, quantity
      });
      if (dpResult.order) {
        orderId = String(dpResult.order);
      } else if (dpResult.error) {
        return res.status(400).json({ error: `DenyPanel: ${dpResult.error}` });
      }
    } catch (dpErr) {
      console.error('[orders] DenyPanel call failed:', dpErr.message);
      // Demo fallback nếu DenyPanel không hoạt động
      orderId = 'DEMO_' + Date.now();
      demo    = true;
    }

    // Trừ balance
    const newBalance = parseFloat((balVal - chargeVal).toFixed(6));
    await pool.query('UPDATE users SET balance=$1 WHERE uid=$2', [newBalance, req.user.uid]);

    // Lưu đơn hàng vào DB
    const svcName = service_name || String(service_id);
    let savedOrder;
    try {
      const r = await pool.query(`
        INSERT INTO orders (user_id, order_id, service_id, service_name, link, quantity, charge, status, remains)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$6)
        RETURNING *`,
        [user.id, orderId, parseInt(service_id), svcName, link, parseInt(quantity), chargeVal]
      );
      savedOrder = r.rows[0];
    } catch (schemaErr) {
      // Fallback schema cũ
      console.warn('[orders] Schema mới không hoạt động, dùng schema cũ:', schemaErr.message);
      const r = await pool.query(`
        INSERT INTO orders (user_id, order_id, service, quantity, link, status, charge)
        VALUES ($1,$2,$3,$4,$5,'pending',$6)
        RETURNING *`,
        [user.id, orderId, String(service_id), parseInt(quantity), link, chargeVal]
      );
      savedOrder = r.rows[0];
    }

    // Ghi transaction
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount_usd, description)
       VALUES ($1,'deduct',$2,$3)`,
      [user.id, chargeVal, `Order #${orderId} - Service ${service_id}`]
    ).catch(() => {});

    // Emit Socket.io
    if (global.emitToAdmin) {
      global.emitToAdmin('new_order', {
        order_id: orderId, service_id, service_name: svcName,
        link, quantity, charge: chargeVal, status: 'pending',
        user: { uid: req.user.uid, username: user.username }
      });
    }

    res.json({
      success: true,
      orderId,
      demo,
      order: savedOrder,
      newBalance
    });

  } catch (e) {
    console.error('[orders/place]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/orders  (Legacy - lưu đơn đã đặt sẵn)
// ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { order_id, service_id, service_name, link, quantity, charge, status, demo } = req.body;
  if (!order_id || !service_id || !link || !quantity || charge === undefined) {
    return res.status(400).json({ error: 'Thiếu thông tin' });
  }
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE uid=$1', [req.user.uid]);
    const user    = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });

    const chargeVal = parseFloat(charge);
    const balVal    = parseFloat(user.balance || 0);
    const newBalance = demo ? balVal : parseFloat((balVal - chargeVal).toFixed(6));

    if (!demo) {
      if (chargeVal > balVal + 0.000001) return res.status(400).json({ error: 'Số dư không đủ' });
      await pool.query('UPDATE users SET balance=$1 WHERE uid=$2', [newBalance, req.user.uid]);
    }

    try {
      await pool.query(`
        INSERT INTO orders (user_id, order_id, service_id, service_name, link, quantity, charge, status, remains)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6)`,
        [user.id, String(order_id), parseInt(service_id), service_name||String(service_id),
         link, parseInt(quantity), chargeVal, status||'pending']
      );
    } catch {
      await pool.query(`
        INSERT INTO orders (user_id, order_id, service, quantity, link, status, charge)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [user.id, String(order_id), String(service_id), parseInt(quantity), link, status||'pending', chargeVal]
      );
    }

    res.json({ success: true, newBalance });
  } catch (e) {
    console.error('[orders POST legacy]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// Helper: Gọi DenyPanel API
// ──────────────────────────────────────────────
function callDenyPanel(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req  = https.request({
      hostname: 'denypanel.com', port: 443, path: '/api/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      rejectUnauthorized: false
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('DenyPanel timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = router;
