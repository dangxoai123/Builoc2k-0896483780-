/**
 * Script download HTML denypanel.com và parse descriptions
 * Chạy: node scripts/parse-descriptions.js
 */

const https = require('https');
const fs = require('fs');

// Download trang với cookie session (cần đăng nhập)
// Dùng API key để lấy session cookie trước
function fetchWithSession(url, cookieStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'denypanel.com',
      port: 443,
      path: url.replace('https://denypanel.com', '') || '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        'Cookie': cookieStr || '',
        'Referer': 'https://denypanel.com/'
      }
    };

    const req = https.request(options, (res) => {
      // Lấy set-cookie headers
      const cookies = res.headers['set-cookie'] || [];
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => rawData += chunk);
      res.on('end', () => resolve({ body: rawData, cookies, status: res.statusCode, headers: res.headers }));
    });

    req.on('error', reject);
    req.end();
  });
}

function postLogin(username, password) {
  return new Promise((resolve, reject) => {
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const options = {
      hostname: 'denypanel.com',
      port: 443,
      path: '/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://denypanel.com/login'
      }
    };

    const req = https.request(options, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => resolve({ cookies, body: rawData, status: res.statusCode, location: res.headers['location'] }));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseCookies(cookieArray) {
  return cookieArray.map(c => c.split(';')[0]).join('; ');
}

// Parse descriptions từ HTML
function parseDescriptions(html) {
  const results = {};
  
  // Pattern 1: onclick với service modal data
  // onclick="openModal(id, {speed:'...', refill:'...', text:'...'})"
  const onclickPattern = /onclick=['""][^'"]*openModal[^'"]*(\d+)[^'"]*['""].*?class=['""][^'"]*modal/gi;
  
  // Pattern 2: data-modal attributes  
  // Tìm tất cả modal containers với ID như serviceModal1536
  const modalPattern = /id=["']serviceModal(\d+)["'][^>]*>[\s\S]*?<\/div>/gi;
  let match;
  
  // Pattern 3: v-bind hoặc :data với JSON
  // Tìm service data trong JSON embedded
  const jsonPattern = /"service":\s*(\d+).*?"description":\s*"([^"]+)"/gi;
  while ((match = jsonPattern.exec(html)) !== null) {
    results[match[1]] = match[2];
  }
  
  // Pattern 4: Tìm text trong modal divs
  // <div id="d{id}" class="hidden">text</div>
  const hiddenDivPattern = /id=["']d(\d+)["'][^>]*>([\s\S]*?)<\/div>/gi;
  while ((match = hiddenDivPattern.exec(html)) !== null) {
    if (match[2].trim() && !results[match[1]]) {
      results[match[1]] = match[2].replace(/<[^>]+>/g, '').trim();
    }
  }
  
  // Pattern 5: serviceModalText trong JS
  // serviceModalText: "..."
  const modalTextPattern = /serviceModalText['":\s]+(['"]+)([\s\S]*?)\1/gi;
  while ((match = modalTextPattern.exec(html)) !== null) {
    // Tìm service ID gần đó
    const context = html.substring(Math.max(0, match.index - 200), match.index);
    const idMatch = context.match(/service[:\s'"]+(\d+)/i);
    if (idMatch) {
      results[idMatch[1]] = match[2].trim();
    }
  }

  return results;
}

async function main() {
  console.log('Step 1: Fetching login page...');
  const loginPage = await fetchWithSession('https://denypanel.com/login');
  console.log('Login page status:', loginPage.status);
  
  // Lấy CSRF token nếu có
  const csrfMatch = loginPage.body.match(/name=["']_token["']\s+value=["']([^"']+)["']/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  console.log('CSRF token:', csrf ? 'found' : 'not found');
  
  const loginCookies = parseCookies(loginPage.cookies);
  
  console.log('Step 2: Logging in...');
  // Try with CSRF
  const loginRes = await postLogin('dangxoai', 'k999999');
  console.log('Login status:', loginRes.status, 'Location:', loginRes.location);
  
  const sessionCookies = parseCookies([...loginPage.cookies, ...loginRes.cookies]);
  console.log('Session cookies obtained:', sessionCookies.substring(0, 100));
  
  console.log('Step 3: Fetching services page...');
  const servicesPage = await fetchWithSession('https://denypanel.com/services', sessionCookies);
  console.log('Services page status:', servicesPage.status);
  console.log('Services page size:', servicesPage.body.length, 'chars');
  
  if (servicesPage.status !== 200 || servicesPage.body.length < 10000) {
    console.log('Failed to get services page. Response:', servicesPage.body.substring(0, 500));
    // Try with redirect cookies
    const redirectCookies = parseCookies(servicesPage.cookies);
    const allCookies = sessionCookies + '; ' + redirectCookies;
    const retry = await fetchWithSession('https://denypanel.com/services', allCookies);
    console.log('Retry status:', retry.status, 'Size:', retry.body.length);
    fs.writeFileSync('/tmp/services-raw.html', retry.body);
    return;
  }
  
  // Save raw HTML for debugging
  fs.writeFileSync('/tmp/services-raw.html', servicesPage.body);
  console.log('Saved raw HTML to /tmp/services-raw.html');
  
  console.log('Step 4: Parsing descriptions...');
  const descriptions = parseDescriptions(servicesPage.body);
  console.log('Descriptions found:', Object.keys(descriptions).length);
  
  // Check sample
  const sampleKeys = Object.keys(descriptions).slice(0, 5);
  sampleKeys.forEach(id => {
    console.log(`ID ${id}: ${descriptions[id].substring(0, 100)}`);
  });
  
  fs.writeFileSync('denypanel/service-descriptions.json', JSON.stringify(descriptions, null, 2), 'utf8');
  console.log('Saved to denypanel/service-descriptions.json');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
