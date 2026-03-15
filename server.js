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

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
global._io = io; // để các route khác dùng

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
});
