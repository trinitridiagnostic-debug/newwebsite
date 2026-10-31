<?php
/* Trinetri Diagnostics customer portal server (PHP 7.4+ / 8.x, MySQL or SQLite).
   - Customers register with mobile + password, then link their lab orders with Order ID + report PIN.
   - The lab software uses the /lab/* routes with the secret lab_api_key (header X-Lab-Key).
   - Same routes and replies as the Cloudflare version in ../portal-server, so the website needs no change.
   Setup: see SETUP.md. Copy config.sample.php to config.php and fill it in. */

const PLANS = [
  ['id' => 'bronze', 'name' => 'Bronze', 'price' => 499, 'period' => 'year', 'discount' => 5, 'perks' => ['5% off every test', 'Free home collection', 'Reports on WhatsApp']],
  ['id' => 'silver', 'name' => 'Silver', 'price' => 999, 'period' => 'year', 'discount' => 10, 'perks' => ['10% off every test', 'Free home collection', 'Priority slots', 'Reports on WhatsApp']],
  ['id' => 'gold', 'name' => 'Gold', 'price' => 1999, 'period' => 'year', 'discount' => 15, 'perks' => ['15% off every test', 'Free home collection', 'Priority slots', '1 free basic health package a year', 'Family members can use it (up to 3)']],
  ['id' => 'platinum', 'name' => 'Platinum', 'price' => 3999, 'period' => 'year', 'discount' => 20, 'perks' => ['20% off every test', 'Free home collection', 'Fastest priority slots', '2 free health packages a year', 'Family members can use it (up to 5)', 'Dedicated support contact']],
];
const STATUSES = ['booked', 'collected', 'processing', 'completed'];

class HttpErr extends Exception {
  public $status;
  public function __construct($status, $msg) { parent::__construct($msg); $this->status = $status; }
}
function bad($m) { return new HttpErr(400, $m); }

/* ---------- config ---------- */
function cfg() {
  static $c = null;
  if ($c !== null) return $c;
  $c = ['db_dsn' => '', 'db_user' => '', 'db_pass' => '', 'lab_api_key' => '', 'secret' => '',
        'allowed_origins' => 'https://trinitridiagnostic-debug.github.io', 'storage_dir' => __DIR__ . '/storage'];
  $f = __DIR__ . '/config.php';
  if (is_file($f)) { $x = require $f; if (is_array($x)) $c = array_merge($c, $x); }
  foreach (['db_dsn' => 'PORTAL_DB_DSN', 'db_user' => 'PORTAL_DB_USER', 'db_pass' => 'PORTAL_DB_PASS', 'lab_api_key' => 'PORTAL_LAB_KEY',
            'allowed_origins' => 'PORTAL_ORIGINS', 'storage_dir' => 'PORTAL_STORAGE'] as $k => $e) {
    $v = getenv($e); if ($v !== false && $v !== '') $c[$k] = $v;
  }
  return $c;
}

/* ---------- small helpers ---------- */
function nowms() { return (int)floor(microtime(true) * 1000); }
function b64u($bin) { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64ud($s) { return base64_decode(strtr($s, '-_', '+/')); }
function rnd($n) { return b64u(random_bytes($n)); }
function clean($s, $max) {
  $s = preg_replace('/[\x00-\x1f\x7f]/', ' ', (string)($s === null ? '' : (is_scalar($s) ? $s : '')));
  $s = trim(preg_replace('/\s+/u', ' ', $s));
  return mb_substr($s, 0, $max);
}
function cleanBody($s, $max) {
  $s = preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/', '', (string)($s === null ? '' : (is_scalar($s) ? $s : '')));
  return mb_substr(trim($s), 0, $max);
}
function normMobile($m) { $d = preg_replace('/\D/', '', (string)$m); return strlen($d) >= 10 ? substr($d, -10) : ''; }
function out($obj, $status = 200) {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function body($max = 20000) {
  $t = file_get_contents('php://input');
  if (strlen($t) > $max) throw new HttpErr(413, 'Request too large');
  if ($t === '' || $t === false) return [];
  $j = json_decode($t, true);
  if (!is_array($j)) throw bad('Invalid request');
  return $j;
}
function field($b, $k) { return isset($b[$k]) ? $b[$k] : ''; }

/* ---------- database ---------- */
function db() {
  static $pdo = null;
  if ($pdo) return $pdo;
  $c = cfg();
  $dir = $c['storage_dir'];
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  if (!is_dir($dir . '/reports')) @mkdir($dir . '/reports', 0755, true);
  if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
  $dsn = $c['db_dsn'] !== '' ? $c['db_dsn'] : 'sqlite:' . $dir . '/portal.sqlite';
  $pdo = new PDO($dsn, $c['db_user'] !== '' ? $c['db_user'] : null, $c['db_pass'] !== '' ? $c['db_pass'] : null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  $mysql = strpos($dsn, 'mysql') === 0;
  if (!$mysql) $pdo->exec('PRAGMA busy_timeout=5000');
  $mark = $dir . '/.schema-v1';
  if (!is_file($mark)) { migrate($pdo, $mysql); @file_put_contents($mark, '1'); }
  return $pdo;
}
function migrate($pdo, $mysql) {
  $ai = $mysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  $tail = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
  $ix = function ($name, $table, $cols) use ($mysql) { return $mysql ? null : "CREATE INDEX IF NOT EXISTS $name ON $table($cols)"; };
  $kx = function ($name, $cols) use ($mysql) { return $mysql ? ", KEY $name ($cols)" : ''; };
  $sql = [
    "CREATE TABLE IF NOT EXISTS users (id VARCHAR(32) PRIMARY KEY, name VARCHAR(60) NOT NULL, mobile VARCHAR(10) NOT NULL UNIQUE, hash VARCHAR(255) NOT NULL, membership TEXT NULL, created BIGINT NOT NULL)$tail",
    "CREATE TABLE IF NOT EXISTS orders (id VARCHAR(32) PRIMARY KEY, code VARCHAR(30) NOT NULL UNIQUE, mobile VARCHAR(10) NOT NULL, name VARCHAR(60), tests TEXT NOT NULL, amount BIGINT NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL, times TEXT NOT NULL, created BIGINT NOT NULL, report_name VARCHAR(80) NULL, report_size BIGINT NOT NULL DEFAULT 0, report_file VARCHAR(64) NULL, pin_hash VARCHAR(64) NOT NULL)$tail",
    "CREATE TABLE IF NOT EXISTS links (uid VARCHAR(32) NOT NULL, order_id VARCHAR(32) NOT NULL, PRIMARY KEY (uid, order_id))$tail",
    "CREATE TABLE IF NOT EXISTS tickets (id VARCHAR(12) PRIMARY KEY, uid VARCHAR(32) NOT NULL, mobile VARCHAR(10), name VARCHAR(60), subject VARCHAR(100) NOT NULL, category VARCHAR(30), status VARCHAR(12) NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL" . $kx('t_uid', 'uid') . ")$tail",
    "CREATE TABLE IF NOT EXISTS ticket_msgs (id $ai, ticket_id VARCHAR(12) NOT NULL, sender VARCHAR(10) NOT NULL, body TEXT NOT NULL, ts BIGINT NOT NULL" . $kx('tm_t', 'ticket_id') . ")$tail",
    "CREATE TABLE IF NOT EXISTS chat (id $ai, uid VARCHAR(32) NOT NULL, sender VARCHAR(10) NOT NULL, body TEXT NOT NULL, label VARCHAR(40) NOT NULL DEFAULT '', ts BIGINT NOT NULL" . $kx('c_uid', 'uid, ts') . ")$tail",
    "CREATE TABLE IF NOT EXISTS chat_state (uid VARCHAR(32) PRIMARY KEY, last BIGINT NOT NULL DEFAULT 0, greeted BIGINT NOT NULL DEFAULT 0)$tail",
    "CREATE TABLE IF NOT EXISTS attempts (k VARCHAR(64) PRIMARY KEY, n INT NOT NULL DEFAULT 0, until_ts BIGINT NOT NULL DEFAULT 0, t BIGINT NOT NULL DEFAULT 0)$tail",
  ];
  foreach ($sql as $s) $pdo->exec($s);
  foreach ([$ix('t_uid', 'tickets', 'uid'), $ix('tm_t', 'ticket_msgs', 'ticket_id'), $ix('c_uid', 'chat', 'uid, ts')] as $s) if ($s) $pdo->exec($s);
}
function q($sql, $args = []) { $st = db()->prepare($sql); $st->execute($args); return $st; }
function one($sql, $args = []) { $r = q($sql, $args)->fetch(); return $r === false ? null : $r; }
function all($sql, $args = []) { return q($sql, $args)->fetchAll(); }

/* ---------- auth ---------- */
function secret() {
  static $s = null;
  if ($s) return $s;
  $c = cfg();
  if ($c['secret'] !== '') return $s = $c['secret'];
  db();
  $f = $c['storage_dir'] . '/secret.key';
  if (!is_file($f)) @file_put_contents($f, bin2hex(random_bytes(32)), LOCK_EX);
  $s = trim((string)@file_get_contents($f));
  if ($s === '') throw new Exception('Cannot create the secret key file in the storage folder.');
  return $s;
}
function sign($payload) { $p = b64u(json_encode($payload)); return $p . '.' . b64u(hash_hmac('sha256', $p, secret(), true)); }
function verify($token) {
  $parts = explode('.', (string)$token);
  if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') return null;
  if (!hash_equals(b64u(hash_hmac('sha256', $parts[0], secret(), true)), $parts[1])) return null;
  $d = json_decode((string)b64ud($parts[0]), true);
  if (!is_array($d) || empty($d['e']) || $d['e'] < nowms()) return null;
  return $d;
}
function authHeader() {
  foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $k) if (!empty($_SERVER[$k])) return $_SERVER[$k];
  if (function_exists('getallheaders')) foreach (getallheaders() as $k => $v) if (strtolower($k) === 'authorization') return $v;
  return '';
}
function authed() {
  $h = authHeader();
  $d = verify(strpos($h, 'Bearer ') === 0 ? substr($h, 7) : '');
  $u = $d ? one('SELECT * FROM users WHERE id=?', [$d['u']]) : null;
  if (!$u) throw new HttpErr(401, 'Please log in again.');
  return $u;
}
function publicUser($u) {
  $m = $u['membership'] ? json_decode($u['membership'], true) : null;
  return ['id' => $u['id'], 'name' => $u['name'], 'mobile' => $u['mobile'], 'membership' => $m, 'created' => (int)$u['created']];
}
function attempt($k) { $r = one('SELECT n, until_ts, t FROM attempts WHERE k=?', [$k]); return $r ? ['n' => (int)$r['n'], 'until' => (int)$r['until_ts'], 't' => (int)$r['t']] : ['n' => 0, 'until' => 0, 't' => 0]; }
function saveAttempt($k, $a) {
  $up = q('UPDATE attempts SET n=?, until_ts=?, t=? WHERE k=?', [$a['n'], $a['until'], $a['t'], $k]);
  if ($up->rowCount() === 0) { try { q('INSERT INTO attempts (k, n, until_ts, t) VALUES (?,?,?,?)', [$k, $a['n'], $a['until'], $a['t']]); } catch (PDOException $e) { /* raced */ } }
}
function clearAttempt($k) { q('DELETE FROM attempts WHERE k=?', [$k]); }

function register() {
  $b = body();
  $name = clean(field($b, 'name'), 60); $mobile = normMobile(field($b, 'mobile')); $pw = (string)field($b, 'password');
  if (mb_strlen($name) < 2) throw bad('Enter your name.');
  if (!preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Enter a valid 10-digit mobile number.');
  if (strlen($pw) < 8 || mb_strlen($pw) > 100) throw bad('Use a password of at least 8 characters.');
  if (preg_match('/^(.)\1+$/su', $pw) || in_array(strtolower($pw), ['password', '12345678', 'qwertyuiop'], true)) throw bad('That password is too easy to guess.');
  if (one('SELECT id FROM users WHERE mobile=?', [$mobile])) throw bad('This mobile number already has an account. Please log in.');
  $id = rnd(9); $created = nowms();
  try { q('INSERT INTO users (id, name, mobile, hash, membership, created) VALUES (?,?,?,?,NULL,?)', [$id, $name, $mobile, password_hash($pw, PASSWORD_DEFAULT), $created]); }
  catch (PDOException $e) { throw bad('This mobile number already has an account. Please log in.'); }
  $u = one('SELECT * FROM users WHERE id=?', [$id]);
  out(['token' => sign(['u' => $id, 'e' => nowms() + 7 * 864e5]), 'user' => publicUser($u)], 201);
}
function login() {
  $b = body();
  $mobile = normMobile(field($b, 'mobile')); $pw = (string)field($b, 'password');
  $key = 'a:' . ($mobile ?: 'x'); $a = attempt($key);
  if ($a['until'] > nowms()) throw new HttpErr(429, 'Too many wrong attempts. Try again in a few minutes.');
  $u = $mobile ? one('SELECT * FROM users WHERE mobile=?', [$mobile]) : null;
  $ok = $u ? password_verify($pw, $u['hash']) : (password_verify($pw, '$2y$10$ErKK8JRXzbgQ4C32zE6/..xdQa2nbN7mg4FYi/NHpmq8xsd1Wdiay') && false)   /* dummy check keeps timing similar */;
  if (!$ok) {
    $a['n']++; if ($a['n'] >= 5) { $a['until'] = nowms() + 15 * 60000; $a['n'] = 0; }
    saveAttempt($key, $a);
    throw new HttpErr(401, 'Wrong mobile number or password.');
  }
  if ($a['n'] || $a['until']) clearAttempt($key);
  if (password_needs_rehash($u['hash'], PASSWORD_DEFAULT)) q('UPDATE users SET hash=? WHERE id=?', [password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
  out(['token' => sign(['u' => $u['id'], 'e' => nowms() + 7 * 864e5]), 'user' => publicUser($u)]);
}

/* ---------- orders ---------- */
function orderView($o) {
  $t = json_decode($o['times'], true);
  return ['id' => $o['id'], 'code' => $o['code'], 'tests' => json_decode($o['tests'], true), 'amount' => (int)$o['amount'], 'status' => $o['status'],
    'times' => $t ?: new stdClass, 'created' => (int)$o['created'], 'hasReport' => !empty($o['report_file']),
    'reportName' => !empty($o['report_file']) ? $o['report_name'] : null, 'reportSize' => (int)$o['report_size']];
}
function pinHash($code, $pin) { return hash('sha256', $code . ':' . $pin . ':' . secret()); }
function linkOrder($user) {
  $b = body();
  $code = strtoupper(clean(field($b, 'code'), 30)); $pin = preg_replace('/\D/', '', (string)field($b, 'pin'));
  if ($code === '' || strlen($pin) !== 6) throw bad('Enter the Order ID and the 6-digit report PIN from your receipt.');
  $k = 'la:' . $user['id']; $a = attempt($k);
  if ($a['until'] > nowms()) throw new HttpErr(429, 'Too many wrong attempts. Try again later.');
  $o = one('SELECT * FROM orders WHERE code=?', [$code]);
  $ok = $o && $o['mobile'] === $user['mobile'] && hash_equals($o['pin_hash'], pinHash($code, $pin));
  if (!$ok) {
    $a['n']++; if ($a['n'] >= 6) { $a['until'] = nowms() + 3600000; $a['n'] = 0; }
    saveAttempt($k, $a);
    throw new HttpErr(404, 'We could not match that Order ID and PIN to your mobile number. Check your receipt or ask the lab.');
  }
  if ($a['n']) clearAttempt($k);
  if (!one('SELECT 1 AS x FROM links WHERE uid=? AND order_id=?', [$user['id'], $o['id']])) q('INSERT INTO links (uid, order_id) VALUES (?,?)', [$user['id'], $o['id']]);
  return orderView($o);
}
function mineOrder($user, $code) {
  $o = one('SELECT o.* FROM orders o JOIN links l ON l.order_id=o.id WHERE l.uid=? AND o.code=?', [$user['id'], strtoupper($code)]);
  if (!$o) throw new HttpErr(404, 'Order not found.');
  return $o;
}
function reportPath($o) { return cfg()['storage_dir'] . '/reports/' . basename($o['report_file']); }

/* ---------- tickets & chat ---------- */
function ticketView($t) {
  $m = all('SELECT sender, body, ts FROM ticket_msgs WHERE ticket_id=? ORDER BY ts, id', [$t['id']]);
  return ['id' => $t['id'], 'uid' => $t['uid'], 'mobile' => $t['mobile'], 'name' => $t['name'], 'subject' => $t['subject'], 'category' => $t['category'],
    'status' => $t['status'], 'created' => (int)$t['created'], 'updated' => (int)$t['updated'],
    'msgs' => array_map(function ($x) { return ['from' => $x['sender'], 'body' => $x['body'], 'ts' => (int)$x['ts']]; }, $m)];
}
function pushChat($uid, $from, $body, $label = '') {
  $r = one('SELECT MAX(ts) AS m FROM chat WHERE uid=?', [$uid]);
  $ts = max(nowms(), ($r && $r['m'] ? (int)$r['m'] : 0) + 1);
  q('INSERT INTO chat (uid, sender, body, label, ts) VALUES (?,?,?,?,?)', [$uid, $from, $body, $label, $ts]);
  return ['id' => $ts . '-' . rnd(3), 'from' => $from, 'body' => $body, 'ts' => $ts, 'label' => $label];
}
function chatRows($uid, $after = 0) {
  $rows = all('SELECT sender, body, label, ts, id FROM (SELECT * FROM chat WHERE uid=? AND ts>? ORDER BY ts DESC LIMIT 200) x ORDER BY ts', [$uid, $after]);
  return array_map(function ($r) { return ['id' => $r['ts'] . '-' . $r['id'], 'from' => $r['sender'], 'body' => $r['body'], 'ts' => (int)$r['ts'], 'label' => $r['label']]; }, $rows);
}
function touchChat($uid) {
  $now = nowms();
  if (q('UPDATE chat_state SET last=? WHERE uid=?', [$now, $uid])->rowCount() === 0) {
    try { q('INSERT INTO chat_state (uid, last, greeted) VALUES (?,?,0)', [$uid, $now]); } catch (PDOException $e) {}
  }
}

/* ---------- customer routes ---------- */
function customer($path, $m, $user) {
  if ($path === '/me' && $m === 'GET') out(['user' => publicUser($user)]);

  if ($path === '/orders' && $m === 'GET') {
    $rows = all('SELECT o.* FROM orders o JOIN links l ON l.order_id=o.id WHERE l.uid=? ORDER BY o.created DESC', [$user['id']]);
    out(['orders' => array_map('orderView', $rows)]);
  }
  if ($path === '/orders/link' && $m === 'POST') out(['order' => linkOrder($user)]);
  if ($m === 'GET' && preg_match('#^/orders/([^/]+)/report$#', $path, $r)) {
    $o = mineOrder($user, rawurldecode($r[1]));
    if (empty($o['report_file']) || !is_file(reportPath($o))) throw new HttpErr(404, 'The report is not ready yet.');
    http_response_code(200);
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $o['code']) . '-report.pdf"');
    header('Content-Length: ' . filesize(reportPath($o)));
    readfile(reportPath($o));
    exit;
  }

  if ($path === '/tickets' && $m === 'GET') {
    $rows = all('SELECT * FROM tickets WHERE uid=? ORDER BY updated DESC', [$user['id']]);
    out(['tickets' => array_map('ticketView', $rows)]);
  }
  if ($path === '/tickets' && $m === 'POST') {
    $b = body();
    $subject = clean(field($b, 'subject'), 100); $msg = cleanBody(field($b, 'message'), 2000); $cat = clean(field($b, 'category'), 30) ?: 'General';
    if (mb_strlen($subject) < 3) throw bad('Enter a subject.');
    if (mb_strlen($msg) < 5) throw bad('Describe the problem in a few words.');
    $n = one('SELECT COUNT(*) AS n FROM tickets WHERE uid=?', [$user['id']]);
    if ((int)$n['n'] >= 200) throw bad('Too many tickets.');
    do { $id = 'TK' . random_int(100000, 999999); } while (one('SELECT 1 AS x FROM tickets WHERE id=?', [$id]));
    $now = nowms();
    q('INSERT INTO tickets (id, uid, mobile, name, subject, category, status, created, updated) VALUES (?,?,?,?,?,?,?,?,?)', [$id, $user['id'], $user['mobile'], $user['name'], $subject, $cat, 'open', $now, $now]);
    q('INSERT INTO ticket_msgs (ticket_id, sender, body, ts) VALUES (?,?,?,?)', [$id, 'customer', $msg, $now]);
    out(['ticket' => ticketView(one('SELECT * FROM tickets WHERE id=?', [$id]))], 201);
  }
  if ($m === 'POST' && preg_match('#^/tickets/([^/]+)/reply$#', $path, $r)) {
    $id = rawurldecode($r[1]);
    $t = one('SELECT * FROM tickets WHERE id=? AND uid=?', [$id, $user['id']]);
    if (!$t) throw new HttpErr(404, 'Ticket not found.');
    $msg = cleanBody(field(body(), 'message'), 2000);
    if (mb_strlen($msg) < 2) throw bad('Write your message.');
    $n = one('SELECT COUNT(*) AS n FROM ticket_msgs WHERE ticket_id=?', [$id]);
    if ((int)$n['n'] >= 100) throw bad('This ticket is full. Please open a new one.');
    $now = nowms();
    q('INSERT INTO ticket_msgs (ticket_id, sender, body, ts) VALUES (?,?,?,?)', [$id, 'customer', $msg, $now]);
    q("UPDATE tickets SET status='open', updated=? WHERE id=?", [$now, $id]);
    out(['ticket' => ticketView(one('SELECT * FROM tickets WHERE id=?', [$id]))]);
  }

  if ($path === '/chat' && $m === 'GET') out(['messages' => chatRows($user['id'], (int)(isset($_GET['after']) ? $_GET['after'] : 0))]);
  if ($path === '/chat' && $m === 'POST') {
    $text = cleanBody(field(body(), 'body'), 500);
    if ($text === '') throw bad('Type a message.');
    $rk = 'cr:' . $user['id']; $rl = attempt($rk); $now = nowms();
    if ($now - $rl['t'] > 60000) { $rl['t'] = $now; $rl['n'] = 0; }
    $rl['n']++;
    if ($rl['n'] > 20) throw new HttpErr(429, 'You are sending messages too fast.');
    saveAttempt($rk, $rl);
    $res = [pushChat($user['id'], 'customer', $text)];
    $st = one('SELECT greeted FROM chat_state WHERE uid=?', [$user['id']]);
    $g = $st ? (int)$st['greeted'] : 0;
    if ($g === 0 || $now - $g > 6 * 3600000) {
      touchChat($user['id']);
      q('UPDATE chat_state SET greeted=? WHERE uid=?', [$now, $user['id']]);
      $res[] = pushChat($user['id'], 'staff', 'Thank you for messaging Trinetri Diagnostics. Our team will reply here as soon as possible (Mon to Sat 7 am to 10 pm, Sun 7 am to 2 pm). For urgent help call +91 91873 15972.', 'Auto reply');
    }
    touchChat($user['id']);
    out(['messages' => $res], 201);
  }

  if ($path === '/membership' && $m === 'POST') {
    $tier = strtolower(clean(field(body(), 'tier'), 20));
    $plan = null; foreach (PLANS as $p) if ($p['id'] === $tier) $plan = $p;
    if (!$plan) throw bad('Choose a plan.');
    q('UPDATE users SET membership=? WHERE id=?', [json_encode(['tier' => $plan['id'], 'status' => 'requested', 'requested' => nowms()]), $user['id']]);
    out(['user' => publicUser(one('SELECT * FROM users WHERE id=?', [$user['id']])), 'note' => 'Request received. The lab will confirm your plan after payment at the counter or on WhatsApp.']);
  }
  throw new HttpErr(404, 'Not found');
}

/* ---------- lab software routes (secret key) ---------- */
function labOrder($code) {
  $o = one('SELECT * FROM orders WHERE code=?', [strtoupper(rawurldecode($code))]);
  if (!$o) throw new HttpErr(404, 'Order not found.');
  return $o;
}
function lab($path, $m) {
  $key = cfg()['lab_api_key'];
  if ($key === '') throw new HttpErr(503, 'Lab API is not enabled. Set lab_api_key in config.php.');
  if (!hash_equals($key, isset($_SERVER['HTTP_X_LAB_KEY']) ? (string)$_SERVER['HTTP_X_LAB_KEY'] : '')) throw new HttpErr(401, 'Invalid lab key.');

  if ($path === '/lab/orders' && $m === 'POST') {
    $b = body(); $mobile = normMobile(field($b, 'mobile'));
    if (!preg_match('/^[6-9]\d{9}$/', $mobile)) throw bad('Valid mobile required.');
    $tests = [];
    foreach (array_slice(is_array(field($b, 'tests')) ? $b['tests'] : [], 0, 100) as $t) {
      $name = is_array($t) ? clean(field($t, 'name'), 120) : clean($t, 120);
      $price = is_array($t) ? max(0, (int)round((float)field($t, 'price'))) : 0;
      if ($name !== '') $tests[] = ['name' => $name, 'price' => $price];
    }
    if (!$tests) throw bad('At least one test required.');
    $code = strtoupper(clean(field($b, 'code'), 30));
    if ($code === '') $code = 'TD-' . date('ymd') . '-' . strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', 'X', rnd(3)), 0, 4));
    if (!preg_match('/^[A-Z0-9-]{3,30}$/', $code)) throw bad('Order code may contain letters, numbers and dashes only.');
    if (one('SELECT 1 AS x FROM orders WHERE code=?', [$code])) throw new HttpErr(409, 'Order code already exists.');
    $pin = (string)random_int(100000, 999999);
    $amt = (float)field($b, 'amount'); if (!$amt) $amt = array_sum(array_column($tests, 'price'));
    $id = rnd(9); $now = nowms();
    q('INSERT INTO orders (id, code, mobile, name, tests, amount, status, times, created, pin_hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [$id, $code, $mobile, clean(field($b, 'name'), 60), json_encode($tests, JSON_UNESCAPED_UNICODE), max(0, (int)round($amt)), 'booked', json_encode(['booked' => $now]), $now, pinHash($code, $pin)]);
    out(['order' => orderView(one('SELECT * FROM orders WHERE id=?', [$id])), 'pin' => $pin], 201);
  }
  if ($m === 'POST' && preg_match('#^/lab/orders/([^/]+)/status$#', $path, $r)) {
    $o = labOrder($r[1]); $st = strtolower(clean(field(body(), 'status'), 20));
    if (!in_array($st, STATUSES, true)) throw bad('Status must be one of: ' . implode(', ', STATUSES));
    $t = json_decode($o['times'], true) ?: []; $t[$st] = nowms();
    q('UPDATE orders SET status=?, times=? WHERE id=?', [$st, json_encode($t), $o['id']]);
    out(['order' => orderView(one('SELECT * FROM orders WHERE id=?', [$o['id']]))]);
  }
  if ($m === 'PUT' && preg_match('#^/lab/orders/([^/]+)/report$#', $path, $r)) {
    $o = labOrder($r[1]);
    $raw = (string)file_get_contents('php://input');
    if (strlen($raw) > 3 * 1024 * 1024) throw new HttpErr(413, 'Report must be under 3 MB.');
    if (substr($raw, 0, 5) !== '%PDF-') throw bad('Only PDF files are accepted.');
    db();
    $file = $o['id'] . '.pdf';
    if (@file_put_contents(cfg()['storage_dir'] . '/reports/' . $file, $raw, LOCK_EX) === false) throw new Exception('Cannot write the report file.');
    $name = clean(isset($_GET['name']) ? $_GET['name'] : '', 80) ?: ($o['code'] . '-report.pdf');
    $t = json_decode($o['times'], true) ?: []; if (empty($t['completed'])) $t['completed'] = nowms();
    q("UPDATE orders SET report_name=?, report_size=?, report_file=?, status='completed', times=? WHERE id=?", [$name, strlen($raw), $file, json_encode($t), $o['id']]);
    out(['order' => orderView(one('SELECT * FROM orders WHERE id=?', [$o['id']]))]);
  }
  if ($path === '/lab/tickets' && $m === 'GET') {
    $st = isset($_GET['status']) ? (string)$_GET['status'] : '';
    $rows = $st !== '' ? all('SELECT * FROM tickets WHERE status=? ORDER BY updated DESC LIMIT 200', [$st]) : all('SELECT * FROM tickets ORDER BY updated DESC LIMIT 200');
    out(['tickets' => array_map('ticketView', $rows)]);
  }
  if ($m === 'POST' && preg_match('#^/lab/tickets/([^/]+)/reply$#', $path, $r)) {
    $id = rawurldecode($r[1]);
    if (!one('SELECT 1 AS x FROM tickets WHERE id=?', [$id])) throw new HttpErr(404, 'Ticket not found.');
    $b = body(); $msg = cleanBody(field($b, 'message'), 2000);
    if ($msg === '') throw bad('Message required.');
    $now = nowms();
    q('INSERT INTO ticket_msgs (ticket_id, sender, body, ts) VALUES (?,?,?,?)', [$id, 'staff', $msg, $now]);
    q('UPDATE tickets SET status=?, updated=? WHERE id=?', [!empty($b['close']) ? 'closed' : 'answered', $now, $id]);
    out(['ticket' => ticketView(one('SELECT * FROM tickets WHERE id=?', [$id]))]);
  }
  if ($path === '/lab/chat' && $m === 'GET') {
    $rows = all('SELECT u.mobile, u.name, s.last FROM chat_state s JOIN users u ON u.id=s.uid ORDER BY s.last DESC');
    out(['chats' => array_map(function ($x) { return ['mobile' => $x['mobile'], 'name' => $x['name'], 'last' => (int)$x['last']]; }, $rows)]);
  }
  if (preg_match('#^/lab/chat/(\d{10})$#', $path, $r)) {
    $u = one('SELECT * FROM users WHERE mobile=?', [$r[1]]);
    if (!$u) throw new HttpErr(404, 'No customer with this mobile.');
    if ($m === 'GET') out(['messages' => chatRows($u['id'], 0)]);
    if ($m === 'POST') {
      $text = cleanBody(field(body(), 'body'), 500);
      if ($text === '') throw bad('Message required.');
      $msg = pushChat($u['id'], 'staff', $text, 'Trinetri Support'); touchChat($u['id']);
      out(['message' => $msg], 201);
    }
  }
  if ($path === '/lab/membership' && $m === 'POST') {
    $b = body(); $u = one('SELECT * FROM users WHERE mobile=?', [normMobile(field($b, 'mobile'))]);
    if (!$u) throw new HttpErr(404, 'No customer with this mobile.');
    $tier = strtolower(clean(field($b, 'tier'), 20)); $found = false;
    foreach (PLANS as $p) if ($p['id'] === $tier) $found = true;
    if (!$found) throw bad('Unknown plan.');
    $st = field($b, 'status') === 'active' ? 'active' : (field($b, 'status') === 'cancelled' ? 'cancelled' : 'requested');
    $mem = ['tier' => $tier, 'status' => $st]; if ($st === 'active') $mem['since'] = nowms();
    q('UPDATE users SET membership=? WHERE id=?', [json_encode($mem), $u['id']]);
    out(['user' => publicUser(one('SELECT * FROM users WHERE id=?', [$u['id']]))]);
  }
  throw new HttpErr(404, 'Not found');
}

/* ---------- entry point ---------- */
function route() {
  header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff');
  $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
  if ($origin !== '') {
    $allowed = array_filter(array_map('trim', explode(',', cfg()['allowed_origins'])));
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
    $self = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://') . $host;
    if (!in_array($origin, $allowed, true) && $origin !== $self) out(['error' => 'Origin not allowed'], 403);
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Lab-Key');
    header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
    header('Access-Control-Max-Age: 600');
  }
  $m = $_SERVER['REQUEST_METHOD'];
  if ($m === 'OPTIONS') { http_response_code(204); exit; }

  $uri = (string)parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);
  $root = realpath(isset($_SERVER['DOCUMENT_ROOT']) ? $_SERVER['DOCUMENT_ROOT'] : '') ?: '';
  $here = realpath(__DIR__) ?: __DIR__;
  if ($root !== '' && strpos($here, $root) === 0) { $base = str_replace('\\', '/', substr($here, strlen($root))); if ($base !== '' && strpos($uri, $base) === 0) $uri = substr($uri, strlen($base)); }
  if (strpos($uri, '/index.php') === 0) $uri = substr($uri, 10);
  $path = rtrim($uri, '/') ?: '/';

  if ($path === '/' && $m === 'GET') out(['ok' => true, 'service' => 'trinetri-portal']);
  if ($path === '/plans' && $m === 'GET') out(['plans' => PLANS, 'placeholder' => true]);
  if (strpos($path, '/lab/') === 0) lab($path, $m);
  if ($path === '/auth/register' && $m === 'POST') register();
  if ($path === '/auth/login' && $m === 'POST') login();
  customer($path, $m, authed());
}

try {
  route();
} catch (HttpErr $e) {
  out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
  error_log('[trinetri-portal] ' . $e);
  out(['error' => 'Something went wrong. Please try again.'], 500);
}
