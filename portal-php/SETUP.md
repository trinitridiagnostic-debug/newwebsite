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
| `/lab.html` | staff | lab console with roles: admin, reception, technician (technicians upload and send reports; there is no doctor role) |
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

## Uploading lab reports (from the standalone lab software)

1. Export the patient's report as a PDF from the lab software.
2. Lab console > open the order > **Lab report** > choose the PDF. A preview shows it with the Trinetri letterhead (logo, patient details, page numbers).
3. If the lab software prints its own header or footer, use "Trim from top / bottom (mm)" and press Update preview.
4. Press **Send to customer**. There is no approval step. The customer sees the report straight away in their account, and the WhatsApp button messages them.
5. To correct a report, choose a new PDF and send it. It replaces the old one.

Files involved: `lab.js`, `lab-report.js`, `pdf-lib.min.js` (website folder) and `portal-api/index.php`, `portal-api/staff.php`.

## WhatsApp message when a report is sent (AiSensy)

1. In AiSensy create an API campaign with an approved template: `Hello {{1}}, your Trinetri Diagnostics report for order {{2}} is ready. Download it here: {{3}}`
2. In cPanel File Manager open `public_html/portal-api/config.php` (Edit) and add before the closing `];`:
   `'aisensy_key' => 'YOUR API KEY',` and `'aisensy_campaign' => 'YOUR CAMPAIGN NAME',`
3. After **Send to customer** the customer is messaged automatically. The link in the message works without login and expires after 14 days. The "Send on WhatsApp" button on the order sends it again.

## Customer login (mobile number + WhatsApp OTP, no passwords)

Customers log in or sign up with only their mobile number and a one-time code sent on WhatsApp. If the lab or the website already made an order for that number, it appears in their account straight after the OTP. Forgot-password no longer exists, because there is no password.
In `config.php` set `otp_provider` and the matching template details (see `config.sample.php`, options A and B).

## Phlebotomist app (home sample collection)

- **Create logins:** Lab console > Staff > Add a staff login > Role **Phlebotomist**. They log in at `trinetridiagnostics.com/phlebotomist.html` (they can add it to their phone's home screen).
- **Book a home visit:** New order > Collection **Home collection** > fill the address and the visit date and time. Website bookings carry their address and date across automatically.
- **Assign:** Lab console > **Home visits** (or the Home visit card on the order). Choose a phlebotomist, or leave it open so any phlebotomist can pick it under **Pick Order**.
- **Phlebotomist screens:** Orders (Accept, Start, Sample collected, Order release), Served, Pick Order, Leave, Password, SOS.
- **Lab sees:** collected samples move the order to "Sample collected" automatically, plus phlebotomist leave and SOS alerts (with location) on the Home visits page. Press Acknowledge on an SOS once handled.

## Online payment for home visits (Razorpay QR) and invoice on WhatsApp
After the phlebotomist marks the sample collected, the app shows **Show payment QR** for the amount still due. When the patient pays by any UPI app, the order is marked **paid (online)** and an invoice PDF is sent to the patient's WhatsApp.

1. In your Razorpay dashboard: generate API keys (Account & Settings > API Keys) and make sure **UPI QR codes** are enabled for your account.
2. Razorpay dashboard > Webhooks > Add: URL `https://trinetridiagnostics.com/portal-api/pay/webhook`, choose a secret you invent, tick **qr_code.credited** and **payment.captured**.
3. In `config.php` (type these yourself, never send them to anyone):
   `'razorpay_key_id' => 'rzp_live_...', 'razorpay_key_secret' => '...', 'razorpay_webhook_secret' => '...',`
4. In AiSensy create an approved template with a **document header** and 4 variables ({{1}} name, {{2}} order ID, {{3}} amount paid, {{4}} date), then add `'aisensy_invoice_campaign' => 'your_campaign_name',`.
5. The lab console order page has **Download invoice** and **Send invoice on WhatsApp** buttons for any order with a payment.
Without the webhook the app still notices the payment (it checks Razorpay every few seconds while the QR is on screen).
