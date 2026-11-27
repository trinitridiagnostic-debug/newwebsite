// Doctor partner app tests with a mock Razorpay/AiSensy. Run: node portal-php/test-dr.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'dr-'));
const P1 = Number(process.env.PORT || 8850), P2 = P1 + 1, B = `http://127.0.0.1:${P1}`, ORIGIN = 'http://localhost:8765', WH = 'whsec';
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
  r = await call('POST', '/staff/users', { token: A, body: { username: 'drravi', role: 'doctor', name: 'Dr Ravi', password: 'Staff#2026' } }); ok(r.s === 201, 'admin creates a doctor partner');
  await call('POST', '/staff/users', { token: A, body: { username: 'drsita', role: 'doctor', name: 'Dr Sita', password: 'Staff#2026' } });
  await call('POST', '/staff/users', { token: A, body: { username: 'rec1', role: 'reception', name: 'Rec', password: 'Staff#2026' } });
  const DR = (await call('POST', '/staff/login', { body: { username: 'drravi', password: 'Staff#2026' } })).j.token, DR2 = (await call('POST', '/staff/login', { body: { username: 'drsita', password: 'Staff#2026' } })).j.token, REC = (await call('POST', '/staff/login', { body: { username: 'rec1', password: 'Staff#2026' } })).j.token;
  // role limits
  ok((await call('GET', '/staff/orders', { token: DR })).s === 403, 'doctor cannot open lab orders');
  ok((await call('GET', '/staff/b2b', { token: DR })).s === 403, 'doctor cannot open the B2B admin');
  ok((await call('GET', '/staff/b2b', { token: REC })).s === 403, 'reception cannot open the B2B admin');
  ok((await call('GET', '/staff/dr/home', { token: REC })).s === 403, 'reception cannot use the doctor app');
  ok((await call('GET', '/staff/me', { token: DR })).j.staff.role === 'doctor', 'doctor can read own profile');
  // B2B upload
  ok((await call('POST', '/staff/b2b', { token: DR, body: { rows: [{ key: 'T:1', name: 'x', price: 1 }] } })).s === 403, 'doctor cannot upload prices');
  ok((await call('POST', '/staff/b2b', { token: A, body: { rows: [] } })).s === 400, 'empty upload refused');
  r = await call('POST', '/staff/b2b', { token: A, body: { rows: [{ key: 'A:1', name: 'CBC', price: 150, mrp: 350 }, { key: 'A:2', name: 'LIPID PROFILE', price: 200, mrp: 500 }, { key: 'K:9', name: 'Full Body Checkup', price: 900 }, { key: 'X:bad', name: 'Zero', price: 0 }, { key: '', name: 'nokey', price: 5 }] } });
  ok(r.s === 200 && r.j.saved === 3 && r.j.count === 3, 'upload saves 3 valid rows, skips 2 bad');
  r = await call('POST', '/staff/b2b', { token: A, body: { rows: [{ key: 'A:1', name: 'CBC', price: 140, mrp: 350 }] } }); ok(r.j.count === 3, 'second upload updates, not duplicates');
  { const pr = (await call('GET', '/staff/dr/prices', { token: DR })).j.prices; ok(pr.find((p) => p.key === 'A:1').price === 140 && pr.find((p) => p.key === 'A:1').mrp === 350 && pr.find((p) => p.key === 'A:2').mrp === 500 && pr.find((p) => p.key === 'K:9').mrp === 0, 'doctor sees B2B and MRP'); }
  // booking validation
  const slot = Date.now() + 86400000, base = { name: 'Gopal', mobile: '9811000001', age: 44, sex: 'M', address: 'Near bus stand, Betageri', slot, tests: ['A:1', 'A:2'], price: 600 };
  ok((await call('POST', '/staff/dr/bookings', { token: DR, body: { ...base, price: 300 } })).s === 400, 'price below B2B (340) refused');
  ok((await call('POST', '/staff/dr/bookings', { token: DR, body: { ...base, tests: ['A:1', 'NOPE'] } })).s === 400, 'test not on the price list refused');
  ok((await call('POST', '/staff/dr/bookings', { token: DR, body: { ...base, mobile: '123' } })).s === 400, 'bad mobile refused');
  ok((await call('POST', '/staff/dr/bookings', { token: DR, body: { ...base, slot: Date.now() - 86400000 } })).s === 400, 'past slot refused');
  ok((await call('POST', '/staff/dr/bookings', { token: DR, body: { ...base, address: 'x' } })).s === 400, 'short address refused');
  r = await call('POST', '/staff/dr/bookings', { token: DR, body: base }); const bk = r.j.booking;
  ok(r.s === 201 && bk.b2b === 340 && bk.price === 600 && bk.commission === 260 && bk.status === 'awaiting_payment', 'booking: B2B 340, charge 600, commission 260');
  ok(!(await call('GET', '/staff/orders', { token: A })).j.orders.some((o) => o.name === 'Gopal'), 'no lab order until the QR is paid');
  // QR
  r = await call('POST', `/staff/dr/bookings/${bk.id}/qr`, { token: DR }); ok(r.s === 200 && r.j.qr.amount === 340 && r.j.qr.image_url.includes('qr.png'), 'QR is for the B2B amount only (340)');
  const qrCall = log().filter((l) => l.path.endsWith('/qr_codes')).pop(); ok(qrCall && qrCall.body.payment_amount === 34000 && qrCall.body.fixed_amount === true, 'Razorpay asked for 340 rupees fixed');
  ok((await call('POST', `/staff/dr/bookings/${bk.id}/qr`, { token: DR2 })).s === 404, 'another doctor cannot touch it');
  r = await call('GET', `/staff/dr/bookings/${bk.id}/status`, { token: DR }); ok(r.j.paid === false, 'not paid yet');
  // pay: partial amount must not confirm
  writeFileSync(PAID, '10000'); r = await call('GET', `/staff/dr/bookings/${bk.id}/status`, { token: DR }); ok(r.j.paid === false, 'underpayment does not confirm');
  writeFileSync(PAID, '34000'); r = await call('GET', `/staff/dr/bookings/${bk.id}/status`, { token: DR }); ok(r.j.paid === true && r.j.booking.status === 'confirmed' && r.j.booking.order_code && /^\d{6}$/.test(r.j.booking.pin), 'paid: confirmed, order created, PIN shown to doctor');
  const code = r.j.booking.order_code; r = await call('GET', `/staff/orders/${code}`, { token: A }); const o = r.j.order;
  ok(o && o.kind === 'home' && o.amount === 340 && o.paid === 340 && o.due === 0 && o.name === 'Gopal' && o.ref_doctor === 'Dr Ravi', 'lab order: home visit, 340 fully paid, referred by Dr Ravi');
  ok(/Do NOT collect/.test(o.notes || '') && /Rs 600/.test(o.notes || ''), 'lab note says do not collect money from patient');
  ok((await call('GET', `/staff/dr/bookings/${bk.id}/status`, { token: DR })).j.paid === true && (await call('GET', '/staff/orders', { token: A })).j.orders.filter((x) => x.name === 'Gopal').length === 1, 'checking again does not create a second order');
  // webhook idempotent on the same booking
  const b2 = (await call('POST', '/staff/dr/bookings', { token: DR, body: { ...base, name: 'Hema', mobile: '9811000002', tests: ['K:9'], price: 1200 } })).j.booking;
  const q2 = (await call('POST', `/staff/dr/bookings/${b2.id}/qr`, { token: DR })).j.qr; ok(q2.amount === 900, 'second QR for package 900');
  const ev = { event: 'qr_code.credited', payload: { qr_code: { entity: { id: q2.qr_id } }, payment: { entity: { id: 'pay_WH1', status: 'captured', amount: 90000, notes: { dr_booking: b2.id } } } } };
  ok((await hook(ev, 'bad')).s === 400, 'webhook with bad signature refused');
  ok((await hook(ev)).s === 200, 'webhook accepted'); await hook(ev);
  r = await call('GET', `/staff/dr/bookings/${b2.id}`, { token: DR }); ok(r.j.booking.status === 'confirmed', 'webhook confirms the booking');
  ok((await call('GET', '/staff/orders', { token: A })).j.orders.filter((x) => x.name === 'Hema').length === 1, 'webhook twice gives one order');
  // cancel
  const b3 = (await call('POST', '/staff/dr/bookings', { token: DR, body: { ...base, name: 'Cancel Me', mobile: '9811000003' } })).j.booking;
  ok((await call('POST', `/staff/dr/bookings/${b3.id}/cancel`, { token: DR })).s === 200, 'unpaid booking can be cancelled');
  ok((await call('POST', `/staff/dr/bookings/${bk.id}/cancel`, { token: DR })).s === 400, 'paid booking cannot be cancelled');
  ok((await call('POST', `/staff/dr/bookings/${b3.id}/qr`, { token: DR })).s === 400, 'cancelled booking gets no QR');
  // earnings
  r = await call('GET', '/staff/dr/home', { token: DR }); const e = r.j.earnings; ok(e.bookings === 2 && e.commission === 260 + 300 && e.paid_to_lab === 1240 && e.collected === 1800 && e.prices === undefined && r.j.prices === 3, 'earnings: 2 paid bookings, commission 560, paid to lab 1240');
  ok((await call('GET', '/staff/dr/home', { token: DR2 })).j.earnings.bookings === 0, 'other doctor sees nothing of it');
  // lab side overview
  r = await call('GET', '/staff/drbookings', { token: A }); ok(r.j.bookings.length === 3 && r.j.doctors.length === 1 && r.j.doctors[0].commission === 560 && r.j.doctors[0].name === 'Dr Ravi', 'lab overview per doctor');
  ok((await call('GET', '/staff/drbookings', { token: REC })).s === 403, 'reception cannot see doctor money');
  // phlebotomist can be assigned as usual
  await call('POST', '/staff/users', { token: A, body: { username: 'ph1', role: 'phlebotomist', name: 'Suresh', password: 'Staff#2026' } });
  const ph1 = (await call('GET', '/staff/phlebs', { token: A })).j.phlebs[0]; r = await call('POST', `/staff/orders/${code}/assign`, { token: A, body: { phleb: ph1.id } }); ok(r.s === 200, 'lab assigns a phlebotomist to the doctor booking');
  r = await call('GET', `/staff/dr/bookings/${bk.id}`, { token: DR }); ok(r.j.booking.stage === 'phlebo_assigned', 'doctor sees stage: phlebotomist assigned');
  // delete a price
  ok((await call('POST', '/staff/b2b/delete', { token: A, body: { key: 'K:9' } })).s === 200 && (await call('GET', '/staff/b2b', { token: A })).j.count === 2, 'price row deleted');
  r = await call('POST', '/staff/b2b', { token: A, body: { replace: true, rows: [{ key: 'A:1', name: 'CBC', price: 100 }] } }); ok((await call('GET', '/staff/b2b', { token: A })).j.count === 1, 'replace-all upload');
} catch (e) { console.log('ERROR', e); fail++; } finally { srv.kill(); mock.kill(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
