const crypto = require('crypto');

// Must match the secret key used in /api/createbill.js.
const TOYYIBPAY_SECRET_KEY = 'w3ffnh2b-wxgg-1c4c-eb4p-c8gvxbxdpq0k';

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

async function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) return JSON.parse(req.body || '{}');
    return Object.fromEntries(new URLSearchParams(req.body).entries());
  }

  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          resolve(raw ? JSON.parse(raw) : {});
          return;
        }
        resolve(Object.fromEntries(new URLSearchParams(raw).entries()));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  let body;
  try {
    body = await parseRequestBody(req);
  } catch (error) {
    sendText(res, 400, 'Invalid body');
    return;
  }

  const status = body.status || body.status_id || '';
  const orderId = body.order_id || '';
  const refNo = body.refno || '';
  const receivedHash = body.hash || '';

  const expectedHash = crypto
    .createHash('md5')
    .update(`${TOYYIBPAY_SECRET_KEY}${status}${orderId}${refNo}ok`)
    .digest('hex');

  if (receivedHash && !timingSafeEqualText(receivedHash, expectedHash)) {
    console.warn('ToyyibPay callback invalid hash:', {
      status,
      orderId,
      refNo,
      billcode: body.billcode || body.billCode || ''
    });
    sendText(res, 401, 'Invalid hash');
    return;
  }

  // status: 1 = success, 2 = pending, 3 = failed.
  // Add your fulfilment logic here later, for example: send ebook email, save to database, Google Sheet, CRM, etc.
  console.log('ToyyibPay callback received:', {
    status,
    orderId,
    refNo,
    billcode: body.billcode || body.billCode || '',
    amount: body.amount || '',
    reason: body.reason || '',
    transaction_time: body.transaction_time || ''
  });

  sendText(res, 200, 'OK');
};
