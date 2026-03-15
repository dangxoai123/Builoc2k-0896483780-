/**
 * MMOpanel Express Server
 * Thay thế Vercel Serverless Functions
 * Database: PostgreSQL | Auth: JWT + bcrypt
 */

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
global._io = io;

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

// 1. Helmet - bảo vệ HTTP headers (XSS, clickjacking, MIME sniffing)
app.use(helmet({
  contentSecurityPolicy: false,  // Tắt CSP để không chặn CDN fonts/icons
  crossOriginEmbedderPolicy: false,
}));

// 2. CORS - chỉ cho phép domain chính
app.use(cors({
  origin: ['https://mmopanel.com', 'https://www.mmopanel.com', 'http://localhost:3000'],
  credentials: true,
}));

// 3. Rate Limit - giới hạn request chung (chống DDoS)
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 phút
  max: 200,                   // tối đa 200 request/phút/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
});
app.use('/api/', globalLimiter);

// 4. Rate Limit nghiêm hơn cho login/register (chống brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 20,                    // tối đa 20 lần/15 phút/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần đăng nhập thất bại. Thử lại sau 15 phút.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// 5. Rate Limit nhẹ hơn cho admin (chỉ admin dùng)
const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: { error: 'Quá nhiều request admin.' },
});
app.use('/api/admin/', adminLimiter);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Serve static files từ thư mục denypanel
app.use(express.static(path.join(__dirname, 'denypanel')));

// ==========================================
// API ROUTES
// ==========================================
app.use('/api/auth',     require('./api/auth'));
app.use('/api/payment',  require('./api/payment'));
app.use('/api/services', require('./api/services'));
app.use('/api/rate',     require('./api/rate'));
app.use('/api/admin',    require('./api/admin'));
app.use('/api/orders',   require('./api/orders'));

// ==========================================
// SOCKET.IO - Real-time cho admin
// ==========================================
io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('[Socket.io] Client disconnected:', socket.id);
  });
});

// Hàm global để emit sự kiện từ bất kỳ route nào
global.emitToAdmin = (event, data) => {
  io.emit(event, data);
};

// ==========================================
// FALLBACK - Serve index.html cho SPA
// ==========================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'denypanel', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'denypanel', 'admin.html'));
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ MMOpanel server running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`🛡️  Security: Helmet + Rate Limiting enabled`);
});
