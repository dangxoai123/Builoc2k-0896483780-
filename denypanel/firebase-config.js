/**
 * ==========================================
 * FIREBASE CONFIG - Builoc2k Reseller Panel
 * ==========================================
 * Sử dụng Firebase SDK v9+ (compat mode)
 */

// Firebase Config (project: builoc2k-denypanel)
const firebaseConfig = {
  apiKey: "AIzaSyDA6SIIeT8jlzLMyp1r6WnefnsGQxMgygA",
  authDomain: "builoc2k-denypanel.firebaseapp.com",
  projectId: "builoc2k-denypanel",
  storageBucket: "builoc2k-denypanel.firebasestorage.app",
  messagingSenderId: "1062694746960",
  appId: "1:1062694746960:web:59fad0e292a1fb137d0a55"
};

// Initialize Firebase (compat mode - works with script tags)
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// ==========================================
// AUTH HELPERS
// ==========================================

/** Đăng nhập bằng email */
async function loginUser(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}

/** Đăng ký tài khoản mới */
async function registerUser(email, password, username) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  const uid = cred.user.uid;

  // Lưu thông tin user vào Firestore
  await db.collection('users').doc(uid).set({
    username: username,
    email: email,
    balance: 0,
    currency: 'VND',
    role: 'user',
    totalOrders: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  return cred;
}

/** Đăng xuất */
async function logoutUser() {
  try { await auth.signOut(); } catch(e) {}
  // Xóa localStorage auth cũ
  localStorage.removeItem('dp_user');
  localStorage.removeItem('dp_logged_in');
  sessionStorage.clear();
  // Redirect với flag để login.html không auto-redirect lại
  window.location.href = 'login.html?logout=1';
}

/** Lấy data user hiện tại từ Firestore */
async function getUserProfile(uid) {
  const doc = await db.collection('users').doc(uid).get();
  return doc.exists ? doc.data() : null;
}

/** Cập nhật số dư user trong Firestore */
async function updateBalance(uid, newBalance) {
  await db.collection('users').doc(uid).update({ balance: newBalance });
}

/** Lưu đơn hàng vào Firestore */
async function saveOrder(uid, orderData) {
  await db.collection('users').doc(uid).collection('orders').add({
    ...orderData,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  // Tăng tổng đơn hàng
  await db.collection('users').doc(uid).update({
    totalOrders: firebase.firestore.FieldValue.increment(1)
  });
}

/** Lấy danh sách đơn hàng của user */
async function getUserOrders(uid) {
  const snap = await db.collection('users').doc(uid).collection('orders')
    .orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Map Firebase lỗi sang tiếng Việt
function getAuthErrorMsg(code) {
  const map = {
    'auth/user-not-found': 'Tài khoản không tồn tại!',
    'auth/wrong-password': 'Sai mật khẩu!',
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng!',
    'auth/email-already-in-use': 'Email này đã được đăng ký!',
    'auth/weak-password': 'Mật khẩu quá yếu (tối thiểu 6 ký tự)!',
    'auth/invalid-email': 'Email không hợp lệ!',
    'auth/too-many-requests': 'Quá nhiều lần thử. Vui lòng thử lại sau!',
    'auth/network-request-failed': 'Lỗi kết nối mạng!',
  };
  return map[code] || 'Lỗi: ' + code;
}
