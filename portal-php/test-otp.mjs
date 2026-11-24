// WhatsApp-OTP login tests with mock providers (Meta Cloud API and AiSensy). Run: node portal-php/test-otp.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'otp-'));
const P1 = Number(process.env.PORT || 8810), P2 = P1 + 1, P3 = P1 + 2, ORIGIN = 'http://localhost:8765';
const LOG = path.join(tmp, 'provider.log').replace(/\\/g, '/'), FAIL = path.join(tmp, 'fail').replace(/\\/g, '/');
writeFileSync(path.join(tmp, 'mock.php'), `<?php
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); $body = file_get_contents('php://input');
file_put_contents('${LOG}', json_encode(['path' => $p, 'body' => json_decode($body, true)]) . "\\n", FILE_APPEND);
if (file_exists('${FAIL}')) { http_response_code(400); echo json_encode(['message' => 'Template not approved']); exit; }
if (preg_match('#/messages$#', $p)) { echo json_encode(['messages' => [['id' => 'wamid.T']]]); exit; }
echo json_encode(['success' => true]);`);
const mk = (port, extra) => spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir, path.join(dir, 'index.php')], { cwd: dir, stdio: 'ignore',
  env: { ...process.env, PORTAL_STORAGE: mkdtempSync(path.join(tmpdir(), 'st-')), PORTAL_LAB_KEY: 'k', PORTAL_ORIGINS: ORIGIN, PORTAL_OTP_COOLDOWN: '0', ...extra } });
const meta = mk(P1, { PORTAL_OTP_PROVIDER: 'whatsapp', PORTAL_WA_PHONE_ID: '1234567', PORTAL_WA_TOKEN: 'tok', PORTAL_WA_BASE: `http://127.0.0.1:${P3}/v21.0` });
const ais = mk(P2, { PORTAL_OTP_PROVIDER: 'aisensy', PORTAL_AISENSY_KEY: 'key1', PORTAL_AISENSY_OTP: 'otp_login', PORTAL_AISENSY_BASE: `http://127.0.0.1:${P3}` });
const off = mk(P2 + 5, {});
const mock = spawn('php', ['-S', `127.0.0.1:${P3}`, path.join(tmp, 'mock.php')], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const api = (port) => async (method, p, body) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, t }; };
try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${P1}/`); await fetch(`http://127.0.0.1:${P2}/`); await fetch(`http://127.0.0.1:${P3}/x`); await fetch(`http://127.0.0.1:${P2 + 5}/`); break; } catch (e) { await sleep(150); } }
  // Meta Cloud API provider
  let c = api(P1), r = await c('GET', '/auth/config'); ok(r.j.otp === true && r.j.channels.join() === 'whatsapp', 'config: OTP on');
  r = await c('POST', '/auth/otp/send', { mobile: '9876543210', purpose: 'login' }); ok(r.s === 200 && r.j.sent && r.j.to === '98xxxxx210' && !r.j.devCode, 'OTP sent, code not revealed');
  let m = sent().pop(); ok(m.path.endsWith('/messages') && m.body.to === '919876543210' && m.body.template.components[0].parameters[0].text.length === 6, 'Meta: template message with a 6-digit code');
  const code = m.body.template.components[0].parameters[0].text;
  r = await c('POST', '/auth/otp/login', { mobile: '9876543210', otp: code === '111111' ? '222222' : '111111' }); ok(r.s === 400, 'wrong OTP refused');
  r = await c('POST', '/auth/otp/login', { mobile: '9876543210', otp: code, name: 'Asha Rao' }); ok(r.s === 200 && r.j.token && r.j.user.name === 'Asha Rao', 'right OTP creates the account and logs in');
  r = await c('POST', '/auth/otp/login', { mobile: '9876543210', otp: code }); ok(r.s === 400, 'an OTP works only once');
  for (const p of ['register', 'login', 'reset']) { r = await c('POST', '/auth/' + p, { mobile: '9876543210', password: 'x' }); ok(!r.j.token && r.s >= 400, 'no password route ' + p); }
  r = await c('POST', '/auth/otp/send', { mobile: '9876543210', purpose: 'reset' }); ok(r.s === 400, 'reset purpose no longer exists');
  // provider failure
  writeFileSync(FAIL.replace(/\//g, path.sep), '1');
  r = await c('POST', '/auth/otp/send', { mobile: '9123456780', purpose: 'login' }); ok(r.s === 502, 'provider failure gives a clear 502');
  // AiSensy provider
  require_unlink: { const fs = await import('node:fs'); fs.unlinkSync(FAIL.replace(/\//g, path.sep)); }
  c = api(P2); r = await c('POST', '/auth/otp/send', { mobile: '9123456780', purpose: 'login' }); ok(r.s === 200 && r.j.sent, 'AiSensy: OTP sent');
  m = sent().pop(); ok(m.path === '/campaign/t1/api/v2' && m.body.apiKey === 'key1' && m.body.campaignName === 'otp_login' && m.body.destination === '919123456780' && /^\d{6}$/.test(m.body.templateParams[0]), 'AiSensy: campaign payload');
  r = await c('POST', '/auth/otp/login', { mobile: '9123456780', otp: m.body.templateParams[0] }); ok(r.s === 200 && r.j.user.name === 'Customer', 'AiSensy: login works, default name');
  // switched off
  c = api(P2 + 5); r = await c('POST', '/auth/otp/send', { mobile: '9123456780', purpose: 'login' }); ok(r.s === 503, 'OTP off -> clear 503');
} catch (e) { fail++; console.log('ERR', e); }
[meta, ais, off, mock].forEach((p) => p.kill());
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
