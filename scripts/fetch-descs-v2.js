/**
 * Script tải HTML denypanel.com đúng cách (handle gzip) và parse descriptions
 */
const https  = require('https');
const zlib   = require('zlib');
const fs     = require('fs');
const path   = require('path');

// Bước 1: Lấy session cookie bằng cách đăng nhập
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        const cookies = res.headers['set-cookie'] || [];
        const location = res.headers['location'] || '';

        const decompress = (buf) => new Promise((res, rej) => {
          if (enc === 'gzip') { zlib.gunzip(buf, (e, d) => e ? rej(e) : res(d.toString('utf8'))); }
          else if (enc === 'br') { zlib.brotliDecompress(buf, (e, d) => e ? rej(e) : res(d.toString('utf8'))); }
          else if (enc === 'deflate') { zlib.inflate(buf, (e, d) => e ? rej(e) : res(d.toString('utf8'))); }
          else { res(buf.toString('utf8')); }
        });

        decompress(buf).then(text => {
          resolve({ body: text, cookies, status: res.statusCode, location });
        }).catch(reject);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseCookieStr(cookieArray) {
  return cookieArray.map(c => c.split(';')[0]).join('; ');
}

async function main() {
  // LOGIN
  console.log('Logging in to denypanel.com...');
  const loginBody = 'username=dangxoai&password=k999999';
  const loginRes = await httpRequest({
    hostname: 'denypanel.com', port: 443, path: '/login', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(loginBody),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://denypanel.com/login'
    }
  }, loginBody);

  console.log('Login status:', loginRes.status, '| Redirect:', loginRes.location);
  let cookies = parseCookieStr(loginRes.cookies);
  console.log('Cookies:', cookies.substring(0, 100));

  // Follow redirect if needed
  if (loginRes.status >= 300 && loginRes.status < 400) {
    const redirectUrl = loginRes.location || '/';
    const redirRes = await httpRequest({
      hostname: 'denypanel.com', port: 443,
      path: redirectUrl.startsWith('/') ? redirectUrl : '/' + redirectUrl,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cookie': cookies
      }
    });
    cookies = parseCookieStr([...loginRes.cookies, ...redirRes.cookies]);
  }

  // FETCH SERVICES PAGE
  console.log('Fetching services page...');
  const svcRes = await httpRequest({
    hostname: 'denypanel.com', port: 443, path: '/services', method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      'Cookie': cookies
    }
  });

  console.log('Services page status:', svcRes.status, '| Size:', svcRes.body.length, 'chars');
  fs.writeFileSync('/tmp/services-full.html', svcRes.body, 'utf8');
  console.log('Saved to /tmp/services-full.html');

  // PARSE descriptions
  const html = svcRes.body;

  // Pattern: { id: 1234, ..., serviceModalTitle: `...`, serviceModalText: `...` }
  const serviceBlockRe = /\{\s*id:\s*(\d+)[^}]{0,3000}?serviceModalTitle:\s*`([^`]*)`[^}]{0,3000}?serviceModalText:\s*`([^`]*)`/gs;
  const results = {};
  let m;
  while ((m = serviceBlockRe.exec(html)) !== null) {
    const id   = m[1];
    const name = m[2].trim();
    const text = m[3].trim();
    // Decode HTML entities trong text
    const decoded = text
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    results[id] = { name, description: decoded };
  }

  console.log('\nParsed', Object.keys(results).length, 'services with descriptions');

  // Cũng thử pattern ngược (serviceModalText trước id)
  const altRe = /serviceModalTitle:\s*`([^`]*)`\s*,\s*serviceModalText:\s*`([^`]*)`[\s\S]{0,500}?id:\s*(\d+)/gs;
  while ((m = altRe.exec(html)) !== null) {
    const id = m[3];
    if (!results[id]) {
      results[id] = {
        name: m[1].trim(),
        description: m[2].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
                       .replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').trim()
      };
    }
  }

  console.log('After alt parse:', Object.keys(results).length, 'services');

  // Sample
  const sample = Object.entries(results).slice(0, 5);
  sample.forEach(([id, d]) => {
    console.log(`\nID ${id}: ${d.name.substring(0, 70)}`);
    console.log(`Desc: ${d.description.substring(0, 120)}`);
  });

  // Save
  const outPath = path.join(__dirname, '../denypanel/service-descriptions.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('\nSaved to', outPath);
}

main().catch(e => { console.error('Error:', e.message, e.stack); process.exit(1); });
