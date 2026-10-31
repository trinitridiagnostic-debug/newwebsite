<?php
/* Copy this file to config.php (same folder) and fill it in. Never upload config.php to GitHub. */
return [
  // Database. Leave db_dsn empty to use a SQLite file inside the storage folder (works without MySQL).
  // For MySQL (recommended on BigRock cPanel): create a database + user in cPanel > MySQL Databases, then:
  // 'db_dsn'  => 'mysql:host=localhost;dbname=CPANELUSER_trinetri;charset=utf8mb4',
  // 'db_user' => 'CPANELUSER_portal',
  // 'db_pass' => 'the database password',
  'db_dsn' => '',
  'db_user' => '',
  'db_pass' => '',

  // Long random text. The lab software sends it in the X-Lab-Key header to create orders, update status, upload reports, answer chats and tickets.
  'lab_api_key' => '',

  // Website addresses allowed to call this API (comma separated, no trailing slash).
  'allowed_origins' => 'https://trinitridiagnostic-debug.github.io',
];
