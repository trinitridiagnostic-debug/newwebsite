// CRM tests: roles, scoping, intake channels, import. Run: node portal-php/test-crm.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url)), store = mkdtempSync(path.join(tmpdir(), 'crm-')), tmp = mkdtempSync(path.join(tmpdir(), 'crmm-'));
const P1 = Number(process.env.PORT || 8850), P2 = P1 + 1, B = `http://127.0.0.1:${P1}`, ORIGIN = 'http://localhost:8765';
writeFileSync(path.join(tmp, 'mock.php'), `<?php header('Content-Type: application/json'); echo json_encode(['field_data' => [['name' => 'full_name', 'values' => ['Meena Rao']], ['name' => 'phone_number', 'values' => ['+91 98450 11122']], ['name' => 'city', 'values' => ['Gadag']]], 'platform' => 'ig', 'form_name' => 'Health Checkup Offer']);`);
const srv = spawn('php', ['-S', `127.0.0.1:${P1}`, '-t', dir, path.join(dir, 'index.php')], { cwd: dir, stdio: 'ignore', env: { ...process.env, PORTAL_STORAGE: store, PORTAL_LAB_KEY: 'k', PORTAL_ORIGINS: ORIGIN, PORTAL_OTP_PROVIDER: 'dev', PORTAL_META_TOKEN: 'tok', PORTAL_META_SECRET: 'appsec', PORTAL_META_BASE: `http://127.0.0.1:${P2}`, PORTAL_PUBLIC_URL: 'https://trinetridiagnostics.com' } });
const mock = spawn('php', ['-S', `127.0.0.1:${P2}`, path.join(tmp, 'mock.php')], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, { body, token, raw, headers } = {}) {
  const h = { Origin: ORIGIN, ...(headers || {}) }; if (token) h.Authorization = 'Bearer ' + token; let b = raw; if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(B + p, { method, headers: h, body: b }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, t };
}
try {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/'); await fetch(`http://127.0.0.1:${P2}/x`); break; } catch (e) { await sleep(150); } }
  const A = (await call('POST', '/staff/setup', { body: { name: 'Owner', username: 'owner', password: 'Owner#2026', setup_code: 'k' } })).j.token;
  const mk = async (tok, role, username, extra = {}) => { const r = await call('POST', '/staff/crm/users', { token: tok, body: { name: username + ' user', username, role, password: 'Staff#2026', ...extra } }); return r; };
  const login = async (u) => (await call('POST', '/staff/login', { body: { username: u, password: 'Staff#2026' } })).j.token;
  // roles & team
  let r = await mk(A, 'manager', 'mgr1'); ok(r.s === 201, 'super admin creates a manager'); const MG = await login('mgr1');
  r = await mk(MG, 'teamlead', 'tl1'); ok(r.s === 201, 'manager creates a team leader'); const tl1 = r.j.user.id; const TL = await login('tl1');
  r = await mk(MG, 'teamlead', 'tl2'); const TL2 = await login('tl2');
  ok((await mk(MG, 'manager', 'mgr2')).s === 403, 'manager cannot create another manager');
  r = await mk(TL, 'telecaller', 'tc1'); ok(r.s === 201 && r.j.user.team_lead === tl1, 'team leader creates a telecaller in own team'); const tc1 = r.j.user.id; const TC1 = await login('tc1');
  r = await mk(TL2, 'telecaller', 'tc2'); const tc2 = r.j.user.id; const TC2 = await login('tc2');
  ok((await mk(TL, 'teamlead', 'tl3')).s === 403, 'team leader cannot create a team leader');
  await mk(MG, 'marketing', 'dm1'); const DM = await login('dm1');
  ok((await mk(TC1, 'telecaller', 'tcx')).s === 403, 'telecaller cannot create staff');
  // CRM roles are locked out of the lab
  for (const tok of [TC1, DM, TL, MG]) ok((await call('GET', '/staff/orders', { token: tok })).s === 403 && (await call('GET', '/staff/users', { token: tok })).s === 403 && (await call('GET', '/staff/dashboard', { token: tok })).s === 403, 'CRM role cannot open lab routes');
  ok((await call('GET', '/staff/crm/leads', { token: (await call('POST', '/staff/login', { body: { username: 'owner', password: 'Owner#2026' } })).j.token })).s === 200, 'super admin can open CRM');
  // intake channels
  r = await call('GET', '/staff/crm/settings', { token: MG }); const key = r.j.intake_key; ok(r.s === 200 && key.length > 10, 'manager sees the intake key');
  ok((await call('GET', '/staff/crm/settings', { token: TC1 })).s === 403, 'telecaller cannot see integration settings');
  ok((await call('POST', '/crm/in/justdial?key=bad', { body: { name: 'X', mobile: '9811111111' } })).s === 403, 'intake refuses a wrong key');
  r = await call('POST', `/crm/in/justdial?key=${key}`, { body: { name: 'Ravi JD', mobile: '9811111111', category: 'Blood tests', city: 'Gadag', leadid: 'JD-1' } }); ok(r.s === 200 && r.j.created === true, 'Justdial lead created');
  r = await call('GET', `/crm/in/facebook?key=${key}&name=Anita&phone=%2B91%2098222%2033344&campaign=Diwali`, {}); ok(r.s === 200 && r.j.created === true, 'Facebook lead via GET query');
  r = await call('POST', `/crm/in/justdial?key=${key}`, { body: { name: 'Ravi JD', mobile: '98111 11111', leadid: 'JD-2' } }); ok(r.j.created === false, 'same mobile is not duplicated');
  r = await call('POST', `/crm/in/instagram`, { body: { name: 'NoKey', mobile: '9833333333' }, headers: { 'X-CRM-Key': key } }); ok(r.s === 200 && r.j.created, 'key in header works');
  ok((await call('POST', `/crm/in/website?key=${key}`, { body: { name: 'Bad', mobile: '12345' } })).s === 400, 'bad mobile refused');
  // WhatsApp inbound
  r = await call('POST', '/wa/webhook', { body: { entry: [{ changes: [{ value: { contacts: [{ wa_id: '919844000001', profile: { name: 'Geeta' } }], messages: [{ from: '919844000001', id: 'wamid.1', text: { body: 'Need CBC test price' } }] } }] }] } }); ok(r.s === 200, 'WhatsApp webhook accepts');
  // Meta lead ads webhook
  const metaBody = JSON.stringify({ entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: '555' } }] }] });
  ok((await call('POST', '/crm/meta', { raw: metaBody, headers: { 'X-Hub-Signature-256': 'sha256=bad', 'Content-Type': 'application/json' } })).s === 403, 'Meta webhook bad signature refused');
  r = await call('POST', '/crm/meta', { raw: metaBody, headers: { 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', 'appsec').update(metaBody).digest('hex'), 'Content-Type': 'application/json' } }); ok(r.s === 200, 'Meta webhook accepted');
  r = await call('GET', `/crm/meta?hub.mode=subscribe&hub.verify_token=${key}&hub.challenge=abc123`); ok(r.t === 'abc123', 'Meta verification handshake');
  // manager sees everything
  r = await call('GET', '/staff/crm/leads?limit=100', { token: MG }); const srcs = r.j.leads.map((l) => l.source + ':' + l.name);
  ok(r.j.total === 5 && srcs.includes('instagram:Meena Rao') && srcs.some((x) => x.startsWith('whatsapp:Geeta')) && srcs.some((x) => x.startsWith('justdial:')) && srcs.some((x) => x.startsWith('facebook:')), 'all channels landed as leads (' + srcs.join(', ') + ')');
  // auto assign
  ok((await call('POST', '/staff/crm/settings', { token: MG, body: { auto_assign: true } })).j.auto_assign === true, 'auto-assign switched on');
  await call('POST', `/crm/in/facebook?key=${key}`, { body: { name: 'Auto One', mobile: '9844555501' } }); await call('POST', `/crm/in/facebook?key=${key}`, { body: { name: 'Auto Two', mobile: '9844555502' } });
  r = await call('GET', '/staff/crm/leads?q=Auto', { token: MG }); ok(r.j.leads.length === 2 && new Set(r.j.leads.map((l) => l.assigned_to)).size === 2, 'auto-assign spreads leads across telecallers');
  // scoping
  r = await call('GET', '/staff/crm/leads', { token: TC1 }); ok(r.j.leads.every((l) => l.assigned_to === tc1) && r.j.leads.length === 1, 'telecaller sees only own leads');
  const mine = r.j.leads[0];
  r = await call('GET', '/staff/crm/leads', { token: TL }); ok(r.j.leads.some((l) => l.assigned_to === null) && !r.j.leads.some((l) => l.assigned_to === tc2), 'team leader sees own team + unassigned, not another team');
  r = await call('GET', '/staff/crm/leads', { token: DM }); ok(r.j.total === 7, 'marketing views all leads');
  const other = (await call('GET', '/staff/crm/leads?q=Auto', { token: MG })).j.leads.find((l) => l.assigned_to === tc2);
  ok((await call('GET', `/staff/crm/leads/${other.id}`, { token: TC1 })).s === 404, 'telecaller cannot open a lead of another telecaller');
  // editing
  r = await call('POST', `/staff/crm/leads/${mine.id}`, { token: TC1, body: { status: 'interested', next_follow: Date.now() + 3600000, city: 'Hubballi' } }); ok(r.s === 200 && r.j.lead.status === 'interested' && r.j.lead.city === 'Hubballi', 'telecaller updates own lead');
  ok((await call('POST', `/staff/crm/leads/${mine.id}/note`, { token: TC1, body: { text: 'Called, will visit Saturday' } })).s === 200, 'telecaller adds a note');
  r = await call('GET', `/staff/crm/leads/${mine.id}`, { token: TC1 }); ok(r.j.log.some((x) => x.text.includes('Saturday')) && r.j.log.some((x) => x.kind === 'status') && r.j.can_edit && !r.j.can_assign && !r.j.can_delete, 'timeline shows note and status change; flags correct');
  ok((await call('POST', `/staff/crm/leads/${mine.id}/assign`, { token: TC1, body: { to: tc2 } })).s === 403, 'telecaller cannot reassign');
  ok((await call('POST', `/staff/crm/leads/${mine.id}/delete`, { token: TL })).s === 403, 'team leader cannot delete');
  ok((await call('POST', `/staff/crm/leads/${mine.id}`, { token: DM, body: { status: 'lost' } })).s === 403, 'marketing cannot edit leads');
  ok((await call('POST', `/staff/crm/leads/${mine.id}/assign`, { token: TL, body: { to: tl1 } })).s === 200, 'team leader reassigns within scope');
  r = await call('POST', '/staff/crm/leads', { token: TC1, body: { name: 'Manual Lead', mobile: '9844666601', interest: 'Thyroid', source: 'walkin' } }); ok(r.s === 201 && r.j.lead.assigned_to === tc1 && r.j.lead.source === 'walkin', 'telecaller creates a lead assigned to self');
  ok((await call('POST', '/staff/crm/leads', { token: TC1, body: { name: 'Dup', mobile: '9844666601' } })).s === 409, 'manual duplicate warns');
  // import
  const rows = [{ name: 'Imp One', mobile: '9877000001', city: 'Gadag', source: 'Justdial' }, { name: 'Imp Two', mobile: '9877000002' }, { name: 'Dupe', mobile: '9877000001' }, { name: 'Bad', mobile: '555' }];
  ok((await call('POST', '/staff/crm/import', { token: TC1, body: { rows } })).s === 403, 'telecaller cannot import');
  r = await call('POST', '/staff/crm/import', { token: DM, body: { rows } }); ok(r.j.added === 2 && r.j.duplicates === 1 && r.j.invalid === 1, 'marketing imports: 2 added, 1 duplicate, 1 invalid');
  r = await call('GET', '/staff/crm/leads?q=Imp', { token: MG }); ok(r.j.leads.find((l) => l.name === 'Imp One').source === 'justdial', 'import keeps the source column');
  // bulk
  const ids = r.j.leads.map((l) => l.id);
  ok((await call('POST', '/staff/crm/bulk', { token: MG, body: { action: 'assign', ids, to: tc1 } })).j.changed === 2, 'bulk assign');
  ok((await call('POST', '/staff/crm/bulk', { token: TL, body: { action: 'delete', ids } })).s === 403, 'team leader bulk delete refused');
  ok((await call('POST', '/staff/crm/bulk', { token: MG, body: { action: 'delete', ids } })).j.changed === 2, 'manager bulk delete');
  // summary
  r = await call('GET', '/staff/crm/summary', { token: MG }); ok(r.j.total >= 7 && r.j.by_source.justdial >= 1 && r.j.today >= 7, 'summary counts');
  r = await call('GET', '/staff/crm/summary', { token: TC1 }); ok(r.j.total === 1, 'telecaller summary is only their own');
  // disabling a telecaller releases open leads
  r = await call('POST', `/staff/crm/users/${tc1}`, { token: TL, body: { active: false } }); ok(r.s === 200 && r.j.user.active === false, 'team leader disables own telecaller');
  ok((await call('POST', `/staff/crm/users/${tc2}`, { token: TL, body: { active: false } })).s === 404, 'team leader cannot manage another team');
  ok((await call('POST', '/staff/login', { body: { username: 'tc1', password: 'Staff#2026' } })).s !== 200, 'disabled telecaller cannot log in');
  console.log(`${pass} passed, ${fail} failed`);
} finally { srv.kill(); mock.kill(); }
process.exit(fail ? 1 : 0);
