<?php
/**
 * ==========================================
 * DENYPANEL API PROXY
 * File này chạy trên server PHP của bạn
 * Forward tất cả request từ frontend → DenyPanel API
 * Bypass CORS limitation của browser
 * ==========================================
 */

// Cho phép CORS từ frontend
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

// Nếu là preflight request (OPTIONS), trả về luôn
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Chỉ chấp nhận POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Method not allowed']);
    exit();
}

// ==========================================
// CẤU HÌNH
// ==========================================
$DENY_PANEL_URL = 'https://denypanel.com/api/v2';
$API_KEY        = '3b341f23c723707da4ce67f673f4e2f8'; // API key của bạn

// Lấy tất cả POST data từ frontend
$postData = array_merge($_POST, ['key' => $API_KEY]);

// Build query string
$postFields = [];
foreach ($postData as $name => $value) {
    if ($value !== '' && $value !== null) {
        $postFields[] = $name . '=' . urlencode($value);
    }
}

// ==========================================
// GỌI DENYPANEL API QUA CURL
// ==========================================
$ch = curl_init($DENY_PANEL_URL);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_HEADER, 0);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, implode('&', $postFields));
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; DenyPanel-Proxy/1.0)');
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

$result = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_errno($ch);

curl_close($ch);

// Trả về response từ DenyPanel về cho frontend
if ($curlError || empty($result)) {
    echo json_encode([
        'error' => 'Cannot connect to DenyPanel API',
        'curl_error' => $curlError
    ]);
    exit();
}

// Đảm bảo output là JSON hợp lệ
$decoded = json_decode($result, true);
if ($decoded === null) {
    echo json_encode(['error' => 'Invalid response from DenyPanel', 'raw' => substr($result, 0, 200)]);
    exit();
}

http_response_code($httpCode);
echo json_encode($decoded);
?>
