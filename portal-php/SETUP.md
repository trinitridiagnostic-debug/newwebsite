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

## Lab API (header `X-Lab-Key: <lab_api_key>`, JSON unless noted)
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
- Developers: `node portal-php/test.mjs` runs 66 checks against PHP's built-in server.
