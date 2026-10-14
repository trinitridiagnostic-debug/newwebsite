// Trinetri Diagnostics - Razorpay order server (Cloudflare Worker, no dependencies).
// Endpoints:  POST /create-order   POST /verify-payment
// Secrets (never put these in the website):  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
// Plain variable:  ALLOWED_ORIGIN  (your website address, e.g. https://www.trinetridiagnostics.com)
import { PACKAGES, TESTS } from './prices.js';

const MAX_ITEMS = 60;
const MAX_RUPEES = 100000;

function cors(env, req) {
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    },
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// Price comes from this server's table, never from the browser.
export function priceOrder(body) {
  const pkg = typeof body.package === 'string' ? body.package.trim() : '';
  const tests = Array.isArray(body.tests) ? body.tests : [];
  if (tests.length > MAX_ITEMS) return { error: 'Too many tests in one order.' };
  let rupees = 0;
  if (pkg) {
    if (!Object.prototype.hasOwnProperty.call(PACKAGES, pkg)) return { error: 'This package cannot be paid online. Pay at collection.' };
    rupees += PACKAGES[pkg];
  }
  const seen = new Set();
  for (const code of tests) {
    if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(TESTS, code)) return { error: 'Unknown test: ' + String(code).slice(0, 30) };
    if (seen.has(code)) continue;
    seen.add(code);
    rupees += TESTS[code];
  }
  if (rupees <= 0) return { error: 'Nothing to pay for.' };
  if (rupees > MAX_RUPEES) return { error: 'Amount too large for online payment.' };
  return { rupees, pkg, codes: [...seen] };
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(req, env) {
    const c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (!c.ok) return json({ error: 'Origin not allowed.' }, 403, c.headers);
    const url = new URL(req.url);
    if (req.method !== 'POST') return json({ error: 'Not found.' }, 404, c.headers);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'Bad request.' }, 400, c.headers); }

    if (url.pathname === '/create-order') {
      const p = priceOrder(body);
      if (p.error) return json({ error: p.error }, 400, c.headers);
      const notes = {
        name: String(body.name || '').slice(0, 60),
        phone: String(body.phone || '').replace(/\D/g, '').slice(0, 15),
        package: p.pkg,
        tests: p.codes.join(',').slice(0, 250),
      };
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET),
        },
        body: JSON.stringify({ amount: p.rupees * 100, currency: 'INR', receipt: 'trin_' + Date.now(), notes }),
      });
      const o = await r.json().catch(() => ({}));
      if (!r.ok || !o.id) return json({ error: 'Could not start payment. Please try again.' }, 502, c.headers);
      return json({ order_id: o.id, amount: o.amount, currency: o.currency }, 200, c.headers);
    }

    if (url.pathname === '/verify-payment') {
      const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = body;
      if (![oid, pid, sig].every(v => typeof v === 'string' && v.length > 5 && v.length < 200)) return json({ verified: false }, 400, c.headers);
      const expect = await hmacHex(env.RAZORPAY_KEY_SECRET, oid + '|' + pid);
      return json({ verified: safeEqual(expect, sig.toLowerCase()) }, 200, c.headers);
    }
    return json({ error: 'Not found.' }, 404, c.headers);
  },
};
