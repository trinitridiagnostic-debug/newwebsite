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
  try { sendInvoiceWhatsApp($fresh); } catch (Throwable $e) { error_log('[trinetri-portal] invoice message: ' . $e->getMessage()); }
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
function buildInvoicePdf($o) {
  $teal = [0.247, 0.482, 0.510]; $ink = [0.1, 0.15, 0.16]; $gray = [0.4, 0.45, 0.46]; $green = [0.1, 0.5, 0.25];
  $L = 40; $R = MiniPdf::W - 40;
  $pdf = new MiniPdf(__DIR__ . '/logo.jpg');
  $pdf->logo($L, 28, 46); $x = $pdf->hasLogo() ? $L + 56 : $L;
  $pdf->text($x, 50, LAB_NAME, 19, true, $teal); $pdf->text($x, 64, LAB_ADDR, 8.5, false, $gray); $pdf->text($x, 75, LAB_PHONE, 8.5, false, $gray);
  $pdf->textRight($R, 48, 'INVOICE', 14, true, $ink);
  $pdf->line($L, 92, $R, 92, $teal, 1.4);
  $pays = all('SELECT * FROM payments WHERE order_id=? ORDER BY created', [$o['id']]);
  $pdf->text($L, 112, 'Billed to', 8.5, false, $gray); $pdf->text($L, 126, (string)$o['name'], 11, true, $ink); $pdf->text($L, 140, 'Mobile: +91 ' . $o['mobile'], 9, false, $gray);
  $pdf->textRight($R, 112, 'Invoice no: INV-' . $o['code'], 9.5, true, $ink); $pdf->textRight($R, 126, 'Order ID: ' . $o['code'], 9.5, false, $ink);
  $pdf->textRight($R, 140, 'Date: ' . rpt_dt($pays ? (int)end($pays)['created'] : (int)$o['created']), 9, false, $gray);
  $y = 170; $pdf->rect($L, $y - 12, $R - $L, 20, [0.93, 0.96, 0.96]); $pdf->text($L + 8, $y + 2, 'Test / package', 9, true, $ink); $pdf->textRight($R - 8, $y + 2, 'Amount (Rs.)', 9, true, $ink); $y += 24;
  $tests = json_decode($o['tests'], true) ?: [];
  foreach ($tests as $t) {
    foreach ($pdf->wrap((string)$t['name'], 380, 9.5) as $i => $ln) { $pdf->text($L + 8, $y, $ln, 9.5, false, $ink); if ($i === 0) $pdf->textRight($R - 8, $y, number_format((int)$t['price']), 9.5, false, $ink); $y += 14; }
    $pdf->line($L, $y - 8, $R, $y - 8, [0.9, 0.93, 0.93], 0.5);
  }
  $sub = 0; foreach ($tests as $t) $sub += (int)$t['price']; $y += 6;
  $row = function ($label, $val, $bold = false, $rgb = null) use (&$y, $pdf, $R, $ink) { $pdf->textRight($R - 130, $y, $label, 9.5, $bold, $rgb ?: $ink); $pdf->textRight($R - 8, $y, $val, 9.5, $bold, $rgb ?: $ink); $y += 15; };
  $row('Sub total', number_format($sub)); if ((int)$o['discount'] > 0) $row('Discount', '- ' . number_format((int)$o['discount']));
  $row('Total', number_format((int)$o['amount']), true); $row('Paid', number_format((int)$o['paid']), true, $green);
  $due = orderDue($o); $row('Balance due', number_format($due), true, $due > 0 ? [0.74, 0.12, 0.1] : $ink);
  $y += 8; $pdf->text($L, $y, 'Payment', 8.5, false, $gray); $y += 14;
  if ($pays) foreach ($pays as $p) { $pdf->text($L, $y, 'Rs. ' . number_format((int)$p['amount']) . ' paid online (UPI) on ' . rpt_dt((int)$p['created']) . '   Ref: ' . $p['ref'], 9.5, false, $ink); $y += 14; }
  elseif ((int)$o['paid'] > 0) { $pdf->text($L, $y, 'Rs. ' . number_format((int)$o['paid']) . ' paid by ' . ($o['pay_mode'] ?: 'cash'), 9.5, false, $ink); $y += 14; }
  else { $pdf->text($L, $y, 'No payment received yet.', 9.5, false, $ink); $y += 14; }
  return $pdf->output(function ($p, $n, $t) use ($L, $R, $gray) {
    $p->line($L, MiniPdf::H - 56, $R, MiniPdf::H - 56, [0.8, 0.85, 0.85], 0.8);
    $p->text($L, MiniPdf::H - 42, 'This is a computer generated invoice from Trinetri Diagnostics and needs no signature.', 7.5, false, $gray);
    $p->text($L, MiniPdf::H - 31, LAB_ADDR, 7.5, false, $gray); $p->textRight($R, MiniPdf::H - 42, 'Page ' . $n . ' of ' . $t, 8, false, $gray);
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
function sendInvoiceWhatsApp($o) {
  $c = cfg();
  if ($c['aisensy_key'] === '' || $c['aisensy_invoice_campaign'] === '') throw new HttpErr(503, 'The invoice WhatsApp message is not set up yet (aisensy_invoice_campaign in config.php).');
  $name = waText($o['name'] ?: 'Customer', 60);
  $payload = ['apiKey' => $c['aisensy_key'], 'campaignName' => $c['aisensy_invoice_campaign'], 'destination' => '91' . $o['mobile'], 'userName' => $c['aisensy_name'],
    'templateParams' => [$name, waText($o['code'], 30), 'Rs. ' . number_format((int)$o['paid']), (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('d-m-Y')], 'source' => 'trinetri-invoice',
    'media' => ['url' => invoiceLink($o), 'filename' => preg_replace('/[^A-Za-z0-9._-]/', '_', $o['code']) . '-invoice.pdf']];
  list($st, $res) = httpPost(rtrim($c['aisensy_base'], '/') . '/campaign/t1/api/v2', ['Content-Type: application/json'], json_encode($payload));
  if ($st < 200 || $st >= 300) {
    error_log('[trinetri-portal] aisensy invoice ' . $st . ' ' . substr($res, 0, 300)); $j = json_decode($res, true); $why = is_array($j) ? (string)($j['message'] ?? ($j['error'] ?? '')) : '';
    throw new HttpErr(502, 'WhatsApp could not send the invoice (' . $st . ')' . ($why !== '' ? ': ' . substr($why, 0, 160) : '.'));
  }
}
