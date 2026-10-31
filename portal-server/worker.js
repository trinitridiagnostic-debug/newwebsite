/* Trinetri Diagnostics customer portal server (Cloudflare Worker + one Durable Object).
   - Customers register with mobile + password, then link their lab orders with Order ID + report PIN.
   - The lab software uses the /lab/* routes with the secret LAB_API_KEY.
   - All data lives in the Durable Object's storage. Nothing here needs a separate database. */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const STATUSES = ['booked', 'collected', 'processing', 'completed'];
export const PLANS = [
  { id: 'bronze', name: 'Bronze', price: 499, period: 'year', discount: 5, perks: ['5% off every test', 'Free home collection', 'Reports on WhatsApp'] },
  { id: 'silver', name: 'Silver', price: 999, period: 'year', discount: 10, perks: ['10% off every test', 'Free home collection', 'Priority slots', 'Reports on WhatsApp'] },
  { id: 'gold', name: 'Gold', price: 1999, period: 'year', discount: 15, perks: ['15% off every test', 'Free home collection', 'Priority slots', '1 free basic health package a year', 'Family members can use it (up to 3)'] },
  { id: 'platinum', name: 'Platinum', price: 3999, period: 'year', discount: 20, perks: ['20% off every test', 'Free home collection', 'Fastest priority slots', '2 free health packages a year', 'Family members can use it (up to 5)', 'Dedicated support contact'] },
];

class HttpErr extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpErr(400, m);

/* ---------- small helpers ---------- */
const b64u = (buf) => { const a = new Uint8Array(buf); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64uDec = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const r = atob(s), a = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; };
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
function safeEq(a, b) { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanBody = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const normMobile = (m) => { const d = String(m || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
async function pbkdf2(pw, saltB64) {
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: b64uDec(saltB64), iterations: 100000, hash: 'SHA-256' }, km, 256);
  return b64u(bits);
}

/* ---------- Worker entry: CORS, then hand every request to the one Durable Object ---------- */
function allowedOrigins(env) { return String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean); }
function corsFor(req, env) {
  const o = req.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (o && allowedOrigins(env).includes(o)) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Lab-Key';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}
export default {
  async fetch(req, env) {
    const cors = corsFor(req, env);
    const origin = req.headers.get('Origin');
    if (origin && !cors['Access-Control-Allow-Origin']) return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const stub = env.PORTAL.get(env.PORTAL.idFromName('main'));
    const res = await stub.fetch(req);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    h.set('Cache-Control', 'no-store');
    h.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers: h });
  },
};

/* ---------- the Durable Object ---------- */
export class Portal {
  constructor(state, env) { this.state = state; this.s = state.storage; this.env = env; this._secret = null; }

  json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }

  async fetch(req) {
    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const m = req.method;
      if (path === '/' && m === 'GET') return this.json({ ok: true, service: 'trinetri-portal' });
      if (path === '/plans' && m === 'GET') return this.json({ plans: PLANS, placeholder: true });
      if (path.startsWith('/lab/')) return await this.lab(req, url, path, m);
      if (path === '/auth/register' && m === 'POST') return await this.register(await this.body(req));
      if (path === '/auth/login' && m === 'POST') return await this.login(await this.body(req));
      const user = await this.authed(req);
      return await this.customer(req, url, path, m, user);
    } catch (e) {
      if (e instanceof HttpErr) return this.json({ error: e.message }, e.status);
      console.error(e && e.stack || e);
      return this.json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  }

  async body(req, max = 20000) {
    const t = await req.text();
    if (t.length > max) throw new HttpErr(413, 'Request too large');
    try { return JSON.parse(t || '{}'); } catch (e) { throw bad('Invalid request'); }
  }

  /* ---------- auth ---------- */
  async secret() {
    if (this._secret) return this._secret;
    let s = await this.s.get('secret');
    if (!s) { s = rand(32); await this.s.put('secret', s); }
    this._secret = s; return s;
  }
  async sign(payload) {
    const key = await crypto.subtle.importKey('raw', enc.encode(await this.secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const p = b64u(enc.encode(JSON.stringify(payload)));
    const sig = b64u(await crypto.subtle.sign('HMAC', key, enc.encode(p)));
    return p + '.' + sig;
  }
  async verify(token) {
    const [p, sig] = String(token || '').split('.');
    if (!p || !sig) return null;
    const key = await crypto.subtle.importKey('raw', enc.encode(await this.secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const good = b64u(await crypto.subtle.sign('HMAC', key, enc.encode(p)));
    if (!safeEq(good, sig)) return null;
    let data; try { data = JSON.parse(dec.decode(b64uDec(p))); } catch (e) { return null; }
    if (!data.e || data.e < Date.now()) return null;
    return data;
  }
  async authed(req) {
    const h = req.headers.get('Authorization') || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const d = await this.verify(t);
    if (!d) throw new HttpErr(401, 'Please log in again.');
    const u = await this.s.get('u:' + d.u);
    if (!u) throw new HttpErr(401, 'Please log in again.');
    return u;
  }
  publicUser(u) { return { id: u.id, name: u.name, mobile: u.mobile, membership: u.membership || null, created: u.created }; }

  async register(b) {
    const name = clean(b.name, 60), mobile = normMobile(b.mobile), pw = String(b.password || '');
    if (name.length < 2) throw bad('Enter your name.');
    if (!/^[6-9]\d{9}$/.test(mobile)) throw bad('Enter a valid 10-digit mobile number.');
    if (pw.length < 8 || pw.length > 100) throw bad('Use a password of at least 8 characters.');
    if (/^(\d)\1+$/.test(pw) || ['password', '12345678', 'qwertyuiop'].includes(pw.toLowerCase())) throw bad('That password is too easy to guess.');
    if (await this.s.get('m:' + mobile)) throw bad('This mobile number already has an account. Please log in.');
    const id = rand(9), salt = rand(16);
    const u = { id, name, mobile, salt, hash: await pbkdf2(pw, salt), membership: null, created: Date.now() };
    await this.s.put('u:' + id, u);
    await this.s.put('m:' + mobile, id);
    return this.json({ token: await this.sign({ u: id, e: Date.now() + 7 * 864e5 }), user: this.publicUser(u) }, 201);
  }
  async login(b) {
    const mobile = normMobile(b.mobile), pw = String(b.password || '');
    const key = 'a:' + (mobile || 'x'), a = (await this.s.get(key)) || { n: 0, until: 0 };
    if (a.until > Date.now()) throw new HttpErr(429, 'Too many wrong attempts. Try again in a few minutes.');
    const id = mobile && await this.s.get('m:' + mobile);
    const u = id && await this.s.get('u:' + id);
    let ok = false;
    if (u) ok = safeEq(await pbkdf2(pw, u.salt), u.hash);
    else await pbkdf2(pw, 'AAAAAAAAAAAAAAAAAAAAAA');   // keep timing similar
    if (!ok) {
      a.n++; if (a.n >= 5) { a.until = Date.now() + 15 * 60e3; a.n = 0; }
      await this.s.put(key, a);
      throw new HttpErr(401, 'Wrong mobile number or password.');
    }
    if (a.n || a.until) await this.s.delete(key);
    return this.json({ token: await this.sign({ u: u.id, e: Date.now() + 7 * 864e5 }), user: this.publicUser(u) });
  }

  /* ---------- orders ---------- */
  orderView(o) {
    return { id: o.id, code: o.code, tests: o.tests, amount: o.amount, status: o.status, times: o.times, created: o.created, hasReport: !!o.report, reportName: o.report ? o.report.name : null, reportSize: o.report ? o.report.size : 0 };
  }
  async ordersOf(uid) {
    const idx = await this.s.list({ prefix: 'ou:' + uid + ':' });
    const out = [];
    for (const [, id] of idx) { const o = await this.s.get('o:' + id); if (o) out.push(o); }
    out.sort((a, b) => b.created - a.created);
    return out;
  }
  async linkOrder(user, b) {
    const code = clean(b.code, 30).toUpperCase(), pin = String(b.pin || '').replace(/\D/g, '');
    if (!code || pin.length !== 6) throw bad('Enter the Order ID and the 6-digit report PIN from your receipt.');
    const k = 'la:' + user.id, a = (await this.s.get(k)) || { n: 0, until: 0 };
    if (a.until > Date.now()) throw new HttpErr(429, 'Too many wrong attempts. Try again later.');
    const id = await this.s.get('oc:' + code);
    const o = id && await this.s.get('o:' + id);
    const ok = o && o.mobile === user.mobile && safeEq(await sha(code + ':' + pin + ':' + await this.secret()), o.pinHash);
    if (!ok) {
      a.n++; if (a.n >= 6) { a.until = Date.now() + 60 * 60e3; a.n = 0; }
      await this.s.put(k, a);
      throw new HttpErr(404, 'We could not match that Order ID and PIN to your mobile number. Check your receipt or ask the lab.');
    }
    if (a.n) await this.s.delete(k);
    await this.s.put('ou:' + user.id + ':' + o.id, o.id);
    return this.orderView(o);
  }
  async mineOrder(user, code) {
    const id = await this.s.get('oc:' + String(code).toUpperCase());
    if (!id || !(await this.s.get('ou:' + user.id + ':' + id))) throw new HttpErr(404, 'Order not found.');
    return this.s.get('o:' + id);
  }
  async readReport(o) {
    const parts = [];
    for (let i = 0; i < o.report.chunks; i++) parts.push(await this.s.get('r:' + o.id + ':' + i));
    return b64uDec(parts.join('').replace(/=+$/, ''));
  }

  /* ---------- customer routes ---------- */
  async customer(req, url, path, m, user) {
    if (path === '/me' && m === 'GET') return this.json({ user: this.publicUser(user) });

    if (path === '/orders' && m === 'GET') return this.json({ orders: (await this.ordersOf(user.id)).map((o) => this.orderView(o)) });
    if (path === '/orders/link' && m === 'POST') return this.json({ order: await this.linkOrder(user, await this.body(req)) });
    let r = path.match(/^\/orders\/([^/]+)\/report$/);
    if (r && m === 'GET') {
      const o = await this.mineOrder(user, decodeURIComponent(r[1]));
      if (!o.report) throw new HttpErr(404, 'The report is not ready yet.');
      const bytes = await this.readReport(o);
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + o.code + '-report.pdf"' } });
    }

    if (path === '/tickets' && m === 'GET') {
      const out = []; for (const [, id] of await this.s.list({ prefix: 'tu:' + user.id + ':' })) { const t = await this.s.get('t:' + id); if (t) out.push(t); }
      out.sort((a, b) => b.updated - a.updated); return this.json({ tickets: out });
    }
    if (path === '/tickets' && m === 'POST') {
      const b = await this.body(req), subject = clean(b.subject, 100), msg = cleanBody(b.message, 2000), cat = clean(b.category, 30) || 'General';
      if (subject.length < 3) throw bad('Enter a subject.'); if (msg.length < 5) throw bad('Describe the problem in a few words.');
      const count = (await this.s.list({ prefix: 'tu:' + user.id + ':' })).size; if (count >= 200) throw bad('Too many tickets.');
      let id; do { id = 'TK' + String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); } while (await this.s.get('t:' + id));
      const t = { id, uid: user.id, mobile: user.mobile, name: user.name, subject, category: cat, status: 'open', created: Date.now(), updated: Date.now(), msgs: [{ from: 'customer', body: msg, ts: Date.now() }] };
      await this.s.put('t:' + id, t); await this.s.put('tu:' + user.id + ':' + id, id);
      return this.json({ ticket: t }, 201);
    }
    r = path.match(/^\/tickets\/([^/]+)\/reply$/);
    if (r && m === 'POST') {
      const id = decodeURIComponent(r[1]);
      if (!(await this.s.get('tu:' + user.id + ':' + id))) throw new HttpErr(404, 'Ticket not found.');
      const t = await this.s.get('t:' + id), msg = cleanBody((await this.body(req)).message, 2000);
      if (msg.length < 2) throw bad('Write your message.'); if (t.msgs.length >= 100) throw bad('This ticket is full. Please open a new one.');
      t.msgs.push({ from: 'customer', body: msg, ts: Date.now() }); t.status = 'open'; t.updated = Date.now();
      await this.s.put('t:' + id, t); return this.json({ ticket: t });
    }

    if (path === '/chat' && m === 'GET') {
      const after = Number(url.searchParams.get('after')) || 0;
      const all = await this.s.list({ prefix: 'c:' + user.id + ':' });
      const msgs = [...all.values()].filter((x) => x.ts > after).slice(-200);
      return this.json({ messages: msgs });
    }
    if (path === '/chat' && m === 'POST') {
      const body = cleanBody((await this.body(req)).body, 500);
      if (!body) throw bad('Type a message.');
      const rk = 'cr:' + user.id, rl = (await this.s.get(rk)) || { t: 0, n: 0 };
      const now = Date.now(); if (now - rl.t > 60e3) { rl.t = now; rl.n = 0; } rl.n++;
      if (rl.n > 20) throw new HttpErr(429, 'You are sending messages too fast.');
      await this.s.put(rk, rl);
      const mine = await this.pushChat(user.id, 'customer', body);
      const first = !(await this.s.get('cg:' + user.id));
      const out = [mine];
      if (first || now - ((await this.s.get('cg:' + user.id)) || 0) > 6 * 3600e3) {
        await this.s.put('cg:' + user.id, now);
        out.push(await this.pushChat(user.id, 'staff', 'Thank you for messaging Trinetri Diagnostics. Our team will reply here as soon as possible (Mon to Sat 7 am to 10 pm, Sun 7 am to 2 pm). For urgent help call +91 91873 15972.', 'Auto reply'));
      }
      await this.s.put('cu:' + user.id, now);
      return this.json({ messages: out }, 201);
    }

    if (path === '/membership' && m === 'POST') {
      const tier = clean((await this.body(req)).tier, 20).toLowerCase();
      const plan = PLANS.find((p) => p.id === tier); if (!plan) throw bad('Choose a plan.');
      user.membership = { tier: plan.id, status: 'requested', requested: Date.now() };
      await this.s.put('u:' + user.id, user);
      return this.json({ user: this.publicUser(user), note: 'Request received. The lab will confirm your plan after payment at the counter or on WhatsApp.' });
    }
    throw new HttpErr(404, 'Not found');
  }

  async pushChat(uid, from, body, label) {
    const ts = Date.now(), msg = { id: ts + '-' + rand(3), from, body, ts, label: label || '' };
    await this.s.put('c:' + uid + ':' + String(ts).padStart(13, '0') + rand(2), msg);
    return msg;
  }

  /* ---------- lab software routes (secret key) ---------- */
  async lab(req, url, path, m) {
    const key = this.env.LAB_API_KEY;
    if (!key) throw new HttpErr(503, 'Lab API is not enabled. Set the LAB_API_KEY secret.');
    if (!safeEq(req.headers.get('X-Lab-Key') || '', key)) throw new HttpErr(401, 'Invalid lab key.');

    if (path === '/lab/orders' && m === 'POST') {
      const b = await this.body(req), mobile = normMobile(b.mobile);
      if (!/^[6-9]\d{9}$/.test(mobile)) throw bad('Valid mobile required.');
      const tests = (Array.isArray(b.tests) ? b.tests : []).slice(0, 100).map((t) => typeof t === 'string' ? { name: clean(t, 120), price: 0 } : { name: clean(t.name, 120), price: Math.max(0, Math.round(Number(t.price) || 0)) }).filter((t) => t.name);
      if (!tests.length) throw bad('At least one test required.');
      const code = clean(b.code, 30).toUpperCase() || ('TD-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + rand(3).replace(/[-_]/g, 'X').toUpperCase().slice(0, 4));
      if (!/^[A-Z0-9-]{3,30}$/.test(code)) throw bad('Order code may contain letters, numbers and dashes only.');
      if (await this.s.get('oc:' + code)) throw new HttpErr(409, 'Order code already exists.');
      const pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      const id = rand(9), now = Date.now();
      const o = { id, code, mobile, name: clean(b.name, 60), tests, amount: Math.max(0, Math.round(Number(b.amount) || tests.reduce((a, t) => a + t.price, 0))), status: 'booked', times: { booked: now }, created: now, report: null, pinHash: await sha(code + ':' + pin + ':' + await this.secret()) };
      await this.s.put('o:' + id, o); await this.s.put('oc:' + code, id);
      return this.json({ order: this.orderView(o), pin }, 201);
    }
    let r = path.match(/^\/lab\/orders\/([^/]+)\/status$/);
    if (r && m === 'POST') {
      const o = await this.labOrder(r[1]), st = clean((await this.body(req)).status, 20).toLowerCase();
      if (!STATUSES.includes(st)) throw bad('Status must be one of: ' + STATUSES.join(', '));
      o.status = st; o.times[st] = Date.now(); await this.s.put('o:' + o.id, o);
      return this.json({ order: this.orderView(o) });
    }
    r = path.match(/^\/lab\/orders\/([^/]+)\/report$/);
    if (r && m === 'PUT') {
      const o = await this.labOrder(r[1]);
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) throw new HttpErr(413, 'Report must be under 3 MB.');
      if (dec.decode(buf.slice(0, 5)) !== '%PDF-') throw bad('Only PDF files are accepted.');
      const all = b64u(buf), CH = 90000, n = Math.ceil(all.length / CH);
      if (o.report) for (let i = 0; i < o.report.chunks; i++) await this.s.delete('r:' + o.id + ':' + i);
      for (let i = 0; i < n; i++) await this.s.put('r:' + o.id + ':' + i, all.slice(i * CH, (i + 1) * CH));
      o.report = { name: clean(url.searchParams.get('name'), 80) || (o.code + '-report.pdf'), size: buf.length, chunks: n, at: Date.now() };
      o.status = 'completed'; o.times.completed = o.times.completed || Date.now();
      await this.s.put('o:' + o.id, o);
      return this.json({ order: this.orderView(o) });
    }
    if (path === '/lab/tickets' && m === 'GET') {
      const out = []; for (const [, t] of await this.s.list({ prefix: 't:' })) if (!url.searchParams.get('status') || t.status === url.searchParams.get('status')) out.push(t);
      return this.json({ tickets: out.sort((a, b) => b.updated - a.updated).slice(0, 200) });
    }
    r = path.match(/^\/lab\/tickets\/([^/]+)\/reply$/);
    if (r && m === 'POST') {
      const t = await this.s.get('t:' + r[1]); if (!t) throw new HttpErr(404, 'Ticket not found.');
      const b = await this.body(req), msg = cleanBody(b.message, 2000); if (!msg) throw bad('Message required.');
      t.msgs.push({ from: 'staff', body: msg, ts: Date.now() }); t.status = b.close ? 'closed' : 'answered'; t.updated = Date.now();
      await this.s.put('t:' + t.id, t); return this.json({ ticket: t });
    }
    if (path === '/lab/chat' && m === 'GET') {
      const out = [];
      for (const [k, ts] of await this.s.list({ prefix: 'cu:' })) { const u = await this.s.get('u:' + k.slice(3)); if (u) out.push({ mobile: u.mobile, name: u.name, last: ts }); }
      return this.json({ chats: out.sort((a, b) => b.last - a.last) });
    }
    r = path.match(/^\/lab\/chat\/(\d{10})$/);
    if (r) {
      const id = await this.s.get('m:' + r[1]); if (!id) throw new HttpErr(404, 'No customer with this mobile.');
      if (m === 'GET') return this.json({ messages: [...(await this.s.list({ prefix: 'c:' + id + ':' })).values()].slice(-200) });
      if (m === 'POST') {
        const body = cleanBody((await this.body(req)).body, 500); if (!body) throw bad('Message required.');
        const msg = await this.pushChat(id, 'staff', body, 'Trinetri Support'); await this.s.put('cu:' + id, Date.now());
        return this.json({ message: msg }, 201);
      }
    }
    if (path === '/lab/membership' && m === 'POST') {
      const b = await this.body(req), id = await this.s.get('m:' + normMobile(b.mobile));
      if (!id) throw new HttpErr(404, 'No customer with this mobile.');
      const tier = clean(b.tier, 20).toLowerCase(); if (!PLANS.find((p) => p.id === tier)) throw bad('Unknown plan.');
      const st = b.status === 'active' ? 'active' : b.status === 'cancelled' ? 'cancelled' : 'requested';
      const u = await this.s.get('u:' + id); u.membership = { tier, status: st, since: st === 'active' ? Date.now() : undefined };
      await this.s.put('u:' + id, u); return this.json({ user: this.publicUser(u) });
    }
    throw new HttpErr(404, 'Not found');
  }
  async labOrder(code) {
    const id = await this.s.get('oc:' + decodeURIComponent(code).toUpperCase());
    const o = id && await this.s.get('o:' + id);
    if (!o) throw new HttpErr(404, 'Order not found.');
    return o;
  }
}
