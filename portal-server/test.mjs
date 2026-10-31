import { makeEnv, worker } from './fake-do.mjs';
import { PLANS } from './worker.js';
let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };
const ORIGIN = 'https://site.example';
const env = makeEnv({ ALLOWED_ORIGIN: ORIGIN + ',http://localhost:8765', LAB_API_KEY: 'labkey-123' });
async function call(method, path, { body, token, lab, raw, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (token) h.Authorization = 'Bearer ' + token;
  if (lab) h['X-Lab-Key'] = lab;
  let b;
  if (raw) { b = raw; } else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await worker.fetch(new Request('https://api.test' + path, { method, headers: h, body: b }), env);
  const ct = res.headers.get('Content-Type') || '';
  const data = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { s: res.status, d: data, h: res.headers };
}
const LAB = 'labkey-123';

// --- register / login
let r = await call('POST', '/auth/register', { body: { name: 'A', mobile: '9876543210', password: 'longenough1' } });
ok(r.s === 400, 'register rejects short name');
r = await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '12345', password: 'longenough1' } });
ok(r.s === 400, 'register rejects bad mobile');
r = await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '9876543210', password: 'short' } });
ok(r.s === 400, 'register rejects short password');
r = await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '+91 98765 43210', password: 'Sunrise#2026' } });
ok(r.s === 201 && r.d.token && r.d.user.mobile === '9876543210', 'register ok (mobile normalised)');
const tokA = r.d.token;
r = await call('POST', '/auth/register', { body: { name: 'Other', mobile: '9876543210', password: 'Sunrise#2026' } });
ok(r.s === 400, 'duplicate mobile rejected');
r = await call('POST', '/auth/login', { body: { mobile: '9876543210', password: 'wrong-password' } });
ok(r.s === 401, 'wrong password rejected');
r = await call('POST', '/auth/login', { body: { mobile: '9876543210', password: 'Sunrise#2026' } });
ok(r.s === 200 && r.d.token, 'login ok');
r = await call('GET', '/me'); ok(r.s === 401, '/me needs token');
r = await call('GET', '/me', { token: 'abc.def' }); ok(r.s === 401, '/me rejects forged token');
r = await call('GET', '/me', { token: tokA }); ok(r.s === 200 && r.d.user.name === 'Asha Rao', '/me ok');
r = await call('POST', '/auth/register', { body: { name: 'Ravi Kumar', mobile: '9123456780', password: 'Another#Pass1' } });
const tokB = r.d.token;
for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { body: { mobile: '9123456780', password: 'nope' + i } });
r = await call('POST', '/auth/login', { body: { mobile: '9123456780', password: 'Another#Pass1' } });
ok(r.s === 429, 'lockout after 5 wrong attempts');

// --- lab api guard
r = await call('POST', '/lab/orders', { body: {}, origin: null });
ok(r.s === 401, 'lab api needs key');
r = await call('POST', '/lab/orders', { body: { mobile: '9876543210', tests: ['CBC'] }, lab: 'wrong', origin: null });
ok(r.s === 401, 'lab api rejects wrong key');

// --- orders
r = await call('POST', '/lab/orders', { lab: LAB, origin: null, body: { code: 'td-2610-0001', mobile: '9876543210', name: 'Asha Rao', tests: [{ name: 'CBC', price: 300 }, 'LIPID PROFILE'], amount: 550 } });
ok(r.s === 201 && /^\d{6}$/.test(r.d.pin) && r.d.order.code === 'TD-2610-0001', 'lab creates order and returns PIN');
const PIN = r.d.pin;
r = await call('POST', '/lab/orders', { lab: LAB, origin: null, body: { code: 'td-2610-0001', mobile: '9876543210', tests: ['X'] } });
ok(r.s === 409, 'duplicate order code rejected');
r = await call('GET', '/orders', { token: tokA }); ok(r.s === 200 && r.d.orders.length === 0, 'order not visible until linked');
r = await call('POST', '/orders/link', { token: tokA, body: { code: 'TD-2610-0001', pin: '000000' } });
ok(r.s === 404, 'link with wrong PIN fails');
r = await call('POST', '/orders/link', { token: tokB, body: { code: 'TD-2610-0001', pin: PIN } });
ok(r.s === 404, 'other customer cannot link with correct PIN (mobile mismatch)');
r = await call('POST', '/orders/link', { token: tokA, body: { code: 'td-2610-0001', pin: PIN } });
ok(r.s === 200 && r.d.order.status === 'booked', 'link with right code + PIN');
r = await call('GET', '/orders', { token: tokA }); ok(r.d.orders.length === 1 && r.d.orders[0].tests.length === 2 && !('pinHash' in r.d.orders[0]), 'orders list shows linked order without secrets');
r = await call('GET', '/orders', { token: tokB }); ok(r.d.orders.length === 0, 'other customer sees nothing');

// --- live status
for (const st of ['collected', 'processing']) {
  r = await call('POST', '/lab/orders/TD-2610-0001/status', { lab: LAB, origin: null, body: { status: st } });
  ok(r.s === 200 && r.d.order.status === st && r.d.order.times[st], 'lab sets status ' + st);
}
r = await call('POST', '/lab/orders/TD-2610-0001/status', { lab: LAB, origin: null, body: { status: 'weird' } });
ok(r.s === 400, 'invalid status rejected');
r = await call('GET', '/orders/TD-2610-0001/report', { token: tokA }); ok(r.s === 404, 'report 404 before upload');

// --- report upload / download
r = await call('PUT', '/lab/orders/TD-2610-0001/report', { lab: LAB, origin: null, raw: new TextEncoder().encode('not a pdf') });
ok(r.s === 400, 'non-PDF rejected');
const pdf = new Uint8Array(250000); pdf.set(new TextEncoder().encode('%PDF-1.4\n')); for (let i = 9; i < pdf.length; i++) pdf[i] = (i * 31) % 251;
r = await call('PUT', '/lab/orders/TD-2610-0001/report?name=asha-cbc.pdf', { lab: LAB, origin: null, raw: pdf });
ok(r.s === 200 && r.d.order.status === 'completed' && r.d.order.hasReport, 'PDF accepted, order completed');
r = await call('GET', '/orders/TD-2610-0001/report', { token: tokA });
ok(r.s === 200 && r.h.get('Content-Type') === 'application/pdf' && r.d.length === pdf.length && r.d.every((x, i) => x === pdf[i]), 'customer downloads identical PDF bytes (multi-chunk)');
r = await call('GET', '/orders/TD-2610-0001/report', { token: tokB }); ok(r.s === 404, "other customer cannot download the report");
r = await call('GET', '/orders/TD-2610-0001/report'); ok(r.s === 401, 'no token cannot download');
r = await call('PUT', '/lab/orders/TD-2610-0001/report', { lab: LAB, origin: null, raw: new Uint8Array(3 * 1024 * 1024 + 10) });
ok(r.s === 413 || r.s === 400, 'oversize file rejected');

// --- tickets
r = await call('POST', '/tickets', { token: tokA, body: { subject: 'Report mismatch', message: 'Name is spelled wrong on my report', category: 'Report' } });
ok(r.s === 201 && r.d.ticket.status === 'open', 'ticket created');
const tid = r.d.ticket.id;
r = await call('POST', '/tickets/' + tid + '/reply', { token: tokB, body: { message: 'hi' } }); ok(r.s === 404, "cannot reply to someone else's ticket");
r = await call('POST', '/lab/tickets/' + tid + '/reply', { lab: LAB, origin: null, body: { message: 'We have corrected it.', close: true } });
ok(r.s === 200 && r.d.ticket.status === 'closed', 'lab replies and closes ticket');
r = await call('POST', '/tickets/' + tid + '/reply', { token: tokA, body: { message: 'Thanks, still wrong' } });
ok(r.s === 200 && r.d.ticket.status === 'open' && r.d.ticket.msgs.length === 3, 'customer reply reopens ticket');
r = await call('GET', '/tickets', { token: tokA }); ok(r.d.tickets.length === 1, 'ticket list');
r = await call('GET', '/tickets', { token: tokB }); ok(r.d.tickets.length === 0, 'tickets are private');

// --- chat
r = await call('POST', '/chat', { token: tokA, body: { body: 'Hello, is my report ready?' } });
ok(r.s === 201 && r.d.messages.length === 2 && r.d.messages[1].from === 'staff', 'chat: message + one auto reply');
const t0 = r.d.messages[1].ts;
r = await call('POST', '/chat', { token: tokA, body: { body: 'Second message' } });
ok(r.d.messages.length === 1, 'chat: no repeated auto reply');
r = await call('POST', '/lab/chat/9876543210', { lab: LAB, origin: null, body: { body: 'Yes, it is ready.' } });
ok(r.s === 201, 'lab replies in chat');
r = await call('GET', '/chat?after=' + t0, { token: tokA });
ok(r.d.messages.some((m) => m.body === 'Yes, it is ready.') && r.d.messages.every((m) => m.ts > t0), 'customer polls and sees staff reply');
r = await call('GET', '/chat', { token: tokB }); ok(r.d.messages.length === 0, 'chat is private');
r = await call('GET', '/lab/chat', { lab: LAB, origin: null }); ok(r.d.chats.length === 1 && r.d.chats[0].mobile === '9876543210', 'lab chat inbox');

// --- membership
r = await call('GET', '/plans'); ok(r.d.plans.length === 4 && r.d.plans.map((p) => p.id).join() === 'bronze,silver,gold,platinum', 'four plans served');
r = await call('POST', '/membership', { token: tokA, body: { tier: 'diamond' } }); ok(r.s === 400, 'unknown plan rejected');
r = await call('POST', '/membership', { token: tokA, body: { tier: 'gold' } });
ok(r.s === 200 && r.d.user.membership.tier === 'gold' && r.d.user.membership.status === 'requested', 'membership request pending (not active)');
r = await call('POST', '/lab/membership', { lab: LAB, origin: null, body: { mobile: '9876543210', tier: 'gold', status: 'active' } });
ok(r.s === 200 && r.d.user.membership.status === 'active', 'lab activates membership');

// --- CORS
r = await call('GET', '/plans', { origin: 'https://evil.example' }); ok(r.s === 403, 'unknown origin blocked');
r = await call('GET', '/plans'); ok(r.h.get('Access-Control-Allow-Origin') === ORIGIN, 'CORS header for allowed origin');
r = await call('OPTIONS', '/orders', {}); ok(r.s === 204 && /Authorization/.test(r.h.get('Access-Control-Allow-Headers')), 'preflight ok');

// --- lab disabled without key
const env2 = makeEnv({ ALLOWED_ORIGIN: ORIGIN });
const res = await worker.fetch(new Request('https://api.test/lab/orders', { method: 'POST', body: '{}' }), env2);
ok(res.status === 503, 'lab api disabled when LAB_API_KEY is not set');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
