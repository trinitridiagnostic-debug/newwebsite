<?php
/* Doctor partner app: B2B price list, home-visit bookings booked by doctors, commission, Razorpay QR for the lab's share.
   The patient pays the doctor whatever the doctor charges. The doctor pays the lab only the B2B total (by UPI QR) and keeps the rest.
   Once that QR is paid, the home visit becomes a normal paid order that the lab assigns to a phlebotomist. */

function drId() { return 'D' . strtoupper(substr(bin2hex(random_bytes(5)), 0, 9)); }
function drSlotLabel($ms) { return $ms ? (new DateTime('@' . intdiv((int)$ms, 1000)))->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('d-m-Y h:i A') : ''; }

function drView($b, $withPin = false) {
  $o = $b['order_code'] ? one('SELECT status, ph_status, report_name, res_status, ph_id FROM orders WHERE code=?', [$b['order_code']]) : null;
  $v = ['id' => $b['id'], 'name' => $b['pname'], 'mobile' => $b['mobile'], 'age' => $b['age'] === null ? null : (int)$b['age'], 'sex' => $b['sex'], 'address' => $b['addr'], 'slot_at' => $b['slot_at'] === null ? null : (int)$b['slot_at'],
    'notes' => $b['notes'], 'tests' => json_decode((string)$b['tests'], true) ?: [], 'b2b' => (int)$b['b2b'], 'price' => (int)$b['price'], 'commission' => (int)$b['commission'], 'status' => $b['status'],
    'order_code' => $b['order_code'], 'created' => (int)$b['created'], 'paid_at' => $b['paid_at'] === null ? null : (int)$b['paid_at'],
    'stage' => $o ? ($o['res_status'] === 'approved' || $o['report_name'] ? 'report_ready' : ($o['status'] === 'booked' ? ($o['ph_status'] === 'collected' ? 'collected' : ($o['ph_id'] ? 'phlebo_assigned' : 'confirmed')) : $o['status'])) : null];
  if ($withPin && $b['status'] === 'confirmed' && !empty($b['pin'])) $v['pin'] = $b['pin'];
  return $v;
}

/* a single-use, fixed-amount UPI QR for the lab's B2B share */
function drQrCreate($b) {
  if ($b['status'] !== 'awaiting_payment') throw bad('This booking is already paid or cancelled.');
  $amt = (int)$b['b2b']; if ($amt < 1) throw bad('Nothing to pay.');
  if (!empty($b['qr_id']) && $b['qr_url'] && nowms() - (int)$b['qr_at'] < 8 * 60000) return ['qr_id' => $b['qr_id'], 'image_url' => $b['qr_url'], 'amount' => $amt];
  if (!empty($b['qr_id'])) { try { rzpCall('POST', '/payments/qr_codes/' . rawurlencode($b['qr_id']) . '/close'); } catch (Throwable $e) { } }
  list($st, $j) = rzpCall('POST', '/payments/qr_codes', ['type' => 'upi_qr', 'name' => 'Trinetri partner ' . $b['id'], 'usage' => 'single_use', 'fixed_amount' => true, 'payment_amount' => $amt * 100,
    'description' => 'Trinetri Diagnostics lab charges ' . $b['id'], 'close_by' => time() + 20 * 60, 'notes' => ['dr_booking' => $b['id']]]);
  if ($st < 200 || $st >= 300 || empty($j['id']) || empty($j['image_url'])) {
    error_log('[trinetri-portal] razorpay dr qr ' . $st . ' ' . json_encode($j));
    $why = isset($j['error']['description']) ? (string)$j['error']['description'] : '';
    throw new HttpErr(502, 'Could not create the payment QR' . ($why !== '' ? ': ' . substr($why, 0, 160) : '. Please try again.'));
  }
  q('UPDATE dr_bookings SET qr_id=?, qr_url=?, qr_at=? WHERE id=?', [$j['id'], $j['image_url'], nowms(), $b['id']]);
  return ['qr_id' => $j['id'], 'image_url' => $j['image_url'], 'amount' => $amt];
}

/* Money for a booking arrived. Safe to call twice: only the first call confirms the booking and creates the order. */
function drConfirm($b, $ref, $paise) {
  require_once __DIR__ . '/staff.php';
  if (intdiv((int)$paise, 100) < (int)$b['b2b']) return false;
  $n = q("UPDATE dr_bookings SET status='confirmed', pay_ref=?, paid_at=? WHERE id=? AND status='awaiting_payment'", [substr((string)$ref, 0, 40), nowms(), $b['id']]);
  if (!$n || $n->rowCount() < 1) return false;
  $now = nowms(); $id = rnd(9); $pin = (string)random_int(100000, 999999); $tests = [];
  foreach (json_decode((string)$b['tests'], true) ?: [] as $t) $tests[] = ['key' => $t['key'], 'name' => $t['name'], 'price' => (int)$t['b2b']];
  $dr = one('SELECT name FROM staff WHERE id=?', [$b['doctor_id']]); $drName = $dr ? $dr['name'] : 'Doctor partner';
  $note = 'Doctor partner booking (' . $b['id'] . '). Patient pays Dr ' . preg_replace('/^dr\.?\s+/i', '', $drName) . ' Rs ' . (int)$b['price'] . '; lab charges Rs ' . (int)$b['b2b'] . ' already paid by the doctor. Do NOT collect money from the patient.' . ($b['notes'] ? ' ' . $b['notes'] : '');
  for ($try = 0; ; $try++) {
    $code = nextCode();
    try {
      q('INSERT INTO orders (id, code, mobile, name, tests, amount, status, times, created, pin_hash, age, sex, ref_doctor, kind, notes, discount, paid, pay_mode, created_by, addr, slot_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$id, $code, $b['mobile'], $b['pname'], json_encode($tests, JSON_UNESCAPED_UNICODE), (int)$b['b2b'], 'booked', json_encode(['booked' => $now]), $now, pinHash($code, $pin), $b['age'], $b['sex'], $drName, 'home', substr($note, 0, 500), 0, (int)$b['b2b'], 'online', 'Doctor app', $b['addr'], $b['slot_at']]);
      break;
    } catch (PDOException $e) { if ($try > 5) throw $e; }
  }
  $cu = one('SELECT id FROM users WHERE mobile=? AND verified=1', [$b['mobile']]); if ($cu) autoLink($cu['id'], $b['mobile']);
  try { q('INSERT INTO payments (order_id, ref, amount, mode, created) VALUES (?,?,?,?,?)', [$id, substr('dr-' . (string)$ref, 0, 40), (int)$b['b2b'], 'online', $now]); } catch (PDOException $e) { }
  q('UPDATE dr_bookings SET order_code=?, pin=? WHERE id=?', [$code, $pin, $b['id']]);
  return true;
}

function drCheck($b) {
  if ($b['status'] === 'awaiting_payment' && !empty($b['qr_id'])) {
    list($st, $j) = rzpCall('GET', '/payments/qr_codes/' . rawurlencode($b['qr_id']) . '/payments');
    if ($st >= 200 && $st < 300) foreach (($j['items'] ?? []) as $p) if (($p['status'] ?? '') === 'captured' && !empty($p['id']) && drConfirm($b, $p['id'], (int)$p['amount'])) break;
  }
  return one('SELECT * FROM dr_bookings WHERE id=?', [$b['id']]);
}

/* called from the Razorpay webhook when the order lookup finds nothing */
function drWebhook($qid, $pay) {
  $b = $qid ? one('SELECT * FROM dr_bookings WHERE qr_id=?', [$qid]) : null;
  if (!$b && !empty($pay['notes']['dr_booking'])) $b = one('SELECT * FROM dr_bookings WHERE id=?', [(string)$pay['notes']['dr_booking']]);
  if ($b && !empty($pay['id']) && (($pay['status'] ?? 'captured') === 'captured')) drConfirm($b, $pay['id'], (int)($pay['amount'] ?? 0));
}

function drEarnings($did) {
  $r = one("SELECT COUNT(*) AS n, COALESCE(SUM(commission),0) AS c, COALESCE(SUM(price),0) AS p, COALESCE(SUM(b2b),0) AS b FROM dr_bookings WHERE doctor_id=? AND status='confirmed'", [$did]);
  $ms = (new DateTime('first day of this month 00:00', new DateTimeZone('Asia/Kolkata')))->getTimestamp() * 1000;
  $m = one("SELECT COUNT(*) AS n, COALESCE(SUM(commission),0) AS c FROM dr_bookings WHERE doctor_id=? AND status='confirmed' AND paid_at>=?", [$did, $ms]);
  $w = one("SELECT COUNT(*) AS n FROM dr_bookings WHERE doctor_id=? AND status='awaiting_payment'", [$did]);
  return ['bookings' => (int)$r['n'], 'collected' => (int)$r['p'], 'paid_to_lab' => (int)$r['b'], 'commission' => (int)$r['c'], 'month_bookings' => (int)$m['n'], 'month_commission' => (int)$m['c'], 'awaiting' => (int)$w['n']];
}

function drRoutes($path, $m, $s) {
  /* ---- lab side: upload the B2B price list, see doctor bookings ---- */
  if ($path === '/staff/b2b' && $m === 'GET') {
    need($s, 'b2b'); $rows = all('SELECT tkey, name, price, updated FROM b2b_prices ORDER BY name'); $u = 0; foreach ($rows as $r) $u = max($u, (int)$r['updated']);
    out(['count' => count($rows), 'updated' => $u, 'rows' => array_map(function ($r) { return ['key' => $r['tkey'], 'name' => $r['name'], 'price' => (int)$r['price']]; }, $rows)]);
  }
  if ($path === '/staff/b2b' && $m === 'POST') {
    need($s, 'b2b'); $b = body(6000000); $rows = is_array($b['rows'] ?? null) ? $b['rows'] : []; if (!$rows) throw bad('No prices found in the file.');
    if (count($rows) > 6000) throw bad('Too many rows in one go (6000 max).');
    $clean = []; $now = nowms();
    foreach ($rows as $r) {
      if (!is_array($r)) continue; $k = clean(field($r, 'key'), 40); $n = clean(field($r, 'name'), 160); $p = (int)round((float)field($r, 'price'));
      if ($k === '' || $n === '' || $p < 1 || $p > 1000000) continue; $clean[$k] = [$n, $p];
    }
    if (!$clean) throw bad('No valid rows (each needs a test name and a price above 0).');
    if (!empty($b['replace'])) q('DELETE FROM b2b_prices');
    foreach ($clean as $k => $v) {
      if (one('SELECT 1 AS x FROM b2b_prices WHERE tkey=?', [$k])) q('UPDATE b2b_prices SET name=?, price=?, updated=? WHERE tkey=?', [$v[0], $v[1], $now, $k]);
      else q('INSERT INTO b2b_prices (tkey, name, price, updated) VALUES (?,?,?,?)', [$k, $v[0], $v[1], $now]);
    }
    $c = one('SELECT COUNT(*) AS n FROM b2b_prices'); out(['saved' => count($clean), 'count' => (int)$c['n']]);
  }
  if ($path === '/staff/b2b/delete' && $m === 'POST') { need($s, 'b2b'); $k = clean(field(body(), 'key'), 40); q('DELETE FROM b2b_prices WHERE tkey=?', [$k]); out(['ok' => true]); }
  if ($path === '/staff/drbookings' && $m === 'GET') {
    need($s, 'b2b'); $rows = all('SELECT d.*, s.name AS dname, s.username AS duser FROM dr_bookings d LEFT JOIN staff s ON s.id=d.doctor_id ORDER BY d.created DESC LIMIT 500');
    $sum = all("SELECT d.doctor_id, s.name, COUNT(*) AS n, SUM(d.price) AS p, SUM(d.b2b) AS b, SUM(d.commission) AS c FROM dr_bookings d LEFT JOIN staff s ON s.id=d.doctor_id WHERE d.status='confirmed' GROUP BY d.doctor_id, s.name ORDER BY c DESC");
    out(['bookings' => array_map(function ($r) { $v = drView($r); $v['doctor'] = $r['dname']; return $v; }, $rows),
         'doctors' => array_map(function ($r) { return ['id' => $r['doctor_id'], 'name' => $r['name'], 'bookings' => (int)$r['n'], 'collected' => (int)$r['p'], 'paid_to_lab' => (int)$r['b'], 'commission' => (int)$r['c']]; }, $sum)]);
  }

  /* ---- doctor side ---- */
  if (strpos($path, '/staff/dr/') !== 0) return;
  need($s, 'dr');
  if ($path === '/staff/dr/home' && $m === 'GET') {
    $c = one('SELECT COUNT(*) AS n FROM b2b_prices');
    out(['earnings' => drEarnings($s['id']), 'prices' => (int)$c['n'], 'recent' => array_map('drView', all('SELECT * FROM dr_bookings WHERE doctor_id=? ORDER BY created DESC LIMIT 5', [$s['id']]))]);
  }
  if ($path === '/staff/dr/prices' && $m === 'GET') { out(['prices' => array_map(function ($r) { return ['key' => $r['tkey'], 'name' => $r['name'], 'price' => (int)$r['price']]; }, all('SELECT tkey, name, price FROM b2b_prices ORDER BY name'))]); }
  if ($path === '/staff/dr/bookings' && $m === 'GET') {
    $rows = all('SELECT * FROM dr_bookings WHERE doctor_id=? ORDER BY created DESC LIMIT 300', [$s['id']]);
    out(['bookings' => array_map(function ($r) { return drView($r, true); }, $rows), 'earnings' => drEarnings($s['id'])]);
  }
  if ($path === '/staff/dr/bookings' && $m === 'POST') {
    $b = body(20000); $name = clean(field($b, 'name'), 60); $mobile = normMobile(field($b, 'mobile'));
    if (mb_strlen($name) < 2) throw bad('Enter the patient name.');
    if (!preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Enter a valid 10-digit mobile number.');
    $addr = clean(field($b, 'address'), 300); if (mb_strlen($addr) < 8) throw bad('Enter the full address for the home visit.');
    $slot = (int)field($b, 'slot'); if ($slot < nowms() - 600000 || $slot > nowms() + 60 * 86400000) throw bad('Choose a visit date and time within the next 60 days.');
    $keys = field($b, 'tests'); if (!is_array($keys) || !$keys) throw bad('Choose at least one test.'); $keys = array_values(array_unique(array_map(function ($k) { return clean($k, 40); }, array_slice($keys, 0, 80))));
    $tests = []; $b2b = 0;
    foreach ($keys as $k) { $p = one('SELECT * FROM b2b_prices WHERE tkey=?', [$k]); if (!$p) throw bad('One of the tests is not on the partner price list. Please refresh and choose again.'); $tests[] = ['key' => $p['tkey'], 'name' => $p['name'], 'b2b' => (int)$p['price']]; $b2b += (int)$p['price']; }
    $price = (int)round((float)field($b, 'price')); if ($price < $b2b) throw bad('The amount you charge the patient cannot be less than the lab price of Rs ' . $b2b . '.'); if ($price > 1000000) throw bad('That amount is too high.');
    $age = field($b, 'age'); $age = ($age === '' || $age === null) ? null : max(0, min(120, (int)$age)); $sex = strtoupper(clean(field($b, 'sex'), 1)); if (!in_array($sex, ['M', 'F', 'O'], true)) $sex = null;
    $id = drId(); q('INSERT INTO dr_bookings (id, doctor_id, pname, mobile, age, sex, addr, slot_at, notes, tests, b2b, price, commission, status, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [$id, $s['id'], $name, $mobile, $age, $sex, $addr, $slot, cleanBody(field($b, 'notes'), 200), json_encode($tests, JSON_UNESCAPED_UNICODE), $b2b, $price, $price - $b2b, 'awaiting_payment', nowms()]);
    out(['booking' => drView(one('SELECT * FROM dr_bookings WHERE id=?', [$id]))], 201);
  }
  if (preg_match('#^/staff/dr/bookings/([A-Z0-9]+)(?:/(qr|status|cancel))?$#', $path, $r)) {
    $bk = one('SELECT * FROM dr_bookings WHERE id=? AND doctor_id=?', [$r[1], $s['id']]); if (!$bk) throw new HttpErr(404, 'Booking not found.'); $act = $r[2] ?? '';
    if ($act === '' && $m === 'GET') out(['booking' => drView($bk, true)]);
    if ($act === 'qr' && $m === 'POST') { $qr = drQrCreate($bk); out(['qr' => $qr, 'booking' => drView(one('SELECT * FROM dr_bookings WHERE id=?', [$bk['id']]))]); }
    if ($act === 'status' && $m === 'GET') { $bk = drCheck($bk); out(['booking' => drView($bk, true), 'paid' => $bk['status'] === 'confirmed']); }
    if ($act === 'cancel' && $m === 'POST') {
      $bk = drCheck($bk); if ($bk['status'] !== 'awaiting_payment') throw bad('This booking is already paid, so it cannot be cancelled here. Please call the lab.');
      if (!empty($bk['qr_id'])) { try { rzpCall('POST', '/payments/qr_codes/' . rawurlencode($bk['qr_id']) . '/close'); } catch (Throwable $e) { } }
      q("UPDATE dr_bookings SET status='cancelled' WHERE id=? AND status='awaiting_payment'", [$bk['id']]); out(['ok' => true]);
    }
  }
  throw new HttpErr(404, 'Not found.');
}
