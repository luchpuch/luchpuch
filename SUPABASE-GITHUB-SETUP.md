# Luchpuch: GitHub Pages + Supabase

## What changed from Netlify

- **Hosting:** GitHub Pages instead of Netlify (static `index.html` only —
  no more `netlify.toml`, no build credits, no deploy limits).
- **Database:** Supabase Postgres instead of Netlify Blobs (`kv_store` table
  for products, a real `orders` table with an atomic invoice sequence).
- **Backend logic:** Supabase Edge Functions instead of Netlify Functions —
  same five endpoints (`products`, `orders`, `order-status`, `admin-check`,
  `luchi-chat`), same behavior, same `x-admin-key` header for admin access.
- **Bonus fix folded in:** `orders` now re-prices every cart item against
  the live catalogue server-side before charging/invoicing it — closes a
  price-tampering gap your last live `orders.mjs` still had.
- **New: email sign-in for customers.** Browsing (shop, product pages,
  bag) still needs no account. Placing an order now requires signing in
  with a passwordless email link — no Google/OAuth setup, nothing to pay
  for. Enforced both in the UI (the checkout form is replaced with a
  "Send sign-in link" box until you're signed in) and on the server (the
  `orders` function rejects POST requests with no valid Supabase Auth
  session, using the `_shared/auth.ts` helper). Admin login is
  unchanged — it's still the separate `x-admin-key` passcode.

## Setup, in order

1. **Create the Supabase project** at supabase.com. Note your **Project
   Reference ID** (Project Settings -> API) — you'll need it as
   `<PROJECT_REF>` below.
2. **Run the schema.** Dashboard -> SQL Editor -> paste `supabase/schema.sql`
   -> Run.
3. **Install & link the CLI:**
   ```
   npm install -g supabase
   supabase login
   supabase link --project-ref <PROJECT_REF>
   ```
4. **Set secrets** (one command, values from your Netlify env vars today):
   ```
   supabase secrets set \
     ADMIN_KEY=your-real-passcode \
     RESEND_API_KEY=... \
     FROM_EMAIL="Luchpuch <orders@yourdomain.com>" \
     GEMINI_API_KEY=... \
     SUPPORT_EMAIL=hello@luchpuch.com \
     SITE_URL=https://yourusername.github.io/luchpuch
   ```
5. **Deploy the functions.** All five still run with `--no-verify-jwt` —
   that's Supabase's automatic "require a JWT for every request" gate,
   which would also block the still-public `GET /orders?email=...` lookup
   and the admin-key routes. The customer sign-in requirement on `POST
   /orders` is instead checked manually inside the function itself (via
   `getUser()` in `_shared/auth.ts`), so it doesn't need that flag on:
   ```
   supabase functions deploy products --no-verify-jwt
   supabase functions deploy orders --no-verify-jwt
   supabase functions deploy order-status --no-verify-jwt
   supabase functions deploy admin-check --no-verify-jwt
   supabase functions deploy luchi-chat --no-verify-jwt
   ```
6. **Migrate your existing data**, once, before cutover, while your Netlify
   site is still serving its last deploy:
   ```
   npm install @supabase/supabase-js
   NETLIFY_SITE_URL=https://your-site.netlify.app \
   ADMIN_KEY=your-real-admin-passcode \
   SUPABASE_URL=https://<PROJECT_REF>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
   node migrate-to-supabase.mjs
   ```
   Then spot-check a few rows in the Supabase table editor.
7. **Edit `index.html`** — replace `YOUR-PROJECT-REF` on the `API_BASE`
   line near the top of the `<script>` with your real project ref.
8. **Turn on email sign-in for customers:**
   - Get your **anon public key**: Dashboard -> Project Settings -> API ->
     Project API keys -> `anon` `public`. Paste it into `SUPABASE_ANON_KEY`
     near the top of the `<script>` in `index.html` (right under
     `API_BASE`). This key is safe to ship client-side — unlike the
     service role key, it can't bypass Row Level Security.
   - That's the only setup step. Supabase's email provider is on by
     default on every project, free tier included — no Google Cloud
     account, no OAuth client, no cost. As soon as the anon key is in
     place, the "Sign in" button in the nav works: a customer types their
     email, gets a one-time link, and clicking it signs them in and drops
     them back on your site.
   - In Supabase: Dashboard -> Authentication -> URL Configuration -> set
     **Site URL** to your live site (e.g.
     `https://yourusername.github.io/luchpuch`) and add it under **Redirect
     URLs** too — otherwise the sign-in link will work but bounce back to
     the wrong page.
   - Supabase's built-in email sender is rate-limited (a handful of emails
     per hour on the free tier) — fine for testing and modest traffic. If
     you outgrow it, Dashboard -> Authentication -> Providers -> Email
     lets you turn on **Custom SMTP** and plug in Resend, SendGrid, or
     similar (you likely already have Resend configured for order
     confirmations — same account can send these too).
   - Until the anon key is filled in, the "Sign in" button in the nav
     shows "Sign-in not set up" and stays disabled — browsing and the bag
     still work fine either way.
9. **Push to GitHub**, then repo -> Settings -> Pages -> Deploy from a
   branch -> `main` / root. Live at
   `https://yourusername.github.io/reponame` (or add a custom domain there
   if you bought `luchpuch.com`).
10. **Tighten CORS.** Once your GitHub Pages URL (or custom domain) is
    final, open `supabase/functions/_shared/cors.ts` and change
    `"Access-Control-Allow-Origin"` to your exact site origin, then
    redeploy all five functions. Leaving it as `*` (or the wrong origin)
    lets any website call your functions, not just yours — and if it
    doesn't match your real site origin, the sign-in link's redirect back
    to your site will also fail CORS on the very first API call.

## Where your service role key lives

Only in Supabase's own secrets (set via `supabase secrets set` — you never
put it in `index.html`, a GitHub repo, or anywhere client-side). It bypasses
Row Level Security entirely, which is exactly why `schema.sql` enables RLS
with no policies: it blocks the public REST API from reading your tables
directly, while your Edge Functions keep working normally.

The **anon key** is different — it's meant to be public, and is what the
browser uses for the email sign-in flow (`SUPABASE_ANON_KEY` in
`index.html`). It only grants what your RLS policies allow, which today is
nothing on `kv_store` or `orders` — the anon key here is purely for Auth
(sign-in, session, sign-out), not for reading your tables directly.

## Known limitations carried over unchanged

Same caveats your Netlify README already documented — none of this
migration changes them:
- Admin passcode is a shared secret, not real per-person accounts.
- Order lookup by email has no additional proof of ownership — anyone who
  knows an email used at checkout can look up those orders on `#track`.
  Sign-in gates *placing* an order, not looking one up by email.
- Order status is set manually in admin, not connected to a courier API.

## One more thing worth knowing

`repriceFromCatalogue` looks up each cart item by product `id`, and your
product `id`s are just their array position (set by `reindex()` whenever you
add/edit/delete a product in admin). If someone has your site open with an
item in their cart, and you delete or reorder products in another tab before
they check out, their cart's `id` could end up pointing at a different
product after the reindex — rare in practice, but worth knowing. It's an
existing quirk of how products are identified, not something this migration
introduced; a more robust fix would give every product a stable ID that
never changes, independent of its position in the list. Ask me if you'd like
that built.

## Still open: payment verification

This migration closes the price-tampering gap (orders now re-price against
your real catalogue server-side) — but it does **not** yet verify that a
Razorpay/PayPal payment actually happened before an order is saved as
"Confirmed." Right now, someone could still create a fully valid order —
invoice, confirmation email, and all — by sending the right request
directly, without paying. That's the next thing worth fixing.
