<?php
/* Customer-care CRM: leads from Facebook, Instagram, WhatsApp, Justdial, website and Excel, with telecaller / marketing / team leader / manager / super admin roles. */

const CRM_STATUSES = ['new', 'contacted', 'interested', 'follow_up', 'booked', 'not_interested', 'wrong_number', 'lost'];
const CRM_CLOSED = ['booked', 'not_interested', 'wrong_number', 'lost'];
const CRM_SOURCES = ['facebook', 'instagram', 'whatsapp', 'justdial', 'website', 'excel', 'manual', 'referral', 'walkin', 'other'];
const CRM_ROLES = ['telecaller', 'marketing', 'teamlead', 'manager'];

function crmSetting($k, $def = '') { $r = one('SELECT v FROM crm_settings WHERE k=?', [$k]); return $r ? (string)$r['v'] : $def; }
function crmSet($k, $v) { if (one('SELECT 1 AS x FROM crm_settings WHERE k=?', [$k])) q('UPDATE crm_settings SET v=? WHERE k=?', [(string)$v, $k]); else q('INSERT INTO crm_settings (k, v) VALUES (?,?)', [$k, (string)$v]); }
function crmKey() { $k = crmSetting('intake_key'); if ($k === '') { $k = rnd(18); crmSet('intake_key', $k); } return $k; }
function crmMobile($v) { $d = preg_replace('/\D/', '', (string)$v); if (strlen($d) > 10) $d = substr($d, -10); return preg_match('/^[6-9]\d{9}$/', $d) ? $d : ''; }
function crmSource($v) { $v = strtolower(trim((string)$v)); $map = ['fb' => 'facebook', 'insta' => 'instagram', 'ig' => 'instagram', 'wa' => 'whatsapp', 'jd' => 'justdial', 'just dial' => 'justdial', 'web' => 'website', 'walk-in' => 'walkin', 'walk in' => 'walkin']; $v = $map[$v] ?? $v; return in_array($v, CRM_SOURCES, true) ? $v : 'other'; }
function crmLog($lid, $sid, $kind, $text) { q('INSERT INTO lead_log (lead_id, staff_id, kind, text, created) VALUES (?,?,?,?,?)', [$lid, $sid, $kind, clean($text, 500), nowms()]); }

/* which leads a person may see */
function crmScope($s) {
  if (staff_can($s, 'crm_all')) return ['1=1', []];
  if (staff_can($s, 'crm_team')) return ["(assigned_to=? OR assigned_to IS NULL OR assigned_to='' OR assigned_to IN (SELECT id FROM staff WHERE team_lead=?))", [$s['id'], $s['id']]];
  return ['assigned_to=?', [$s['id']]];
}
function crmCanEdit($s, $l) {
  if (staff_can($s, 'crm_all') && staff_can($s, 'crm_edit')) return true;
  if (staff_can($s, 'crm_team') && staff_can($s, 'crm_edit')) { if (!$l['assigned_to']) return true; if ($l['assigned_to'] === $s['id']) return true; $m = one('SELECT team_lead FROM staff WHERE id=?', [$l['assigned_to']]); return $m && $m['team_lead'] === $s['id']; }
  return $l['assigned_to'] === $s['id'] && staff_can($s, 'crm');
}
function crmLeadScoped($s, $id) { list($w, $p) = crmScope($s); $l = one("SELECT * FROM leads WHERE id=? AND $w", array_merge([$id], $p)); if (!$l) throw new HttpErr(404, 'Lead not found.'); return $l; }
function crmView($l) {
  $a = $l['assigned_to'] ? one('SELECT name FROM staff WHERE id=?', [$l['assigned_to']]) : null;
  return ['id' => $l['id'], 'name' => $l['name'], 'mobile' => $l['mobile'], 'email' => (string)$l['email'], 'city' => (string)$l['city'], 'source' => $l['source'], 'campaign' => (string)$l['campaign'], 'interest' => (string)$l['interest'], 'status' => $l['status'],
    'assigned_to' => $l['assigned_to'] ?: null, 'assignee' => $a ? $a['name'] : '', 'next_follow' => $l['next_follow'] !== null ? (int)$l['next_follow'] : null, 'order_code' => (string)$l['order_code'], 'created' => (int)$l['created'], 'updated' => (int)$l['updated']];
}
function crmTeamMembers($s) { return all("SELECT id FROM staff WHERE team_lead=? AND active=1", [$s['id']]); }

/* round robin: the active telecaller with the fewest open leads */
function crmAutoAssign() {
  if (crmSetting('auto_assign', '0') !== '1') return null;
  $row = one("SELECT s.id, (SELECT COUNT(*) FROM leads l WHERE l.assigned_to=s.id AND l.status NOT IN ('booked','not_interested','wrong_number','lost')) AS n FROM staff s WHERE s.role='telecaller' AND s.active=1 ORDER BY n ASC, s.created ASC LIMIT 1");
  return $row ? $row['id'] : null;
}

/* the one door every channel uses. Same mobile again = a note on the existing lead, not a duplicate. Returns [id, isNew]. */
function crmIngest($source, $d, $by = null, $assign = null) {
  $mobile = crmMobile($d['mobile'] ?? ''); if ($mobile === '') throw bad('A valid 10-digit mobile number is needed.');
  $name = clean($d['name'] ?? '', 80); if ($name === '') $name = 'Lead ' . $mobile;
  $ext = clean($d['ext_id'] ?? '', 60);
  if ($ext !== '' && one('SELECT 1 AS x FROM leads WHERE ext_id=?', [$ext])) return [one('SELECT id FROM leads WHERE ext_id=?', [$ext])['id'], false];
  $ex = one('SELECT * FROM leads WHERE mobile=? ORDER BY created DESC', [$mobile]);
  if ($ex) {
    $re = in_array($ex['status'], ['not_interested', 'lost'], true);
    q('UPDATE leads SET updated=?' . ($re ? ", status='new'" : '') . ' WHERE id=?', [nowms(), $ex['id']]);
    crmLog($ex['id'], $by, 'again', 'Enquired again via ' . $source . (clean($d['interest'] ?? '', 120) !== '' ? ' for ' . clean($d['interest'], 120) : '') . ($re ? ' (reopened)' : ''));
    return [$ex['id'], false];
  }
  $id = rnd(9); $to = $assign ?: crmAutoAssign(); $now = nowms();
  q('INSERT INTO leads (id, name, mobile, email, city, source, campaign, interest, status, assigned_to, created_by, created, updated, ext_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [$id, $name, $mobile, clean($d['email'] ?? '', 120), clean($d['city'] ?? '', 60), $source, clean($d['campaign'] ?? '', 80), clean($d['interest'] ?? '', 160), 'new', $to, $by, $now, $now, $ext !== '' ? $ext : null]);
  crmLog($id, $by, 'created', 'Lead created from ' . $source . ($to ? ' and assigned automatically' : ''));
  if (!empty($d['message'])) crmLog($id, null, 'note', 'Message: ' . clean($d['message'], 400));
  return [$id, true];
}

/* ---------- public intake: /crm/in/{source}, /crm/meta, WhatsApp ---------- */
function crmPick($a, $keys) { foreach ($keys as $k) { foreach ($a as $kk => $v) if (strtolower((string)$kk) === $k && is_scalar($v) && trim((string)$v) !== '') return (string)$v; } return ''; }
function crmIntake($source) {
  $key = (string)($_SERVER['HTTP_X_CRM_KEY'] ?? ($_GET['key'] ?? ''));
  if (!hash_equals(crmKey(), $key)) throw new HttpErr(403, 'Invalid key.');
  $raw = (string)file_get_contents('php://input'); $j = json_decode($raw, true); $a = is_array($j) ? $j : array_merge($_GET, $_POST);
  if (isset($a['data']) && is_array($a['data'])) $a = array_merge($a, $a['data']);                // wrapper some tools add
  $d = ['name' => crmPick($a, ['name', 'full_name', 'fullname', 'customer_name', 'prefix_name']), 'mobile' => crmPick($a, ['mobile', 'phone', 'phone_number', 'mobile_number', 'contact', 'contact_number', 'whatsapp']),
    'email' => crmPick($a, ['email', 'email_address']), 'city' => crmPick($a, ['city', 'area', 'location']), 'interest' => crmPick($a, ['interest', 'category', 'test', 'product', 'service', 'enquiry', 'query']),
    'campaign' => crmPick($a, ['campaign', 'campaign_name', 'form_name', 'ad_name']), 'message' => crmPick($a, ['message', 'comments', 'remarks']), 'ext_id' => crmPick($a, ['leadid', 'lead_id', 'id'])];
  if ($d['ext_id'] !== '') $d['ext_id'] = $source . ':' . $d['ext_id'];
  list($id, $new) = crmIngest(crmSource($source), $d);
  out(['ok' => true, 'lead' => $id, 'created' => $new]);
}
function crmHttpGet($url) {
  if (!function_exists('curl_init')) throw new Exception('PHP curl is not enabled on this host.');
  $ch = curl_init($url); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 6]);
  $res = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch); return [$code, json_decode((string)$res, true) ?: []];
}
/* Facebook / Instagram Lead Ads webhook */
function crmMeta() {
  $c = cfg();
  if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $ok = ($_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '') === 'subscribe' && hash_equals(crmKey(), (string)($_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? ''));
    if (!$ok) { http_response_code(403); echo 'Forbidden'; exit; }
    header('Content-Type: text/plain'); echo (string)($_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? ''); exit;
  }
  $raw = (string)file_get_contents('php://input');
  if ($c['meta_app_secret'] !== '') { $sig = (string)($_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? ''); if (!hash_equals('sha256=' . hash_hmac('sha256', $raw, $c['meta_app_secret']), $sig)) throw new HttpErr(403, 'Bad signature.'); }
  $e = json_decode($raw, true) ?: [];
  foreach (($e['entry'] ?? []) as $en) foreach (($en['changes'] ?? []) as $ch) {
    if (($ch['field'] ?? '') !== 'leadgen') continue; $lg = (string)($ch['value']['leadgen_id'] ?? ''); if ($lg === '' || $c['meta_page_token'] === '') continue;
    try {
      list($st, $j) = crmHttpGet(rtrim($c['meta_graph_base'], '/') . '/' . rawurlencode($lg) . '?access_token=' . rawurlencode($c['meta_page_token']));
      if ($st < 200 || $st >= 300) { error_log('[trinetri-portal] meta lead ' . $st . ' ' . json_encode($j)); continue; }
      $f = []; foreach (($j['field_data'] ?? []) as $x) $f[strtolower((string)$x['name'])] = (string)(($x['values'] ?? [''])[0] ?? '');
      $plat = (($j['platform'] ?? '') === 'ig' || ($ch['value']['platform'] ?? '') === 'ig') ? 'instagram' : 'facebook';
      crmIngest($plat, ['name' => crmPick($f, ['full_name', 'name', 'first_name']), 'mobile' => crmPick($f, ['phone_number', 'phone', 'mobile', 'mobile_number']), 'email' => crmPick($f, ['email']), 'city' => crmPick($f, ['city']),
        'campaign' => (string)($j['form_name'] ?? $j['ad_name'] ?? $j['campaign_name'] ?? ''), 'interest' => crmPick($f, ['interest', 'test', 'service']), 'ext_id' => 'meta:' . $lg]);
    } catch (Throwable $x) { error_log('[trinetri-portal] meta lead: ' . $x->getMessage()); }
  }
  http_response_code(200); header('Content-Type: text/plain'); echo 'OK'; exit;
}
/* called by the existing WhatsApp webhook for each inbound message */
function crmFromWhatsApp($payload) {
  foreach (($payload['entry'] ?? []) as $en) foreach (($en['changes'] ?? []) as $ch) {
    $v = $ch['value'] ?? []; $names = []; foreach (($v['contacts'] ?? []) as $c) $names[$c['wa_id'] ?? ''] = $c['profile']['name'] ?? '';
    foreach (($v['messages'] ?? []) as $msg) {
      $from = (string)($msg['from'] ?? ''); $mob = crmMobile($from); if ($mob === '') continue;
      $text = (string)($msg['text']['body'] ?? ($msg['button']['text'] ?? ''));
      try { crmIngest('whatsapp', ['name' => $names[$from] ?? '', 'mobile' => $mob, 'message' => $text, 'ext_id' => 'wa:' . (string)($msg['id'] ?? '')]); } catch (Throwable $e) { error_log('[trinetri-portal] wa lead: ' . $e->getMessage()); }
    }
  }
}

/* ---------- staff-side routes ---------- */
function crmUserView($u) { $n = one("SELECT COUNT(*) AS n FROM leads WHERE assigned_to=? AND status NOT IN ('booked','not_interested','wrong_number','lost')", [$u['id']]); $tl = !empty($u['team_lead']) ? one('SELECT name FROM staff WHERE id=?', [$u['team_lead']]) : null;
  return ['id' => $u['id'], 'name' => $u['name'], 'username' => $u['username'], 'role' => $u['role'], 'active' => (int)$u['active'] === 1, 'team_lead' => $u['team_lead'] ?: null, 'team_lead_name' => $tl ? $tl['name'] : '', 'open' => (int)$n['n'], 'mobile' => (string)($u['mobile'] ?? '')]; }
function crmCreatableRoles($s) { if ($s['role'] === 'admin') return CRM_ROLES; if (staff_can($s, 'crm_staff') && $s['role'] === 'manager') return ['telecaller', 'marketing', 'teamlead']; if (staff_can($s, 'crm_staff') && $s['role'] === 'teamlead') return ['telecaller']; return []; }
function crmCanManageUser($s, $u) { if (!in_array($u['role'], CRM_ROLES, true)) return false; if ($s['role'] === 'admin') return true; if ($s['role'] === 'manager') return $u['role'] !== 'manager'; if ($s['role'] === 'teamlead') return $u['role'] === 'telecaller' && $u['team_lead'] === $s['id']; return false; }

function crmRoutes($path, $m, $s) {
  if (strpos($path, '/staff/crm') !== 0) return;
  need($s, 'crm');
  $b = null;
  if ($path === '/staff/crm/summary' && $m === 'GET') {
    list($w, $p) = crmScope($s); $by = []; foreach (all("SELECT status, COUNT(*) AS n FROM leads WHERE $w GROUP BY status", $p) as $r) $by[$r['status']] = (int)$r['n'];
    $src = []; foreach (all("SELECT source, COUNT(*) AS n FROM leads WHERE $w GROUP BY source", $p) as $r) $src[$r['source']] = (int)$r['n'];
    $ist = new DateTimeZone('Asia/Kolkata'); $t0 = (new DateTime('today', $ist))->getTimestamp() * 1000; $t1 = $t0 + 86400000; $m0 = (new DateTime('first day of this month 00:00', $ist))->getTimestamp() * 1000;
    $new = one("SELECT COUNT(*) AS n FROM leads WHERE $w AND created>=?", array_merge($p, [$t0]))['n'];
    $due = one("SELECT COUNT(*) AS n FROM leads WHERE $w AND next_follow IS NOT NULL AND next_follow<? AND status NOT IN ('booked','not_interested','wrong_number','lost')", array_merge($p, [$t1]))['n'];
    $unas = one("SELECT COUNT(*) AS n FROM leads WHERE $w AND (assigned_to IS NULL OR assigned_to='') AND status NOT IN ('booked','not_interested','wrong_number','lost')", $p)['n'];
    $won = one("SELECT COUNT(*) AS n FROM leads WHERE $w AND status='booked' AND updated>=?", array_merge($p, [$m0]))['n'];
    out(['by_status' => $by, 'by_source' => $src, 'today' => (int)$new, 'due' => (int)$due, 'unassigned' => (int)$unas, 'booked_month' => (int)$won, 'total' => array_sum($by)]);
  }
  if ($path === '/staff/crm/leads' && $m === 'GET') {
    list($w, $p) = crmScope($s); $c = [$w]; $ps = $p;
    $st = (string)($_GET['status'] ?? ''); if ($st === 'open') { $c[] = "status NOT IN ('booked','not_interested','wrong_number','lost')"; } elseif (in_array($st, CRM_STATUSES, true)) { $c[] = 'status=?'; $ps[] = $st; }
    $so = (string)($_GET['source'] ?? ''); if (in_array($so, CRM_SOURCES, true)) { $c[] = 'source=?'; $ps[] = $so; }
    $as = (string)($_GET['assignee'] ?? ''); if ($as === 'none') $c[] = "(assigned_to IS NULL OR assigned_to='')"; elseif ($as !== '') { $c[] = 'assigned_to=?'; $ps[] = $as; }
    if (!empty($_GET['due'])) { $t1 = (new DateTime('tomorrow', new DateTimeZone('Asia/Kolkata')))->getTimestamp() * 1000; $c[] = "next_follow IS NOT NULL AND next_follow<? AND status NOT IN ('booked','not_interested','wrong_number','lost')"; $ps[] = $t1; }
    $q = trim((string)($_GET['q'] ?? '')); if ($q !== '') { $c[] = '(name LIKE ? OR mobile LIKE ? OR email LIKE ? OR city LIKE ?)'; $lk = '%' . str_replace(['%', '_'], ['', ''], $q) . '%'; array_push($ps, $lk, $lk, $lk, $lk); }
    $where = implode(' AND ', $c); $lim = max(1, min(5000, (int)($_GET['limit'] ?? 50))); $off = max(0, (int)($_GET['offset'] ?? 0));
    $tot = (int)one("SELECT COUNT(*) AS n FROM leads WHERE $where", $ps)['n'];
    $rows = all("SELECT * FROM leads WHERE $where ORDER BY created DESC LIMIT $lim OFFSET $off", $ps);
    out(['total' => $tot, 'leads' => array_map('crmView', $rows)]);
  }
  if ($path === '/staff/crm/leads' && $m === 'POST') {
    need($s, 'crm_add'); $b = body();
    $mob = crmMobile(field($b, 'mobile')); if ($mob === '') throw bad('Enter a valid 10-digit mobile number.'); if (clean(field($b, 'name'), 80) === '') throw bad('Enter the name.');
    $ex = one('SELECT l.*, s.name AS an FROM leads l LEFT JOIN staff s ON s.id=l.assigned_to WHERE l.mobile=?', [$mob]);
    if ($ex) throw new HttpErr(409, 'This number is already a lead: ' . $ex['name'] . ' (' . str_replace('_', ' ', $ex['status']) . ($ex['an'] ? ', with ' . $ex['an'] : ', not assigned') . ').');
    $to = clean(field($b, 'assigned_to'), 32); if (!staff_can($s, 'crm_assign') || $to === '') $to = in_array($s['role'], ['telecaller', 'teamlead'], true) ? $s['id'] : null;
    if ($to && !one("SELECT 1 AS x FROM staff WHERE id=? AND active=1 AND role IN ('telecaller','teamlead','manager')", [$to])) throw bad('Choose a valid person to assign.');
    list($id) = crmIngest(crmSource(field($b, 'source') ?: 'manual'), array_merge($b, ['mobile' => $mob]), $s['id'], $to);
    $nf = field($b, 'next_follow'); if (is_numeric($nf) && (int)$nf > 0) q('UPDATE leads SET next_follow=? WHERE id=?', [(int)$nf, $id]);
    out(['lead' => crmView(one('SELECT * FROM leads WHERE id=?', [$id]))], 201);
  }
  if ($path === '/staff/crm/import' && $m === 'POST') {
    need($s, 'crm_import'); $b = body(2500000); $rows = (array)($b['rows'] ?? []); if (count($rows) > 1000) throw bad('Send at most 1000 rows at a time.');
    $to = clean(field($b, 'assign_to'), 32); if ($to !== '' && (!staff_can($s, 'crm_assign') || !one("SELECT 1 AS x FROM staff WHERE id=? AND active=1", [$to]))) $to = '';
    $add = 0; $dup = 0; $bad = []; $defSrc = crmSource(field($b, 'source') ?: 'excel');
    foreach ($rows as $i => $r) {
      if (!is_array($r)) continue;
      try { $src = !empty($r['source']) ? crmSource($r['source']) : $defSrc; list($id, $new) = crmIngest($src, $r, $s['id'], $to ?: null); if ($new) $add++; else $dup++; }
      catch (HttpErr $e) { if (count($bad) < 20) $bad[] = 'Row ' . ($i + 1) . ': ' . $e->getMessage(); else $bad[] = null; }
    }
    $bad = array_values(array_filter($bad)); out(['added' => $add, 'duplicates' => $dup, 'invalid' => count($rows) - $add - $dup, 'problems' => $bad]);
  }
  if ($path === '/staff/crm/bulk' && $m === 'POST') {
    $b = body(); $ids = array_slice(array_filter((array)($b['ids'] ?? []), 'is_string'), 0, 500); $act = (string)field($b, 'action'); $n = 0;
    if ($act === 'assign') need($s, 'crm_assign'); elseif ($act === 'delete') need($s, 'crm_delete'); elseif ($act === 'status') {} else throw bad('Unknown action.');
    $to = clean(field($b, 'to'), 32); $stt = (string)field($b, 'status');
    if ($act === 'assign' && $to !== '' && !one("SELECT 1 AS x FROM staff WHERE id=? AND active=1 AND role IN ('telecaller','teamlead','manager')", [$to])) throw bad('Choose a valid person to assign.');
    if ($act === 'status' && !in_array($stt, CRM_STATUSES, true)) throw bad('Choose a status.');
    foreach ($ids as $id) {
      $l = null; try { $l = crmLeadScoped($s, $id); } catch (HttpErr $e) { continue; }
      if ($act === 'delete') { q('DELETE FROM lead_log WHERE lead_id=?', [$id]); q('DELETE FROM leads WHERE id=?', [$id]); $n++; continue; }
      if (!crmCanEdit($s, $l) && $act !== 'assign') continue;
      if ($act === 'assign') { q('UPDATE leads SET assigned_to=?, updated=? WHERE id=?', [$to !== '' ? $to : null, nowms(), $id]); $nm = $to !== '' ? one('SELECT name FROM staff WHERE id=?', [$to])['name'] : 'nobody'; crmLog($id, $s['id'], 'assign', 'Assigned to ' . $nm); }
      else { q('UPDATE leads SET status=?, updated=? WHERE id=?', [$stt, nowms(), $id]); crmLog($id, $s['id'], 'status', 'Status set to ' . str_replace('_', ' ', $stt)); }
      $n++;
    }
    out(['changed' => $n]);
  }
  if (preg_match('#^/staff/crm/leads/([^/]+)(?:/(note|assign|delete))?$#', $path, $r)) {
    $id = rawurldecode($r[1]); $act = $r[2] ?? ''; $l = crmLeadScoped($s, $id);
    if ($m === 'GET' && $act === '') {
      $log = all('SELECT g.*, s.name AS who FROM lead_log g LEFT JOIN staff s ON s.id=g.staff_id WHERE g.lead_id=? ORDER BY g.created DESC, g.id DESC LIMIT 100', [$id]);
      out(['lead' => crmView($l), 'can_edit' => crmCanEdit($s, $l), 'can_assign' => staff_can($s, 'crm_assign'), 'can_delete' => staff_can($s, 'crm_delete'),
        'log' => array_map(function ($g) { return ['kind' => $g['kind'], 'text' => $g['text'], 'who' => $g['who'] ?: 'System', 'at' => (int)$g['created']]; }, $log)]);
    }
    if ($m !== 'POST') throw new HttpErr(405, 'Method not allowed');
    if ($act === 'delete') { need($s, 'crm_delete'); q('DELETE FROM lead_log WHERE lead_id=?', [$id]); q('DELETE FROM leads WHERE id=?', [$id]); out(['ok' => true]); }
    if ($act === 'note') {
      if (!crmCanEdit($s, $l) && !staff_can($s, 'crm_all')) throw new HttpErr(403, 'Your role does not allow this.');
      $t = clean(field(body(), 'text'), 500); if ($t === '') throw bad('Write the note.'); crmLog($id, $s['id'], 'note', $t); q('UPDATE leads SET updated=? WHERE id=?', [nowms(), $id]); out(['ok' => true]);
    }
    if ($act === 'assign') {
      need($s, 'crm_assign'); $to = clean(field(body(), 'to'), 32);
      if ($to !== '' && !one("SELECT 1 AS x FROM staff WHERE id=? AND active=1 AND role IN ('telecaller','teamlead','manager')", [$to])) throw bad('Choose a valid person to assign.');
      q('UPDATE leads SET assigned_to=?, updated=? WHERE id=?', [$to !== '' ? $to : null, nowms(), $id]); crmLog($id, $s['id'], 'assign', 'Assigned to ' . ($to !== '' ? one('SELECT name FROM staff WHERE id=?', [$to])['name'] : 'nobody'));
      out(['lead' => crmView(one('SELECT * FROM leads WHERE id=?', [$id]))]);
    }
    if (!crmCanEdit($s, $l)) throw new HttpErr(403, 'Your role does not allow editing this lead.');
    $b = body(); $set = []; $pp = [];
    foreach (['name' => 80, 'email' => 120, 'city' => 60, 'campaign' => 80, 'interest' => 160, 'order_code' => 30] as $f => $max) if (array_key_exists($f, $b)) { $v = clean($b[$f], $max); if ($f === 'name' && $v === '') throw bad('Enter the name.'); $set[] = "$f=?"; $pp[] = $v; }
    if (array_key_exists('mobile', $b)) { $mob = crmMobile($b['mobile']); if ($mob === '') throw bad('Enter a valid 10-digit mobile number.'); if ($mob !== $l['mobile'] && one('SELECT 1 AS x FROM leads WHERE mobile=? AND id<>?', [$mob, $id])) throw bad('Another lead already has this number.'); $set[] = 'mobile=?'; $pp[] = $mob; }
    if (array_key_exists('source', $b)) { $set[] = 'source=?'; $pp[] = crmSource($b['source']); }
    if (array_key_exists('next_follow', $b)) { $nf = $b['next_follow']; $set[] = 'next_follow=?'; $pp[] = (is_numeric($nf) && (int)$nf > 0) ? (int)$nf : null; if (is_numeric($nf) && (int)$nf > 0) crmLog($id, $s['id'], 'follow', 'Follow-up set for ' . (new DateTime('@' . intdiv((int)$nf, 1000)))->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('d-m-Y h:i A')); }
    if (array_key_exists('status', $b) && $b['status'] !== $l['status']) { if (!in_array($b['status'], CRM_STATUSES, true)) throw bad('Choose a status.'); $set[] = 'status=?'; $pp[] = $b['status']; crmLog($id, $s['id'], 'status', 'Status changed from ' . str_replace('_', ' ', $l['status']) . ' to ' . str_replace('_', ' ', $b['status'])); }
    if ($set) { $set[] = 'updated=?'; $pp[] = nowms(); $pp[] = $id; q('UPDATE leads SET ' . implode(', ', $set) . ' WHERE id=?', $pp); }
    out(['lead' => crmView(one('SELECT * FROM leads WHERE id=?', [$id]))]);
  }
  if ($path === '/staff/crm/users' && $m === 'GET') {
    if (staff_can($s, 'crm_all') || $s['role'] === 'admin') $us = all("SELECT * FROM staff WHERE role IN ('telecaller','marketing','teamlead','manager') ORDER BY role, name");
    elseif (staff_can($s, 'crm_team')) $us = all("SELECT * FROM staff WHERE role IN ('telecaller','teamlead') AND (team_lead=? OR id=?) ORDER BY role, name", [$s['id'], $s['id']]);
    else $us = [];
    $all = array_map('crmUserView', $us); $tls = array_values(array_map('crmUserView', all("SELECT * FROM staff WHERE role='teamlead' AND active=1 ORDER BY name")));
    out(['users' => $all, 'team_leads' => $tls, 'creatable' => crmCreatableRoles($s)]);
  }
  if ($path === '/staff/crm/users' && $m === 'POST') {
    need($s, 'crm_staff'); $b = body(); $role = (string)field($b, 'role'); if (!in_array($role, crmCreatableRoles($s), true)) throw new HttpErr(403, 'You cannot create this role.');
    $user = cleanUser(field($b, 'username')); $name = clean(field($b, 'name'), 60); $pw = (string)field($b, 'password'); if (mb_strlen($name) < 2) throw bad('Enter the name.'); validPassword($pw);
    if (one('SELECT 1 AS x FROM staff WHERE username=?', [$user])) throw bad('That username is taken.');
    $tl = $s['role'] === 'teamlead' ? $s['id'] : clean(field($b, 'team_lead'), 32); if ($role !== 'telecaller') $tl = ''; if ($tl !== '' && !one("SELECT 1 AS x FROM staff WHERE id=? AND role='teamlead'", [$tl])) throw bad('Choose a team leader.');
    $mob = preg_replace('/\D/', '', (string)field($b, 'mobile')); $id = rnd(9);
    q('INSERT INTO staff (id, username, name, role, title, hash, active, created, team_lead, mobile) VALUES (?,?,?,?,?,?,1,?,?,?)', [$id, $user, $name, $role, '', password_hash($pw, PASSWORD_DEFAULT), nowms(), $tl !== '' ? $tl : null, substr($mob, -10)]);
    out(['user' => crmUserView(one('SELECT * FROM staff WHERE id=?', [$id]))], 201);
  }
  if ($m === 'POST' && preg_match('#^/staff/crm/users/([^/]+)$#', $path, $r)) {
    need($s, 'crm_staff'); $u = one('SELECT * FROM staff WHERE id=?', [rawurldecode($r[1])]); if (!$u || !crmCanManageUser($s, $u)) throw new HttpErr(404, 'User not found.');
    $b = body(); $name = isset($b['name']) ? clean($b['name'], 60) : $u['name']; if (mb_strlen($name) < 2) throw bad('Enter the name.');
    $act = isset($b['active']) ? ($b['active'] ? 1 : 0) : (int)$u['active']; $tl = $u['team_lead'];
    if (array_key_exists('team_lead', $b) && $u['role'] === 'telecaller' && $s['role'] !== 'teamlead') { $tl = clean($b['team_lead'], 32); if ($tl !== '' && !one("SELECT 1 AS x FROM staff WHERE id=? AND role='teamlead'", [$tl])) throw bad('Choose a team leader.'); $tl = $tl !== '' ? $tl : null; }
    $mob = array_key_exists('mobile', $b) ? substr(preg_replace('/\D/', '', (string)$b['mobile']), -10) : (string)($u['mobile'] ?? '');
    q('UPDATE staff SET name=?, active=?, team_lead=?, mobile=? WHERE id=?', [$name, $act, $tl, $mob, $u['id']]);
    if (!empty($b['password'])) { validPassword((string)$b['password']); q('UPDATE staff SET hash=? WHERE id=?', [password_hash((string)$b['password'], PASSWORD_DEFAULT), $u['id']]); }
    if (!$act) q("UPDATE leads SET assigned_to=NULL WHERE assigned_to=? AND status NOT IN ('booked','not_interested','wrong_number','lost')", [$u['id']]);
    out(['user' => crmUserView(one('SELECT * FROM staff WHERE id=?', [$u['id']]))]);
  }
  if ($path === '/staff/crm/settings' && $m === 'GET') {
    need($s, 'crm_settings'); $c = cfg(); $base = rtrim($c['public_url'], '/') . '/portal-api';
    out(['intake_key' => crmKey(), 'auto_assign' => crmSetting('auto_assign', '0') === '1', 'base' => $base, 'meta_ready' => $c['meta_page_token'] !== '', 'sources' => CRM_SOURCES]);
  }
  if ($path === '/staff/crm/settings' && $m === 'POST') {
    need($s, 'crm_settings'); $b = body();
    if (array_key_exists('auto_assign', $b)) crmSet('auto_assign', $b['auto_assign'] ? '1' : '0');
    if (!empty($b['new_key'])) crmSet('intake_key', rnd(18));
    $c = cfg(); out(['intake_key' => crmKey(), 'auto_assign' => crmSetting('auto_assign', '0') === '1', 'base' => rtrim($c['public_url'], '/') . '/portal-api', 'meta_ready' => $c['meta_page_token'] !== '', 'sources' => CRM_SOURCES]);
  }
  throw new HttpErr(404, 'Not found');
}
