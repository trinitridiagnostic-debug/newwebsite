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

## Online payment for home visits (Razorpay QR) and invoice download
After the phlebotomist marks the sample collected, the app shows **Show payment QR** for the amount still due. When the patient pays by any UPI app, the order is marked **paid (online)** and an invoice PDF is sent to the patient's WhatsApp.

1. In your Razorpay dashboard: generate API keys (Account & Settings > API Keys) and make sure **UPI QR codes** are enabled for your account.
2. Razorpay dashboard > Webhooks > Add: URL `https://trinetridiagnostics.com/portal-api/pay/webhook`, choose a secret you invent, tick **qr_code.credited** and **payment.captured**.
3. In `config.php` (type these yourself, never send them to anyone):
   `'razorpay_key_id' => 'rzp_live_...', 'razorpay_key_secret' => '...', 'razorpay_webhook_secret' => '...',`
4. Invoices are not sent on WhatsApp. The customer downloads the invoice from the Reports page of their account (beside Download PDF), and the lab can use **Download invoice** on the order page.
Without the webhook the app still notices the payment (it checks Razorpay every few seconds while the QR is on screen).

## Patient PIN check before collecting a home sample
In the phlebotomist app, after **Start**, the phlebotomist must ask the patient for the 6-digit report PIN (the one given when the order was created) and verify it. Only then does **Sample collected** appear. After 5 wrong tries the app waits 10 minutes. If the patient lost the PIN, open the order in the lab console and generate a new PIN, then give it to the patient.

## Daily attendance (selfie + GPS)
The first time a phlebotomist opens the app each day (IST), a full-screen "Welcome" sheet asks for **Capture Selfie**. The phone's front camera takes the photo, the phone's GPS location is read, then **Proceed** saves it. The app cannot be used until attendance is marked (unless the phlebotomist has leave for that day). The browser asks for camera and location permission the first time: tap Allow. The lab console has an **Attendance** tab: pick a date to see who is present (selfie, time, map link), on leave or not marked. Selfies are stored in `portal-storage/attendance` (private, not public).

## Advance schedule (next 8 days)
In the phlebotomist app, **Schedule** asks for each of the next 8 days: **YES** selects all hourly slots (05:00 to 22:00, ending at 11 pm) in green, and the phlebotomist can untap any slot and press **Confirm Slots**; **NO** marks the day not available. The home screen shows a yellow reminder while any of the 8 days is unanswered. In the lab console, the Phlebotomists page has an **Advance schedule** button per person (for example "Schedule (3/8)") that shows the 8 days with available days and slots in green.

## Customer-care CRM (leads)
Lab console > **CRM Leads** (everyone with a CRM role), **CRM team** (manager, team leader, super admin), **Integrations** (manager, super admin).

**Roles** (create them in CRM team, or Staff for the super admin):
- **Telecaller**: sees and works only the leads assigned to them (status, follow-up date, notes, call / WhatsApp buttons) and can add a lead (it is assigned to themselves).
- **Digital marketing**: sees all leads, adds leads and uploads Excel/CSV files. Cannot change or delete leads.
- **Team leader**: sees their own telecallers' leads plus unassigned leads, edits, assigns, imports, creates telecallers for their team.
- **Manager**: all leads, assign, edit, delete, import, creates telecallers / marketing / team leaders, sees the Integrations page.
- **Super admin** (the existing Admin): everything, including creating managers.
CRM roles only see the CRM; they cannot open orders, patients, reports or the rest of the lab console.

**Where leads come from**
1. *Excel / CSV*: CRM Leads > Import Excel / CSV. Pick the file, check the column matching, Import. Numbers already in the CRM are skipped, never duplicated.
2. *Justdial / Facebook / Instagram / website / other*: Integrations page shows one link per channel (it contains a secret key). Give the Justdial link to your Justdial account manager as the lead push URL. For Facebook and Instagram Lead Ads use Zapier, Make or Pabbly with the Facebook link, or the direct connection below.
3. *Direct Meta Lead Ads* (optional): in your Meta app add a Webhooks "Page" subscription for `leadgen` with the Callback URL and Verify token shown on the Integrations page, then add to `config.php` (type these yourself): `'meta_page_token' => 'long-lived page access token', 'meta_app_secret' => 'your app secret',`
4. *WhatsApp*: the existing WhatsApp Business webhook (`/portal-api/wa/webhook`) turns every new person who messages the lab into a lead.
Turn on "Share new leads automatically" on the Integrations page to hand new leads to the telecaller with the fewest open leads.

## Doctor partner app (doctor.html)
Doctors book home visits for their patients, collect money from the patient themselves, and pay the lab only the **B2B price** by Razorpay UPI QR. The rest is their margin.
1. **Upload prices**: Lab console > **B2B prices** > choose your Excel/CSV (one column test name, one column B2B price). Matching tests are linked to your catalog; others are saved under the name in your file. Doctors can book only tests on this list.
2. **Create a doctor**: Lab console > Staff > add, role **Doctor partner**. Give them the link `https://trinetridiagnostics.com/doctor.html` with their username and password.
3. **How a booking works**: doctor enters patient, address, time, picks tests, types the amount they charge the patient (never below the B2B total). A QR for the B2B total appears. When it is paid (Razorpay webhook or the app's own check) the booking becomes a normal paid home-visit order in your Home visits list, and the doctor sees a PIN for the patient. Assign a phlebotomist as usual. The order note tells the phlebotomist not to collect money.
4. **Money view**: Lab console > **Doctor bookings** shows each doctor's paid bookings, amount paid to lab and margin.
This uses the same Razorpay keys and webhook as the phlebotomist QR (see the Razorpay section above). Nothing else to configure.

## Sample-collection verification PIN on WhatsApp
When a **home-visit** order is created (by the lab, or by a doctor partner after paying), the 6-digit verification PIN is sent to the customer's WhatsApp automatically. The same happens when the lab presses **New PIN + WhatsApp** on a home order. The customer tells the PIN to the phlebotomist, who types it in the app before collecting the sample.
Setup: in AiSensy create the approved template ("Sample Collection Verification") with 2 variables, {{1}} patient name and {{2}} the 6-digit code, then add `'aisensy_pin_campaign' => 'your_campaign_name',` to config.php. If it is not set, nothing is sent and the lab still sees the PIN on screen as before.

## Customer mobile app (installable app + APK)
`customer.html` is now an installable app (manifest, icons, service worker). Customers can also install it from Chrome (menu > Install app / Add to Home screen); an "Install" bar appears automatically.
**Making the Android APK** (free, no coding): open https://www.pwabuilder.com, enter `https://trinetridiagnostics.com/customer.html`, press Start, then **Package for stores > Android**. Use package ID like `com.trinetridiagnostics.app`, app name `Trinetri Diagnostics`, and let PWABuilder create a new signing key. Download the zip: it contains the `.apk` (to share directly) and an `.aab` (for Google Play), plus `signing.keystore` and its password file. **Keep the keystore and password safe and private; without them you cannot update the app later.**
Full-screen without the browser bar: the zip also contains `assetlinks.json`. In cPanel File Manager create the folder `public_html/.well-known` and upload that file into it. Without this step the app still works but shows a thin address bar at the top.
After the website changes, the app updates itself. You only rebuild the APK to change the app icon, name or package.

## Sample vial photos (phlebotomist app)
Before "Sample collected" can be pressed, the phlebotomist must, for every vial: photograph the empty vial, enter or scan its barcode (confirmed with "Check the Barcode"), photograph the filled vial, and finally take a selfie (while removing PPE). Photos are stored in `storage/vials` (private, served only to logged-in lab staff). On the lab order page, a "Sample photos" card shows them and a technician/admin can press "Mark sample verified". A barcode can be used on one vial only. Upload `vials.php` with the other PHP files; the database updates itself on first use.
