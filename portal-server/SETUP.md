# Customer portal: going live

The customer dashboard (customer.html) shows sample data ("demo mode") until it is connected to this server.

1. In GitHub > Settings > Secrets > Actions, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` must exist (already used earlier).
2. Add a secret `LAB_API_KEY`: a long random string. The lab software / staff tools use it in the `X-Lab-Key` header. Without it, `/lab/*` stays switched off.
3. Run the workflow "Deploy customer portal server" (Actions tab). It tests, then deploys the Worker `trinetri-portal`.
4. Copy the Worker address (Cloudflare > Workers > trinetri-portal), e.g. `https://trinetri-portal.xxxx.workers.dev`, into `portal-config.js`: `window.TRIN_PORTAL = { api: 'https://...' };` and push.

## Lab API (header `X-Lab-Key: <LAB_API_KEY>`)
- `POST /lab/orders` create an order {code, pin, mobile, name, tests[]}
- `POST /lab/orders/:code/status` {status: booked | sample_collected | in_progress | completed}
- `PUT /lab/orders/:code/report` body = PDF file (max 3 MB)
- `GET /lab/tickets`, `POST /lab/tickets/:id/reply`
- `GET /lab/chat`, `GET/POST /lab/chat/:mobile`
- `POST /lab/membership` activate a customer's plan

Customers link an order with Order ID + 6-digit PIN printed on their receipt.
Plans and prices in worker.js (`PLANS`) are placeholders.
