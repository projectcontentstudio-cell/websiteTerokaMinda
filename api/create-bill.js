const crypto = require('crypto');

const TOYYIBPAY_BASE_URL = process.env.TOYYIBPAY_BASE_URL || 'https://toyyibpay.com';
const SITE_URL = (process.env.SITE_URL || 'https://terokaminda.com').replace(/\/$/, '');

// ToyyibPay credentials.
// Server-side only: do not put these values in frontend/browser files.
const TOYYIBPAY_SECRET_KEY = process.env.TOYYIBPAY_SECRET_KEY || 'w3ffnh2b-wxgg-1c4c-eb4p-c8gvxbxdpq0k';
const TOYYIBPAY_CATEGORY_CODE = process.env.TOYYIBPAY_CATEGORY_CODE || '0z8hg4h6';

const PRODUCTS = {
  'teroka-minda-ebook': {
    billName: 'Teroka Minda Ebook',
    billDescription: 'Teroka Minda Ebook Digital',
    amountCents: 2900
  }
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cleanText(value, maxLength) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9 _@.+-]/g, '')
    .slice(0, maxLength);
}

function makeReferenceNo() {
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TM${Date.now()}${random}`.slice(0, 30);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ message: 'Method not allowed' }));
    return;
  }

  const secretKey = TOYYIBPAY_SECRET_KEY;
  const categoryCode = TOYYIBPAY_CATEGORY_CODE;

  if (!secretKey || !categoryCode) {
    res.statusCode = 500;
    res.end(JSON.stringify({
      message: 'ToyyibPay credential belum diset.'
    }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    res.statusCode = 400;
    res.end(JSON.stringify({ message: 'Invalid JSON body' }));
    return;
  }

  const product = PRODUCTS[body.package] || PRODUCTS['teroka-minda-ebook'];
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 120);
  const phone = cleanText(body.phone, 30);

  if (!name || !isValidEmail(email) || !phone) {
    res.statusCode = 400;
    res.end(JSON.stringify({ message: 'Sila isi nama, email dan nombor WhatsApp yang sah.' }));
    return;
  }

  const referenceNo = makeReferenceNo();

  const form = new URLSearchParams({
    userSecretKey: secretKey,
    categoryCode,
    billName: product.billName,
    billDescription: product.billDescription,
    billPriceSetting: '1',
    billPayorInfo: '1',
    billAmount: String(product.amountCents),
    billReturnUrl: `${SITE_URL}/payment-return.html`,
    billCallbackUrl: `${SITE_URL}/api/toyyibpay-callback`,
    billExternalReferenceNo: referenceNo,
    billTo: name,
    billEmail: email,
    billPhone: phone,
    billSplitPayment: '0',
    billSplitPaymentArgs: '',
    billPaymentChannel: process.env.TOYYIBPAY_PAYMENT_CHANNEL || '0',
    billContentEmail: 'Terima kasih kerana membeli Teroka Minda Ebook.',
    billChargeToCustomer: process.env.TOYYIBPAY_CHARGE_TO_CUSTOMER || '',
    billExpiryDays: process.env.TOYYIBPAY_BILL_EXPIRY_DAYS || '3'
  });

  try {
    const tpResponse = await fetch(`${TOYYIBPAY_BASE_URL}/index.php/api/createBill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });

    const rawText = await tpResponse.text();
    let data;

    try {
      data = JSON.parse(rawText);
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({
        message: 'ToyyibPay memberi respons yang tidak dapat dibaca.',
        details: rawText.slice(0, 300)
      }));
      return;
    }

    const billCode = Array.isArray(data) ? data[0]?.BillCode : data?.BillCode;

    if (!tpResponse.ok || !billCode) {
      res.statusCode = 502;
      res.end(JSON.stringify({
        message: 'Gagal cipta bill ToyyibPay.',
        details: data
      }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      billCode,
      referenceNo,
      paymentUrl: `${TOYYIBPAY_BASE_URL}/${billCode}`
    }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({
      message: 'Server error semasa menghubungi ToyyibPay.',
      details: error.message
    }));
  }
};
