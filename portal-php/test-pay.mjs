// Razorpay QR payment + invoice tests with a mock Razorpay/AiSensy. Run: node portal-php/test-pay.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'pay-'));
const P1 = Number(process.env.PORT || 8830), P2 = P1 + 1, B = `http://127.0.0.1:${P1}`, ORIGIN = 'http://localhost:8765', WH = 'whsec';
const LOG = path.join(tmp, 'p.log'), PAID = path.join(tmp, 'paid'), store = mkdtempSync(path.join(tmpdir(), 'st-'));
writeFileSync(path.join(tmp, 'mock.php'), `<?php
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); $body = file_get_contents('php://input');
file_put_contents('${LOG}', json_encode(['path' => $p, 'm' => $_SERVER['REQUEST_METHOD'], 'auth' => $_SERVER['PHP_AUTH_USER'] ?? '', 'body' => json_decode($body, true)]) . "\\n", FILE_APPEND);
if (preg_match('#/payments/qr_codes$#', $p)) { echo json_encode(['id' => 'qr_' . substr(md5($body . microtime()), 0, 8), 'image_url' => 'https://rzp.test/qr.png']); exit; }
if (preg_match('#/qr_codes/([^/]+)/payments$#', $p, $m)) { echo json_encode(['items' => file_exists('${PAID}') ? [['id' => 'pay_POLL1', 'status' => 'captured', 'amount' => (int)file_get_contents('${PAID}')]] : []]); exit; }
echo json_encode(['ok' => true]);`);
const srv = spawn('php', ['-S', `127.0.0.1:${P1}`, '-t', dir, path.join(dir, 'index.php')], { cwd: dir, stdio: 'ignore', env: { ...process.env, PORTAL_STORAGE: store, PORTAL_LAB_KEY: 'k', PORTAL_ORIGINS: ORIGIN, PORTAL_OTP_PROVIDER: 'dev', PORTAL_OTP_COOLDOWN: '0',
  PORTAL_RZP_KEY: 'rzp_test_k', PORTAL_RZP_SECRET: 'sek', PORTAL_RZP_WEBHOOK: WH, PORTAL_RZP_BASE: `http://127.0.0.1:${P2}/v1`, PORTAL_AISENSY_KEY: 'ak', PORTAL_AISENSY_BASE: `http://127.0.0.1:${P2}`, PORTAL_AISENSY_INVOICE: 'invoice_01', PORTAL_PUBLIC_URL: 'https://trinetridiagnostics.com' } });
const mock = spawn('php', ['-S', `127.0.0.1:${P2}`, path.join(tmp, 'mock.php')], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
async function call(method, p, { body, token, raw, headers } = {}) {
  const h = { Origin: ORIGIN, ...(headers || {}) }; if (token) h.Authorization = 'Bearer ' + token; let b = raw; if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(B + p, { method, headers: h, body: b }); const buf = Buffer.from(await r.arrayBuffer()); let j = {}; try { j = JSON.parse(buf.toString()); } catch (e) {} return { s: r.status, j, buf };
}
const hook = (obj, sig) => { const raw = JSON.stringify(obj); return call('POST', '/pay/webhook', { raw, headers: { 'X-Razorpay-Signature': sig || createHmac('sha256', WH).update(raw).digest('hex'), 'Content-Type': 'application/json' } }); };
try {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/'); await fetch(`http://127.0.0.1:${P2}/x`); break; } catch (e) { await sleep(150); } }
  let r = await call('POST', '/staff/setup', { body: { name: 'Owner', username: 'owner', password: 'Owner#2026', setup_code: 'k' } }); const A = r.j.token;
  await call('POST', '/staff/users', { token: A, body: { username: 'ph1', role: 'phlebotomist', name: 'Suresh', password: 'Staff#2026' } });
  await call('POST', '/staff/users', { token: A, body: { username: 'ph2', role: 'phlebotomist', name: 'Mahesh', password: 'Staff#2026' } });
  const PH = (await call('POST', '/staff/login', { body: { username: 'ph1', password: 'Staff#2026' } })).j.token, PH2 = (await call('POST', '/staff/login', { body: { username: 'ph2', password: 'Staff#2026' } })).j.token;
  const ph1 = (await call('GET', '/staff/phlebs', { token: A })).j.phlebs.find((x) => x.name === 'Suresh');
  r = await call('POST', '/staff/orders', { token: A, body: { name: 'Linga Gouda', mobile: '9811111111', kind: 'home', address: 'Gadag', slot: Date.now() + 3600000, tests: [{ name: 'LIPID PROFILE', price: 250 }, { name: 'CBC', price: 300 }], discount: 50 } });
  const code = r.j.order.code, pin1 = r.j.pin; ok(r.j.order.due === 500, 'order due 500');
  await call('POST', `/staff/orders/${code}/assign`, { token: A, body: { phleb: ph1.id } });
  r = await call('POST', '/staff/orders', { token: A, body: { name: 'Auto Assign', mobile: '9833333333', kind: 'home', address: 'X', phleb: ph1.id, tests: [{ name: 'CBC', price: 300 }] } }); ok(r.s === 201 && r.j.order.ph_id === ph1.id && r.j.order.ph_status === 'assigned', 'new order created already assigned to the phlebotomist');
  ok((await call('GET', '/staff/phleb/orders?scope=mine', { token: PH })).j.orders.some((o) => o.code === r.j.order.code), 'it shows in the phlebotomist app');
  ok((await call('POST', '/staff/orders', { token: A, body: { name: 'Bad Pick', mobile: '9833333334', kind: 'home', phleb: 'nope', tests: [{ name: 'CBC', price: 300 }] } })).s === 400, 'unknown phlebotomist refused');
  r = await call('POST', '/staff/orders', { token: A, body: { name: 'Doc Test', mobile: '9833333336', ref_doctor: 'Dr. ANIL TAMMANNAVAR (DR007)', ref_doc_mobile: '94482 36254', tests: [{ name: 'CBC', price: 300 }] } }); ok(r.j.order.ref_doctor.startsWith('Dr. ANIL') && r.j.order.ref_doc_mobile === '9448236254', 'referring doctor and number saved');
  r = await call('POST', `/staff/orders/${r.j.order.code}/update`, { token: A, body: { name: 'Doc Test', ref_doctor: '', ref_doc_mobile: '9448236254' } }); ok(r.j.order.ref_doctor === '' && r.j.order.ref_doc_mobile === '', 'Self clears the doctor number');
  r = await call('POST', '/staff/orders', { token: A, body: { name: 'Walk In', mobile: '9833333335', kind: 'walk-in', phleb: ph1.id, tests: [{ name: 'CBC', price: 300 }] } }); ok(r.s === 201 && !r.j.order.ph_id, 'walk-in order ignores phlebotomist');
  r = await call('POST', `/staff/phleb/orders/${code}/payqr`, { token: PH }); ok(r.s === 400, 'QR refused before sample collected');
  await call('POST', `/staff/phleb/orders/${code}/accept`, { token: PH }); await call('POST', `/staff/phleb/orders/${code}/verifypin`, { token: PH, body: { pin: pin1 } }); await call('POST', `/staff/phleb/orders/${code}/collected`, { token: PH });
  ok((await call('POST', `/staff/phleb/orders/${code}/payqr`, { token: PH2 })).s === 404, 'other phlebotomist cannot take payment');
  r = await call('POST', `/staff/phleb/orders/${code}/payqr`, { token: PH }); ok(r.s === 200 && r.j.qr.image_url === 'https://rzp.test/qr.png' && r.j.qr.amount === 500, 'QR created for the due amount');
  const cr = log().find((l) => l.path.endsWith('/payments/qr_codes')); ok(cr.auth === 'rzp_test_k' && cr.body.payment_amount === 50000 && cr.body.usage === 'single_use' && cr.body.fixed_amount === true && cr.body.notes.order === code, 'Razorpay got a fixed single-use 500 rupee QR');
  const qid = r.j.qr.qr_id; const n1 = log().length; r = await call('POST', `/staff/phleb/orders/${code}/payqr`, { token: PH }); ok(r.j.qr.qr_id === qid && log().length === n1, 'fresh QR is reused');
  r = await call('GET', `/staff/phleb/orders/${code}/paystatus`, { token: PH }); ok(r.s === 200 && r.j.paid_online === false && r.j.order.due === 500, 'poll: not paid yet');
  ok((await hook({ event: 'qr_code.credited', payload: {} }, 'bad')).s === 400, 'bad webhook signature refused');
  const ev = { event: 'qr_code.credited', payload: { qr_code: { entity: { id: qid } }, payment: { entity: { id: 'pay_WH1', status: 'captured', amount: 50000, notes: {} } } } };
  r = await hook(ev); ok(r.s === 200, 'valid webhook accepted');
  r = await call('GET', `/staff/phleb/orders/${code}/paystatus`, { token: PH }); ok(r.j.paid_online === true && r.j.order.due === 0 && r.j.order.pay_mode === 'online', 'order marked paid online');
  let wa = log().filter((l) => l.path.endsWith('/campaign/t1/api/v2')); ok(wa.length === 1 && wa[0].body.campaignName === 'invoice_01' && wa[0].body.destination === '919811111111' && wa[0].body.templateParams.length === 4 && wa[0].body.templateParams[2] === 'Rs. 500', 'invoice sent on WhatsApp once');
  const url = new URL(wa[0].body.media.url); r = await call('GET', url.pathname.replace('/portal-api', '') + url.search); ok(r.s === 200 && r.buf.subarray(0, 5).toString() === '%PDF-', 'signed invoice link serves a PDF');
  r = await call('GET', url.pathname.replace('/portal-api', '') + url.search.replace(/s=.*/, 's=bad')); ok(r.s === 404, 'bad invoice signature refused');
  await hook(ev); wa = log().filter((l) => l.path.endsWith('/campaign/t1/api/v2')); ok(wa.length === 1, 'webhook replay is idempotent (no second invoice)');
  r = await call('GET', `/staff/orders/${code}`, { token: A }); ok(r.j.order.paid === 500 && r.j.order.pay_mode === 'online', 'lab sees paid 500 online');
  ok((await call('POST', `/staff/phleb/orders/${code}/payqr`, { token: PH })).s === 400, 'no QR when nothing is due');
  r = await call('GET', `/staff/orders/${code}/invoice`, { token: A }); ok(r.s === 200 && r.buf.subarray(0, 5).toString() === '%PDF-', 'lab downloads the invoice');
  ok((await call('GET', `/staff/orders/${code}/invoice`, { token: PH })).s === 403, 'phlebotomist cannot use lab invoice route');
  r = await call('POST', `/staff/orders/${code}/sendinvoice`, { token: A }); ok(r.s === 200 && log().filter((l) => l.path.endsWith('/campaign/t1/api/v2')).length === 2, 'lab can resend the invoice');
  // second order: confirmed by polling Razorpay (webhook late)
  r = await call('POST', '/staff/orders', { token: A, body: { name: 'Vaishak B', mobile: '9822222222', kind: 'home', address: 'Betageri', slot: Date.now() + 7200000, tests: [{ name: 'CBC', price: 300 }], paid: 100, pay_mode: 'cash' } }); const c2 = r.j.order.code, pin2 = r.j.pin;
  await call('POST', `/staff/orders/${c2}/assign`, { token: A, body: { phleb: ph1.id } }); await call('POST', `/staff/phleb/orders/${c2}/verifypin`, { token: PH, body: { pin: pin2 } }); await call('POST', `/staff/phleb/orders/${c2}/collected`, { token: PH });
  r = await call('POST', `/staff/phleb/orders/${c2}/payqr`, { token: PH }); ok(r.j.qr.amount === 200, 'QR is for the balance only');
  writeFileSync(PAID, '20000'); r = await call('GET', `/staff/phleb/orders/${c2}/paystatus`, { token: PH }); ok(r.j.paid_online === true && r.j.order.paid === 300, 'polling Razorpay marks it paid');
  console.log(`${pass} passed, ${fail} failed`);
} finally { srv.kill(); mock.kill(); }
process.exit(fail ? 1 : 0);
