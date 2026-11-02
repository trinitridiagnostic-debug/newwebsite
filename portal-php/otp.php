<?php
/* Mobile-number OTP: sent ONLY on WhatsApp (Meta WhatsApp Business Cloud API, "authentication" template).
   There is no SMS sending anywhere in this system, by design. Loaded by index.php.
   OTP codes are stored only as keyed hashes, expire in 5 minutes, allow 5 tries, and sending is rate limited. */

const OTP_TTL = 300000;        // 5 minutes
const OTP_TRIES = 5;
function otpCooldown() { $c = cfg()['otp_cooldown']; return max(0, (int)$c) * 1000; }   // seconds between sends to the same number (default 30)

function otpEnabled() { return cfg()['otp_provider'] !== ''; }

function maskMobile($m) { return substr($m, 0, 2) . 'xxxxx' . substr($m, -3); }

/* ---------- delivery ---------- */
function httpPost($url, $headers, $body) {
  if (!function_exists('curl_init')) throw new Exception('PHP curl is not enabled on this host.');
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 6]);
  $res = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $err = curl_error($ch); curl_close($ch);
  if ($res === false) throw new Exception('Network error: ' . $err);
  return [$code, (string)$res];
}
function sendWhatsAppOtp($mobile, $code) {
  $c = cfg();
  if ($c['wa_phone_id'] === '' || $c['wa_token'] === '') throw new Exception('WhatsApp OTP is not set up (wa_phone_id / wa_token).');
  $url = rtrim($c['wa_api_base'], '/') . '/' . rawurlencode($c['wa_phone_id']) . '/messages';
  $payload = ['messaging_product' => 'whatsapp', 'to' => '91' . $mobile, 'type' => 'template', 'template' => ['name' => $c['wa_template'], 'language' => ['code' => $c['wa_lang']],
    'components' => [['type' => 'body', 'parameters' => [['type' => 'text', 'text' => $code]]],
                     ['type' => 'button', 'sub_type' => 'url', 'index' => '0', 'parameters' => [['type' => 'text', 'text' => $code]]]]]];
  list($st, $res) = httpPost($url, ['Authorization: Bearer ' . $c['wa_token'], 'Content-Type: application/json'], json_encode($payload));
  $j = json_decode($res, true);
  if ($st < 200 || $st >= 300 || empty($j['messages'][0]['id'])) throw new Exception('WhatsApp send failed (' . $st . '): ' . substr($res, 0, 200));
}
/* Sends the code on WhatsApp and returns 'whatsapp' ('dev' = local test mode). Any other channel a client asks for is ignored. */
function deliverOtp($mobile, $code, $want) {
  $c = cfg();
  if ($c['otp_provider'] === 'dev') {   // local testing only: refuse on a live server
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
    if (!in_array($ip, ['127.0.0.1', '::1'], true)) throw new HttpErr(503, 'OTP test mode only works on the local machine.');
    @file_put_contents($c['storage_dir'] . '/otp-dev.log', date('c') . " $mobile $code\n", FILE_APPEND | LOCK_EX);
    return 'dev';
  }
  try { sendWhatsAppOtp($mobile, $code); return 'whatsapp'; }
  catch (Exception $e) {
    error_log('[trinetri-portal] WhatsApp OTP delivery failed for ' . maskMobile($mobile) . ' | ' . $e->getMessage());
    throw new HttpErr(502, 'We could not send the OTP on WhatsApp. Please check that this number has WhatsApp, then try again in a minute, or call the lab.');
  }
}

/* ---------- issue + check ---------- */
function otpHash($mobile, $purpose, $code) { return hash_hmac('sha256', $mobile . '|' . $purpose . '|' . $code, secret()); }
function sendOtp($mobile, $purpose, $want = '') {
  $want = '';   // WhatsApp is the only channel
  $now = nowms();
  $last = one('SELECT created FROM otps WHERE mobile=? AND purpose=? ORDER BY created DESC LIMIT 1', [$mobile, $purpose]);
  if ($last && $now - (int)$last['created'] < otpCooldown()) throw new HttpErr(429, 'Please wait ' . (int)ceil((otpCooldown() - ($now - (int)$last['created'])) / 1000) . ' seconds before asking for another OTP.');
  foreach (['os:' . $mobile => 5, 'oi:' . substr(hash('sha256', isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'x'), 0, 20) => 25] as $k => $max) {   // per number and per visitor, per hour
    $a = attempt($k); if ($now - $a['t'] > 3600000) { $a['t'] = $now; $a['n'] = 0; } $a['n']++;
    if ($a['n'] > $max) throw new HttpErr(429, 'Too many OTP requests. Please try again after an hour, or call the lab.');
    saveAttempt($k, $a);
  }
  $code = (string)random_int(100000, 999999);
  q('UPDATE otps SET used=1 WHERE mobile=? AND purpose=? AND used=0', [$mobile, $purpose]);
  $ch = deliverOtp($mobile, $code, $want);
  q('INSERT INTO otps (mobile, purpose, code_hash, expires, tries, used, channel, created) VALUES (?,?,?,?,0,0,?,?)', [$mobile, $purpose, otpHash($mobile, $purpose, $code), $now + OTP_TTL, $ch, $now]);
  $r = ['sent' => true, 'channel' => $ch, 'to' => maskMobile($mobile), 'expiresIn' => (int)(OTP_TTL / 1000), 'resendIn' => (int)(otpCooldown() / 1000)];
  if ($ch === 'dev') $r['devCode'] = $code;
  return $r;
}
/* True when the code is right (and uses it up). Throws a clear error for wrong / expired / locked. */
function checkOtp($mobile, $purpose, $code) {
  $code = preg_replace('/\D/', '', (string)$code);
  if (strlen($code) !== 6) throw bad('Enter the 6-digit OTP.');
  $o = one('SELECT * FROM otps WHERE mobile=? AND purpose=? AND used=0 ORDER BY created DESC LIMIT 1', [$mobile, $purpose]);
  if (!$o || (int)$o['expires'] < nowms()) throw new HttpErr(400, 'This OTP has expired. Please ask for a new one.');
  if ((int)$o['tries'] >= OTP_TRIES) throw new HttpErr(429, 'Too many wrong tries. Please ask for a new OTP.');
  if (!hash_equals($o['code_hash'], otpHash($mobile, $purpose, $code))) {
    q('UPDATE otps SET tries=tries+1 WHERE id=?', [$o['id']]);
    throw new HttpErr(400, 'That OTP is not correct.');
  }
  q('UPDATE otps SET used=1 WHERE id=?', [$o['id']]);
  return true;
}

/* ---------- remembered devices (skip the login OTP for 30 days on a device that passed it) ---------- */
function deviceMake($uid) {
  $raw = rnd(24);
  q('INSERT INTO devices (uid, token_hash, expires, created) VALUES (?,?,?,?)', [$uid, hash('sha256', $raw), nowms() + 30 * 86400000, nowms()]);
  return $raw;
}
function deviceOk($uid, $raw) {
  if (!$raw || !is_string($raw) || strlen($raw) > 80) return false;
  return (bool)one('SELECT 1 AS x FROM devices WHERE uid=? AND token_hash=? AND expires>?', [$uid, hash('sha256', $raw), nowms()]);
}
function devicesRevoke($uid) { q('DELETE FROM devices WHERE uid=?', [$uid]); }

/* ---------- booking proof: shows the visitor passed the OTP for this mobile ---------- */
function bookingProof($mobile) { return sign(['b' => $mobile, 'e' => nowms() + 30 * 60000]); }
function proofOk($proof, $mobile) { $d = verify((string)$proof); return $d && isset($d['b']) && $d['b'] === $mobile; }

/* ---------- routes: /auth/config, /auth/otp/send, /auth/otp/verify, /auth/reset ---------- */
function otpRoute($path, $m) {
  if ($path === '/auth/config' && $m === 'GET') {
    $c = cfg();
    out(['otp' => otpEnabled(), 'channels' => $c['otp_provider'] === 'dev' ? ['dev'] : ['whatsapp'], 'smsAvailable' => false]);
  }
  if ($path === '/auth/otp/send' && $m === 'POST') {
    if (!otpEnabled()) throw new HttpErr(503, 'OTP is not switched on yet.');
    $b = body(); $mobile = normMobile(field($b, 'mobile')); $purpose = (string)field($b, 'purpose');
    if (!preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Enter a valid 10-digit mobile number.');
    if (!in_array($purpose, ['register', 'reset', 'booking'], true)) throw bad('Unknown request.');
    $exists = (bool)one('SELECT 1 AS x FROM users WHERE mobile=?', [$mobile]);
    if ($purpose === 'register' && $exists) throw bad('This mobile number already has an account. Please log in.');
    if ($purpose === 'reset' && !$exists) out(['sent' => true, 'channel' => 'whatsapp', 'to' => maskMobile($mobile), 'expiresIn' => (int)(OTP_TTL / 1000), 'resendIn' => (int)(otpCooldown() / 1000)]);   // same reply either way
    out(sendOtp($mobile, $purpose, (string)field($b, 'channel')));
  }
  if ($path === '/auth/otp/verify' && $m === 'POST') {       // used by the website booking forms
    if (!otpEnabled()) throw new HttpErr(503, 'OTP is not switched on yet.');
    $b = body(); $mobile = normMobile(field($b, 'mobile'));
    if (!preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Enter a valid 10-digit mobile number.');
    checkOtp($mobile, 'booking', field($b, 'otp'));
    out(['verified' => true, 'proof' => bookingProof($mobile), 'validFor' => 1800]);
  }
  if ($path === '/auth/reset' && $m === 'POST') {
    if (!otpEnabled()) throw new HttpErr(503, 'Password reset by OTP is not switched on yet. Please contact the lab.');
    $b = body(); $mobile = normMobile(field($b, 'mobile')); $pw = (string)field($b, 'password');
    $u = $mobile ? one('SELECT * FROM users WHERE mobile=?', [$mobile]) : null;
    if (!$u) throw new HttpErr(400, 'That OTP is not correct.');                  // do not reveal whether the number has an account
    checkPassword($pw);
    checkOtp($mobile, 'reset', field($b, 'otp'));
    q('UPDATE users SET hash=? WHERE id=?', [password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
    devicesRevoke($u['id']); clearAttempt('a:' . $mobile);
    out(['token' => sign(['u' => $u['id'], 'e' => nowms() + 7 * 864e5]), 'user' => publicUser($u)]);
  }
}
