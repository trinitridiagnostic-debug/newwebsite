# Trinetri Diagnostics: server setup (cPanel)

Everything runs on your own hosting: the website, the customer portal, the lab console and the catalog admin.
The website files sit in `public_html`. The server sits in the `portal-api` folder next to them and uses one MySQL database.

## First-time setup

1. cPanel > **MySQL Databases**: create a database `trinetri`, create a user `trinetri` with the password given in your credentials sheet, then **Add user to database** with ALL PRIVILEGES.
2. cPanel > **phpMyAdmin**: click the database, open **Import**, choose `trinetri-database.sql`, press **Go**. (It creates every table, your owner login and the starter result templates.)
3. cPanel > **File Manager** > `public_html` > **Upload** the website zip, then **Extract**.
4. Open `public_html/portal-api/config.php` > **Edit**. Replace `CPANELUSER` (two places) with your cPanel username as shown in MySQL Databases. Save.
5. cPanel > **Select PHP Version**: PHP 8.1 or newer, with `pdo_mysql`, `curl`, `mbstring`, `json` ticked.
6. Check: open `https://trinetridiagnostics.com/portal-api/health` and you should see `{"ok":true,"database":"connected"}`. If not, the message tells you what to fix.
7. Open `https://trinetridiagnostics.com/lab.html` and log in as the owner. Change the password under **My account**, then add your staff under **Staff**.

The first request creates anything the SQL file did not (the app checks its own tables automatically), so a missing table never stops the site.

## What lives where

| Address | Who | What |
|---|---|---|
| `/` | public | website, test and package list, booking form (bookings land in Lab console > Bookings) |
| `/customer.html` | customers | account, order tracking, reports (PDF), tickets, chat, membership |
| `/lab.html` | staff | lab console with roles: admin, reception, technician, doctor |
| `/admin.html` | admin | edit packages, tests and prices (saved straight to the site) |

All of them read and write the same database, so a booking made on the website, an order made at reception and what the customer sees in their account are always the same record.

## Settings in config.php

| Setting | Meaning |
|---|---|
| `db_dsn`, `db_user`, `db_pass` | the MySQL database |
| `secret` | signs login tokens. Never change it after go-live (everyone would be logged out) |
| `lab_api_key` | machine key for the lab API (X-Lab-Key header). Keep private |
| `otp_provider` | empty = OTP off. `'live'` = WhatsApp OTP on (needs the lines below) |
| `wa_phone_id`, `wa_token`, `wa_template`, `wa_lang` | Meta WhatsApp Business Cloud API |
| `wa_verify_token` | the Verify token you type in Meta when saving the webhook |
| `site_dir` | only if `catalog.js` is not in the folder above `portal-api` |

## WhatsApp OTP (optional, recommended)

OTP is sent on WhatsApp only. Once switched on it is required for new customer accounts, login on a new device and password reset. Website bookings never need an OTP.

1. Meta Business: WhatsApp Business Cloud API, a phone number, and an approved **authentication** template named `otp_code`.
2. In Meta > WhatsApp > Configuration > Webhook: callback URL `https://trinetridiagnostics.com/portal-api/wa/webhook`, verify token = `wa_verify_token` from config.php.
3. In `config.php` add `wa_phone_id`, `wa_token`, then set `'otp_provider' => 'live'`.
4. Test with your own number from `customer.html` > Create account.

## Backups

- Database: cPanel > **Backup** > Download a MySQL database backup (do this weekly).
- Files: cPanel > Backup > Home directory backup. Reports are stored in `portal-api/storage/reports`.
- Catalog: the last 30 versions are kept in `portal-api/storage/catalog-backups`.

## Moving or resetting

- Forgot the owner password: in phpMyAdmin open table `staff`, delete the owner row, then run the owner INSERT line from `trinetri-database.sql` again with a new hash, or ask me to generate a new one.
- Membership prices are in `PLANS` near the top of `portal-api/index.php`.
