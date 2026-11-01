<?php
/* Lab management software API: /staff/* routes (loaded by index.php).
   Staff log in with username + password and get a token. What each person may do depends on their role. */

const ROLE_CAN = [
  'admin'      => ['view', 'billing', 'status', 'results', 'approve', 'inbox', 'members', 'templates', 'staff', 'stock'],
  'reception'  => ['view', 'billing', 'status', 'inbox', 'members'],
  'technician' => ['view', 'status', 'results', 'stock'],
  'doctor'     => ['view', 'status', 'results', 'approve', 'templates', 'stock'],
];

function staff_can($s, $perm) { return in_array($perm, ROLE_CAN[$s['role']] ?? [], true); }
function need($s, $perm) { if (!staff_can($s, $perm)) throw new HttpErr(403, 'Your role does not allow this.'); }
function staffPublic($s) { return ['id' => $s['id'], 'username' => $s['username'], 'name' => $s['name'], 'role' => $s['role'], 'title' => $s['title'], 'active' => (int)$s['active'] === 1, 'can' => ROLE_CAN[$s['role']] ?? []]; }
function staffToken($s) { return sign(['s' => $s['id'], 'e' => nowms() + 12 * 3600000]); }
function staffAuthed() {
  $h = authHeader();
  $d = verify(strpos($h, 'Bearer ') === 0 ? substr($h, 7) : '');
  $s = ($d && !empty($d['s'])) ? one('SELECT * FROM staff WHERE id=?', [$d['s']]) : null;
  if (!$s || (int)$s['active'] !== 1) throw new HttpErr(401, 'Please log in again.');
  return $s;
}
function validPassword($pw) {
  if (strlen($pw) < 8 || mb_strlen($pw) > 100) throw bad('Use a password of at least 8 characters.');
  if (preg_match('/^(.)\1+$/su', $pw) || in_array(strtolower($pw), ['password', '12345678', 'qwertyuiop'], true)) throw bad('That password is too easy to guess.');
}
function cleanRole($r) { $r = strtolower((string)$r); if (!isset(ROLE_CAN[$r])) throw bad('Role must be admin, reception, technician or doctor.'); return $r; }
function cleanUser($u) { $u = strtolower(trim((string)$u)); if (!preg_match('/^[a-z0-9._-]{3,30}$/', $u)) throw bad('Username: 3 to 30 letters, numbers, dot, dash or underscore.'); return $u; }

/* ---------- orders ---------- */
function sOrder($code) {
  $o = one('SELECT * FROM orders WHERE code=?', [strtoupper(rawurldecode($code))]);
  if (!$o) throw new HttpErr(404, 'Order not found.');
  return $o;
}
function sTests($arr) {
  $tests = [];
  foreach (array_slice(is_array($arr) ? $arr : [], 0, 100) as $t) {
    if (!is_array($t)) continue;
    $name = clean(field($t, 'name'), 120); if ($name === '') continue;
    $tests[] = ['key' => clean(field($t, 'key'), 40), 'name' => $name, 'price' => max(0, (int)round((float)field($t, 'price')))];
  }
  if (!$tests) throw bad('Add at least one test.');
  return $tests;
}
function sView($o, $full = true) {
  $tests = json_decode($o['tests'], true) ?: [];
  $sub = array_sum(array_column($tests, 'price'));
  $v = ['id' => $o['id'], 'code' => $o['code'], 'name' => $o['name'], 'mobile' => $o['mobile'], 'age' => $o['age'] === null ? null : (int)$o['age'], 'sex' => $o['sex'],
    'ref_doctor' => $o['ref_doctor'], 'kind' => $o['kind'], 'notes' => $o['notes'], 'tests' => $tests, 'subtotal' => $sub, 'discount' => (int)$o['discount'], 'amount' => (int)$o['amount'],
    'paid' => (int)$o['paid'], 'due' => max(0, (int)$o['amount'] - (int)$o['paid']), 'pay_mode' => $o['pay_mode'], 'status' => $o['status'], 'res_status' => $o['res_status'],
    'times' => json_decode($o['times'], true) ?: new stdClass, 'created' => (int)$o['created'], 'hasReport' => !empty($o['report_file']), 'approved_by' => $o['approved_by'],
    'approved_at' => $o['approved_at'] === null ? null : (int)$o['approved_at'], 'created_by' => $o['created_by']];
  if ($full) $v['results'] = $o['results'] ? json_decode($o['results'], true) : [];
  return $v;
}
function sFresh($id) { return one('SELECT * FROM orders WHERE id=?', [$id]); }
function nextCode() {
  $pre = 'TD-' . date('ymd') . '-';
  $r = one('SELECT COUNT(*) AS n FROM orders WHERE code LIKE ?', [$pre . '%']); $n = (int)$r['n'] + 1;
  while (one('SELECT 1 AS x FROM orders WHERE code=?', [$pre . str_pad((string)$n, 3, '0', STR_PAD_LEFT)])) $n++;
  return $pre . str_pad((string)$n, 3, '0', STR_PAD_LEFT);
}
function demographics($b) {
  $age = field($b, 'age'); $age = ($age === '' || $age === null) ? null : max(0, min(120, (int)$age));
  $sex = strtoupper(clean(field($b, 'sex'), 1)); if (!in_array($sex, ['M', 'F', 'O'], true)) $sex = null;
  $kind = clean(field($b, 'kind'), 10); if (!in_array($kind, ['walk-in', 'home'], true)) $kind = 'walk-in';
  return [$age, $sex, clean(field($b, 'ref_doctor'), 80), $kind, cleanBody(field($b, 'notes'), 500)];
}
function money($b, $k) { return max(0, (int)round((float)field($b, $k))); }

function createOrder($s) {
  need($s, 'billing');
  $b = body(30000);
  $name = clean(field($b, 'name'), 60); $mobile = normMobile(field($b, 'mobile'));
  if (mb_strlen($name) < 2) throw bad('Enter the patient name.');
  if (!preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Enter a valid 10-digit mobile number.');
  $tests = sTests(field($b, 'tests')); list($age, $sex, $doc, $kind, $notes) = demographics($b);
  $sub = array_sum(array_column($tests, 'price')); $disc = min($sub, money($b, 'discount')); $amount = $sub - $disc;
  $paid = min($amount, money($b, 'paid')); $mode = clean(field($b, 'pay_mode'), 12) ?: ($paid ? 'cash' : null);
  $pin = (string)random_int(100000, 999999); $id = rnd(9); $now = nowms();
  for ($try = 0; ; $try++) {
    $code = nextCode();
    try {
      q('INSERT INTO orders (id, code, mobile, name, tests, amount, status, times, created, pin_hash, age, sex, ref_doctor, kind, notes, discount, paid, pay_mode, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$id, $code, $mobile, $name, json_encode($tests, JSON_UNESCAPED_UNICODE), $amount, 'booked', json_encode(['booked' => $now]), $now, pinHash($code, $pin), $age, $sex, $doc, $kind, $notes, $disc, $paid, $mode, $s['name']]);
      break;
    } catch (PDOException $e) { if ($try > 5) throw $e; }
  }
  $bid = (int)field($b, 'booking_id');
  if ($bid > 0) q("UPDATE bookings SET status='done', order_code=? WHERE id=? AND status='new'", [$code, $bid]);
  out(['order' => sView(sFresh($id)), 'pin' => $pin], 201);
}

/* A booking request sent from the website forms (no login). Rate limited per visitor address. */
function publicBooking() {
  $b = body(); $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'x';
  $k = 'pb:' . substr(hash('sha256', $ip), 0, 20); $a = attempt($k); $now = nowms();
  if ($now - $a['t'] > 3600000) { $a['t'] = $now; $a['n'] = 0; } $a['n']++;
  if ($a['n'] > 10) throw new HttpErr(429, 'Too many requests. Please call or WhatsApp us.');
  saveAttempt($k, $a);
  $name = clean(field($b, 'name'), 60); $mobile = normMobile(field($b, 'mobile'));
  if (mb_strlen($name) < 2 || !preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Enter your name and a valid mobile number.');
  $tests = field($b, 'tests'); if (is_array($tests)) $tests = implode(', ', array_map(function ($x) { return clean($x, 100); }, array_slice($tests, 0, 40)));
  $src = field($b, 'source') === 'book' ? 'book' : 'home';
  $dup = one('SELECT id FROM bookings WHERE mobile=? AND created>? AND tests=?', [$mobile, $now - 600000, clean($tests, 600)]);   // same request sent twice
  if (!$dup) q('INSERT INTO bookings (name, mobile, tests, pref_date, slot, address, note, source, status, created) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [$name, $mobile, clean($tests, 600), clean(field($b, 'date'), 12), clean(field($b, 'slot'), 40), clean(field($b, 'address'), 200), clean(field($b, 'note'), 300), $src, 'new', $now]);
  out(['ok' => true], 201);
}

function updateOrder($s, $o) {
  need($s, 'billing');
  $b = body(30000);
  $name = clean(field($b, 'name'), 60); $mobile = normMobile(field($b, 'mobile'));
  if (mb_strlen($name) < 2) throw bad('Enter the patient name.');
  if ($mobile !== '' && !preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Enter a valid 10-digit mobile number.');
  list($age, $sex, $doc, $kind, $notes) = demographics($b);
  $tests = json_decode($o['tests'], true); $amount = (int)$o['amount']; $disc = (int)$o['discount'];
  if (isset($b['tests'])) {
    if ($o['res_status'] === 'approved') throw bad('The report is already approved. Tests can no longer be changed.');
    $tests = sTests($b['tests']); $sub = array_sum(array_column($tests, 'price')); $disc = min($sub, money($b, 'discount')); $amount = $sub - $disc;
  }
  q('UPDATE orders SET name=?, mobile=?, age=?, sex=?, ref_doctor=?, kind=?, notes=?, tests=?, amount=?, discount=? WHERE id=?',
    [$name, $mobile !== '' ? $mobile : $o['mobile'], $age, $sex, $doc, $kind, $notes, json_encode($tests, JSON_UNESCAPED_UNICODE), $amount, $disc, $o['id']]);
  out(['order' => sView(sFresh($o['id']))]);
}

/* ---------- results ---------- */
function numeric($v) { $v = str_replace(',', '', trim((string)$v)); return is_numeric($v) ? (float)$v : null; }
function cleanSections($arr) {
  $out = [];
  foreach (array_slice(is_array($arr) ? $arr : [], 0, 40) as $sec) {
    if (!is_array($sec)) continue;
    $rows = [];
    foreach (array_slice(is_array(field($sec, 'rows')) ? $sec['rows'] : [], 0, 80) as $r) {
      if (!is_array($r)) continue;
      $value = clean(field($r, 'value'), 80);
      $low = (field($r, 'low') === '' || field($r, 'low') === null) ? null : numeric($r['low']);
      $high = (field($r, 'high') === '' || field($r, 'high') === null) ? null : numeric($r['high']);
      $flag = strtoupper(clean(field($r, 'flag'), 1)); if (!in_array($flag, ['H', 'L', 'A'], true)) $flag = '';
      $n = numeric(preg_replace('/^[<>]=?\s*/', '', $value));
      if ($value === '') $flag = '';
      elseif ($n !== null && ($low !== null || $high !== null)) $flag = ($low !== null && $n < $low) ? 'L' : (($high !== null && $n > $high) ? 'H' : '');
      $rows[] = ['name' => clean(field($r, 'name'), 120), 'value' => $value, 'unit' => clean(field($r, 'unit'), 20), 'low' => $low, 'high' => $high, 'ref' => clean(field($r, 'ref'), 120), 'flag' => $flag];
    }
    $out[] = ['key' => clean(field($sec, 'key'), 40), 'title' => clean(field($sec, 'title'), 120) ?: 'Result', 'rows' => $rows, 'comment' => cleanBody(field($sec, 'comment'), 500)];
  }
  return $out;
}
function hasValues($secs) { foreach ($secs as $s) foreach ($s['rows'] as $r) if ($r['value'] !== '') return true; return false; }

function saveResults($s, $o) {
  need($s, 'results');
  if ($o['res_status'] === 'approved') need($s, 'approve');
  $secs = cleanSections(field(body(200000), 'sections'));
  $t = json_decode($o['times'], true) ?: [];
  $status = $o['status'];
  if (in_array($status, ['booked', 'collected'], true) && hasValues($secs)) { $status = 'processing'; $t['processing'] = nowms(); }
  q('UPDATE orders SET results=?, res_status=?, status=?, times=? WHERE id=?', [json_encode($secs, JSON_UNESCAPED_UNICODE), hasValues($secs) ? 'entered' : 'none', $status, json_encode($t), $o['id']]);
  out(['order' => sView(sFresh($o['id']))]);
}
function reportFor($o, $draft, $meta = null) {
  $secs = $o['results'] ? json_decode($o['results'], true) : [];
  $meta = $meta ?: ['draft' => $draft, 'by' => $o['approved_by'], 'title' => $o['approved_title'], 'at' => $o['approved_at']];
  return buildReportPdf($o, $secs, $meta);
}
function approveOrder($s, $o) {
  need($s, 'approve');
  $secs = $o['results'] ? json_decode($o['results'], true) : [];
  if ($o['res_status'] === 'none' || !hasValues($secs)) throw bad('Enter at least one result before approving.');
  require_once __DIR__ . '/pdf.php';
  $now = nowms();
  $bytes = buildReportPdf($o, $secs, ['draft' => false, 'by' => $s['name'], 'title' => $s['title'], 'at' => $now]);
  db();
  $file = $o['id'] . '.pdf';
  if (@file_put_contents(cfg()['storage_dir'] . '/reports/' . $file, $bytes, LOCK_EX) === false) throw new Exception('Cannot write the report file.');
  $t = json_decode($o['times'], true) ?: []; if (empty($t['completed'])) $t['completed'] = $now;
  q("UPDATE orders SET report_name=?, report_size=?, report_file=?, status='completed', res_status='approved', approved_by=?, approved_title=?, approved_at=?, times=? WHERE id=?",
    [$o['code'] . '-report.pdf', strlen($bytes), $file, $s['name'], $s['title'], $now, json_encode($t), $o['id']]);
  out(['order' => sView(sFresh($o['id']))]);
}

/* ---------- templates ---------- */
function ensureTemplates() {
  $n = one('SELECT COUNT(*) AS n FROM test_templates');
  if ((int)$n['n'] > 0) return;
  require_once __DIR__ . '/templates-seed.php';
  $now = nowms();
  foreach (seed_templates() as $t) q('INSERT INTO test_templates (tkey, name, params, matches, updated) VALUES (?,?,?,?,?)', [$t['key'], $t['name'], json_encode($t['params']), json_encode($t['match']), $now]);
}
function cleanParams($arr) {
  $out = [];
  foreach (array_slice(is_array($arr) ? $arr : [], 0, 80) as $p) {
    if (!is_array($p)) continue; $name = clean(field($p, 'name'), 120); if ($name === '') continue;
    $num = function ($k) use ($p) { $v = field($p, $k); return ($v === '' || $v === null) ? null : numeric($v); };
    $out[] = ['name' => $name, 'unit' => clean(field($p, 'unit'), 20), 'low' => $num('low'), 'high' => $num('high'), 'flo' => $num('flo'), 'fhi' => $num('fhi'), 'ref' => clean(field($p, 'ref'), 120)];
  }
  return $out;
}

/* ---------- reports / summary ---------- */
function summary($from, $to, $tz) {
  $rows = all('SELECT tests, amount, discount, paid, pay_mode, created FROM orders WHERE created>=? AND created<?', [$from, $to]);
  $byDay = []; $top = []; $modes = []; $billed = 0; $paid = 0;
  foreach ($rows as $r) {
    $billed += (int)$r['amount']; $paid += (int)$r['paid'];
    $d = (int)floor(((int)$r['created'] + $tz * 60000) / 86400000);
    if (!isset($byDay[$d])) $byDay[$d] = ['day' => $d, 'orders' => 0, 'billed' => 0];
    $byDay[$d]['orders']++; $byDay[$d]['billed'] += (int)$r['amount'];
    $m = $r['pay_mode'] ?: 'unpaid'; if ((int)$r['paid'] > 0) $modes[$m] = ($modes[$m] ?? 0) + (int)$r['paid'];
    foreach (json_decode($r['tests'], true) ?: [] as $t) { $k = $t['name']; if (!isset($top[$k])) $top[$k] = ['name' => $k, 'count' => 0, 'revenue' => 0]; $top[$k]['count']++; $top[$k]['revenue'] += (int)$t['price']; }
  }
  ksort($byDay); usort($top, function ($a, $b) { return $b['count'] <=> $a['count'] ?: $b['revenue'] <=> $a['revenue']; });
  return ['orders' => count($rows), 'billed' => $billed, 'paid' => $paid, 'due' => max(0, $billed - $paid), 'by_day' => array_values($byDay), 'top_tests' => array_slice($top, 0, 15), 'by_mode' => $modes];
}

/* ---------- router ---------- */
function staff($path, $m) {
  $q = $_GET;
  if ($path === '/staff/status' && $m === 'GET') { $n = one('SELECT COUNT(*) AS n FROM staff'); out(['needsSetup' => (int)$n['n'] === 0]); }
  if ($path === '/staff/setup' && $m === 'POST') {
    $n = one('SELECT COUNT(*) AS n FROM staff'); if ((int)$n['n'] > 0) throw new HttpErr(403, 'Setup is already done.');
    $lk = cfg()['lab_api_key']; if ($lk === '') throw new HttpErr(503, 'Set lab_api_key in config.php first. It is also the setup code for the first admin.');
    $b = body(); if (!hash_equals($lk, (string)field($b, 'setup_code'))) throw new HttpErr(403, 'The setup code is wrong. Use the lab_api_key from config.php.');
    $name = clean(field($b, 'name'), 60); $user = cleanUser(field($b, 'username')); $pw = (string)field($b, 'password');
    if (mb_strlen($name) < 2) throw bad('Enter your name.'); validPassword($pw);
    $id = rnd(9); q('INSERT INTO staff (id, username, name, role, title, hash, active, created) VALUES (?,?,?,?,?,?,1,?)', [$id, $user, $name, 'admin', clean(field($b, 'title'), 120), password_hash($pw, PASSWORD_DEFAULT), nowms()]);
    $s = one('SELECT * FROM staff WHERE id=?', [$id]); out(['token' => staffToken($s), 'staff' => staffPublic($s)], 201);
  }
  if ($path === '/staff/login' && $m === 'POST') {
    $b = body(); $user = strtolower(trim((string)field($b, 'username'))); $pw = (string)field($b, 'password');
    $key = 'sl:' . substr(hash('sha256', $user), 0, 24); $a = attempt($key);
    if ($a['until'] > nowms()) throw new HttpErr(429, 'Too many wrong attempts. Try again in a few minutes.');
    $s = $user !== '' ? one('SELECT * FROM staff WHERE username=?', [$user]) : null;
    $ok = $s && (int)$s['active'] === 1 && password_verify($pw, $s['hash']);
    if (!$ok) { $a['n']++; if ($a['n'] >= 5) { $a['until'] = nowms() + 15 * 60000; $a['n'] = 0; } saveAttempt($key, $a); throw new HttpErr(401, 'Wrong username or password.'); }
    if ($a['n'] || $a['until']) clearAttempt($key);
    out(['token' => staffToken($s), 'staff' => staffPublic($s)]);
  }

  $s = staffAuthed();
  require_once __DIR__ . '/pdf.php';
  if ($path === '/staff/me' && $m === 'GET') out(['staff' => staffPublic($s)]);
  if ($path === '/staff/password' && $m === 'POST') {
    $b = body(); if (!password_verify((string)field($b, 'old'), $s['hash'])) throw bad('Your current password is not correct.');
    validPassword((string)field($b, 'new')); q('UPDATE staff SET hash=? WHERE id=?', [password_hash((string)$b['new'], PASSWORD_DEFAULT), $s['id']]);
    out(['ok' => true]);
  }

  /* staff accounts (admin) */
  if ($path === '/staff/users' && $m === 'GET') { need($s, 'staff'); out(['users' => array_map('staffPublic', all('SELECT * FROM staff ORDER BY created'))]); }
  if ($path === '/staff/users' && $m === 'POST') {
    need($s, 'staff'); $b = body(); $user = cleanUser(field($b, 'username')); $name = clean(field($b, 'name'), 60); $role = cleanRole(field($b, 'role')); $pw = (string)field($b, 'password');
    if (mb_strlen($name) < 2) throw bad('Enter the name.'); validPassword($pw);
    if (one('SELECT 1 AS x FROM staff WHERE username=?', [$user])) throw bad('That username is taken.');
    $id = rnd(9); q('INSERT INTO staff (id, username, name, role, title, hash, active, created) VALUES (?,?,?,?,?,?,1,?)', [$id, $user, $name, $role, clean(field($b, 'title'), 120), password_hash($pw, PASSWORD_DEFAULT), nowms()]);
    out(['user' => staffPublic(one('SELECT * FROM staff WHERE id=?', [$id]))], 201);
  }
  if ($m === 'POST' && preg_match('#^/staff/users/([^/]+)$#', $path, $r)) {
    need($s, 'staff'); $u = one('SELECT * FROM staff WHERE id=?', [rawurldecode($r[1])]); if (!$u) throw new HttpErr(404, 'Staff member not found.');
    $b = body(); $self = $u['id'] === $s['id'];
    $name = isset($b['name']) ? clean($b['name'], 60) : $u['name']; if (mb_strlen($name) < 2) throw bad('Enter the name.');
    $role = isset($b['role']) ? cleanRole($b['role']) : $u['role']; $active = isset($b['active']) ? ($b['active'] ? 1 : 0) : (int)$u['active'];
    if ($self && ($role !== $u['role'] || !$active)) throw bad('You cannot change your own role or deactivate yourself.');
    $title = isset($b['title']) ? clean($b['title'], 120) : $u['title'];
    q('UPDATE staff SET name=?, role=?, title=?, active=? WHERE id=?', [$name, $role, $title, $active, $u['id']]);
    if (!empty($b['password'])) { validPassword((string)$b['password']); q('UPDATE staff SET hash=? WHERE id=?', [password_hash((string)$b['password'], PASSWORD_DEFAULT), $u['id']]); }
    out(['user' => staffPublic(one('SELECT * FROM staff WHERE id=?', [$u['id']]))]);
  }

  /* patient lookup by mobile (membership discount, last details) */
  if ($path === '/staff/patient' && $m === 'GET') {
    $mob = normMobile(isset($q['mobile']) ? $q['mobile'] : ''); if ($mob === '') out(['found' => false]);
    $u = one('SELECT * FROM users WHERE mobile=?', [$mob]); $last = one('SELECT name, age, sex, ref_doctor FROM orders WHERE mobile=? ORDER BY created DESC LIMIT 1', [$mob]);
    $n = one('SELECT COUNT(*) AS n FROM orders WHERE mobile=?', [$mob]);
    $mem = $u && $u['membership'] ? json_decode($u['membership'], true) : null; $disc = 0;
    if ($mem && ($mem['status'] ?? '') === 'active') foreach (PLANS as $p) if ($p['id'] === $mem['tier']) $disc = $p['discount'];
    out(['found' => (bool)($u || $last), 'name' => $last ? $last['name'] : ($u ? $u['name'] : ''), 'age' => $last && $last['age'] !== null ? (int)$last['age'] : null, 'sex' => $last ? $last['sex'] : null,
      'hasAccount' => (bool)$u, 'membership' => $mem, 'discountPct' => $disc, 'orders' => (int)$n['n']]);
  }

  /* orders */
  if ($path === '/staff/orders' && $m === 'POST') createOrder($s);
  if ($path === '/staff/orders' && $m === 'GET') {
    $w = []; $a = [];
    $st = isset($q['status']) ? (string)$q['status'] : '';
    if ($st === 'awaiting') $w[] = "res_status='entered'"; elseif (in_array($st, STATUSES, true)) { $w[] = 'status=?'; $a[] = $st; }
    $qq = trim(isset($q['q']) ? (string)$q['q'] : '');
    if ($qq !== '') { $w[] = '(code LIKE ? OR name LIKE ? OR mobile LIKE ?)'; $like = '%' . str_replace(['%', '_'], ['', ''], $qq) . '%'; array_push($a, $like, $like, $like); }
    if (!empty($q['from'])) { $w[] = 'created>=?'; $a[] = (int)$q['from']; } if (!empty($q['to'])) { $w[] = 'created<?'; $a[] = (int)$q['to']; }
    if (isset($q['due']) && $q['due'] === '1') $w[] = 'amount>paid';
    $where = $w ? 'WHERE ' . implode(' AND ', $w) : '';
    $limit = max(1, min(100, (int)(isset($q['limit']) ? $q['limit'] : 50))); $off = max(0, (int)(isset($q['offset']) ? $q['offset'] : 0));
    $tot = one("SELECT COUNT(*) AS n FROM orders $where", $a);
    $rows = all("SELECT * FROM orders $where ORDER BY created DESC LIMIT $limit OFFSET $off", $a);
    out(['total' => (int)$tot['n'], 'orders' => array_map(function ($o) { return sView($o, false); }, $rows)]);
  }
  if (preg_match('#^/staff/orders/([^/]+)(?:/([a-z]+))?$#', $path, $r)) {
    $o = sOrder($r[1]); $act = isset($r[2]) ? $r[2] : '';
    if ($act === '' && $m === 'GET') out(['order' => sView($o)]);
    if ($act === 'update' && $m === 'POST') updateOrder($s, $o);
    if ($act === 'results' && $m === 'POST') saveResults($s, $o);
    if ($act === 'approve' && $m === 'POST') approveOrder($s, $o);
    if ($act === 'status' && $m === 'POST') {
      need($s, 'status'); $st = strtolower(clean(field(body(), 'status'), 20));
      if (!in_array($st, ['booked', 'collected', 'processing'], true)) throw bad('Completed is set when the report is approved.');
      $t = json_decode($o['times'], true) ?: []; $t[$st] = nowms();
      q('UPDATE orders SET status=?, times=? WHERE id=?', [$st, json_encode($t), $o['id']]); out(['order' => sView(sFresh($o['id']))]);
    }
    if ($act === 'payment' && $m === 'POST') {
      need($s, 'billing'); $b = body(); $amt = money($b, 'amount'); $due = (int)$o['amount'] - (int)$o['paid'];
      if ($amt < 1) throw bad('Enter the amount received.'); if ($amt > $due) throw bad('That is more than the balance due (Rs. ' . $due . ').');
      q('UPDATE orders SET paid=paid+?, pay_mode=? WHERE id=?', [$amt, clean(field($b, 'mode'), 12) ?: 'cash', $o['id']]); out(['order' => sView(sFresh($o['id']))]);
    }
    if ($act === 'pin' && $m === 'POST') {
      need($s, 'billing'); $pin = (string)random_int(100000, 999999);
      q('UPDATE orders SET pin_hash=? WHERE id=?', [pinHash($o['code'], $pin), $o['id']]); out(['pin' => $pin, 'order' => sView(sFresh($o['id']), false)]);
    }
    if ($act === 'upload' && ($m === 'PUT' || $m === 'POST')) {
      need($s, 'approve');
      $raw = (string)file_get_contents('php://input');
      if (strlen($raw) > 3 * 1024 * 1024) throw new HttpErr(413, 'Report must be under 3 MB.');
      if (substr($raw, 0, 5) !== '%PDF-') throw bad('Only PDF files are accepted.');
      db(); $file = $o['id'] . '.pdf'; $now = nowms();
      if (@file_put_contents(cfg()['storage_dir'] . '/reports/' . $file, $raw, LOCK_EX) === false) throw new Exception('Cannot write the report file.');
      $name = clean(isset($q['name']) ? $q['name'] : '', 80) ?: ($o['code'] . '-report.pdf');
      $t = json_decode($o['times'], true) ?: []; if (empty($t['completed'])) $t['completed'] = $now;
      q("UPDATE orders SET report_name=?, report_size=?, report_file=?, status='completed', res_status='approved', approved_by=?, approved_title=?, approved_at=?, times=? WHERE id=?",
        [$name, strlen($raw), $file, $s['name'], $s['title'], $now, json_encode($t), $o['id']]);
      out(['order' => sView(sFresh($o['id']))]);
    }
    if ($act === 'report' && $m === 'GET') {
      $draft = !empty($q['draft']) || $o['res_status'] !== 'approved' || empty($o['report_file']);
      if ($draft && !$o['results']) throw new HttpErr(404, 'No results have been entered yet.');
      $bytes = ($draft || !is_file(reportPath($o))) ? reportFor($o, true) : file_get_contents(reportPath($o));
      http_response_code(200); header('Content-Type: application/pdf'); header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $o['code']) . ($draft ? '-draft' : '-report') . '.pdf"');
      header('Content-Length: ' . strlen($bytes)); echo $bytes; exit;
    }
    throw new HttpErr(404, 'Not found');
  }

  /* templates */
  if ($path === '/staff/templates' && $m === 'GET') {
    ensureTemplates();
    out(['templates' => array_map(function ($t) { return ['key' => $t['tkey'], 'name' => $t['name'], 'params' => json_decode($t['params'], true), 'match' => json_decode($t['matches'] ?: '[]', true)]; }, all('SELECT * FROM test_templates ORDER BY tkey'))]);
  }
  if ($path === '/staff/templates' && $m === 'POST') {
    need($s, 'templates'); $b = body(60000); $key = strtoupper(clean(field($b, 'key'), 40)); $name = clean(field($b, 'name'), 120);
    if (!preg_match('/^[A-Z]:[A-Z0-9_-]{1,35}$/', $key)) throw bad('Key looks like T:CODE (test) or P:NAME (panel).'); if ($name === '') throw bad('Enter a name.');
    $params = cleanParams(field($b, 'params')); if (!$params) throw bad('Add at least one parameter.');
    $match = array_values(array_filter(array_map(function ($x) { return strtoupper(clean($x, 40)); }, is_array(field($b, 'match')) ? $b['match'] : [])));
    ensureTemplates();
    if (q('UPDATE test_templates SET name=?, params=?, matches=?, updated=? WHERE tkey=?', [$name, json_encode($params), json_encode($match), nowms(), $key])->rowCount() === 0 && !one('SELECT 1 AS x FROM test_templates WHERE tkey=?', [$key]))
      q('INSERT INTO test_templates (tkey, name, params, matches, updated) VALUES (?,?,?,?,?)', [$key, $name, json_encode($params), json_encode($match), nowms()]);
    out(['ok' => true]);
  }
  if ($path === '/staff/templates/delete' && $m === 'POST') { need($s, 'templates'); q('DELETE FROM test_templates WHERE tkey=?', [strtoupper(clean(field(body(), 'key'), 40))]); out(['ok' => true]); }

  /* website booking requests */
  if ($path === '/staff/bookings' && $m === 'GET') {
    need($s, 'billing'); $st = isset($q['status']) ? (string)$q['status'] : 'new';
    $rows = in_array($st, ['new', 'done', 'cancelled'], true) ? all('SELECT * FROM bookings WHERE status=? ORDER BY created DESC LIMIT 200', [$st]) : all('SELECT * FROM bookings ORDER BY created DESC LIMIT 200');
    out(['bookings' => array_map(function ($x) { return ['id' => (int)$x['id'], 'name' => $x['name'], 'mobile' => $x['mobile'], 'tests' => (string)$x['tests'], 'date' => (string)$x['pref_date'], 'slot' => (string)$x['slot'],
      'address' => (string)$x['address'], 'note' => (string)$x['note'], 'source' => (string)$x['source'], 'status' => $x['status'], 'orderCode' => $x['order_code'], 'created' => (int)$x['created']]; }, $rows)]);
  }
  if ($m === 'POST' && preg_match('#^/staff/bookings/(\d+)/status$#', $path, $r)) {
    need($s, 'billing'); $st = strtolower(clean(field(body(), 'status'), 12));
    if (!in_array($st, ['new', 'done', 'cancelled'], true)) throw bad('Status must be new, done or cancelled.');
    q('UPDATE bookings SET status=? WHERE id=?', [$st, (int)$r[1]]); out(['ok' => true]);
  }

  /* inbox: tickets */
  if ($path === '/staff/tickets' && $m === 'GET') {
    need($s, 'inbox'); $st = isset($q['status']) ? (string)$q['status'] : '';
    $rows = $st === 'active' ? all("SELECT * FROM tickets WHERE status<>'closed' ORDER BY updated DESC LIMIT 200") : ($st !== '' ? all('SELECT * FROM tickets WHERE status=? ORDER BY updated DESC LIMIT 200', [$st]) : all('SELECT * FROM tickets ORDER BY updated DESC LIMIT 200'));
    out(['tickets' => array_map('ticketView', $rows)]);
  }
  if ($m === 'POST' && preg_match('#^/staff/tickets/([^/]+)/reply$#', $path, $r)) {
    need($s, 'inbox'); $id = rawurldecode($r[1]); if (!one('SELECT 1 AS x FROM tickets WHERE id=?', [$id])) throw new HttpErr(404, 'Ticket not found.');
    $b = body(); $msg = cleanBody(field($b, 'message'), 2000); $close = !empty($b['close']);
    if ($msg === '' && !$close) throw bad('Write a reply or close the ticket.');
    $now = nowms(); if ($msg !== '') q('INSERT INTO ticket_msgs (ticket_id, sender, body, ts) VALUES (?,?,?,?)', [$id, 'staff', $msg, $now]);
    q('UPDATE tickets SET status=?, updated=? WHERE id=?', [$close ? 'closed' : 'answered', $now, $id]); out(['ticket' => ticketView(one('SELECT * FROM tickets WHERE id=?', [$id]))]);
  }
  /* inbox: live chat */
  if ($path === '/staff/chats' && $m === 'GET') {
    need($s, 'inbox');
    $rows = all('SELECT s.uid, s.last, s.staff_seen, u.mobile, u.name FROM chat_state s JOIN users u ON u.id=s.uid ORDER BY s.last DESC LIMIT 100'); $out = [];
    foreach ($rows as $r) {
      $lc = one("SELECT MAX(ts) AS m FROM chat WHERE uid=? AND sender='customer'", [$r['uid']]); $lm = one('SELECT sender, body FROM chat WHERE uid=? ORDER BY ts DESC LIMIT 1', [$r['uid']]);
      $out[] = ['mobile' => $r['mobile'], 'name' => $r['name'], 'last' => (int)$r['last'], 'unread' => $lc && $lc['m'] && (int)$lc['m'] > (int)$r['staff_seen'], 'preview' => $lm ? mb_substr($lm['body'], 0, 80) : '', 'from' => $lm ? $lm['sender'] : ''];
    }
    out(['chats' => $out]);
  }
  if (preg_match('#^/staff/chats/(\d{10})$#', $path, $r)) {
    need($s, 'inbox'); $u = one('SELECT * FROM users WHERE mobile=?', [$r[1]]); if (!$u) throw new HttpErr(404, 'No customer with this mobile.');
    if ($m === 'GET') {
      $msgs = chatRows($u['id'], (int)(isset($q['after']) ? $q['after'] : 0)); touchChat($u['id']); q('UPDATE chat_state SET staff_seen=? WHERE uid=?', [nowms(), $u['id']]);
      out(['messages' => $msgs, 'name' => $u['name'], 'mobile' => $u['mobile']]);
    }
    if ($m === 'POST') {
      $text = cleanBody(field(body(), 'body'), 500); if ($text === '') throw bad('Type a message.');
      $msg = pushChat($u['id'], 'staff', $text, $s['name']); touchChat($u['id']); q('UPDATE chat_state SET staff_seen=? WHERE uid=?', [nowms(), $u['id']]);
      out(['message' => $msg], 201);
    }
  }

  /* memberships */
  if ($path === '/staff/members' && $m === 'GET') {
    need($s, 'members'); $rows = all('SELECT name, mobile, membership, created FROM users WHERE membership IS NOT NULL ORDER BY created DESC LIMIT 500'); $out = [];
    foreach ($rows as $r) { $mem = json_decode($r['membership'], true); if (!$mem) continue; $st = isset($q['status']) ? (string)$q['status'] : ''; if ($st !== '' && ($mem['status'] ?? '') !== $st) continue; $out[] = ['name' => $r['name'], 'mobile' => $r['mobile'], 'membership' => $mem]; }
    out(['members' => $out]);
  }
  if ($path === '/staff/members' && $m === 'POST') {
    need($s, 'members'); $b = body(); $u = one('SELECT * FROM users WHERE mobile=?', [normMobile(field($b, 'mobile'))]); if (!$u) throw new HttpErr(404, 'No customer with this mobile.');
    $tier = strtolower(clean(field($b, 'tier'), 20)); $found = false; foreach (PLANS as $p) if ($p['id'] === $tier) $found = true; if (!$found) throw bad('Unknown plan.');
    $st = field($b, 'status') === 'active' ? 'active' : (field($b, 'status') === 'cancelled' ? 'cancelled' : 'requested');
    $mem = ['tier' => $tier, 'status' => $st]; if ($st === 'active') $mem['since'] = nowms();
    q('UPDATE users SET membership=? WHERE id=?', [json_encode($mem), $u['id']]); out(['ok' => true, 'membership' => $mem]);
  }

  /* patients (built from orders) */
  if ($path === '/staff/patients' && $m === 'GET') {
    need($s, 'view'); $qq = trim(isset($q['q']) ? (string)$q['q'] : ''); $w = ''; $a = [];
    if ($qq !== '') { $w = 'WHERE name LIKE ? OR mobile LIKE ?'; $like = '%' . str_replace(['%', '_'], ['', ''], $qq) . '%'; $a = [$like, $like]; }
    $rows = all("SELECT mobile, COUNT(*) AS n, MAX(created) AS last, SUM(amount) AS billed, SUM(amount-paid) AS due FROM orders $w GROUP BY mobile ORDER BY last DESC LIMIT 100", $a); $out = [];
    foreach ($rows as $r) {
      $o = one('SELECT name, age, sex FROM orders WHERE mobile=? ORDER BY created DESC LIMIT 1', [$r['mobile']]); $u = one('SELECT membership FROM users WHERE mobile=?', [$r['mobile']]);
      $out[] = ['mobile' => $r['mobile'], 'name' => $o['name'], 'age' => $o['age'] === null ? null : (int)$o['age'], 'sex' => $o['sex'], 'orders' => (int)$r['n'], 'last' => (int)$r['last'], 'billed' => (int)$r['billed'], 'due' => (int)$r['due'],
        'membership' => $u && $u['membership'] ? json_decode($u['membership'], true) : null];
    }
    out(['patients' => $out]);
  }

  /* stock */
  if ($path === '/staff/stock' && $m === 'GET') {
    need($s, 'stock');
    out(['items' => array_map(function ($i) { return ['id' => (int)$i['id'], 'name' => $i['name'], 'unit' => $i['unit'], 'qty' => (int)$i['qty'], 'min' => (int)$i['min_qty'], 'low' => (int)$i['qty'] <= (int)$i['min_qty'], 'updated' => (int)$i['updated']]; },
      all('SELECT * FROM stock_items WHERE active=1 ORDER BY name'))]);
  }
  if ($path === '/staff/stock' && $m === 'POST') {
    need($s, 'stock'); $b = body(); $name = clean(field($b, 'name'), 80); if (mb_strlen($name) < 2) throw bad('Enter the item name.');
    $unit = clean(field($b, 'unit'), 20) ?: 'pcs'; $min = money($b, 'min'); $now = nowms();
    if (!empty($b['id'])) {
      $it = one('SELECT * FROM stock_items WHERE id=? AND active=1', [(int)$b['id']]); if (!$it) throw new HttpErr(404, 'Item not found.');
      q('UPDATE stock_items SET name=?, unit=?, min_qty=?, updated=? WHERE id=?', [$name, $unit, $min, $now, $it['id']]);
      if (!empty($b['remove'])) q('UPDATE stock_items SET active=0 WHERE id=?', [$it['id']]);
      out(['ok' => true]);
    }
    $qty = money($b, 'qty'); q('INSERT INTO stock_items (name, unit, qty, min_qty, active, updated) VALUES (?,?,?,?,1,?)', [$name, $unit, $qty, $min, $now]);
    $id = (int)db()->lastInsertId(); if ($qty > 0) q('INSERT INTO stock_log (item_id, delta, note, by_name, ts) VALUES (?,?,?,?,?)', [$id, $qty, 'Opening stock', $s['name'], $now]);
    out(['ok' => true, 'id' => $id], 201);
  }
  if ($m === 'POST' && preg_match('#^/staff/stock/(\d+)/adjust$#', $path, $r)) {
    need($s, 'stock'); $it = one('SELECT * FROM stock_items WHERE id=? AND active=1', [(int)$r[1]]); if (!$it) throw new HttpErr(404, 'Item not found.');
    $b = body(); $d = (int)round((float)field($b, 'delta')); if ($d === 0) throw bad('Enter how many were added (+) or used (-).');
    $new = (int)$it['qty'] + $d; if ($new < 0) throw bad('Only ' . (int)$it['qty'] . ' ' . $it['unit'] . ' in stock.');
    q('UPDATE stock_items SET qty=?, updated=? WHERE id=?', [$new, nowms(), $it['id']]);
    q('INSERT INTO stock_log (item_id, delta, note, by_name, ts) VALUES (?,?,?,?,?)', [$it['id'], $d, clean(field($b, 'note'), 120), $s['name'], nowms()]);
    out(['ok' => true, 'qty' => $new]);
  }
  if ($m === 'GET' && preg_match('#^/staff/stock/(\d+)/log$#', $path, $r)) {
    need($s, 'stock');
    out(['log' => array_map(function ($l) { return ['delta' => (int)$l['delta'], 'note' => $l['note'], 'by' => $l['by_name'], 'ts' => (int)$l['ts']]; }, all('SELECT * FROM stock_log WHERE item_id=? ORDER BY ts DESC, id DESC LIMIT 30', [(int)$r[1]]))]);
  }

  /* dashboard + reports */
  if ($path === '/staff/dashboard' && $m === 'GET') {
    $since = (int)(isset($q['since']) ? $q['since'] : 0); $tz = (int)(isset($q['tz']) ? $q['tz'] : 330);
    $c = function ($sql, $a = []) { $r = one($sql, $a); return (int)$r['n']; };
    $today = $since ? summary($since, $since + 86400000, $tz) : ['orders' => 0, 'billed' => 0, 'paid' => 0];
    $unread = 0; foreach (all('SELECT uid, staff_seen FROM chat_state') as $r) { $lc = one("SELECT MAX(ts) AS m FROM chat WHERE uid=? AND sender='customer'", [$r['uid']]); if ($lc && $lc['m'] && (int)$lc['m'] > (int)$r['staff_seen']) $unread++; }
    $reqs = 0; foreach (all('SELECT membership FROM users WHERE membership IS NOT NULL') as $r) { $mm = json_decode($r['membership'], true); if ($mm && ($mm['status'] ?? '') === 'requested') $reqs++; }
    out(['today' => ['orders' => $today['orders'], 'billed' => $today['billed'], 'paid' => $today['paid']],
      'pipeline' => ['booked' => $c("SELECT COUNT(*) AS n FROM orders WHERE status='booked'"), 'collected' => $c("SELECT COUNT(*) AS n FROM orders WHERE status='collected'"), 'processing' => $c("SELECT COUNT(*) AS n FROM orders WHERE status='processing' AND res_status<>'entered'"),
        'awaiting' => $c("SELECT COUNT(*) AS n FROM orders WHERE res_status='entered'")],
      'dues' => ['orders' => $c('SELECT COUNT(*) AS n FROM orders WHERE amount>paid'), 'amount' => $c('SELECT COALESCE(SUM(amount-paid),0) AS n FROM orders WHERE amount>paid')],
      'stock' => ['low' => $c('SELECT COUNT(*) AS n FROM stock_items WHERE active=1 AND qty<=min_qty')],
      'inbox' => ['tickets' => $c("SELECT COUNT(*) AS n FROM tickets WHERE status='open'"), 'chats' => $unread, 'members' => $reqs],
      'bookings' => $c("SELECT COUNT(*) AS n FROM bookings WHERE status='new'")]);
  }
  if ($path === '/staff/summary' && $m === 'GET') {
    $from = (int)(isset($q['from']) ? $q['from'] : 0); $to = (int)(isset($q['to']) ? $q['to'] : nowms()); $tz = (int)(isset($q['tz']) ? $q['tz'] : 330);
    if ($to - $from > 93 * 86400000) throw bad('Choose a range of up to 3 months.');
    out(summary($from, $to, $tz));
  }
  throw new HttpErr(404, 'Not found');
}
