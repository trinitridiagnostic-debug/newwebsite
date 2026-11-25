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
    'tests' => array_column($tests, 'name'), 'fasting' => phFasting($tests), 'due' => max(0, (int)$o['amount'] - (int)$o['paid']), 'notes' => (string)$o['notes'],
    'ph_id' => $o['ph_id'], 'ph_status' => $o['ph_status'], 'ph_at' => $o['ph_at'] === null ? null : (int)$o['ph_at'], 'status' => $o['status'], 'created' => (int)$o['created']];
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
        'on_leave' => phOnLeave($me, phToday())]);
    }
    if ($path === '/staff/phleb/orders' && $m === 'GET') {
      $scope = isset($_GET['scope']) ? $_GET['scope'] : 'mine';
      if ($scope === 'pool') $rows = all("SELECT * FROM orders WHERE kind='home' AND status='booked' AND (ph_id IS NULL OR ph_id='') ORDER BY COALESCE(slot_at, created) ASC LIMIT 100");
      elseif ($scope === 'served') $rows = all("SELECT * FROM orders WHERE kind='home' AND ph_id=? AND ph_status='collected' ORDER BY ph_at DESC LIMIT 100", [$me]);
      else $rows = all("SELECT * FROM orders WHERE kind='home' AND ph_id=? AND ph_status IN ('assigned','accepted','started') ORDER BY COALESCE(slot_at, created) ASC LIMIT 100", [$me]);
      out(['orders' => array_map('phView', $rows)]);
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
        if ($act === 'release') q("UPDATE orders SET ph_id=NULL, ph_status=NULL, ph_at=? WHERE id=?", [$now, $o['id']]);
        if ($act === 'collected') {
          $t = json_decode($o['times'], true) ?: []; $t['collected'] = $now;
          q("UPDATE orders SET ph_status='collected', ph_at=?, status=CASE WHEN status='booked' THEN 'collected' ELSE status END, times=? WHERE id=?", [$now, json_encode($t), $o['id']]);
        }
      }
      out(['order' => phView(sFresh($o['id']))]);
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
    if ($pid === '') q('UPDATE orders SET ph_id=NULL, ph_status=NULL, ph_at=? WHERE id=?', [nowms(), $o['id']]);
    else {
      $p = one("SELECT id FROM staff WHERE id=? AND role='phlebotomist' AND active=1", [$pid]); if (!$p) throw bad('Choose a phlebotomist.');
      q("UPDATE orders SET ph_id=?, ph_status='assigned', ph_at=? WHERE id=?", [$pid, nowms(), $o['id']]);
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
