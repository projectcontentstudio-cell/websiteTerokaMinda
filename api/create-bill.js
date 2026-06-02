const crypto = require('crypto');

const TOYYIBPAY_BASE_URL = process.env.TOYYIBPAY_BASE_URL || 'https://toyyibpay.com';
const SITE_URL = (process.env.SITE_URL || 'https://terokaminda.com').replace(/\/$/, '');

// ToyyibPay credentials.
// Server-side only: do not put these values in frontend/browser files.
const TOYYIBPAY_SECRET_KEY = process.env.TOYYIBPAY_SECRET_KEY || 'w3ffnh2b-wxgg-1c4c-eb4p-c8gvxbxdpq0k';
const TOYYIBPAY_CATEGORY_CODE = process.env.TOYYIBPAY_CATEGORY_CODE || '0z8hg4h6';

const PRODUCTS = {
  'teroka-minda-ebook': {
    // ToyyibPay billName: max 30 alphanumeric characters, spaces and underscores only.
    billName: 'Teroka Minda Ebook',
    // ToyyibPay billDescription: max 100 alphanumeric characters, spaces and underscores only.
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

function cleanToyyibPayText(value, maxLength) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9 _]/g, '')
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

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJsonCandidate(rawText) {
  const clean = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!clean) return '';

  // Normal case: ToyyibPay returns JSON such as [{"BillCode":"gcbhict9"}].
  if (clean.startsWith('[') || clean.startsWith('{')) return clean;

  // Some servers prepend PHP warnings/notices before the JSON. Extract the JSON part.
  const arrayStart = clean.indexOf('[');
  const objectStart = clean.indexOf('{');
  const starts = [arrayStart, objectStart].filter(index => index >= 0);
  if (!starts.length) return '';

  const start = Math.min(...starts);
  const endArray = clean.lastIndexOf(']');
  const endObject = clean.lastIndexOf('}');
  const end = Math.max(endArray, endObject);

  return end > start ? clean.slice(start, end + 1) : '';
}

function parseToyyibPayCreateBillResponse(rawText) {
  const clean = String(rawText || '').replace(/^\uFEFF/, '').trim();
  const preview = stripHtml(clean).slice(0, 500);

  if (!clean) {
    return { ok: false, message: 'ToyyibPay tidak menghantar sebarang respons.', preview };
  }

  const jsonCandidate = extractJsonCandidate(clean);
  if (jsonCandidate) {
    try {
      const data = JSON.parse(jsonCandidate);
      const first = Array.isArray(data) ? data[0] : data;
      const billCode = first?.BillCode || first?.billCode || first?.billcode;

      if (billCode) {
        return { ok: true, billCode: String(billCode), data, preview };
      }

      return {
        ok: false,
        message: 'ToyyibPay tidak pulangkan BillCode.',
        data,
        preview
      };
    } catch (error) {
      // Continue to fallback extraction below.
    }
  }

  // Fallback for unexpected raw formats that still contain a BillCode.
  const billCodeMatch = clean.match(/["']?BillCode["']?\s*[:=>]+\s*["']?([a-zA-Z0-9]+)/i);
  if (billCodeMatch?.[1]) {
    return { ok: true, billCode: billCodeMatch[1], data: null, preview };
  }

  // Fallback if ToyyibPay ever returns only the code.
  if (/^[a-zA-Z0-9]{6,30}$/.test(clean)) {
    return { ok: true, billCode: clean, data: null, preview };
  }

  return {
    ok: false,
    message: 'ToyyibPay memberi respons yang bukan JSON atau tidak mengandungi BillCode.',
    data: null,
    preview
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Method not allowed' });
    return;
  }

  const secretKey = TOYYIBPAY_SECRET_KEY;
  const categoryCode = TOYYIBPAY_CATEGORY_CODE;

  if (!secretKey || !categoryCode) {
    sendJson(res, 500, {
      message: 'ToyyibPay credential belum diset.'
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { message: 'Invalid JSON body' });
    return;
  }

  const product = PRODUCTS[body.package] || PRODUCTS['teroka-minda-ebook'];
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 120);
  const phone = cleanText(body.phone, 30);

  if (!name || !isValidEmail(email) || !phone) {
    sendJson(res, 400, { message: 'Sila isi nama, email dan nombor WhatsApp yang sah.' });
    return;
  }

  const referenceNo = makeReferenceNo();

  const form = new URLSearchParams({
    userSecretKey: secretKey,
    categoryCode,
    billName: cleanToyyibPayText(product.billName, 30),
    billDescription: cleanToyyibPayText(product.billDescription, 100),
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
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*'
      },
      body: form.toString()
    });

    const rawText = await tpResponse.text();
    const parsed = parseToyyibPayCreateBillResponse(rawText);

    // Helpful in Vercel/Netlify logs, but never prints the secret key.
    console.log('ToyyibPay createBill response:', {
      httpStatus: tpResponse.status,
      ok: tpResponse.ok,
      parsedOk: parsed.ok,
      billCode: parsed.billCode || null,
      preview: parsed.preview || ''
    });

    if (!tpResponse.ok || !parsed.ok || !parsed.billCode) {
      sendJson(res, 502, {
        message: parsed.message || 'Gagal cipta bill ToyyibPay.',
        httpStatus: tpResponse.status,
        details: parsed.data || parsed.preview || 'Tiada maklumat lanjut daripada ToyyibPay.'
      });
      return;
    }

    sendJson(res, 200, {
      billCode: parsed.billCode,
      referenceNo,
      paymentUrl: `${TOYYIBPAY_BASE_URL}/${parsed.billCode}`
    });
  } catch (error) {
    sendJson(res, 500, {
      message: 'Server error semasa menghubungi ToyyibPay.',
      details: error.message
    });
  }
};
