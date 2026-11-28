<?php
/* Sample vials: the phlebotomist photographs each EMPTY vial, scans/types its barcode, photographs the FILLED vial, and takes a selfie,
   all before the visit can be marked "sample collected". The lab sees the photos on the order and marks the samples verified. */

const VIAL_TYPES = ['EDTA (lavender top)', 'Serum / SST (gold or red top)', 'Fluoride (grey top)', 'Citrate (blue top)', 'Heparin (green top)', 'Urine container', 'Stool container', 'Swab / other'];

function vialDir() { $d = cfg()['storage_dir'] . '/vials'; if (!is_dir($d)) @mkdir($d, 0775, true); return $d; }
function vialJpeg($img, $what) {
  if (!preg_match('#^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$#', (string)$img, $mm)) throw bad('Take the ' . $what . ' photo first.');
  $raw = base64_decode($mm[1], true);
  if ($raw === false || strlen($raw) < 3000 || strlen($raw) > 900000 || substr($raw, 0, 3) !== "\xFF\xD8\xFF") throw bad('The ' . $what . ' photo could not be read. Please take it again.');
  return $raw;
}
function vialSave($raw, $prefix) { $f = $prefix . '-' . bin2hex(random_bytes(4)) . '.jpg'; if (@file_put_contents(vialDir() . '/' . $f, $raw, LOCK_EX) === false) throw new Exception('Cannot save the photo.'); return $f; }
function vialUnlink($f) { if ($f) @unlink(vialDir() . '/' . basename($f)); }
function vialView($v) { return ['id' => $v['id'], 'seq' => (int)$v['seq'], 'type' => $v['vtype'], 'barcode' => (string)$v['barcode'], 'empty' => !empty($v['empty_file']), 'filled' => !empty($v['filled_file'])]; }
function vialList($oid) { return all('SELECT * FROM vials WHERE order_id=? ORDER BY seq, created', [$oid]); }
function vialDone($o) {   /* what is still missing before the sample can be marked collected */
  $vs = vialList($o['id']); $miss = [];
  if (!$vs) $miss[] = 'Add at least one vial.';
  foreach ($vs as $v) { $n = 'Vial ' . (int)$v['seq']; if (empty($v['empty_file'])) $miss[] = $n . ': empty vial photo'; if ($v['barcode'] === '' || $v['barcode'] === null) $miss[] = $n . ': barcode'; if (empty($v['filled_file'])) $miss[] = $n . ': filled vial photo'; }
  if (empty($o['ph_selfie'])) $miss[] = 'Your selfie';
  return $miss;
}
function vialState($o) { $m = vialDone($o); return ['vials' => array_map('vialView', vialList($o['id'])), 'selfie' => !empty($o['ph_selfie']), 'missing' => $m, 'complete' => !$m, 'types' => VIAL_TYPES]; }
function vialOrder($code, $me) {
  $o = one("SELECT * FROM orders WHERE code=? AND kind='home'", [$code]);
  if (!$o || $o['ph_id'] !== $me) throw new HttpErr(404, 'Visit not found.');
  if ($o['ph_status'] === 'collected') throw bad('This visit is already done.');
  if ((int)$o['ph_pin_ok'] !== 1) throw bad('Verify the patient\'s PIN first.');
  return $o;
}
function vialBarcode($v) {
  $b = strtoupper(preg_replace('/[^A-Za-z0-9\-]/', '', (string)$v)); if (strlen($b) < 4 || strlen($b) > 24) throw bad('The barcode must be 4 to 24 letters or digits.'); return $b;
}

function vialRoutes($path, $m, $s) {
  /* ---------- phlebotomist ---------- */
  if (preg_match('#^/staff/phleb/orders/([^/]+)/(vials|selfie)(?:/([A-Za-z0-9]+)(?:/(photo|delete))?)?$#', $path, $r)) {
    need($s, 'phleb'); $me = $s['id']; $code = rawurldecode($r[1]); $kind = $r[2]; $vid = $r[3] ?? ''; $act = $r[4] ?? '';
    if ($kind === 'vials' && $vid === '' && $m === 'GET') {
      $o = one("SELECT * FROM orders WHERE code=? AND kind='home'", [$code]); if (!$o || $o['ph_id'] !== $me) throw new HttpErr(404, 'Visit not found.'); out(vialState($o));
    }
    $o = vialOrder($code, $me);
    if ($kind === 'selfie' && $m === 'POST') {
      $raw = vialJpeg(field(body(1500000), 'image'), 'selfie'); $f = vialSave($raw, 'self-' . $o['id']); vialUnlink($o['ph_selfie']);
      q('UPDATE orders SET ph_selfie=? WHERE id=?', [$f, $o['id']]); out(vialState(sFresh($o['id'])));
    }
    if ($kind === 'vials' && $vid === '' && $m === 'POST') {
      $b = body(); $type = clean(field($b, 'type'), 40); if (!in_array($type, VIAL_TYPES, true)) $type = VIAL_TYPES[0];
      $c = one('SELECT COUNT(*) AS n, COALESCE(MAX(seq),0) AS mx FROM vials WHERE order_id=?', [$o['id']]); if ((int)$c['n'] >= 12) throw bad('That is the maximum number of vials for one visit.');
      $id = rnd(9); q('INSERT INTO vials (id, order_id, seq, vtype, barcode, created) VALUES (?,?,?,?,?,?)', [$id, $o['id'], (int)$c['mx'] + 1, $type, '', nowms()]); out(vialState($o), 201);
    }
    $v = $vid !== '' ? one('SELECT * FROM vials WHERE id=? AND order_id=?', [$vid, $o['id']]) : null; if (!$v) throw new HttpErr(404, 'Vial not found.');
    if ($act === 'delete' && $m === 'POST') { vialUnlink($v['empty_file']); vialUnlink($v['filled_file']); q('DELETE FROM vials WHERE id=?', [$v['id']]); out(vialState(sFresh($o['id']))); }
    if ($act === 'photo' && $m === 'POST') {
      $b = body(1500000); $k = field($b, 'kind') === 'filled' ? 'filled' : 'empty';
      if ($k === 'filled' && (empty($v['empty_file']) || (string)$v['barcode'] === '')) throw bad('Take the empty vial photo and save the barcode first.');
      $raw = vialJpeg(field($b, 'image'), $k . ' vial'); $f = vialSave($raw, 'v-' . $v['id'] . '-' . $k); vialUnlink($v[$k . '_file']);
      q('UPDATE vials SET ' . $k . '_file=? WHERE id=?', [$f, $v['id']]); out(vialState(sFresh($o['id'])));
    }
    if ($act === '' && $m === 'POST') {   /* save barcode and/or type */
      $b = body(); $sets = []; $args = [];
      if (array_key_exists('type', $b)) { $t = clean(field($b, 'type'), 40); if (in_array($t, VIAL_TYPES, true)) { $sets[] = 'vtype=?'; $args[] = $t; } }
      if (array_key_exists('barcode', $b)) {
        $bc = vialBarcode(field($b, 'barcode')); $dup = one('SELECT order_id FROM vials WHERE barcode=? AND id<>?', [$bc, $v['id']]);
        if ($dup) throw bad('This barcode is already used on another vial. Check the sticker.'); $sets[] = 'barcode=?'; $args[] = $bc;
      }
      if ($sets) { $args[] = $v['id']; q('UPDATE vials SET ' . implode(', ', $sets) . ' WHERE id=?', $args); } out(vialState(sFresh($o['id'])));
    }
    throw new HttpErr(404, 'Not found.');
  }

  /* ---------- lab console ---------- */
  if (preg_match('#^/staff/orders/([^/]+)/(vials|vialimg|verifysample)$#', $path, $r)) {
    $o = one('SELECT * FROM orders WHERE code=?', [rawurldecode($r[1])]); if (!$o) throw new HttpErr(404, 'Order not found.');
    if ($r[2] === 'vials' && $m === 'GET') {
      need($s, 'view'); $ph = $o['ph_id'] ? one('SELECT name FROM staff WHERE id=?', [$o['ph_id']]) : null; $vb = !empty($o['sample_ok_by']) ? one('SELECT name FROM staff WHERE id=?', [$o['sample_ok_by']]) : null;
      out(['vials' => array_map('vialView', vialList($o['id'])), 'selfie' => !empty($o['ph_selfie']), 'phlebotomist' => $ph ? $ph['name'] : null,
           'verified_at' => $o['sample_ok'] === null ? null : (int)$o['sample_ok'], 'verified_by' => $vb ? $vb['name'] : null]);
    }
    if ($r[2] === 'vialimg' && $m === 'GET') {
      need($s, 'view'); $k = (string)($_GET['k'] ?? ''); $f = '';
      if ($k === 'selfie') $f = (string)$o['ph_selfie'];
      else { $v = one('SELECT * FROM vials WHERE id=? AND order_id=?', [(string)($_GET['v'] ?? ''), $o['id']]); if ($v && ($k === 'empty' || $k === 'filled')) $f = (string)$v[$k . '_file']; }
      $p = $f !== '' ? vialDir() . '/' . basename($f) : ''; if ($p === '' || !is_file($p)) throw new HttpErr(404, 'No photo.');
      header('Content-Type: image/jpeg'); header('Cache-Control: private, max-age=3600'); header('Content-Length: ' . filesize($p)); readfile($p); exit;
    }
    if ($r[2] === 'verifysample' && $m === 'POST') {
      need($s, 'results'); if ($o['ph_status'] !== 'collected') throw bad('The phlebotomist has not marked this sample collected yet.');
      $on = !array_key_exists('verified', body()) || field(body(), 'verified') ? true : false;
      q('UPDATE orders SET sample_ok=?, sample_ok_by=? WHERE id=?', [$on ? nowms() : null, $on ? $s['id'] : null, $o['id']]); out(['ok' => true, 'verified' => $on]);
    }
  }
}
