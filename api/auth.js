/**
 * Auth API - JWT + bcrypt (thay Firebase Auth)
 * POST /api/auth/register
 * POST /api/auth/login
 * GET  /api/auth/me
 */

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'mmopanel',
  user:     process.env.DB_USER     || 'mmopanel',
  password: process.env.DB_PASS     || 'mmopanel2026',
});

// Auto-GRANT permissions khi khởi động (fix permission denied)
(async () => {
  const superPool = new Pool({
    host: 'localhost', port: 5432, database: 'mmopanel',
    user: process.env.DB_SUPERUSER || 'postgres',
    password: process.env.DB_SUPERPASS || '',
  });
  try {
    await superPool.query(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mmopanel;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mmopanel;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mmopanel;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mmopanel;
    `);
    console.log('[DB] ✅ PostgreSQL permissions granted to mmopanel');
  } catch (e) {
    console.warn('[DB] GRANT skipped (may already have perms):', e.message);
  } finally {
    await superPool.end();
  }
})();


const JWT_SECRET = process.env.JWT_SECRET || 'mmopanel_jwt_secret_2026';
const ADMIN_EMAILS = ['builoc1906@gmail.com', 'buinguyenloc112000@gmail.com'];

function generateToken(user) {
  return jwt.sign(
    { uid: user.uid, id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Middleware xác thực JWT
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token không hợp lệ' });
  }
}

// Admin middleware
function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin' && !ADMIN_EMAILS.includes(req.user?.email)) {
    return res.status(403).json({ error: 'Không có quyền admin' });
  }
  next();
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Thiếu thông tin' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải ít nhất 6 ký tự' });
  }
  try {
    // Check trùng username/email
    const existing = await pool.query(
      'SELECT id FROM users WHERE email=$1 OR username=$2', [email, username]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email hoặc username đã tồn tại' });
    }

    const hash   = await bcrypt.hash(password, 12);
    const apiKey = crypto.randomBytes(32).toString('hex');
    const uid    = crypto.randomUUID();
    const role   = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';

    const result = await pool.query(
      `INSERT INTO users (uid, username, email, password, api_key, role)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uid, username.toLowerCase().trim(), email.toLowerCase().trim(), hash, apiKey, role]
    );
    const user = result.rows[0];

    // Thông báo admin real-time
    if (global.emitToAdmin) {
      global.emitToAdmin('new_user', {
        id: user.id, uid: user.uid,
        username: user.username, email: user.email,
        balance: 0, role: user.role,
        created_at: user.created_at
      });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: { uid: user.uid, username: user.username, email: user.email, role: user.role, balance: 0 }
    });
  } catch (e) {
    console.error('[register]', e.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    const user   = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)  return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: {
        uid: user.uid, username: user.username, email: user.email,
        role: user.role, balance: parseFloat(user.balance || 0),
        api_key: user.api_key
      }
    });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// GET /api/auth/me - Lấy profile hiện tại
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT uid, username, email, role, balance, api_key, created_at FROM users WHERE uid=$1',
      [req.user.uid]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User không tồn tại' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// PATCH /api/auth/me - Cập nhật username/password
router.patch('/me', authMiddleware, async (req, res) => {
  const { username, newPassword } = req.body;
  try {
    if (username) {
      await pool.query('UPDATE users SET username=$1 WHERE uid=$2', [username, req.user.uid]);
    }
    if (newPassword && newPassword.length >= 6) {
      const hash = await bcrypt.hash(newPassword, 12);
      await pool.query('UPDATE users SET password=$1 WHERE uid=$2', [hash, req.user.uid]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// GET /api/auth/check-username - Kiểm tra username đã tồn tại chưa
router.get('/check-username', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ exists: false });
  try {
    const result = await pool.query('SELECT id FROM users WHERE username=$1', [username.toLowerCase().trim()]);
    res.json({ exists: result.rows.length > 0 });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;
module.exports.authMiddleware  = authMiddleware;
module.exports.adminMiddleware = adminMiddleware;
module.exports.pool            = pool;

