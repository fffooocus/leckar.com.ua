# Leckar — local development

Run the site and its `/api` handlers with Node.js:

```sh
node scripts/dev-server.js
```

Open <http://127.0.0.1:8765/>. Run the checkout tests with `node --test tests/checkout.test.js`.

## Meta Conversions API and Dataset Quality

Copy `.env.example` to `.env.local` and set `META_ACCESS_TOKEN`. Keep `.env.local` private; it is ignored by Git. `META_PIXEL_ID` must match the Pixel in the HTML pages. Run the read-only quality report with:

```sh
node scripts/meta-quality.js
```

Cash-on-delivery orders are saved through `/api/cod-checkout`, then sent as `Purchase` to Meta. Card orders are sent after `/api/novapay-callback` verifies the paid session with NovaPay. Both paths use the same `order_id` as the browser Pixel event for deduplication. A Meta API failure is logged without failing a saved order. Do not use `META_TEST_EVENT_CODE` for production events.

For a Vercel deployment, set `META_ACCESS_TOKEN` and `META_PIXEL_ID` in the project's environment variables. Set `APPS_SCRIPT_URL` if the order sheet URL changes. Card checkout also needs the existing `NOVAPAY_MERCHANT_ID`, `NOVAPAY_PRIVATE_KEY_B64`, and `SITE_URL` values. Local card checkout needs those values too.
