/**
 * lang.js - Hệ thống đa ngôn ngữ VI / EN
 * Mặc định: Tiếng Việt (vi)
 */

const TRANSLATIONS = {
  vi: {
    /* === NAVBAR (public) === */
    nav_services:   'Dịch vụ',
    nav_terms:      'Điều khoản',
    nav_login:      'Đăng Nhập',
    nav_register:   'Đăng Kí',
    nav_home:       'Trang chủ',
    lang_switch:    '🇺🇸 EN',

    /* === SERVICES PAGE === */
    svc_search_ph:     '🔍 Tìm kiếm dịch vụ...',
    svc_support:       'Giờ hỗ trợ: 8:00 - 22:00',
    svc_col_id:        'Mã dịch vụ',
    svc_col_name:      'Dịch vụ',
    svc_col_price:     'Giá cho 1000 đơn vị',
    svc_col_min:       'Tối thiểu',
    svc_col_max:       'Tối đa',
    svc_col_time:      'Thời gian trung bình',
    svc_detail_btn:    'Chi tiết',
    svc_loading:       'Đang tải dịch vụ...',
    svc_no_result:     'Không tìm thấy dịch vụ phù hợp',
    svc_detail_speed:  'Speed:',
    svc_detail_refill: 'Refill:',
    svc_detail_quality:'Quality:',
    svc_detail_price:  'Giá/1000:',
    svc_detail_minmax: 'Min/Max:',
    svc_detail_link:   'Link:',
    svc_refill_yes:    'Có bảo hành',
    svc_refill_no:     'Không bảo hành',

    /* === LOGIN PAGE === */
    login_title:     'Đăng Nhập',
    login_subtitle:  'Chào mừng bạn trở lại! Vui lòng đăng nhập.',
    login_email_lbl: 'Email',
    login_email_ph:  'Nhập địa chỉ email...',
    login_pass_lbl:  'Mật khẩu',
    login_pass_ph:   'Nhập mật khẩu...',
    login_forgot:    'Quên mật khẩu?',
    login_btn:       'Đăng Nhập',
    login_no_acc:    'Chưa có tài khoản?',
    login_register:  'Đăng ký ngay',
    login_tagline:   'Phát triển mạng xã hội.',
    login_svc_btn:   'Dịch vụ',

    /* === SIGNUP PAGE === */
    signup_title:      'Tạo tài khoản',
    signup_subtitle:   'Bắt đầu ngay hôm nay, miễn phí!',
    signup_name_lbl:   'Họ và tên',
    signup_name_ph:    'Nhập họ và tên...',
    signup_email_lbl:  'Email',
    signup_email_ph:   'Nhập địa chỉ email...',
    signup_pass_lbl:   'Mật khẩu',
    signup_pass_ph:    'Nhập mật khẩu (tối thiểu 6 ký tự)...',
    signup_confirm_lbl:'Xác nhận mật khẩu',
    signup_confirm_ph: 'Nhập lại mật khẩu...',
    signup_btn:        'Tạo tài khoản',
    signup_has_acc:    'Đã có tài khoản?',
    signup_login:      'Đăng nhập',

    /* === DASHBOARD MENU === */
    menu_home:       'Trang chủ',
    menu_services:   'Dịch vụ',
    menu_new_order:  'Đặt hàng mới',
    menu_orders:     'Đơn hàng',
    menu_sub:        'Đặt hàng lớn',
    menu_funds:      'Nạp tiền',
    menu_api:        'API',
    menu_affiliate:  'Đại lý',
    menu_faq:        'FAQ',
    menu_logout:     'Đăng xuất',

    /* === DASHBOARD SERVICES TABLE === */
    dash_col_fav:    '♥',
    dash_col_id:     'Mã DV',
    dash_col_name:   'Dịch vụ',
    dash_col_price:  'Giá / 1000',
    dash_col_min:    'Tối thiểu',
    dash_col_max:    'Tối đa',
    dash_col_speed:  'Tốc độ',
    dash_col_time:   'Thời gian',
    dash_order_btn:  'Đặt hàng',
  },

  en: {
    /* === NAVBAR (public) === */
    nav_services:   'Services',
    nav_terms:      'Terms',
    nav_login:      'Login',
    nav_register:   'Register',
    nav_home:       'Home',
    lang_switch:    '🇻🇳 VI',

    /* === SERVICES PAGE === */
    svc_search_ph:     '🔍 Search services...',
    svc_support:       'Support hours: 8:00 - 22:00',
    svc_col_id:        'Service ID',
    svc_col_name:      'Service',
    svc_col_price:     'Price per 1000 units',
    svc_col_min:       'Minimum',
    svc_col_max:       'Maximum',
    svc_col_time:      'Average time',
    svc_detail_btn:    'Details',
    svc_loading:       'Loading services...',
    svc_no_result:     'No matching services found',
    svc_detail_speed:  'Speed:',
    svc_detail_refill: 'Refill:',
    svc_detail_quality:'Quality:',
    svc_detail_price:  'Price/1000:',
    svc_detail_minmax: 'Min/Max:',
    svc_detail_link:   'Link:',
    svc_refill_yes:    'Guaranteed',
    svc_refill_no:     'No guarantee',

    /* === LOGIN PAGE === */
    login_title:     'Login',
    login_subtitle:  'Welcome back! Please sign in.',
    login_email_lbl: 'Email',
    login_email_ph:  'Enter your email...',
    login_pass_lbl:  'Password',
    login_pass_ph:   'Enter your password...',
    login_forgot:    'Forgot password?',
    login_btn:       'Login',
    login_no_acc:    'Don\'t have an account?',
    login_register:  'Register now',
    login_tagline:   'Grow your social media.',
    login_svc_btn:   'Services',

    /* === SIGNUP PAGE === */
    signup_title:      'Create Account',
    signup_subtitle:   'Get started today, free!',
    signup_name_lbl:   'Full Name',
    signup_name_ph:    'Enter your full name...',
    signup_email_lbl:  'Email',
    signup_email_ph:   'Enter your email...',
    signup_pass_lbl:   'Password',
    signup_pass_ph:    'Enter password (min 6 chars)...',
    signup_confirm_lbl:'Confirm Password',
    signup_confirm_ph: 'Re-enter your password...',
    signup_btn:        'Create Account',
    signup_has_acc:    'Already have an account?',
    signup_login:      'Sign in',

    /* === DASHBOARD MENU === */
    menu_home:       'Home',
    menu_services:   'Services',
    menu_new_order:  'New Order',
    menu_orders:     'Orders',
    menu_sub:        'Bulk Order',
    menu_funds:      'Add Funds',
    menu_api:        'API',
    menu_affiliate:  'Affiliate',
    menu_faq:        'FAQ',
    menu_logout:     'Logout',

    /* === DASHBOARD SERVICES TABLE === */
    dash_col_fav:    '♥',
    dash_col_id:     'ID',
    dash_col_name:   'Service',
    dash_col_price:  'Price / 1000',
    dash_col_min:    'Min',
    dash_col_max:    'Max',
    dash_col_speed:  'Speed',
    dash_col_time:   'Time',
    dash_order_btn:  'Order',
  }
};

/** Lấy ngôn ngữ hiện tại (mặc định VI) */
function getLang() {
  return localStorage.getItem('lang') || 'vi';
}

/** Đặt ngôn ngữ và áp dụng */
function setLang(lang) {
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;
  applyLang();
}

/** Chuyển đổi VI ↔ EN */
function toggleLang() {
  setLang(getLang() === 'vi' ? 'en' : 'vi');
}

/** Lấy chuỗi dịch */
function t(key) {
  const lang = getLang();
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || (TRANSLATIONS['vi'][key]) || key;
}

/** Áp dụng tất cả bản dịch lên DOM */
function applyLang() {
  const lang = getLang();
  const T = TRANSLATIONS[lang] || TRANSLATIONS['vi'];

  // Áp dụng data-i18n text
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (!T[key]) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = T[key];
    } else {
      el.textContent = T[key];
    }
  });

  // Áp dụng data-i18n-ph (placeholder riêng)
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.dataset.i18nPh;
    if (T[key]) el.placeholder = T[key];
  });

  // Cập nhật nút lang (tất cả)
  document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
    btn.innerHTML = lang === 'vi'
      ? '<span class="flag-icon">🇺🇸</span> EN'
      : '<span class="flag-icon">🇻🇳</span> VI';
    btn.title = lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt';
  });

  // Cập nhật html lang
  document.documentElement.lang = lang;
}

// Áp dụng khi trang load
document.addEventListener('DOMContentLoaded', applyLang);
