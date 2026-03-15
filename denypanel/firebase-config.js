/**
 * jwt-helpers.js (thay firebase-config.js)
 * Các hàm helper dùng chung cho tất cả trang
 */

// ==========================================
// JWT AUTH HELPERS
// ==========================================

/** Lấy JWT token */
function getToken() {
  return localStorage.getItem('jwt_token') || '';
}

/** Lấy user data từ localStorage */
function getCachedUser() {
  try { return JSON.parse(localStorage.getItem('user_data') || '{}'); } catch { return {}; }
}

/** Logout - xóa JWT và chuyển về login */
function logoutUser() {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('user_data');
  window.location.href = 'login.html?logout=1';
}

/** Kiểm tra username tồn tại chưa */
async function checkUsernameExists(username) {
  const r = await fetch('/api/auth/check-username?username=' + encodeURIComponent(username));
  const d = await r.json();
  return d.exists;
}

/** Lấy thông tin user từ server */
async function getUserProfile(uid) {
  // Không dùng nữa (Firebase), trả về null
  return null;
}

/** Thông báo lỗi auth đơn giản */
function getAuthErrorMsg(code) {
  const msgs = {
    'auth/wrong-password': '❌ Sai mật khẩu!',
    'auth/user-not-found': '❌ Email chưa được đăng ký!',
    'auth/invalid-email': '❌ Email không hợp lệ!',
    'auth/too-many-requests': '❌ Quá nhiều lần thử, vui lòng đợi.',
    'auth/email-already-in-use': '❌ Email đã được sử dụng!',
    'auth/username-taken': '❌ Username đã được dùng!',
  };
  return msgs[code] || '❌ Lỗi: ' + (code || 'Không xác định');
}

// ==========================================
// escapeHtml helper
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
