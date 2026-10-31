// Integration test: starts PHP's built-in server and exercises every route. Run: node portal-php/test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const store = mkdtempSync(path.join(tmpdir(), 'portal-'));
const PORT = process.env.PORT || 8790, B = `http://127.0.0.1:${PORT}`, LAB = 'test-lab-key', ORIGIN = 'http://localhost:8765';
const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir, path.join(dir, 'index.php')], { cwd: dir, stdio: 'ignore', env: { ...process.env, PORTAL_STORAGE: store, PORTAL_LAB_KEY: LAB, PORTAL_ORIGINS: ORIGIN } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
async function call(method, p, { body, token, lab, raw, headers } = {}) {
  const h = { Origin: ORIGIN, ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token; if (lab !== undefined) h['X-Lab-Key'] = lab;
  let b; if (raw) b = raw; else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(B + p, { method, headers: h, body: b });
  const buf = Buffer.from(await r.arrayBuffer()); let j = {}; try { j = JSON.parse(buf.toString()); } catch (e) {}
  return { s: r.status, j, buf, h: r.headers };
}
try {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/'); break; } catch (e) { await new Promise((r) => setTimeout(r, 150)); } }
  let r = await call('GET', '/'); ok(r.s === 200 && r.j.ok, 'health');
  ok(r.h.get('access-control-allow-origin') === ORIGIN, 'cors allowed origin');
  r = await call('GET', '/', { headers: { Origin: 'https://evil.example' } }); ok(r.s === 403, 'cors blocks other origins');
  r = await call('OPTIONS', '/orders'); ok(r.s === 204, 'preflight');
  r = await call('GET', '/plans'); ok(r.j.plans.length === 4 && r.j.plans.map((p) => p.id).join() === 'bronze,silver,gold,platinum', 'four plans');
  ok((await call('GET', '/me')).s === 401, 'me needs login');
  ok((await call('GET', '/orders', { token: 'x.y' })).s === 401, 'bad token rejected');

  // register / login
  ok((await call('POST', '/auth/register', { body: { name: 'A', mobile: '9876543210', password: 'Strong#123' } })).s === 400, 'short name');
  ok((await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '1234567890', password: 'Strong#123' } })).s === 400, 'bad mobile');
  ok((await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '9876543210', password: 'short' } })).s === 400, 'short password');
  ok((await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '9876543210', password: '11111111' } })).s === 400, 'weak password');
  r = await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '+91 98765 43210', password: 'Strong#123' } });
  ok(r.s === 201 && r.j.token && r.j.user.mobile === '9876543210' && !r.j.user.hash, 'register ok, no hash leaked');
  const tok = r.j.token;
  ok((await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: '9876543210', password: 'Strong#123' } })).s === 400, 'duplicate mobile');
  r = await call('POST', '/auth/login', { body: { mobile: '9876543210', password: 'Strong#123' } }); ok(r.s === 200 && r.j.token, 'login ok');
  ok((await call('GET', '/me', { token: tok })).j.user.name === 'Asha Rao', 'me');
  // lockout
  for (let i = 0; i < 5; i++) r = await call('POST', '/auth/login', { body: { mobile: '9000000001', password: 'nope-nope' } });
  ok(r.s === 401, 'wrong login 401');
  r = await call('POST', '/auth/login', { body: { mobile: '9000000001', password: 'nope-nope' } }); ok(r.s === 429, 'lockout after 5');

  // lab auth
  ok((await call('POST', '/lab/orders', { body: {} })).s === 401, 'lab needs key');
  ok((await call('POST', '/lab/orders', { lab: 'wrong', body: {} })).s === 401, 'lab wrong key');
  ok((await call('POST', '/lab/orders', { lab: LAB, body: { mobile: '123', tests: ['CBC'] } })).s === 400, 'lab bad mobile');
  ok((await call('POST', '/lab/orders', { lab: LAB, body: { mobile: '9876543210', tests: [] } })).s === 400, 'lab no tests');
  r = await call('POST', '/lab/orders', { lab: LAB, body: { code: 'td-e2e-0001', mobile: '9876543210', name: 'Asha Rao', tests: [{ name: 'CBC', price: 300 }, 'LIPID PROFILE'] } });
  ok(r.s === 201 && r.j.order.code === 'TD-E2E-0001' && /^\d{6}$/.test(r.j.pin) && r.j.order.amount === 300 && r.j.order.status === 'booked', 'lab creates order');
  const pin = r.j.pin; const code = 'TD-E2E-0001';
  ok(!('pinHash' in r.j.order) && !('mobile' in r.j.order), 'order view hides internals');
  ok((await call('POST', '/lab/orders', { lab: LAB, body: { code, mobile: '9876543210', tests: ['CBC'] } })).s === 409, 'duplicate code');
  r = await call('POST', '/lab/orders', { lab: LAB, body: { mobile: '9123456789', tests: ['TSH'] } }); ok(/^TD-\d{6}-[A-Z0-9]{4}$/.test(r.j.order.code), 'auto code ' + r.j.order.code);
  const otherCode = r.j.order.code, otherPin = r.j.pin;

  // link orders
  ok((await call('GET', '/orders', { token: tok })).j.orders.length === 0, 'no orders before link');
  ok((await call('POST', '/orders/link', { token: tok, body: { code, pin: '000000' } })).s === 404, 'wrong pin');
  ok((await call('POST', '/orders/link', { token: tok, body: { code: otherCode, pin: otherPin } })).s === 404, 'cannot link another mobile\'s order');
  ok((await call('POST', '/orders/link', { token: tok, body: { code, pin: '12' } })).s === 400, 'short pin');
  r = await call('POST', '/orders/link', { token: tok, body: { code: code.toLowerCase(), pin } }); ok(r.s === 200 && r.j.order.code === code, 'link ok');
  r = await call('GET', '/orders', { token: tok }); ok(r.j.orders.length === 1 && r.j.orders[0].tests.length === 2 && !r.j.orders[0].hasReport, 'order listed');
  await call('POST', '/orders/link', { token: tok, body: { code, pin } }); ok((await call('GET', '/orders', { token: tok })).j.orders.length === 1, 'link is idempotent');

  // status
  ok((await call('POST', `/lab/orders/${code}/status`, { lab: LAB, body: { status: 'nonsense' } })).s === 400, 'bad status');
  for (const st of ['collected', 'processing']) {
    r = await call('POST', `/lab/orders/${code}/status`, { lab: LAB, body: { status: st } });
    ok(r.s === 200 && r.j.order.status === st && r.j.order.times[st] > 0, 'status ' + st);
  }
  r = await call('GET', '/orders', { token: tok }); ok(r.j.orders[0].status === 'processing' && Object.keys(r.j.orders[0].times).length === 3, 'customer sees status + times');
  ok((await call('GET', `/orders/${code}/report`, { token: tok })).s === 404, 'report not ready');

  // report
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256)), Buffer.from('\n%%EOF')]);
  ok((await call('PUT', `/lab/orders/${code}/report`, { lab: LAB, raw: Buffer.from('not a pdf') })).s === 400, 'non-pdf rejected');
  ok((await call('PUT', `/lab/orders/${code}/report`, { lab: LAB, raw: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(3 * 1024 * 1024)]) })).s === 413, 'over 3 MB rejected');
  r = await call('PUT', `/lab/orders/${code}/report?name=Asha-CBC.pdf`, { lab: LAB, raw: pdf }); ok(r.s === 200 && r.j.order.hasReport && r.j.order.status === 'completed' && r.j.order.reportName === 'Asha-CBC.pdf' && r.j.order.reportSize === pdf.length, 'report uploaded, order completed');
  r = await call('GET', `/orders/${code}/report`, { token: tok }); ok(r.s === 200 && r.h.get('content-type') === 'application/pdf' && Buffer.compare(r.buf, pdf) === 0, 'report downloads byte-identical');
  r = await call('POST', '/auth/register', { body: { name: 'Other Person', mobile: '9123456789', password: 'Another#456' } });
  ok((await call('GET', `/orders/${code}/report`, { token: r.j.token })).s === 404, 'other customer cannot read report');

  // tickets
  ok((await call('POST', '/tickets', { token: tok, body: { subject: 'x', message: 'short' } })).s === 400, 'ticket subject too short');
  r = await call('POST', '/tickets', { token: tok, body: { subject: 'Report not clear', message: 'Please explain my CBC values', category: 'Reports' } });
  ok(r.s === 201 && /^TK\d{6}$/.test(r.j.ticket.id) && r.j.ticket.status === 'open' && r.j.ticket.msgs.length === 1, 'ticket created');
  const tid = r.j.ticket.id;
  r = await call('GET', '/lab/tickets?status=open', { lab: LAB }); ok(r.j.tickets.some((t) => t.id === tid), 'lab sees open ticket');
  r = await call('POST', `/lab/tickets/${tid}/reply`, { lab: LAB, body: { message: 'Doctor will call you today' } }); ok(r.s === 200 && r.j.ticket.status === 'answered' && r.j.ticket.msgs[1].from === 'staff', 'lab replies');
  r = await call('POST', `/tickets/${tid}/reply`, { token: tok, body: { message: 'Thanks!' } }); ok(r.s === 200 && r.j.ticket.status === 'open' && r.j.ticket.msgs.length === 3, 'customer replies, reopens');
  r = await call('GET', '/tickets', { token: tok }); ok(r.j.tickets.length === 1 && r.j.tickets[0].msgs[2].body === 'Thanks!', 'tickets list');
  const t2 = (await call('POST', '/auth/login', { body: { mobile: '9123456789', password: 'Another#456' } })).j.token;
  ok((await call('POST', `/tickets/${tid}/reply`, { token: t2, body: { message: 'hijack' } })).s === 404, 'cannot reply to others\' ticket');
  ok((await call('GET', '/tickets', { token: t2 })).j.tickets.length === 0, 'tickets are private');
  r = await call('POST', `/lab/tickets/${tid}/reply`, { lab: LAB, body: { message: 'Closing now', close: true } }); ok(r.j.ticket.status === 'closed', 'lab closes ticket');

  // chat
  r = await call('POST', '/chat', { token: tok, body: { body: 'Hello lab' } }); ok(r.s === 201 && r.j.messages.length === 2 && r.j.messages[1].from === 'staff' && r.j.messages[1].label === 'Auto reply', 'chat send + auto reply');
  const last = r.j.messages[1].ts;
  r = await call('POST', '/chat', { token: tok, body: { body: 'Another one' } }); ok(r.j.messages.length === 1, 'no second auto reply');
  r = await call('GET', '/chat?after=0', { token: tok }); ok(r.j.messages.length === 3, 'chat history');
  r = await call('GET', '/chat?after=' + last, { token: tok }); ok(r.j.messages.length === 1 && r.j.messages[0].body === 'Another one', 'chat after filter');
  r = await call('GET', '/lab/chat', { lab: LAB }); ok(r.j.chats.length === 1 && r.j.chats[0].mobile === '9876543210', 'lab chat list');
  r = await call('POST', '/lab/chat/9876543210', { lab: LAB, body: { body: 'Hi Asha, how can we help?' } }); ok(r.s === 201 && r.j.message.from === 'staff', 'lab chat reply');
  r = await call('GET', '/chat?after=' + last, { token: tok }); ok(r.j.messages.length === 2 && r.j.messages[1].from === 'staff', 'customer sees staff reply');
  ok((await call('GET', '/lab/chat/9000000000', { lab: LAB })).s === 404, 'lab chat unknown mobile');
  ok((await call('POST', '/chat', { token: tok, body: { body: '   ' } })).s === 400, 'empty chat rejected');
  let lim; for (let i = 0; i < 20; i++) lim = await call('POST', '/chat', { token: tok, body: { body: 'spam ' + i } }); ok(lim.s === 429, 'chat rate limit');

  // membership
  ok((await call('POST', '/membership', { token: tok, body: { tier: 'diamond' } })).s === 400, 'unknown plan');
  r = await call('POST', '/membership', { token: tok, body: { tier: 'Gold' } }); ok(r.s === 200 && r.j.user.membership.tier === 'gold' && r.j.user.membership.status === 'requested', 'membership requested');
  r = await call('POST', '/lab/membership', { lab: LAB, body: { mobile: '9876543210', tier: 'gold', status: 'active' } }); ok(r.j.user.membership.status === 'active' && r.j.user.membership.since > 0, 'lab activates');
  ok((await call('GET', '/me', { token: tok })).j.user.membership.status === 'active', 'customer sees active plan');
  ok((await call('GET', '/nothing', { token: tok })).s === 404, '404 for unknown route');
} catch (e) { fail++; console.log('ERROR', e); }
srv.kill(); rmSync(store, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
