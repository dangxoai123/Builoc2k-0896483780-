/**
 * Script lấy toàn bộ service descriptions từ denypanel.com
 * Chạy: node scripts/fetch-descriptions.js
 */

const https = require('https');
const fs = require('fs');
const querystring = require('querystring');

const API_KEY = 'fa92015088b93cbede91594df8006018';
const API_URL = 'https://denypanel.com/api/v2';

function postRequest(data) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const options = {
      hostname: 'denypanel.com',
      port: 443,
      path: '/api/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => rawData += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(rawData)); }
        catch(e) { resolve(rawData); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Fetching all services from denypanel.com...');
  
  const services = await postRequest({
    key: API_KEY,
    action: 'services'
  });

  if (!Array.isArray(services)) {
    console.error('ERROR: Response is not an array:', typeof services, JSON.stringify(services).substring(0, 300));
    process.exit(1);
  }

  console.log(`Got ${services.length} services total`);

  // Kiểm tra xem có field description không
  const withDesc = services.filter(s => s.description && s.description.trim());
  console.log(`Services with description: ${withDesc.length}`);

  if (withDesc.length > 0) {
    console.log('Sample description:', JSON.stringify(withDesc[0]));
  }

  // Tạo map id -> description
  const descriptionMap = {};
  const detailMap = {};

  services.forEach(s => {
    const id = String(s.service || s.id);
    descriptionMap[id] = s.description || '';
    detailMap[id] = {
      name: s.name,
      category: s.category,
      rate: s.rate,
      min: s.min,
      max: s.max,
      type: s.type,
      refill: s.refill,
      cancel: s.cancel,
      dripfeed: s.dripfeed,
      description: s.description || '',
      avg_time: s.avg_time || ''
    };
  });

  // Lưu file
  const outPath = 'denypanel/service-descriptions.json';
  fs.writeFileSync(outPath, JSON.stringify(descriptionMap, null, 2), 'utf8');
  console.log(`Saved description map to ${outPath} (${Object.keys(descriptionMap).length} entries)`);

  // Lưu full data
  const fullPath = 'denypanel/service-details.json';
  fs.writeFileSync(fullPath, JSON.stringify(detailMap, null, 2), 'utf8');
  console.log(`Saved full detail map to ${fullPath}`);

  // Show stats
  const withDescs = Object.values(descriptionMap).filter(d => d && d.trim());
  console.log(`\n=== STATS ===`);
  console.log(`Total services: ${services.length}`);
  console.log(`With descriptions: ${withDescs.length}`);
  console.log(`Without descriptions: ${services.length - withDescs.length}`);
  
  // Sample
  console.log('\n=== Sample (first 3 with descriptions) ===');
  let shown = 0;
  for (const [id, desc] of Object.entries(descriptionMap)) {
    if (desc && shown < 3) {
      console.log(`ID ${id}: ${desc.substring(0, 150)}`);
      shown++;
    }
  }
}

main().catch(console.error);
