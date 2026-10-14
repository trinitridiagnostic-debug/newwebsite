# Switching on online payment (Razorpay)

The booking form already has the "Pay online" button and the Razorpay popup code. Until the steps
below are done it runs as a demo. Everything is done in the browser; nothing to install.

Why a server? The website is static. Razorpay needs a small server to (1) create each order with the
price taken from your price list, and (2) confirm the payment signature. `worker.js` does both and runs
free on Cloudflare Workers. Your Razorpay **secret key** lives only there, never in the website files.

## Step 1. Razorpay keys (start in Test Mode)
1. dashboard.razorpay.com > switch to **Test Mode** (top of the page).
2. **Account & Settings > API Keys > Generate Key.**
3. You get a **Key ID** (`rzp_test_...`) and a **Key Secret**. The secret is shown once, so save it.

## Step 2. Cloudflare account (free)
1. Sign up at dash.cloudflare.com.
2. Copy your **Account ID** (right side of the Workers & Pages overview page).
3. **My Profile > API Tokens > Create Token > "Edit Cloudflare Workers" template > Create.** Copy the token.

## Step 3. Add 4 secrets to GitHub
Repository > **Settings > Secrets and variables > Actions > New repository secret**. Add exactly these names:

| Name | Value |
|---|---|
| `RAZORPAY_KEY_ID` | the `rzp_test_...` Key ID |
| `RAZORPAY_KEY_SECRET` | the Razorpay Key Secret |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |

GitHub keeps these hidden. They are not visible in the repository or the public website.

## Step 4. Deploy the server
Repository > **Actions > "Deploy payment server" > Run workflow.** When it shows a green tick, open the run
and copy the Worker address from the log, like `https://trinetri-pay.<your-name>.workers.dev`.
(Cloudflare also shows it under Workers & Pages.)

## Step 5. Connect the website
Edit `pay-config.js` in the repository:
```js
window.TRIN_PAY = { key: 'rzp_test_xxxxxxxx', api: 'https://trinetri-pay.<your-name>.workers.dev' };
```
The Key ID is public by design, so this is safe to commit. Wait about a minute for GitHub Pages to update, then
make a test booking with Razorpay's test UPI/card details.

## Step 6. Go live
When Razorpay approves your account: switch the dashboard to **Live Mode**, generate live keys, update the
`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` GitHub secrets, run the workflow again, and change `key` in
`pay-config.js` to `rzp_live_...`.

## Good to know
* **Prices** are decided by the server from `prices.js`, never by the browser. If you change a price or add a
  payable package on the site, update `prices.js` and `PKGRS` in `app.js`, then redeploy.
* Online payment works for the **Advance Health Package**, **Lipid Profile** and single tests. Other packages have no
  price yet, so they stay "pay at collection".
* If you later use your own domain, add it to `ALLOWED_ORIGIN` in `wrangler.toml` (comma separated).
* After a payment the customer still taps one button to send their booking details on WhatsApp.
* Never paste the Key Secret into chat, the website files or an email.
