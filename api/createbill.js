const crypto = require('crypto');

// Server-side only. Do not place this value in index.html or any frontend file.
const TOYYIBPAY_SECRET_KEY = 'w3ffnh2b-wxgg-1c4c-eb4p-c8gvxbxdpq0k';
const TOYYIBPAY_CATEGORY_CODE = '0z8hg4h6';

// Sandbox mode for ToyyibPay testing. For real customer payments, change to 'live'
// and use LIVE secret key + LIVE category code from the same ToyyibPay account.
const TOYYIBPAY_MODE = 'sandbox'; // 'live' or 'sandbox'
const TOYYIBPAY_BASE_URL = TOYYIBPAY_MODE === 'sandbox'
  ? 'https://dev.toyyibpay.com'
  : 'https://toyyibpay.com';

const SITE_URL = 'https://terokaminda-edu.vercel.app';

const PRODUCTS = {
  'teroka-minda-ebook': {
    billName: 'Teroka Minda Ebook',
    billDescription: 'Teroka Minda Ebook Digital',
    amountCents: 2900
  }
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function cleanBuyerText(value, maxLength) {
  return String(value || '')
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^a-zA-Z0-9 _@.+\-]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function cleanToyyibText(value, maxLength) {
  // ToyyibPay billName / billDescription: alphanumeric, spaces and underscore only.
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9 _]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function makeReferenceNo() {
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TM${Date.now()}${random}`.slice(0, 30);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBalancedJsonCandidate(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!clean) return '';

  const starts = [clean.indexOf('['), clean.indexOf('{')].filter(index => index >= 0);
  if (!starts.length) return '';

  const start = Math.min(...starts);
  const open = clean[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < clean.length; i += 1) {
    const char = clean[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth += 1;
    if (char === close) depth -= 1;

    if (depth === 0) return clean.slice(start, i + 1);
  }

  return '';
}

function parseToyyibPayResponse(rawText) {
  const clean = String(rawText || '').replace(/^\uFEFF/, '').trim();
  const preview = stripHtml(clean).slice(0, 1200) || '(empty response)';

  if (!clean) {
    return { ok: false, code: 'EMPTY_RESPONSE', message: 'ToyyibPay tidak menghantar respons.', details: preview };
  }

  const jsonCandidate = getBalancedJsonCandidate(clean);
  if (jsonCandidate) {
    try {
      const json = JSON.parse(jsonCandidate);
      const first = Array.isArray(json) ? json[0] : json;
      const billCode = first?.BillCode || first?.billCode || first?.billcode;

      if (billCode) {
        return { ok: true, billCode: String(billCode), details: json };
      }

      const compact = JSON.stringify(json);
      if (/KEY-DID-NOT-EXIST/i.test(compact)) {
        return {
          ok: false,
          code: 'KEY_DID_NOT_EXIST',
          message: 'ToyyibPay tidak menerima secret key ini untuk mode API sekarang.',
          details: json
        };
      }

      return {
        ok: false,
        code: 'NO_BILLCODE',
        message: 'ToyyibPay tidak pulangkan BillCode.',
        details: json
      };
    } catch (error) {
      // Continue to raw text fallback.
    }
  }

  const billCodeMatch = clean.match(/BillCode[^a-zA-Z0-9]{1,20}([a-zA-Z0-9]{5,40})/i);
  if (billCodeMatch?.[1]) {
    return { ok: true, billCode: billCodeMatch[1], details: preview };
  }

  if (/^[a-zA-Z0-9]{5,40}$/.test(clean)) {
    return { ok: true, billCode: clean, details: preview };
  }

  if (/KEY-DID-NOT-EXIST/i.test(clean)) {
    return {
      ok: false,
      code: 'KEY_DID_NOT_EXIST',
      message: 'ToyyibPay tidak menerima secret key ini untuk mode API sekarang.',
      details: preview
    };
  }

  return {
    ok: false,
    code: 'NO_BILLCODE',
    message: 'ToyyibPay memberi respons tanpa BillCode.',
    details: preview
  };
}

function appendParam(params, key, value) {
  if (value === undefined || value === null || value === '') return;
  params.append(key, String(value));
}

function buildToyyibPayParams({ product, referenceNo, name, email, phone }) {
  const params = new URLSearchParams();

  // Exact field names from ToyyibPay Create Bill API.
  appendParam(params, 'userSecretKey', TOYYIBPAY_SECRET_KEY.trim());
  appendParam(params, 'categoryCode', TOYYIBPAY_CATEGORY_CODE.trim());
  appendParam(params, 'billName', cleanToyyibText(product.billName, 30));
  appendParam(params, 'billDescription', cleanToyyibText(product.billDescription, 100));
  appendParam(params, 'billPriceSetting', '1');
  appendParam(params, 'billPayorInfo', '1');
  appendParam(params, 'billAmount', product.amountCents);
  appendParam(params, 'billReturnUrl', `${SITE_URL}/`);
  appendParam(params, 'billCallbackUrl', `${SITE_URL}/api/toyyibpayfallback`);
  appendParam(params, 'billExternalReferenceNo', referenceNo);
  appendParam(params, 'billTo', name);
  appendParam(params, 'billEmail', email);
  appendParam(params, 'billPhone', phone);
  appendParam(params, 'billPaymentChannel', '0');

  return params;
}

function getHelpfulError(parsed, httpStatus) {
  if (parsed.code === 'KEY_DID_NOT_EXIST') {
    return {
      message: 'ToyyibPay kata secret key tidak wujud untuk API mode sekarang.',
      details: `ToyyibPay response: ${typeof parsed.details === 'string' ? parsed.details : JSON.stringify(parsed.details)}. Semak sama ada secret key ini daripada LIVE atau SANDBOX. Fail ini sekarang menggunakan TOYYIBPAY_MODE=${TOYYIBPAY_MODE}. Jika key/category daripada sandbox, tukar TOYYIBPAY_MODE kepada 'sandbox'. Jika untuk bayaran sebenar, salin semula LIVE Secret Key dan Category Code daripada dashboard ToyyibPay.`
    };
  }

  return {
    message: parsed.message || 'Gagal cipta bill ToyyibPay.',
    details: parsed.details,
    httpStatus
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Method not allowed. Use POST.' });
    return;
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, { message: 'Invalid JSON body.', details: error.message });
    return;
  }

  const product = PRODUCTS[body.package] || PRODUCTS['teroka-minda-ebook'];
  const name = cleanBuyerText(body.name, 80);
  const email = cleanBuyerText(body.email, 120);
  const phone = cleanBuyerText(body.phone, 30);

  if (!name || !isValidEmail(email) || !phone) {
    sendJson(res, 400, {
      message: 'Sila isi nama, email dan nombor WhatsApp yang sah.'
    });
    return;
  }

  const referenceNo = makeReferenceNo();
  const params = buildToyyibPayParams({ product, referenceNo, name, email, phone });

  try {
    const toyyibResponse = await fetch(`${TOYYIBPAY_BASE_URL}/index.php/api/createBill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, text/plain, */*'
      },
      body: params.toString()
    });

    const rawText = await toyyibResponse.text();
    const parsed = parseToyyibPayResponse(rawText);

    console.log('ToyyibPay createBill:', {
      mode: TOYYIBPAY_MODE,
      baseUrl: TOYYIBPAY_BASE_URL,
      httpStatus: toyyibResponse.status,
      httpOk: toyyibResponse.ok,
      parsedOk: parsed.ok,
      parsedCode: parsed.code || null,
      billCode: parsed.billCode || null,
      detailsPreview: typeof parsed.details === 'string' ? parsed.details.slice(0, 300) : parsed.details
    });

    if (!toyyibResponse.ok || !parsed.ok || !parsed.billCode) {
      const errorPayload = getHelpfulError(parsed, toyyibResponse.status);
      sendJson(res, 502, errorPayload);
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
