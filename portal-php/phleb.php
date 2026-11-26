<?php
/* Phlebotomist module: home-collection visits.
   The lab (admin/reception) books a home visit with an address and time, and assigns it to a phlebotomist or leaves it in the pool.
   Phlebotomists log in at phlebotomist.html with a staff login (role "phlebotomist"): accept / start / collect / release visits,
   pick orders from the pool, apply for leave and raise an SOS alert that the lab sees on its Home visits page. */

function phFasting($tests) {
  foreach ($tests as $t) if (preg_match('/fasting|glucose|sugar|fbs|lipid|cholesterol|triglycer|insulin|gtt|homa/i', $t['name'])) return true;
  return false;
}
function phView($o) {
  $tests = json_decode($o['tests'], true) ?: [];
  return ['code' => $o['code'], 'name' => $o['name'], 'mobile' => $o['mobile'], 'age' => $o['age'] === null ? null : (int)$o['age'], 'sex' => $o['sex'],
    'addr' => (string)($o['addr'] ?? ''), 'slot_at' => $o['slot_at'] === null ? null : (int)$o['slot_at'], 'slot_mins' => (int)($o['slot_mins'] ?: 20),
    'tests' => array_column($tests, 'name'), 'fasting' => phFasting($tests), 'due' => max(0, (int)$o['amount'] - (int)$o['paid']), 'amount' => (int)$o['amount'], 'paid' => (int)$o['paid'], 'pay_mode' => $o['pay_mode'], 'notes' => (string)$o['notes'],
    'ph_id' => $o['ph_id'], 'pin_ok' => (int)($o['ph_pin_ok'] ?? 0) === 1, 'ph_status' => $o['ph_status'], 'ph_at' => $o['ph_at'] === null ? null : (int)$o['ph_at'], 'status' => $o['status'], 'created' => (int)$o['created']];
}
/* address + visit time on an order (called after create/update when the form sent them) */
function setVisit($id, $b) {
  $sets = []; $args = [];
  if (array_key_exists('address', $b)) { $sets[] = 'addr=?'; $args[] = clean(field($b, 'address'), 300); }
  if (array_key_exists('slot', $b)) {
    $v = field($b, 'slot'); $ms = ($v === '' || $v === null) ? null : (int)$v;
    if ($ms !== null && ($ms < 1500000000000 || $ms > 4000000000000)) throw bad('The visit time is not valid.');
    $sets[] = 'slot_at=?'; $args[] = $ms;
  }
  if (!$sets) return; $args[] = $id; q('UPDATE orders SET ' . implode(', ', $sets) . ' WHERE id=?', $args);
}
function phOnLeave($sid, $day) { return (bool)one('SELECT 1 AS x FROM leaves WHERE staff_id=? AND from_d<=? AND to_d>=?', [$sid, $day, $day]); }
function phToday() { return (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('Y-m-d'); }
function phDay($v) { $v = (string)$v; $d = DateTime::createFromFormat('Y-m-d', $v); if (!$d || $d->format('Y-m-d') !== $v) throw bad('Choose a valid date.'); return $v; }

function phlebRoutes($path, $m, $s) {
  /* ---------- the phlebotomist's own screens ---------- */
  if (strpos($path, '/staff/phleb/') === 0) {
    need($s, 'phleb'); $me = $s['id'];
    if ($path === '/staff/phleb/home' && $m === 'GET') {
      $c = function ($sql, $a = []) { $r = one($sql, $a); return (int)$r['n']; };
      out(['name' => $s['name'], 'orders' => $c("SELECT COUNT(*) AS n FROM orders WHERE kind='home' AND ph_id=? AND ph_status IN ('assigned','accepted','started')", [$me]),
        'served' => $c("SELECT COUNT(*) AS n FROM orders WHERE kind='home' AND ph_id=? AND ph_status='collected'", [$me]),
        'pool' => $c("SELECT COUNT(*) AS n FROM orders WHERE kind='home' AND status='booked' AND (ph_id IS NULL OR ph_id='')"),
        'on_leave' => phOnLeave($me, phToday()), 'attendance' => (bool)one('SELECT 1 AS x FROM attendance WHERE staff_id=? AND day=?', [$me, phToday()])]);
    }
    if ($path === '/staff/phleb/orders' && $m === 'GET') {
      $scope = isset($_GET['scope']) ? $_GET['scope'] : 'mine';
      if ($scope === 'pool') $rows = all("SELECT * FROM orders WHERE kind='home' AND status='booked' AND (ph_id IS NULL OR ph_id='') ORDER BY COALESCE(slot_at, created) ASC LIMIT 100");
      elseif ($scope === 'served') $rows = all("SELECT * FROM orders WHERE kind='home' AND ph_id=? AND ph_status='collected' ORDER BY ph_at DESC LIMIT 100", [$me]);
      else $rows = all("SELECT * FROM orders WHERE kind='home' AND ph_id=? AND ph_status IN ('assigned','accepted','started') ORDER BY COALESCE(slot_at, created) ASC LIMIT 100", [$me]);
      out(['orders' => array_map('phView', $rows)]);
    }
    if ($m === 'POST' && preg_match('#^/staff/phleb/orders/([^/]+)/verifypin$#', $path, $r)) {
      $o = one("SELECT * FROM orders WHERE code=? AND kind='home'", [rawurldecode($r[1])]);
      if (!$o || $o['ph_id'] !== $me) throw new HttpErr(404, 'Visit not found.');
      if ($o['ph_status'] === 'collected') throw bad('This visit is already done.');
      if ((int)$o['ph_pin_ok'] === 1) out(['verified' => true, 'order' => phView($o)]);
      $now = nowms(); $tries = (int)$o['ph_pin_tries'];
      if ($tries >= 5 && $o['ph_pin_at'] !== null && $now - (int)$o['ph_pin_at'] < 10 * 60000) throw new HttpErr(429, 'Too many wrong PINs. Wait 10 minutes or ask the lab for a new PIN.');
      if ($tries >= 5) $tries = 0;
      $pin = preg_replace('/\D/', '', (string)field(body(), 'pin'));
      if (strlen($pin) !== 6) throw bad('Enter the 6-digit PIN the patient has.');
      if (!hash_equals($o['pin_hash'], pinHash($o['code'], $pin))) { q('UPDATE orders SET ph_pin_tries=?, ph_pin_at=? WHERE id=?', [$tries + 1, $now, $o['id']]); throw bad('That PIN is not correct. Ask the patient to check it.'); }
      q('UPDATE orders SET ph_pin_ok=1, ph_pin_tries=0 WHERE id=?', [$o['id']]);
      out(['verified' => true, 'order' => phView(sFresh($o['id']))]);
    }
    if ($m === 'POST' && preg_match('#^/staff/phleb/orders/([^/]+)/(accept|start|collected|release|pick)$#', $path, $r)) {
      $code = rawurldecode($r[1]); $act = $r[2]; $o = one("SELECT * FROM orders WHERE code=? AND kind='home'", [$code]);
      if (!$o) throw new HttpErr(404, 'Visit not found.');
      $now = nowms();
      if ($act === 'pick') {
        if ($o['status'] !== 'booked') throw bad('This visit is already done.');
        if (phOnLeave($me, phToday())) throw bad('You are on leave today.');
        $n = q("UPDATE orders SET ph_id=?, ph_status='accepted', ph_at=? WHERE id=? AND (ph_id IS NULL OR ph_id='')", [$me, $now, $o['id']])->rowCount();
        if ($n < 1) throw bad('Someone else just picked this visit.');
      } else {
        if ($o['ph_id'] !== $me) throw new HttpErr(403, 'This visit is not assigned to you.');
        if ($o['ph_status'] === 'collected') throw bad('This visit is already done.');
        if ($act === 'accept') q("UPDATE orders SET ph_status='accepted', ph_at=? WHERE id=?", [$now, $o['id']]);
        if ($act === 'start') q("UPDATE orders SET ph_status='started', ph_at=? WHERE id=?", [$now, $o['id']]);
        if ($act === 'release') q("UPDATE orders SET ph_id=NULL, ph_status=NULL, ph_at=?, ph_pin_ok=0 WHERE id=?", [$now, $o['id']]);
        if ($act === 'collected') {
          if ((int)$o['ph_pin_ok'] !== 1) throw bad('Verify the patient\'s PIN before collecting the sample.');
          $t = json_decode($o['times'], true) ?: []; $t['collected'] = $now;
          q("UPDATE orders SET ph_status='collected', ph_at=?, status=CASE WHEN status='booked' THEN 'collected' ELSE status END, times=? WHERE id=?", [$now, json_encode($t), $o['id']]);
        }
      }
      out(['order' => phView(sFresh($o['id']))]);
    }
    if (preg_match('#^/staff/phleb/orders/([^/]+)(?:/(payqr|paystatus))?$#', $path, $r) && ($m === 'GET' || ($r[2] ?? '') === 'payqr')) {
      $act = $r[2] ?? ''; $o = one("SELECT * FROM orders WHERE code=? AND kind='home'", [rawurldecode($r[1])]);
      if (!$o || $o['ph_id'] !== $me) throw new HttpErr(404, 'Visit not found.');
      if ($act === '' && $m === 'GET') out(['order' => phView($o)]);
      if ($o['ph_status'] !== 'collected') throw bad('Mark the sample collected first, then take the payment.');
      require_once __DIR__ . '/pay.php';
      if ($act === 'payqr' && $m === 'POST') { $qr = payQrCreate($o); out(['qr' => $qr, 'order' => phView(sFresh($o['id']))]); }
      if ($act === 'paystatus' && $m === 'GET') { $o = payQrCheck($o); out(['order' => phView($o), 'paid_online' => orderDue($o) < 1 && $o['pay_mode'] === 'online']); }
    }
    if ($path === '/staff/phleb/attendance' && $m === 'POST') {
      $day = phToday();
      if (one('SELECT 1 AS x FROM attendance WHERE staff_id=? AND day=?', [$me, $day])) out(['ok' => true, 'already' => true]);
      $b = body(700000); $lat = field($b, 'lat'); $lng = field($b, 'lng'); $acc = field($b, 'acc');
      if (!is_numeric($lat) || !is_numeric($lng) || abs((float)$lat) > 90 || abs((float)$lng) > 180) throw bad('Your location was not received. Switch on GPS and try again.');
      $img = (string)field($b, 'selfie');
      if (!preg_match('#^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$#', $img, $mm)) throw bad('Take a selfie first.');
      $raw = base64_decode($mm[1], true); if ($raw === false || strlen($raw) < 2000 || strlen($raw) > 450000 || substr($raw, 0, 3) !== "\xFF\xD8\xFF") throw bad('The selfie could not be read. Please retake it.');
      $file = $day . '-' . $me . '.jpg';
      if (@file_put_contents(cfg()['storage_dir'] . '/attendance/' . $file, $raw, LOCK_EX) === false) throw new Exception('Cannot save the selfie.');
      try { q('INSERT INTO attendance (staff_id, day, at, lat, lng, acc, selfie) VALUES (?,?,?,?,?,?,?)', [$me, $day, nowms(), (float)$lat, (float)$lng, is_numeric($acc) ? (float)$acc : null, $file]); } catch (PDOException $e) { }
      out(['ok' => true]);
    }
    if ($path === '/staff/phleb/leaves' && $m === 'GET') {
      out(['leaves' => array_map(function ($x) { return ['id' => (int)$x['id'], 'from' => $x['from_d'], 'to' => $x['to_d'], 'reason' => (string)$x['reason']]; },
        all('SELECT * FROM leaves WHERE staff_id=? AND to_d>=? ORDER BY from_d', [$me, phToday()]))]);
    }
    if ($path === '/staff/phleb/leaves' && $m === 'POST') {
      $b = body(); $f = phDay(field($b, 'from')); $t = phDay(field($b, 'to') ?: field($b, 'from'));
      if ($t < $f) throw bad('The last day cannot be before the first day.'); if ($t < phToday()) throw bad('Choose today or a later date.');
      if ((strtotime($t) - strtotime($f)) > 60 * 86400) throw bad('Leave can be at most 60 days at a time.');
      q('INSERT INTO leaves (staff_id, from_d, to_d, reason, created) VALUES (?,?,?,?,?)', [$me, $f, $t, clean(field($b, 'reason'), 200), nowms()]);
      out(['ok' => true], 201);
    }
    if ($m === 'POST' && preg_match('#^/staff/phleb/leaves/(\d+)/cancel$#', $path, $r)) { q('DELETE FROM leaves WHERE id=? AND staff_id=?', [(int)$r[1], $me]); out(['ok' => true]); }
    if ($path === '/staff/phleb/sos' && $m === 'POST') {
      $b = body(); $lat = field($b, 'lat'); $lng = field($b, 'lng');
      $recent = one('SELECT 1 AS x FROM sos WHERE staff_id=? AND created>?', [$me, nowms() - 60000]);
      if (!$recent) q('INSERT INTO sos (staff_id, staff_name, lat, lng, note, created) VALUES (?,?,?,?,?,?)', [$me, $s['name'], is_numeric($lat) ? (float)$lat : null, is_numeric($lng) ? (float)$lng : null, clean(field($b, 'note'), 200), nowms()]);
      out(['ok' => true]);
    }
    throw new HttpErr(404, 'Not found.');
  }

  /* ---------- the lab side: assign visits, see leave and SOS ---------- */
  /* ---------- the Phlebotomists tab in the lab console ---------- */
  if (strpos($path, '/staff/phlebotomists') === 0) {
    $pv = function ($x) {
      $n = one("SELECT COUNT(*) AS n FROM orders WHERE ph_id=? AND ph_status='collected'", [$x['id']]); $o = one("SELECT COUNT(*) AS n FROM orders WHERE ph_id=? AND status='booked' AND (ph_status IS NULL OR ph_status<>'collected')", [$x['id']]);
      return ['id' => $x['id'], 'name' => $x['name'], 'username' => $x['username'], 'mobile' => (string)($x['mobile'] ?? ''), 'district' => (string)($x['district'] ?? ''), 'taluka' => (string)($x['taluka'] ?? ''),
        'active' => (int)$x['active'] === 1, 'on_leave' => phOnLeave($x['id'], phToday()), 'served' => (int)$n['n'], 'open' => (int)$o['n'], 'created' => (int)$x['created']];
    };
    $loc = function ($b) {
      $d = clean(field($b, 'district'), 40); $t = clean(field($b, 'taluka'), 40); $mob = preg_replace('/\D/', '', (string)field($b, 'mobile')); $mob = strlen($mob) >= 10 ? substr($mob, -10) : $mob;
      if ($mob !== '' && !preg_match('/^[6-9]\d{9}$/', $mob)) throw bad('Enter a valid 10-digit mobile number.');
      return [$mob, $d, $t];
    };
    if ($path === '/staff/phlebotomists' && $m === 'GET') { need($s, 'assign'); out(['phlebotomists' => array_map($pv, all("SELECT * FROM staff WHERE role='phlebotomist' ORDER BY name"))]); }
    if ($path === '/staff/phlebotomists' && $m === 'POST') {
      need($s, 'staff'); $b = body(); $user = cleanUser(field($b, 'username')); $name = clean(field($b, 'name'), 60); $pw = (string)field($b, 'password'); list($mob, $d, $t) = $loc($b);
      if (mb_strlen($name) < 2) throw bad('Enter the name.'); validPassword($pw);
      if (one('SELECT 1 AS x FROM staff WHERE username=?', [$user])) throw bad('That username is taken.');
      $id = rnd(9); q("INSERT INTO staff (id, username, name, role, title, hash, active, created, mobile, district, taluka) VALUES (?,?,?,?,?,?,1,?,?,?,?)", [$id, $user, $name, 'phlebotomist', 'Phlebotomist', password_hash($pw, PASSWORD_DEFAULT), nowms(), $mob, $d, $t]);
      out(['phlebotomist' => $pv(one('SELECT * FROM staff WHERE id=?', [$id]))], 201);
    }
    if ($m === 'POST' && preg_match('#^/staff/phlebotomists/([^/]+?)(?:/(delete))?$#', $path, $r)) {
      need($s, 'staff'); $x = one("SELECT * FROM staff WHERE id=? AND role='phlebotomist'", [rawurldecode($r[1])]); if (!$x) throw new HttpErr(404, 'Phlebotomist not found.');
      if (($r[2] ?? '') === 'delete') {
        q("UPDATE orders SET ph_id=NULL, ph_status=NULL, ph_at=?, ph_pin_ok=0 WHERE ph_id=? AND (ph_status IS NULL OR ph_status<>'collected')", [nowms(), $x['id']]);   // unfinished visits go back to the pool
        q('DELETE FROM leaves WHERE staff_id=?', [$x['id']]); q('DELETE FROM staff WHERE id=?', [$x['id']]); out(['ok' => true]);
      }
      $b = body(); list($mob, $d, $t) = $loc($b); $name = isset($b['name']) ? clean($b['name'], 60) : $x['name']; if (mb_strlen($name) < 2) throw bad('Enter the name.');
      $active = isset($b['active']) ? ($b['active'] ? 1 : 0) : (int)$x['active'];
      q('UPDATE staff SET name=?, mobile=?, district=?, taluka=?, active=? WHERE id=?', [$name, $mob, $d, $t, $active, $x['id']]);
      if (!empty($b['password'])) { validPassword((string)$b['password']); q('UPDATE staff SET hash=? WHERE id=?', [password_hash((string)$b['password'], PASSWORD_DEFAULT), $x['id']]); }
      out(['phlebotomist' => $pv(one('SELECT * FROM staff WHERE id=?', [$x['id']]))]);
    }
  }
  /* attendance sheet for the lab (selfie + GPS the phlebotomists sent) */
  if ($path === '/staff/attendance' && $m === 'GET') {
    need($s, 'assign'); $day = phDay($_GET['day'] ?? phToday()); $rows = [];
    $att = []; foreach (all('SELECT * FROM attendance WHERE day=?', [$day]) as $a) $att[$a['staff_id']] = $a;
    foreach (all("SELECT id, name, mobile, district, taluka FROM staff WHERE role='phlebotomist' AND active=1 ORDER BY name") as $x) {
      $a = $att[$x['id']] ?? null;
      $rows[] = ['staff_id' => $x['id'], 'name' => $x['name'], 'mobile' => (string)($x['mobile'] ?? ''), 'district' => (string)($x['district'] ?? ''), 'taluka' => (string)($x['taluka'] ?? ''), 'on_leave' => phOnLeave($x['id'], $day),
        'present' => (bool)$a, 'at' => $a ? (int)$a['at'] : null, 'lat' => $a ? (float)$a['lat'] : null, 'lng' => $a ? (float)$a['lng'] : null, 'acc' => $a && $a['acc'] !== null ? (float)$a['acc'] : null, 'selfie' => $a ? $a['id'] : null];
    }
    out(['day' => $day, 'rows' => $rows]);
  }
  if ($path === '/staff/attendance/selfie' && $m === 'GET') {
    need($s, 'assign'); $a = one('SELECT * FROM attendance WHERE id=?', [(int)($_GET['id'] ?? 0)]); $f = $a ? cfg()['storage_dir'] . '/attendance/' . basename($a['selfie']) : '';
    if (!$a || !is_file($f)) throw new HttpErr(404, 'No selfie.');
    header('Content-Type: image/jpeg'); header('Cache-Control: private, max-age=3600'); header('Content-Length: ' . filesize($f)); readfile($f); exit;
  }
  if ($path === '/staff/phlebs' && $m === 'GET') {
    need($s, 'assign'); $day = phToday();
    out(['phlebs' => array_map(function ($x) use ($day) { return ['id' => $x['id'], 'name' => $x['name'], 'username' => $x['username'], 'on_leave' => phOnLeave($x['id'], $day)]; },
      all("SELECT id, name, username FROM staff WHERE role='phlebotomist' AND active=1 ORDER BY name"))]);
  }
  if ($path === '/staff/visits' && $m === 'GET') {
    need($s, 'assign'); $from = (int)($_GET['from'] ?? 0); $to = (int)($_GET['to'] ?? 0); $st = $_GET['state'] ?? 'open';
    $w = ["kind='home'"]; $a = [];
    if ($st === 'done') $w[] = "(ph_status='collected' OR status<>'booked')"; else $w[] = "(status='booked' AND (ph_status IS NULL OR ph_status<>'collected'))";
    if ($from) { $w[] = 'COALESCE(slot_at, created)>=?'; $a[] = $from; } if ($to) { $w[] = 'COALESCE(slot_at, created)<?'; $a[] = $to; }
    $rows = all('SELECT * FROM orders WHERE ' . implode(' AND ', $w) . ' ORDER BY COALESCE(slot_at, created) ' . ($st === 'done' ? 'DESC' : 'ASC') . ' LIMIT 200', $a);
    $names = []; foreach (all("SELECT id, name FROM staff WHERE role='phlebotomist'") as $x) $names[$x['id']] = $x['name'];
    out(['visits' => array_map(function ($o) use ($names) { $v = phView($o); $v['ph_name'] = $o['ph_id'] ? ($names[$o['ph_id']] ?? '?') : ''; return $v; }, $rows)]);
  }
  if ($m === 'POST' && preg_match('#^/staff/orders/([^/]+)/assign$#', $path, $r)) {
    need($s, 'assign'); $o = one("SELECT * FROM orders WHERE code=?", [rawurldecode($r[1])]); if (!$o) throw new HttpErr(404, 'Order not found.');
    if ($o['kind'] !== 'home') throw bad('Only home-collection orders can be assigned. Change the order to Home collection first.');
    if ($o['ph_status'] === 'collected' || $o['status'] !== 'booked') throw bad('The sample is already collected.');
    $pid = clean(field(body(), 'phleb'), 32);
    if ($pid === '') q('UPDATE orders SET ph_id=NULL, ph_status=NULL, ph_at=?, ph_pin_ok=0 WHERE id=?', [nowms(), $o['id']]);
    else {
      $p = one("SELECT id FROM staff WHERE id=? AND role='phlebotomist' AND active=1", [$pid]); if (!$p) throw bad('Choose a phlebotomist.');
      q("UPDATE orders SET ph_id=?, ph_status='assigned', ph_at=?, ph_pin_ok=0 WHERE id=?", [$pid, nowms(), $o['id']]);
    }
    out(['order' => sView(sFresh($o['id']))]);
  }
  if ($path === '/staff/leaves' && $m === 'GET') {
    need($s, 'assign');
    out(['leaves' => array_map(function ($x) { return ['id' => (int)$x['id'], 'name' => $x['name'], 'from' => $x['from_d'], 'to' => $x['to_d'], 'reason' => (string)$x['reason']]; },
      all('SELECT l.*, s.name FROM leaves l JOIN staff s ON s.id=l.staff_id WHERE l.to_d>=? ORDER BY l.from_d', [phToday()]))]);
  }
  if ($path === '/staff/sos' && $m === 'GET') {
    need($s, 'assign');
    out(['sos' => array_map(function ($x) { return ['id' => (int)$x['id'], 'name' => $x['staff_name'], 'lat' => $x['lat'] === null ? null : (float)$x['lat'], 'lng' => $x['lng'] === null ? null : (float)$x['lng'], 'note' => (string)$x['note'],
      'created' => (int)$x['created'], 'ack_by' => $x['ack_by'], 'ack_at' => $x['ack_at'] === null ? null : (int)$x['ack_at']]; }, all('SELECT * FROM sos ORDER BY created DESC LIMIT 20'))]);
  }
  if ($m === 'POST' && preg_match('#^/staff/sos/(\d+)/ack$#', $path, $r)) { need($s, 'assign'); q('UPDATE sos SET ack_by=?, ack_at=? WHERE id=? AND ack_at IS NULL', [$s['name'], nowms(), (int)$r[1]]); out(['ok' => true]); }
}
