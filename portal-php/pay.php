<?php
require_once __DIR__ . '/pdf.php'; require_once __DIR__ . '/otp.php';
/* Online payment for home visits (Razorpay UPI QR), invoice PDF and the invoice WhatsApp message.
   Secrets (razorpay_key_secret, razorpay_webhook_secret, aisensy_key) live only in config.php. */

function rzpCall($method, $path, $body = null) {
  $c = cfg();
  if ($c['razorpay_key_id'] === '' || $c['razorpay_key_secret'] === '') throw new HttpErr(503, 'Online payment is not set up yet (razorpay_key_id and razorpay_key_secret in config.php).');
  if (!function_exists('curl_init')) throw new Exception('PHP curl is not enabled on this host.');
  $ch = curl_init(rtrim($c['razorpay_base'], '/') . $path);
  $opt = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_USERPWD => $c['razorpay_key_id'] . ':' . $c['razorpay_key_secret'], CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 6];
  if ($body !== null) $opt[CURLOPT_POSTFIELDS] = json_encode($body);
  curl_setopt_array($ch, $opt);
  $res = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $err = curl_error($ch); curl_close($ch);
  if ($res === false) throw new HttpErr(502, 'Could not reach Razorpay: ' . $err);
  return [$code, json_decode((string)$res, true) ?: []];
}
function orderDue($o) { return max(0, (int)$o['amount'] - (int)$o['paid']); }

/* A fixed-amount, single-use UPI QR for what the patient still owes. */
function payQrCreate($o) {
  $due = orderDue($o); if ($due < 1) throw bad('Nothing is due on this order.');
  if (!empty($o['pay_qr_id']) && (int)$o['pay_qr_amt'] === $due && $o['pay_qr_url'] && nowms() - (int)$o['pay_qr_at'] < 8 * 60000)
    return ['qr_id' => $o['pay_qr_id'], 'image_url' => $o['pay_qr_url'], 'amount' => $due];     // same QR is still fresh
  if (!empty($o['pay_qr_id'])) { try { rzpCall('POST', '/payments/qr_codes/' . rawurlencode($o['pay_qr_id']) . '/close'); } catch (Throwable $e) { } }
  list($st, $j) = rzpCall('POST', '/payments/qr_codes', ['type' => 'upi_qr', 'name' => 'Trinetri ' . $o['code'], 'usage' => 'single_use', 'fixed_amount' => true, 'payment_amount' => $due * 100,
    'description' => 'Trinetri Diagnostics order ' . $o['code'], 'close_by' => time() + 20 * 60, 'notes' => ['order' => $o['code']]]);
  if ($st < 200 || $st >= 300 || empty($j['id']) || empty($j['image_url'])) {
    error_log('[trinetri-portal] razorpay qr ' . $st . ' ' . json_encode($j));
    $why = isset($j['error']['description']) ? (string)$j['error']['description'] : '';
    throw new HttpErr(502, 'Could not create the payment QR' . ($why !== '' ? ': ' . substr($why, 0, 160) : '. Please try again.'));
  }
  q('UPDATE orders SET pay_qr_id=?, pay_qr_url=?, pay_qr_amt=?, pay_qr_at=? WHERE id=?', [$j['id'], $j['image_url'], $due, nowms(), $o['id']]);
  return ['qr_id' => $j['id'], 'image_url' => $j['image_url'], 'amount' => $due];
}

/* Marks money received online. Safe to call twice for the same payment (the payment id is unique). Returns true the first time. */
function recordOnline($o, $ref, $paise) {
  $rupees = intdiv((int)$paise, 100); if ($rupees < 1) return false;
  try { q('INSERT INTO payments (order_id, ref, amount, mode, created) VALUES (?,?,?,?,?)', [$o['id'], substr($ref, 0, 40), $rupees, 'online', nowms()]); }
  catch (PDOException $e) { return false; }
  q('UPDATE orders SET paid=CASE WHEN paid+?>amount THEN amount ELSE paid+? END, pay_mode=? WHERE id=?', [$rupees, $rupees, 'online', $o['id']]);
  $fresh = one('SELECT * FROM orders WHERE id=?', [$o['id']]);
  return true;
}

/* Asks Razorpay what was paid on this order's QR (used while the phlebotomist waits, and as a safety net if the webhook is late). */
function payQrCheck($o) {
  if (!empty($o['pay_qr_id']) && orderDue($o) > 0) {
    list($st, $j) = rzpCall('GET', '/payments/qr_codes/' . rawurlencode($o['pay_qr_id']) . '/payments');
    if ($st >= 200 && $st < 300) foreach (($j['items'] ?? []) as $p) if (($p['status'] ?? '') === 'captured' && !empty($p['id'])) recordOnline(one('SELECT * FROM orders WHERE id=?', [$o['id']]), $p['id'], (int)$p['amount']);
  }
  return one('SELECT * FROM orders WHERE id=?', [$o['id']]);
}

/* Razorpay calls this when money arrives (set it up in the Razorpay dashboard, see SETUP.md). */
function razorpayWebhook() {
  $c = cfg(); $raw = (string)file_get_contents('php://input');
  $sig = $_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '';
  if ($c['razorpay_webhook_secret'] === '' || !hash_equals(hash_hmac('sha256', $raw, $c['razorpay_webhook_secret']), (string)$sig)) throw new HttpErr(400, 'Invalid signature.');
  $e = json_decode($raw, true) ?: []; $ev = (string)($e['event'] ?? '');
  if ($ev === 'qr_code.credited' || $ev === 'payment.captured') {
    $pay = $e['payload']['payment']['entity'] ?? []; $qr = $e['payload']['qr_code']['entity'] ?? [];
    $qid = $qr['id'] ?? ($pay['qr_code_id'] ?? '');
    $o = $qid ? one('SELECT * FROM orders WHERE pay_qr_id=?', [$qid]) : null;
    if (!$o && !empty($pay['notes']['order'])) $o = one('SELECT * FROM orders WHERE code=?', [(string)$pay['notes']['order']]);
    if ($o && !empty($pay['id']) && (($pay['status'] ?? 'captured') === 'captured')) recordOnline($o, $pay['id'], (int)($pay['amount'] ?? 0));
    if (!$o) { require_once __DIR__ . '/dr.php'; drWebhook($qid, $pay); }
  }
  out(['ok' => true]);
}

/* ---------- invoice PDF ---------- */
function inrWords($n) {
  $n = (int)$n; if ($n <= 0) return 'Zero';
  $o = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  $t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  $two = function ($x) use ($o, $t) { return $x < 20 ? $o[$x] : trim($t[intdiv($x, 10)] . ' ' . $o[$x % 10]); };
  $three = function ($x) use ($o, $two) { return trim(($x >= 100 ? $o[intdiv($x, 100)] . ' Hundred ' : '') . $two($x % 100)); };
  $out = '';
  foreach ([[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] as $u) { if ($n >= $u[0]) { $out .= $two(intdiv($n, $u[0])) . ' ' . $u[1] . ' '; $n %= $u[0]; } }
  return trim($out . $three($n));
}

/* Payment invoice on the Trinetri letterhead (same header as the lab report). */
function buildInvoicePdf($o) {
  $teal = [0.247, 0.482, 0.510]; $ink = [0.1, 0.15, 0.16]; $gray = [0.4, 0.45, 0.46]; $green = [0.1, 0.5, 0.25]; $red = [0.74, 0.12, 0.1]; $tint = [0.95, 0.97, 0.97];
  $L = 40; $R = MiniPdf::W - 40; $bottom = MiniPdf::H - 74;
  $pdf = new MiniPdf(__DIR__ . '/logo.jpg');
  $pays = all('SELECT * FROM payments WHERE order_id=? ORDER BY created', [$o['id']]); $lastPay = $pays ? end($pays) : null;
  $due = orderDue($o); $paid = (int)$o['paid']; $total = (int)$o['amount']; $status = $paid <= 0 ? 'UNPAID' : ($due > 0 ? 'PART PAID' : 'PAID');
  $sexTxt = ['M' => 'Male', 'F' => 'Female', 'O' => 'Other']; $ageSex = trim(($o['age'] !== null && $o['age'] !== '' ? $o['age'] . ' Years' : '') . (!empty($o['sex']) ? ' / ' . ($sexTxt[$o['sex']] ?? $o['sex']) : ''), ' /');
  $invDate = rpt_dt($lastPay ? (int)$lastPay['created'] : (int)$o['created']);
  $mode = $lastPay ? ((strtolower($lastPay['mode']) === 'online') ? 'UPI (Razorpay)' : ucfirst($lastPay['mode'])) : ($paid > 0 ? ucfirst($o['pay_mode'] ?: 'Cash') : '-');
  $txn = $lastPay && strtolower($lastPay['mode']) === 'online' ? preg_replace('/^dr-/', '', $lastPay['ref']) : 'NA';

  /* letterhead */
  $pdf->logo($L, 28, 46); $x = $pdf->hasLogo() ? $L + 56 : $L;
  $pdf->text($x, 50, LAB_NAME, 19, true, $teal); $pdf->text($x, 62, 'Quality Diagnostics for Every Family Budget!', 8.5, true, $gray);
  $pdf->text($x, 73, LAB_ADDR, 8, false, $gray); $pdf->text($x, 83, LAB_PHONE . '   |   www.trinetridiagnostics.com', 8, false, $gray);
  $pdf->textRight($R, 48, 'PAYMENT INVOICE', 12, true, $ink);
  $pdf->line($L, 96, $R, 96, $teal, 1.6);

  /* patient + invoice details */
  $pdf->rect($L, 106, $R - $L, 70, $tint);
  $left = [['Patient name', $o['name'] ?: '-'], ['Age / Sex', $ageSex ?: '-'], ['Mobile', '+91 ' . $o['mobile']], ['Referred by', $o['ref_doctor'] ?: 'Self']];
  $right = [['Invoice no', 'INV-' . $o['code']], ['Invoice date', $invDate], ['Order ID', $o['code']], ['Collection', ($o['kind'] ?? '') === 'home' ? 'Home visit' : 'Lab visit']];
  foreach ($left as $i => $r) { $yy = 122 + $i * 15; $pdf->text($L + 10, $yy, $r[0], 8.5, false, $gray); $pdf->text($L + 82, $yy, (string)$r[1], 9.5, true, $ink); }
  foreach ($right as $i => $r) { $yy = 122 + $i * 15; $pdf->text(300, $yy, $r[0], 8.5, false, $gray); $pdf->text(372, $yy, (string)$r[1], 9.5, true, $ink); }

  /* items */
  $y = 200;
  $thead = function () use (&$y, $pdf, $L, $R, $teal) { $pdf->rect($L, $y - 12, $R - $L, 20, $teal); $pdf->text($L + 8, $y + 2, '#', 9, true, [1, 1, 1]); $pdf->text($L + 30, $y + 2, 'Test / package', 9, true, [1, 1, 1]); $pdf->textRight($R - 8, $y + 2, 'Amount (Rs.)', 9, true, [1, 1, 1]); $y += 26; };
  $thead(); $tests = json_decode($o['tests'], true) ?: []; $sub = 0; $n = 0;
  foreach ($tests as $t) {
    $lines = $pdf->wrap((string)$t['name'], 390, 9.5); if ($y + count($lines) * 13 > $bottom) { $pdf->addPage(); $y = 60; $thead(); }
    $n++; $sub += (int)$t['price']; $pdf->text($L + 8, $y, (string)$n, 9.5, false, $gray);
    foreach ($lines as $i => $ln) { $pdf->text($L + 30, $y, $ln, 9.5, false, $ink); if ($i === 0) $pdf->textRight($R - 8, $y, number_format((int)$t['price']), 9.5, false, $ink); $y += 13; }
    $y += 6; $pdf->line($L, $y - 12, $R, $y - 12, [0.9, 0.93, 0.93], 0.5);
  }
  if ($y + 190 > $bottom) { $pdf->addPage(); $y = 60; }

  /* totals */
  $y += 8;
  $row = function ($label, $val, $bold = false, $rgb = null) use (&$y, $pdf, $R, $ink) { $pdf->textRight($R - 120, $y, $label, 9.5, $bold, $rgb ?: $ink); $pdf->textRight($R - 8, $y, $val, 9.5, $bold, $rgb ?: $ink); $y += 15; };
  $row('Sub total', number_format($sub)); if ((int)$o['discount'] > 0) $row('Discount', '- ' . number_format((int)$o['discount']));
  $pdf->line($R - 230, $y - 10, $R, $y - 10, $teal, 0.8); $row('Total', number_format($total), true);
  $row('Amount paid', number_format($paid), true, $green); $row('Balance due', number_format($due), true, $due > 0 ? $red : $ink);
  $pdf->text($L, $y - 30, 'Amount paid in words', 8, false, $gray);
  foreach ($pdf->wrap('Rupees ' . inrWords($paid) . ' Only', 250, 9.5, true) as $i => $ln) $pdf->text($L, $y - 17 + $i * 12, $ln, 9.5, true, $ink);

  /* payment details + status stamp */
  $y += 14; $pdf->rect($L, $y, $R - $L, 64, $tint); $pdf->text($L + 10, $y + 16, 'Payment details', 9, true, $teal);
  $pd = [['Payment mode', $mode], ['Transaction ID', $txn], ['Payment date', $lastPay ? rpt_dt((int)$lastPay['created']) : '-']];
  foreach ($pd as $i => $r) { $pdf->text($L + 10, $y + 31 + $i * 12, $r[0], 8.5, false, $gray); $pdf->text($L + 90, $y + 31 + $i * 12, (string)$r[1], 9, true, $ink); }
  $c = $status === 'PAID' ? $green : ($status === 'UNPAID' ? $red : [0.8, 0.5, 0.05]);
  $pdf->rect($R - 120, $y + 12, 108, 38, $c); $pdf->textCenter($R - 66, $y + 36, $status, 15, true, [1, 1, 1]);
  $y += 84; $pdf->text($L, $y, 'For any billing-related queries please call or WhatsApp +91 91873 15972. Thank you for choosing Trinetri Diagnostics!', 8.5, false, $gray);

  return $pdf->output(function ($p, $n, $t) use ($L, $R, $gray, $teal) {
    $p->line($L, MiniPdf::H - 60, $R, MiniPdf::H - 60, $teal, 1);
    $p->textCenter(MiniPdf::W / 2, MiniPdf::H - 46, 'Trinetri Diagnostics | Quality Diagnostics for Every Family Budget!', 8.5, true, $teal);
    $p->textCenter(MiniPdf::W / 2, MiniPdf::H - 35, LAB_ADDR . '  |  +91 91873 15972  |  www.trinetridiagnostics.com', 7.5, false, $gray);
    $p->text($L, MiniPdf::H - 22, 'Computer generated invoice. No signature required.', 7, false, $gray); $p->textRight($R, MiniPdf::H - 22, 'Page ' . $n . ' of ' . $t, 7.5, false, $gray);
  });
}
function invoiceLink($o) {
  $e = nowms() + 30 * 86400000; $sg = b64u(hash_hmac('sha256', 'inv|' . $o['code'] . '|' . $e, secret(), true));
  return rtrim(cfg()['public_url'], '/') . '/portal-api/public/invoice/' . rawurlencode($o['code']) . '/' . preg_replace('/[^A-Za-z0-9._-]/', '_', $o['code']) . '-invoice.pdf?e=' . $e . '&s=' . $sg;
}
function pdfOut($bytes, $name) { http_response_code(200); header('Content-Type: application/pdf'); header('Content-Disposition: inline; filename="' . $name . '"'); header('Content-Length: ' . strlen($bytes)); echo $bytes; exit; }
function publicInvoice($code) {
  $e = (int)($_GET['e'] ?? 0); $sg = (string)($_GET['s'] ?? '');
  $ok = $e > nowms() && hash_equals(b64u(hash_hmac('sha256', 'inv|' . $code . '|' . $e, secret(), true)), $sg);
  $o = $ok ? one('SELECT * FROM orders WHERE code=?', [$code]) : null;
  if (!$o) throw new HttpErr(404, 'This invoice link has expired or is not valid. Please contact the lab.');
  pdfOut(buildInvoicePdf($o), preg_replace('/[^A-Za-z0-9._-]/', '_', $o['code']) . '-invoice.pdf');
}
