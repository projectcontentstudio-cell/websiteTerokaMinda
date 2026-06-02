const crypto = require('crypto');

// Same ToyyibPay secret used in create-bill.js.
// Keep this file server-side only.
const TOYYIBPAY_SECRET_KEY = process.env.TOYYIBPAY_SECRET_KEY || 'w3ffnh2b-wxgg-1c4c-eb4p-c8gvxbxdpq0k';

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);

  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
        return;
      }

      const params = new URLSearchParams(raw);
      resolve(Object.fromEntries(params.entries()));
    });
    req.on('error', reject);
  });
}

function safeCompare(a, b) {
  const valueA = Buffer.from(String(a || ''), 'utf8');
  const valueB = Buffer.from(String(b || ''), 'utf8');
  return valueA.length === valueB.length && crypto.timingSafeEqual(valueA, valueB);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }

  const secretKey = TOYYIBPAY_SECRET_KEY;
  if (!secretKey) {
    res.statusCode = 500;
    res.end('Missing TOYYIBPAY_SECRET_KEY');
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (error) {
    res.statusCode = 400;
    res.end('Invalid body');
    return;
  }

  const status = body.status || body.status_id || '';
  const orderId = body.order_id || '';
  const refNo = body.refno || '';
  const receivedHash = body.hash || '';
  const expectedHash = crypto
    .createHash('md5')
    .update(`${secretKey}${status}${orderId}${refNo}ok`)
    .digest('hex');

  if (!safeCompare(receivedHash, expectedHash)) {
    res.statusCode = 401;
    res.end('Invalid hash');
    return;
  }

  // TODO: Simpan status bayaran dalam database / Google Sheet / CRM anda.
  // status: 1 = success, 2 = pending, 3 = fail.
  console.log('ToyyibPay callback verified:', {
    status,
    orderId,
    refNo,
    billcode: body.billcode,
    amount: body.amount,
    reason: body.reason,
    transaction_time: body.transaction_time
  });

  res.statusCode = 200;
  res.end('OK');
};
