// OTP tests against the real server, with a mock WhatsApp provider (SMS must never be used). Run: node portal-php/test-otp.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'otp-')), store = path.join(tmp, 'store');
const P1 = process.env.PORT || 8792, P2 = Number(P1) + 1, B = `http://127.0.0.1:${P1}`, ORIGIN = 'http://localhost:8765';
const LOG = path.join(tmp, 'provider.log'), FAILWA = path.join(tmp, 'fail-wa');
writeFileSync(path.join(tmp, 'mock.php'), `<?php
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); $body = file_get_contents('php://input');
$h = function_exists('getallheaders') ? getallheaders() : [];
if (preg_match('#/messages$#', $p)) {
  file_put_contents('${LOG.replace(/\\/g, '/')}', json_encode(['ch' => 'wa', 'path' => $p, 'auth' => isset($h['Authorization']) ? $h['Authorization'] : '', 'body' => json_decode($body, true)]) . "\\n", FILE_APPEND);
  if (file_exists('${FAILWA.replace(/\\/g, '/')}')) { http_response_code(400); echo json_encode(['error' => ['code' => 131026, 'message' => 'Message undeliverable']]); exit; }
  echo json_encode(['messaging_product' => 'whatsapp', 'messages' => [['id' => 'wamid.TEST']]]); exit;
}
if (preg_match('#/api/v5/otp$#', $p)) {   // an SMS provider: the server must NEVER call this
  file_put_contents('${LOG.replace(/\\/g, '/')}', json_encode(['ch' => 'sms', 'query' => $_GET]) . "\\n", FILE_APPEND);
  echo json_encode(['type' => 'success']); exit;
}
http_response_code(404);`);
const env = { ...process.env, PORTAL_STORAGE: store, PORTAL_LAB_KEY: 'k', PORTAL_ORIGINS: ORIGIN, PORTAL_OTP_PROVIDER: 'live', PORTAL_OTP_COOLDOWN: '1', PORTAL_WA_PHONE_ID: '1234567', PORTAL_WA_TOKEN: 'secret-token',
  PORTAL_WA_BASE: `http://127.0.0.1:${P2}/v21.0` , PORTAL_MSG91_KEY: 'authkey1', PORTAL_MSG91_TEMPLATE: 'tpl9', PORTAL_SMS_BASE: `http://127.0.0.1:${P2}` };
const srv = spawn('php', ['-S', `127.0.0.1:${P1}`, '-t', dir, path.join(dir, 'index.php')], { cwd: dir, stdio: 'ignore', env });
const mock = spawn('php', ['-S', `127.0.0.1:${P2}`, path.join(tmp, 'mock.php')], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, { body, token } = {}) {
  const h = { Origin: ORIGIN }; if (token) h.Authorization = 'Bearer ' + token; let b; if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(B + p, { method, headers: h, body: b }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, text: t };
}
const sent = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const lastCode = () => { const s = sent().pop(); return s.ch === 'wa' ? s.body.template.components[0].parameters[0].text : s.query.otp; };
try {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/'); await fetch(`http://127.0.0.1:${P2}/x`); break; } catch (e) { await sleep(150); } }
  let r = await call('GET', '/auth/config'); ok(r.j.otp === true && r.j.channels.join() === 'whatsapp' && r.j.smsAvailable === false, 'config says OTP on, WhatsApp only');

  // ---- sign up
  const M1 = '9876500001', PW = 'Strong#2026';
  ok((await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: M1, password: PW } })).s === 400, 'cannot sign up without an OTP');
  ok((await call('POST', '/auth/otp/send', { body: { mobile: '12345', purpose: 'register' } })).s === 400, 'send needs a valid mobile');
  ok((await call('POST', '/auth/otp/send', { body: { mobile: M1, purpose: 'login' } })).s === 400, 'login OTP cannot be requested without the password');
  r = await call('POST', '/auth/otp/send', { body: { mobile: M1, purpose: 'register' } });
  ok(r.s === 200 && r.j.channel === 'whatsapp' && r.j.to === '98xxxxx001' && !('devCode' in r.j) && !r.text.includes(lastCode()), 'OTP goes to WhatsApp first and the code is not returned by the API');
  let m = sent()[0];
  ok(m.body.to === '919876500001' && m.body.type === 'template' && m.body.template.name === 'otp_code' && m.body.template.language.code === 'en' && m.auth === 'Bearer secret-token' && m.path === '/v21.0/1234567/messages', 'WhatsApp request is the Cloud API authentication template');
  ok(/^\d{6}$/.test(lastCode()) && m.body.template.components[1].sub_type === 'url' && m.body.template.components[1].parameters[0].text === lastCode(), 'code is in the body and in the copy-code button');
  ok(sent().filter((x) => x.ch === 'sms').length === 0, 'no SMS is sent when WhatsApp works');
  ok((await call('POST', '/auth/otp/send', { body: { mobile: M1, purpose: 'register' } })).s === 429, 'resend is blocked during the cooldown');
  const code1 = lastCode();
  const wrong = code1 === '111111' ? '222222' : '111111';
  ok((await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: M1, password: PW, otp: wrong } })).s === 400, 'wrong OTP rejected');
  r = await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: M1, password: PW, otp: code1, remember: true } });
  ok(r.s === 201 && r.j.token && r.j.user.mobile === M1 && r.j.device, 'sign up works with the right OTP and gives a device token');
  const dev1 = r.j.device;
  ok((await call('POST', '/auth/register', { body: { name: 'Asha Rao', mobile: M1, password: PW, otp: code1 } })).s === 400, 'an OTP cannot be used twice');
  ok((await call('POST', '/auth/otp/send', { body: { mobile: M1, purpose: 'register' } })).s === 400, 'cannot sign up a number that already has an account');

  // ---- OTP attempt limit and expiry-style failures
  const M2 = '9876500002';
  await call('POST', '/auth/otp/send', { body: { mobile: M2, purpose: 'register' } }); const c2 = lastCode(); const bad = c2 === '333333' ? '444444' : '333333';
  for (let i = 0; i < 5; i++) await call('POST', '/auth/register', { body: { name: 'Bob Test', mobile: M2, password: PW, otp: bad } });
  r = await call('POST', '/auth/register', { body: { name: 'Bob Test', mobile: M2, password: PW, otp: c2 } }); ok(r.s === 429, 'after 5 wrong tries even the right OTP is refused');

  // ---- login: password then OTP
  await sleep(1200);
  r = await call('POST', '/auth/login', { body: { mobile: M1, password: 'wrong-pass' } }); ok(r.s === 401, 'wrong password stops before any OTP');
  const before = sent().length;
  r = await call('POST', '/auth/login', { body: { mobile: M1, password: PW } }); ok(r.s === 202 && r.j.otpRequired && !r.j.token && r.j.to === '98xxxxx001', 'right password asks for an OTP and gives no token yet');
  ok(sent().length === before + 1, 'login OTP was sent');
  const lc = lastCode();
  r = await call('POST', '/auth/login', { body: { mobile: M1, password: PW, otp: lc === '555555' ? '666666' : '555555' } }); ok(r.s === 400 && !r.j.token, 'wrong login OTP rejected');
  r = await call('POST', '/auth/login', { body: { mobile: M1, password: PW, otp: lc, remember: true } }); ok(r.s === 200 && r.j.token && r.j.device, 'login with the OTP works');
  ok((await call('GET', '/me', { token: r.j.token })).j.user.mobile === M1, 'token works');
  const dev2 = r.j.device;
  const n2 = sent().length;
  r = await call('POST', '/auth/login', { body: { mobile: M1, password: PW, device: dev2 } }); ok(r.s === 200 && r.j.token && sent().length === n2, 'a remembered device skips the OTP');
  await sleep(1200);
  r = await call('POST', '/auth/login', { body: { mobile: M1, password: PW, device: 'not-a-real-device-token' } }); ok(r.s === 202, 'an unknown device token still needs the OTP');
  ok((await call('POST', '/auth/login', { body: { mobile: M1, password: 'wrong-pass', device: dev2 } })).s === 401, 'a remembered device does not skip the password');

  // ---- forgot password
  await sleep(1200);
  const n3 = sent().length;
  r = await call('POST', '/auth/otp/send', { body: { mobile: '9876500099', purpose: 'reset' } }); ok(r.s === 200 && sent().length === n3, 'reset for an unknown number looks the same but sends nothing');
  r = await call('POST', '/auth/otp/send', { body: { mobile: M1, purpose: 'reset' } }); ok(r.s === 200 && sent().length === n3 + 1, 'reset OTP sent for a real account');
  const rc = lastCode();
  ok((await call('POST', '/auth/reset', { body: { mobile: M1, otp: rc, password: 'short' } })).s === 400, 'reset checks the new password');
  r = await call('POST', '/auth/reset', { body: { mobile: M1, otp: rc, password: 'BrandNew#2026' } }); ok(r.s === 200 && r.j.token, 'reset works with the OTP');
  ok((await call('POST', '/auth/login', { body: { mobile: M1, password: PW } })).s === 401, 'old password no longer works');
  ok((await call('POST', '/auth/login', { body: { mobile: M1, password: 'BrandNew#2026', device: dev2 } })).s === 202, 'reset forgets remembered devices');
  ok((await call('POST', '/auth/reset', { body: { mobile: M1, otp: rc, password: 'Another#2026' } })).s === 400, 'reset OTP cannot be reused');

  // ---- WhatsApp only: asking for SMS is ignored, and a WhatsApp failure never falls back to SMS
  await sleep(1200);
  const M4 = '9876500004'; const w0 = sent().filter((x) => x.ch === 'wa').length;
  r = await call('POST', '/auth/otp/send', { body: { mobile: M4, purpose: 'register', channel: 'sms' } });
  ok(r.s === 200 && r.j.channel === 'whatsapp' && sent().filter((x) => x.ch === 'wa').length === w0 + 1, 'asking for SMS still sends on WhatsApp');
  await sleep(1200);
  writeFileSync(FAILWA, '1');
  r = await call('POST', '/auth/otp/send', { body: { mobile: '9876500005', purpose: 'register' } });
  ok(r.s === 502 && /WhatsApp/i.test(r.j.error) && !/SMS/i.test(r.j.error) && !r.text.includes('secret-token'), 'WhatsApp down gives a clear WhatsApp error and leaks no secrets');
  unlinkSync(FAILWA);
  ok(sent().filter((x) => x.ch === 'sms').length === 0, 'no SMS request was ever made during the whole test');

  // ---- website booking needs a verified mobile
  const BK = { name: 'Ravi Kumar', mobile: '9845012345', tests: ['Lipid Profile'], date: '2026-11-02', source: 'home' };
  ok((await call('POST', '/public/booking', { body: BK })).s === 403, 'booking without proof is refused');
  ok((await call('POST', '/public/booking', { body: { ...BK, proof: 'a.b' } })).s === 403, 'booking with a fake proof is refused');
  await call('POST', '/auth/otp/send', { body: { mobile: BK.mobile, purpose: 'booking' } }); const bc = lastCode();
  ok((await call('POST', '/auth/otp/verify', { body: { mobile: BK.mobile, otp: bc === '777777' ? '888888' : '777777' } })).s === 400, 'wrong booking OTP');
  r = await call('POST', '/auth/otp/verify', { body: { mobile: BK.mobile, otp: bc } }); ok(r.s === 200 && r.j.verified && r.j.proof, 'right booking OTP gives a proof');
  const proof = r.j.proof;
  ok((await call('POST', '/public/booking', { body: { ...BK, proof } })).s === 201, 'booking with the proof is saved');
  ok((await call('POST', '/public/booking', { body: { ...BK, mobile: '9845099999', proof } })).s === 403, 'a proof only works for the mobile that was verified');
} catch (e) { fail++; console.log('ERROR', e); }
srv.kill(); mock.kill(); rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
