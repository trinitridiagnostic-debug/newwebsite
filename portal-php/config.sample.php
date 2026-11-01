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

  // Mobile-number OTP (see SETUP.md). Leave otp_provider empty to keep OTP switched off. Set it to 'live' once WhatsApp and/or SMS is set up below.
  'otp_provider' => '',
  'otp_channels' => 'whatsapp,sms',        // order to try: WhatsApp first, SMS as backup
  // WhatsApp Business Cloud API (Meta): needs an approved "authentication" message template
  // 'wa_phone_id' => 'PHONE NUMBER ID FROM META', 'wa_token' => 'PERMANENT ACCESS TOKEN', 'wa_template' => 'otp_code', 'wa_lang' => 'en',
  // SMS backup through MSG91: needs an approved OTP template (DLT in India)
  // 'msg91_key' => 'MSG91 AUTH KEY', 'msg91_template' => 'MSG91 TEMPLATE ID',

  // Website addresses allowed to call this API (comma separated, no trailing slash).
  'allowed_origins' => 'https://trinitridiagnostic-debug.github.io',
];
