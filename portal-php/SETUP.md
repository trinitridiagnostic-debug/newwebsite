# Customer portal (PHP version): setup on BigRock / any cPanel PHP host

Needs: PHP 7.4 or newer (8.x is best) with PDO, and HTTPS on the domain (cPanel > SSL/TLS Status > run AutoSSL).
The website can stay on GitHub Pages. Only this API folder goes on the PHP host.

1. cPanel > File Manager > `public_html`. Create a folder, e.g. `portal-api`. Open it, Upload `trinetri-portal-api.zip`, then Extract.
2. In that folder, copy `config.sample.php` to `config.php` and Edit it:
   - `lab_api_key`: a long random text (30+ characters). Keep it secret. Your lab software sends it as the `X-Lab-Key` header.
   - Database: leave `db_dsn` empty to use a SQLite file (simplest). Or create a MySQL database + user in cPanel > MySQL Databases and fill in `db_dsn`, `db_user`, `db_pass` (example inside the file). Tables are created automatically on the first request.
   - `allowed_origins`: the website address(es) that may call the API. Add your own domain if the site is served from it.
3. Open `https://YOUR-DOMAIN/portal-api/` in a browser. You should see `{"ok":true,"service":"trinetri-portal"}`.
   Also try `/portal-api/plans`. If you get a 404 there, ask the host to enable `mod_rewrite`, or use `https://YOUR-DOMAIN/portal-api/index.php` as the address in step 4 (it works without rewrites).
4. In the website repo, set `portal-config.js`:  `window.TRIN_PORTAL = { api: 'https://YOUR-DOMAIN/portal-api' };`  (no slash at the end) and push. The dashboard leaves demo mode.

Do not upload `config.php` to GitHub. The `storage/` folder (database, report PDFs, signing key) is created by the API and blocked from the web by `.htaccess`. Back it up with your normal cPanel backups.

## Lab console (lab.html): your lab management software
Open `https://YOUR-WEBSITE/lab.html`. The first time, it asks you to create the owner login. The **setup code** is the `lab_api_key` from `config.php` (so nobody else can claim the first login).
Then add staff under **Staff** and give each a role:
- **Reception**: register patients, bill, take payments, print receipts, inbox (tickets, chat), memberships
- **Technician**: mark samples collected / in progress, enter results, stock
- **Doctor / Pathologist**: enter results, **approve reports** (this publishes them to the customer), edit result templates
- **Admin**: everything, plus staff accounts

**Website bookings:** the home page form and the Book page also send each request to the lab console. It appears under **Bookings** (with a red count) and on the Dashboard. Click **Create order** to open New order with the patient, tests, date and address already filled in. The booking is marked done and linked to the order. WhatsApp still opens for the customer as before.

Daily flow: New order (bill, print receipt, give the PIN) -> mark sample collected -> enter results (or attach a ready PDF) -> Approve. Customers see each step live on their dashboard and download the PDF only after approval.
Billing uses the same test prices as the website (and your changes in the catalog admin). Anything not in the price list can be added as a custom test. Member discounts are suggested automatically for active members.
Result templates (parameters, units, normal ranges) are starter values only. Have your pathologist review them under **Result templates** before issuing reports.

## Mobile number verification (OTP)
With OTP switched on, a one-time code sent to the customer's mobile is required to: create an account, log in on a new device, and reset a forgotten password. The password stays as the second check. Customers can tick "Keep me logged in on this device" to skip the code on that device for 30 days. Codes are 6 digits, last 5 minutes, allow 5 tries, and sending is limited per number and per visitor. Codes are never shown on screen or stored in readable form.

**Codes are sent on WhatsApp only. Nothing is ever sent by SMS.** If WhatsApp cannot deliver (for example the number has no WhatsApp), the customer sees a clear message and can try again or call the lab.

**It is OFF until you set up WhatsApp**, because it cannot work without a sender. To switch it on:
1. In Meta Business, set up the WhatsApp Business Platform with a phone number for the lab.
2. Create a message template of type *Authentication* named `otp_code` (language English) and wait for approval.
3. Copy the *Phone number ID* and a *permanent access token* into `config.php` as `wa_phone_id` and `wa_token` (see `config.sample.php` for the exact lines), and set `'otp_provider' => 'live'`.
4. Test with a new account using your own number. Keep the token private and never put it on GitHub.
The WhatsApp sending code could not be tried against the real service from here, so this first test with your own number is important.

## Lab API (for connecting other lab software) (header `X-Lab-Key: <lab_api_key>`, JSON unless noted)
| Call | Purpose |
|---|---|
| `POST /lab/orders` `{code?, mobile, name, tests:[{name,price}], amount?}` | Create an order. Returns the 6-digit `pin` to print on the receipt |
| `POST /lab/orders/CODE/status` `{status}` | `booked`, `collected`, `processing`, `completed` |
| `PUT /lab/orders/CODE/report?name=file.pdf` (body = PDF bytes, max 3 MB) | Attach the report; marks the order completed |
| `GET /lab/tickets?status=open`, `POST /lab/tickets/ID/reply` `{message, close?}` | Support tickets |
| `GET /lab/chat`, `GET /lab/chat/MOBILE`, `POST /lab/chat/MOBILE` `{body}` | Live chat |
| `POST /lab/membership` `{mobile, tier, status}` | `status`: `active`, `requested` or `cancelled` |

Example: `curl -X POST https://YOUR-DOMAIN/portal-api/lab/orders -H "X-Lab-Key: KEY" -H "Content-Type: application/json" -d '{"mobile":"9876543210","name":"Asha","tests":[{"name":"CBC","price":300}]}'`

## Notes
- Customers link a test with Order ID + PIN from the receipt, so nobody can read another person's reports by signing up with their number.
- Passwords are stored with PHP `password_hash`. Logins lock for 15 minutes after 5 wrong tries.
- Plans and prices are placeholders (edit `PLANS` near the top of `index.php`, and the matching list in `portal.js` for demo mode).
- Developers: `node portal-php/test.mjs` (66 checks) and `node portal-php/test-staff.mjs` (100 checks) run against PHP's built-in server.

## Catalog admin (admin.html)

Open `https://YOURDOMAIN.com/admin.html` and log in with the same admin username and password as the lab console. No GitHub token is needed.
"Publish" writes `catalog.js` and the package pictures straight into your website folder (the folder above `portal-api`), so the website updates at once.
The previous 30 versions are kept in `portal-api/storage/catalog-backups/`. If the folder is somewhere else, set `site_dir` in `config.php`.
