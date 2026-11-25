// Integration test for the lab software API (/staff/*) + how it connects to the customer dashboard. Run: node portal-php/test-staff.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const store = mkdtempSync(path.join(tmpdir(), 'portal-'));
const PORT = process.env.PORT || 8791, B = `http://127.0.0.1:${PORT}`, ORIGIN = 'http://localhost:8765';
const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir, path.join(dir, 'index.php')], { cwd: dir, stdio: 'ignore', env: { ...process.env, PORTAL_STORAGE: store, PORTAL_LAB_KEY: 'k', PORTAL_ORIGINS: ORIGIN, PORTAL_OTP_PROVIDER: 'dev', PORTAL_OTP_COOLDOWN: '0' } });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
async function call(method, p, { body, token } = {}) {
  const h = { Origin: ORIGIN }; if (token) h.Authorization = 'Bearer ' + token; let b; if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(B + p, { method, headers: h, body: b }); const buf = Buffer.from(await r.arrayBuffer()); let j = {}; try { j = JSON.parse(buf.toString()); } catch (e) {} return { s: r.status, j, buf, h: r.headers };
}
async function otpIn(mobile, name) {   // log in / sign up with a WhatsApp OTP (test mode returns the code)
  const s = await call('POST', '/auth/otp/send', { body: { mobile, purpose: 'login' } });
  return call('POST', '/auth/otp/login', { body: { mobile, otp: s.j.devCode, name } });
}
try {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/'); break; } catch (e) { await new Promise((r) => setTimeout(r, 150)); } }
  let r = await call('GET', '/staff/status'); ok(r.j.needsSetup === true, 'needs setup initially');
  ok((await call('GET', '/staff/orders')).s === 401, 'staff routes need login');
  ok((await call('POST', '/staff/setup', { body: { name: 'Dr Admin', username: 'admin', password: '123', setup_code: 'k' } })).s === 400, 'setup weak password');
  ok((await call('POST', '/staff/setup', { body: { name: 'Lab Owner', username: 'owner', password: 'Owner#2026', setup_code: 'wrong' } })).s === 403, 'setup needs the right setup code');
  r = await call('POST', '/staff/setup', { body: { name: 'Lab Owner', username: 'Owner', password: 'Owner#2026', title: 'Lab Director', setup_code: 'k', setup_code: 'k' } });
  ok(r.s === 201 && r.j.staff.role === 'admin' && r.j.staff.username === 'owner', 'first staff becomes admin'); const A = r.j.token;
  ok((await call('POST', '/staff/setup', { body: { name: 'Hacker', username: 'hacker', password: 'Hacker#2026', setup_code: 'k' } })).s === 403, 'setup cannot run twice');
  ok((await call('GET', '/staff/status')).j.needsSetup === false, 'setup flag off');
  ok((await call('POST', '/staff/login', { body: { username: 'owner', password: 'wrong' } })).s === 401, 'wrong staff password');
  ok((await call('GET', '/me', { token: A })).s === 401, 'staff token is not a customer token');

  // staff users + roles
  const mk = async (username, role, name, title) => (await call('POST', '/staff/users', { token: A, body: { username, role, name, title, password: 'Staff#2026' } }));
  ok((await mk('rec1', 'reception', 'Reena Reception')).s === 201, 'create reception');
  ok((await mk('tech1', 'technician', 'Tarun Tech')).s === 201, 'create technician');
  r = await mk('doc1', 'doctor', 'Dr Meera Rao', 'MD'); ok(r.s === 400, 'the doctor role no longer exists');
  ok((await mk('adm2', 'admin', 'Second Admin')).s === 201, 'create second admin');
  ok((await mk('rec1', 'reception', 'Dup')).s === 400, 'duplicate username');
  ok((await mk('bad', 'wizard', 'Bad Role')).s === 400, 'bad role');
  const login = async (u) => (await call('POST', '/staff/login', { body: { username: u, password: 'Staff#2026' } })).j.token;
  const REC = await login('rec1'), TECH = await login('tech1'), DOC = await login('adm2');
  ok(REC && TECH && DOC, 'staff can log in');
  ok((await call('GET', '/staff/users', { token: REC })).s === 403, 'reception cannot list staff');
  r = await call('GET', '/staff/users', { token: A }); ok(r.j.users.length === 4, 'admin lists staff');
  const ownerId = r.j.users.find((u) => u.username === 'owner').id;
  ok((await call('POST', '/staff/users/' + ownerId, { token: A, body: { active: false } })).s === 400, 'cannot deactivate self');

  // patient lookup + create order
  r = await call('GET', '/staff/patient?mobile=9876543210', { token: REC }); ok(r.j.found === false, 'new patient not found');
  ok((await call('POST', '/staff/orders', { token: TECH, body: { name: 'X Y', mobile: '9876543210', tests: [{ name: 'CBC', price: 300 }] } })).s === 403, 'technician cannot bill');
  ok((await call('POST', '/staff/orders', { token: REC, body: { name: 'A', mobile: '9876543210', tests: [{ name: 'CBC', price: 300 }] } })).s === 400, 'name too short');
  ok((await call('POST', '/staff/orders', { token: REC, body: { name: 'Asha Rao', mobile: '9876543210', tests: [] } })).s === 400, 'no tests');
  r = await call('POST', '/staff/orders', { token: REC, body: { name: 'Asha Rao', mobile: '9876543210', age: 34, sex: 'f', ref_doctor: 'Dr Patil', tests: [{ key: 'P:CBC', name: 'CBC', price: 400 }, { key: 'T:HBA', name: 'HbA1c', price: 420 }, { name: 'Lipid Profile', price: 600 }], discount: 120, paid: 500, pay_mode: 'upi' } });
  ok(r.s === 201 && /^TD-\d{6}-001$/.test(r.j.order.code), 'order code ' + r.j.order.code);
  ok(r.j.order.subtotal === 1420 && r.j.order.amount === 1300 && r.j.order.paid === 500 && r.j.order.due === 800 && r.j.order.sex === 'F', 'billing maths');
  const code = r.j.order.code, pin = r.j.pin; ok(/^\d{6}$/.test(pin), 'pin returned once');
  r = await call('POST', '/staff/orders', { token: REC, body: { name: 'Second Person', mobile: '9123456789', tests: ['x'].map(() => ({ name: 'TSH', price: 260 })), paid: 9999 } });
  ok(r.j.order.code.endsWith('-002') && r.j.order.paid === 260 && r.j.order.due === 0, 'sequential code, overpay capped');
  r = await call('GET', '/staff/patient?mobile=9876543210', { token: REC }); ok(r.j.found && r.j.name === 'Asha Rao' && r.j.age === 34 && r.j.orders === 1, 'patient lookup remembers details');

  // payments
  ok((await call('POST', `/staff/orders/${code}/payment`, { token: REC, body: { amount: 900, mode: 'cash' } })).s === 400, 'cannot overpay');
  r = await call('POST', `/staff/orders/${code}/payment`, { token: REC, body: { amount: 800, mode: 'cash' } }); ok(r.j.order.due === 0 && r.j.order.paid === 1300, 'payment settles balance');
  ok((await call('POST', `/staff/orders/${code}/payment`, { token: TECH, body: { amount: 1, mode: 'cash' } })).s === 403, 'technician cannot take payment');
  r = await call('POST', `/staff/orders/${code}/update`, { token: REC, body: { name: 'Asha Rao', mobile: '9876543210', age: 35, sex: 'F', ref_doctor: 'Dr Patil', kind: 'home', notes: 'Fasting 12h' } }); ok(r.j.order.age === 35 && r.j.order.kind === 'home' && r.j.order.amount === 1300, 'edit patient details keeps billing');

  // status
  ok((await call('POST', `/staff/orders/${code}/status`, { token: TECH, body: { status: 'completed' } })).s === 400, 'cannot complete by status');
  ok((await call('POST', `/staff/orders/${code}/status`, { token: TECH, body: { status: 'collected' } })).s === 400, 'home order: only the phlebotomist marks collected');
  await call('POST', `/staff/orders/${code}/update`, { token: REC, body: { name: 'Asha Rao', mobile: '9876543210', age: 35, sex: 'F', ref_doctor: 'Dr Patil', kind: 'walk-in', notes: 'Fasting 12h' } });
  r = await call('POST', `/staff/orders/${code}/status`, { token: TECH, body: { status: 'collected' } }); ok(r.j.order.status === 'collected' && r.j.order.times.collected > 0, 'technician marks collected');

  // templates
  r = await call('GET', '/staff/templates', { token: TECH }); const tpl = r.j.templates;
  const cbc = tpl.find((t) => t.key === 'P:CBC'); ok(cbc && cbc.params.length === 14 && cbc.match.includes('CBC'), 'CBC template seeded');
  ok(tpl.some((t) => t.key === 'T:HBA'), 'HbA1c template seeded');
  ok((await call('POST', '/staff/templates', { token: TECH, body: { key: 'C:X', name: 'X', params: [{ name: 'a' }] } })).s === 403, 'technician cannot edit templates');
  ok((await call('POST', '/staff/templates', { token: DOC, body: { key: 'C:VITB', name: 'Vitamin B12', params: [{ name: 'Vitamin B12', unit: 'pg/mL', low: 200, high: 900 }], match: ['B12'] } })).j.ok, 'doctor adds template');
  ok((await call('GET', '/staff/templates', { token: DOC })).j.templates.some((t) => t.key === 'C:VITB'), 'new template listed');

  // results
  const row = (name, value, low, high, unit = '', ref = '') => ({ name, value, low, high, unit, ref });
  const sections = [
    { key: 'P:CBC', title: 'Complete Blood Count (CBC)', rows: [row('Hemoglobin', '9.8', 12, 15, 'g/dL', '12.0 - 15.0'), row('Total WBC count', '7200', 4000, 10000, '/cumm', '4000 - 10000'), row('Platelet count', '520000', 150000, 410000, '/cumm', '150000 - 410000')], comment: 'Microcytic hypochromic picture.' },
    { key: 'T:HBA', title: 'HbA1c', rows: [row('HbA1c', '5.4', 4.0, 5.6, '%', 'Normal < 5.7')] },
    { key: '', title: 'Lipid Profile', rows: [row('Total Cholesterol', '', null, 200, 'mg/dL', '< 200')] },
  ];
  ok((await call('POST', `/staff/orders/${code}/results`, { token: REC, body: { sections } })).s === 403, 'reception cannot enter results');
  r = await call('POST', `/staff/orders/${code}/results`, { token: TECH, body: { sections } });
  const saved = r.j.order; ok(saved.res_status === 'entered' && saved.status === 'processing', 'results saved, status moves to processing');
  const flags = saved.results[0].rows.map((x) => x.flag).join(','); ok(flags === 'L,,H', 'flags computed on server: ' + flags);
  ok(saved.results[1].rows[0].flag === '', 'normal value not flagged');
  // customer must not see it yet
  r = await otpIn('9876543210', 'Asha Rao'); const C = r.j.token;
  r = await call('POST', '/orders/link', { token: C, body: { code, pin } }); ok(r.s === 200 && !r.j.order.hasReport && r.j.order.status === 'processing', 'customer links by PIN and sees live status');
  ok((await call('GET', `/orders/${code}/report`, { token: C })).s === 404, 'customer cannot get an unapproved report');
  // lab software PDF is published straight to the customer (no approval step)
  const pdf1 = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1500, 5), Buffer.from('\n%%EOF')]);
  r = await fetch(B + `/staff/orders/${code}/upload?name=lab.pdf`, { method: 'PUT', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + REC }, body: pdf1 }); ok(r.status === 403, 'reception cannot upload reports');
  r = await fetch(B + `/staff/orders/${code}/upload?name=lab.pdf`, { method: 'PUT', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + TECH }, body: pdf1 }); const uj = await r.json();
  ok(r.status === 200 && uj.order.status === 'completed' && uj.order.hasReport, 'technician uploads the report -> completed');
  ok((await call('POST', `/staff/orders/${code}/approve`, { token: DOC })).s === 404, 'approval step no longer exists');
  r = await call('POST', `/staff/orders/${code}/notify`, { token: TECH }); ok(r.s === 503, 'WhatsApp send says not set up when the AiSensy key is missing');
  { const { createHmac } = await import('node:crypto'); const sec = (await import('node:fs')).readFileSync(path.join(store, 'secret.key'), 'utf8').trim();
    const mkl = (e, c = code) => `/portal-api-unused`; const e = Date.now() + 100000; const sg = (ee) => createHmac('sha256', sec).update(`rep|${code}|${ee}`).digest('base64url');
    r = await call('GET', `/public/report/${code}?e=${e}&s=${sg(e)}`); ok(r.s === 200 && Buffer.compare(r.buf, pdf1) === 0, 'signed report link downloads without login');
    r = await call('GET', `/public/report/${code}?e=${e}&s=bad`); ok(r.s === 404, 'bad signature is refused');
    r = await call('GET', `/public/report/${code}/${code}-report.pdf?e=${e}&s=${sg(e)}`); ok(r.s === 200 && r.buf.slice(0,5).toString() === '%PDF-', 'link with a .pdf file name works too');
    const old = Date.now() - 5; r = await call('GET', `/public/report/${code}?e=${old}&s=${sg(old)}`); ok(r.s === 404, 'expired link is refused'); }
  r = await call('GET', `/orders/${code}/report`, { token: C }); ok(r.s === 200 && Buffer.compare(r.buf, pdf1) === 0, 'customer downloads the uploaded report');

  // PIN reset
  r = await call('POST', `/staff/orders/${code}/pin`, { token: REC }); const pin2 = r.j.pin; ok(/^\d{6}$/.test(pin2) && pin2 !== pin, 'pin reset');
  const C2 = (await otpIn('9876543299', 'Asha Two')).j.token;
  ok((await call('POST', '/orders/link', { token: C2, body: { code, pin: pin2 } })).s === 404, 'new PIN still needs the right mobile');

  // lists
  r = await call('GET', '/staff/orders?q=asha', { token: REC }); ok(r.j.total === 1 && r.j.orders[0].code === code && !('results' in r.j.orders[0]), 'search by name');
  r = await call('GET', '/staff/orders?status=completed', { token: REC }); ok(r.j.total === 1, 'filter completed');
  r = await call('GET', '/staff/orders?due=1', { token: REC }); ok(r.j.total === 0, 'no dues');
  r = await call('GET', '/staff/orders', { token: REC }); ok(r.j.total === 2, 'list all');

  // inbox
  r = await call('POST', '/tickets', { token: C, body: { subject: 'Need doctor call', message: 'Please call me about CBC', category: 'Reports' } }); const tid = r.j.ticket.id;
  ok((await call('GET', '/staff/tickets', { token: TECH })).s === 403, 'technician has no inbox');
  r = await call('GET', '/staff/tickets?status=active', { token: REC }); ok(r.j.tickets.some((t) => t.id === tid), 'reception sees open ticket');
  r = await call('POST', `/staff/tickets/${tid}/reply`, { token: REC, body: { message: 'Doctor will call at 5 pm', close: false } }); ok(r.j.ticket.status === 'answered' && r.j.ticket.msgs.length === 2, 'staff replies');
  r = await call('GET', '/tickets', { token: C }); ok(r.j.tickets[0].msgs[1].from === 'staff', 'customer sees staff ticket reply');
  await call('POST', '/chat', { token: C, body: { body: 'Is my report ready?' } });
  r = await call('GET', '/staff/chats', { token: REC }); ok(r.j.chats.length === 1 && r.j.chats[0].unread === true, 'unread chat shown');
  r = await call('GET', '/staff/dashboard?since=0&tz=330', { token: REC }); ok(r.j.inbox.chats === 1 && r.j.inbox.tickets === 0, 'dashboard counts unread chat');
  r = await call('GET', '/staff/chats/9876543210', { token: REC }); ok(r.j.messages.length === 2, 'staff reads chat (customer msg + auto reply)');
  r = await call('GET', '/staff/chats', { token: REC }); ok(r.j.chats[0].unread === false, 'chat marked read');
  r = await call('POST', '/staff/chats/9876543210', { token: REC, body: { body: 'Yes, ready now.' } }); ok(r.s === 201 && r.j.message.label === 'Reena Reception', 'staff chat reply labelled with name');
  r = await call('GET', '/chat?after=0', { token: C }); ok(r.j.messages.at(-1).from === 'staff' && r.j.messages.at(-1).body === 'Yes, ready now.', 'customer receives staff chat');

  // memberships
  await call('POST', '/membership', { token: C, body: { tier: 'gold' } });
  r = await call('GET', '/staff/members?status=requested', { token: REC }); ok(r.j.members.length === 1 && r.j.members[0].membership.tier === 'gold', 'membership request listed');
  ok((await call('POST', '/staff/members', { token: REC, body: { mobile: '9876543210', tier: 'gold', status: 'active' } })).j.membership.status === 'active', 'staff activates plan');
  r = await call('GET', '/staff/patient?mobile=9876543210', { token: REC }); ok(r.j.discountPct === 15, 'active Gold gives 15% suggestion');
  ok((await call('GET', '/me', { token: C })).j.user.membership.status === 'active', 'customer sees active plan');

  // dashboard / summary
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  r = await call('GET', `/staff/dashboard?since=${midnight.getTime()}&tz=${-new Date().getTimezoneOffset()}`, { token: A });
  ok(r.j.today.orders === 2 && r.j.today.billed === 1560 && r.j.pipeline.booked === 1, 'dashboard today numbers');
  r = await call('GET', `/staff/summary?from=${midnight.getTime() - 6 * 864e5}&to=${Date.now() + 1000}&tz=${-new Date().getTimezoneOffset()}`, { token: A });
  ok(r.j.orders === 2 && r.j.billed === 1560 && r.j.top_tests.some((t) => t.name === 'CBC') && r.j.by_day.length >= 1, 'summary range');
  ok((await call('GET', `/staff/summary?from=0&to=${Date.now()}`, { token: A })).s === 400, 'summary range limit');

  // setup code
  // (setup already done above; a wrong code on a fresh server is covered by the 403 for repeat setup)
  // upload a ready-made PDF
  r = await call('POST', '/staff/orders', { token: TECH, body: { name: 'Ravi Kumar', mobile: '9123456780', tests: [{ name: 'LIPID PROFILE', price: 250 }] } }); ok(r.s === 403, 'technician cannot bill');
  r = await call('POST', '/staff/orders', { token: A, body: { name: 'Ravi Kumar', mobile: '9123456780', tests: [{ name: 'LIPID PROFILE', price: 250 }], paid: 250 } }); const c2 = r.j.order.code;
  const up = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 7), Buffer.from('\n%%EOF')]);
  const putPdf = (token, body, name) => fetch(B + `/staff/orders/${c2}/upload` + (name ? '?name=' + name : ''), { method: 'PUT', headers: { Origin: ORIGIN, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body }).then(async (x) => ({ s: x.status, j: await x.json().catch(() => ({})) }));
  ok((await putPdf(null, up)).s === 401, 'upload needs login');
  ok((await putPdf(DOC, Buffer.from('nope'))).s === 400, 'upload must be a PDF');
  r = await putPdf(DOC, up, 'analyser.pdf'); ok(r.s === 200 && r.j.order.status === 'completed' && r.j.order.res_status === 'approved' && r.j.order.hasReport, 'doctor uploads PDF -> completed');
  r = await otpIn('9123456780', 'Ravi Kumar'); const C3 = r.j.token;
  r = await call('POST', '/staff/orders/' + c2 + '/pin', { token: A }); await call('POST', '/orders/link', { token: C3, body: { code: c2, pin: r.j.pin } });
  r = await call('GET', `/orders/${c2}/report`, { token: C3 }); ok(r.s === 200 && Buffer.compare(r.buf, up) === 0, 'customer downloads the uploaded PDF unchanged');
  // patients
  r = await call('GET', '/staff/patients?q=ravi', { token: REC }); ok(r.j.patients.length === 1 && r.j.patients[0].mobile === '9123456780' && r.j.patients[0].orders === 1, 'patient list search');
  r = await call('GET', '/staff/patients', { token: REC }); ok(r.j.patients.length === 3 && r.j.patients.some((x) => x.mobile === '9876543210' && x.orders === 1), 'patient list groups orders by mobile');
  // stock
  ok((await call('GET', '/staff/stock', { token: REC })).s === 403, 'reception has no stock access');
  r = await call('POST', '/staff/stock', { token: TECH, body: { name: 'EDTA tubes', unit: 'box', qty: 10, min: 4 } }); ok(r.s === 201, 'add stock item'); const sid = r.j.id;
  r = await call('GET', '/staff/stock', { token: TECH }); ok(r.j.items.length === 1 && r.j.items[0].qty === 10 && !r.j.items[0].low, 'stock listed');
  ok((await call('POST', `/staff/stock/${sid}/adjust`, { token: TECH, body: { delta: -20 } })).s === 400, 'cannot use more than in stock');
  r = await call('POST', `/staff/stock/${sid}/adjust`, { token: TECH, body: { delta: -7, note: 'Used this week' } }); ok(r.j.qty === 3, 'stock used');
  r = await call('GET', '/staff/stock', { token: TECH }); ok(r.j.items[0].low === true, 'low stock flagged');
  r = await call('GET', `/staff/stock/${sid}/log`, { token: TECH }); ok(r.j.log.length === 2 && r.j.log[0].delta === -7 && r.j.log[1].note === 'Opening stock', 'stock log');
  r = await call('GET', '/staff/dashboard?since=0', { token: TECH }); ok(r.s === 200 && r.j.stock.low === 1, 'dashboard shows low stock');
  await call('POST', '/staff/stock', { token: TECH, body: { id: sid, name: 'EDTA tubes', unit: 'box', min: 4, remove: true } }); ok((await call('GET', '/staff/stock', { token: TECH })).j.items.length === 0, 'item removed');
  // website booking requests -> lab console
  r = await call('POST', '/public/booking', { body: { name: 'R', mobile: '123' } }); ok(r.s === 400, 'booking needs valid name + mobile');
  r = await call('POST', '/public/booking', { body: { name: 'Ravi Kumar', mobile: '9845012345', tests: ['Lipid Profile', 'HbA1c Test'], date: '2026-11-02', slot: '7:00 - 9:00 am', address: 'Temple Road', source: 'book' } }); ok(r.s === 201 && r.j.ok, 'website booking is accepted without login');
  await call('POST', '/public/booking', { body: { name: 'Ravi Kumar', mobile: '9845012345', tests: ['Lipid Profile', 'HbA1c Test'], source: 'book' } });
  r = await call('GET', '/staff/bookings?status=new', { token: REC }); ok(r.s === 200 && r.j.bookings.length === 1 && r.j.bookings[0].tests === 'Lipid Profile, HbA1c Test' && r.j.bookings[0].source === 'book', 'reception sees the booking (same request sent twice is saved once)');
  const bid = r.j.bookings[0].id;
  ok((await call('GET', '/staff/bookings', { token: TECH })).s === 403, 'technician cannot see bookings');
  ok((await call('GET', '/staff/bookings')).s === 401, 'bookings need login');
  ok((await call('GET', '/staff/dashboard?since=0', { token: REC })).j.bookings === 1, 'dashboard counts new bookings');
  r = await call('POST', '/staff/orders', { token: REC, body: { name: 'Ravi Kumar', mobile: '9845012345', tests: [{ key: '', name: 'Lipid Profile', price: 250 }], booking_id: bid } });
  ok(r.s === 201, 'order created from the booking');
  const bcode = r.j.order.code;
  r = await call('GET', '/staff/bookings?status=done', { token: REC }); ok(r.j.bookings.length === 1 && r.j.bookings[0].orderCode === bcode, 'booking marked done and linked to the order');
  ok((await call('GET', '/staff/dashboard?since=0', { token: REC })).j.bookings === 0, 'new-bookings count drops to 0');
  ok((await call('POST', `/staff/bookings/${bid}/status`, { token: REC, body: { status: 'cancelled' } })).j.ok, 'booking status can be changed');
  // ---- phlebotomist module (home collection)
  ok((await mk('ph1', 'phlebotomist', 'Suresh P')).s === 201 && (await mk('ph2', 'phlebotomist', 'Mahesh K')).s === 201, 'create phlebotomists');
  const PH1 = await login('ph1'), PH2 = await login('ph2'); ok(PH1 && PH2, 'phlebotomists log in');
  const slot = Date.now() + 3600000;
  r = await call('POST', '/staff/orders', { token: REC, body: { name: 'Linga Gouda', mobile: '9811111111', kind: 'home', address: 'Nandishwar Nagar, Gadag', slot, tests: [{ name: 'LIPID PROFILE', price: 250 }] } });
  ok(r.s === 201 && r.j.order.addr === 'Nandishwar Nagar, Gadag' && r.j.order.slot_at === slot && r.j.order.kind === 'home', 'home order keeps address and visit time'); const hc = r.j.order.code;
  ok((await call('GET', '/staff/phleb/home', { token: TECH })).s === 403 && (await call('GET', '/staff/orders', { token: PH1 })).s === 403, 'roles are separated both ways');
  r = await call('GET', '/staff/dashboard?since=0', { token: REC }); ok(r.j.visits.unassigned === 1, 'dashboard counts unassigned visits');
  r = await call('GET', '/staff/phleb/orders?scope=pool', { token: PH1 }); ok(r.j.orders.length === 1 && r.j.orders[0].code === hc && r.j.orders[0].fasting === true && r.j.orders[0].due === 250, 'pool shows the visit with fasting flag and amount to collect');
  ok((await call('POST', `/staff/orders/${hc}/assign`, { token: TECH, body: { phleb: 'x' } })).s === 400, 'technician can assign (bad phlebotomist is refused)');
  const phl = (await call('GET', '/staff/phlebs', { token: REC })).j.phlebs; ok(phl.length === 2, 'lab lists phlebotomists');
  const p1 = phl.find((x) => x.username === 'ph1').id, p2 = phl.find((x) => x.username === 'ph2').id;
  ok((await call('POST', `/staff/orders/${hc}/assign`, { token: REC, body: { phleb: p1 } })).j.order.ph_status === 'assigned', 'lab assigns the visit');
  r = await call('GET', '/staff/phleb/orders?scope=mine', { token: PH1 }); ok(r.j.orders.length === 1 && r.j.orders[0].ph_status === 'assigned', 'assignee sees it');
  ok((await call('GET', '/staff/phleb/orders?scope=mine', { token: PH2 })).j.orders.length === 0 && (await call('POST', `/staff/phleb/orders/${hc}/start`, { token: PH2 })).s === 403, 'others cannot touch it');
  ok((await call('POST', `/staff/phleb/orders/${hc}/accept`, { token: PH1 })).j.order.ph_status === 'accepted', 'accept');
  ok((await call('POST', `/staff/phleb/orders/${hc}/start`, { token: PH1 })).j.order.ph_status === 'started', 'start');
  r = await call('POST', `/staff/phleb/orders/${hc}/collected`, { token: PH1 }); ok(r.j.order.ph_status === 'collected' && r.j.order.status === 'collected', 'collected moves the lab order to collected');
  ok((await call('GET', `/staff/orders/${hc}`, { token: REC })).j.order.status === 'collected', 'lab sees collected');
  ok((await call('GET', '/staff/phleb/orders?scope=served', { token: PH1 })).j.orders.length === 1 && (await call('GET', '/staff/phleb/home', { token: PH1 })).j.served === 1, 'served list and count');
  ok((await call('POST', `/staff/phleb/orders/${hc}/release`, { token: PH1 })).s === 400, 'a finished visit cannot be released');
  r = await call('POST', '/staff/orders', { token: REC, body: { name: 'Vaishak B', mobile: '9822222222', kind: 'home', address: 'Betageri', slot: slot + 7200000, tests: [{ name: 'CBC', price: 300 }] } }); const hc2 = r.j.order.code;
  ok((await call('POST', `/staff/phleb/orders/${hc2}/pick`, { token: PH2 })).j.order.ph_status === 'accepted', 'pick from pool');
  ok((await call('POST', `/staff/phleb/orders/${hc2}/pick`, { token: PH1 })).s === 400, 'a picked visit cannot be picked again');
  ok((await call('POST', `/staff/orders/${hc2}/status`, { token: REC, body: { status: 'collected' } })).s === 400 && (await call('POST', `/staff/orders/${hc2}/status`, { token: TECH, body: { status: 'processing' } })).s === 400, 'lab cannot mark a home visit collected or in progress before the phlebotomist does');
  ok((await call('POST', `/staff/phleb/orders/${hc2}/release`, { token: PH2 })).j.order.ph_id === null, 'release puts it back in the pool');
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  ok((await call('POST', '/staff/phleb/leaves', { token: PH2, body: { from: '2020-01-01', to: '2020-01-02' } })).s === 400, 'past leave refused');
  ok((await call('POST', '/staff/phleb/leaves', { token: PH2, body: { from: today, to: today, reason: 'Fever' } })).s === 201, 'apply for leave');
  ok((await call('POST', `/staff/phleb/orders/${hc2}/pick`, { token: PH2 })).s === 400, 'cannot pick while on leave');
  ok((await call('GET', '/staff/phlebs', { token: REC })).j.phlebs.find((x) => x.id === p2).on_leave === true, 'lab sees who is on leave');
  r = await call('GET', '/staff/leaves', { token: REC }); ok(r.j.leaves.length === 1 && r.j.leaves[0].name === 'Mahesh K', 'lab leave list');
  const lid = (await call('GET', '/staff/phleb/leaves', { token: PH2 })).j.leaves[0].id; ok((await call('POST', `/staff/phleb/leaves/${lid}/cancel`, { token: PH1 })).j.ok && (await call('GET', '/staff/phleb/leaves', { token: PH2 })).j.leaves.length === 1, 'someone else cannot cancel my leave');
  ok((await call('POST', `/staff/phleb/leaves/${lid}/cancel`, { token: PH2 })).j.ok && (await call('GET', '/staff/phleb/leaves', { token: PH2 })).j.leaves.length === 0, 'cancel my leave');
  ok((await call('POST', '/staff/phleb/sos', { token: PH1, body: { lat: 15.43, lng: 75.63 } })).j.ok, 'SOS sent');
  r = await call('GET', '/staff/sos', { token: REC }); ok(r.j.sos.length === 1 && r.j.sos[0].name === 'Suresh P' && !r.j.sos[0].ack_at, 'lab sees the SOS');
  ok((await call('GET', '/staff/dashboard?since=0', { token: REC })).j.visits.sos === 1, 'dashboard SOS count');
  await call('POST', `/staff/sos/${r.j.sos[0].id}/ack`, { token: REC }); ok((await call('GET', '/staff/dashboard?since=0', { token: REC })).j.visits.sos === 0, 'acknowledged SOS clears');
  r = await call('GET', '/staff/visits?state=done', { token: REC }); ok(r.j.visits.some((v) => v.code === hc && v.ph_name === 'Suresh P'), 'lab visit list (done) shows who collected');
  r = await call('GET', '/staff/visits?state=open', { token: REC }); ok(r.j.visits.some((v) => v.code === hc2 && !v.ph_name), 'lab visit list (open) shows the unassigned visit');
  // deactivate
  const rec = (await call('GET', '/staff/users', { token: A })).j.users.find((u) => u.username === 'rec1');
  await call('POST', '/staff/users/' + rec.id, { token: A, body: { active: false } }); ok((await call('GET', '/staff/orders', { token: REC })).s === 401, 'deactivated staff is locked out at once');
  ok((await call('POST', '/staff/password', { token: A, body: { old: 'bad', new: 'NewOwner#2026' } })).s === 400, 'password change needs current');
  ok((await call('POST', '/staff/password', { token: A, body: { old: 'Owner#2026', new: 'NewOwner#2026' } })).j.ok, 'password change');
  ok((await call('POST', '/staff/login', { body: { username: 'owner', password: 'NewOwner#2026' } })).s === 200, 'login with new password');
} catch (e) { fail++; console.log('ERROR', e); }
srv.kill(); rmSync(store, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
