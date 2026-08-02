// migrate-to-supabase.mjs
//
// Run ONCE, locally, before you cut index.html over to the new endpoints —
// while your Netlify site is still serving its last successful deploy
// (credits blocking new deploys doesn't stop the existing one from running).
// Pulls your real products and orders and inserts them into Supabase.
//
// Usage:
//   npm install @supabase/supabase-js
//   NETLIFY_SITE_URL=https://your-site.netlify.app \
//   ADMIN_KEY=your-real-admin-passcode \
//   SUPABASE_URL=https://<PROJECT_REF>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
//   node migrate-to-supabase.mjs
//
// Requires Node 18+ (for global fetch). Safe to re-run — products upsert,
// orders upsert on id so re-running just overwrites with the same data.
import { createClient } from "@supabase/supabase-js";

const NETLIFY_SITE_URL = process.env.NETLIFY_SITE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [name, val] of Object.entries({ NETLIFY_SITE_URL, ADMIN_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function migrateProducts() {
  console.log("Fetching products from Netlify...");
  const res = await fetch(`${NETLIFY_SITE_URL}/.netlify/functions/products`);
  if (!res.ok) throw new Error(`products fetch failed: ${res.status}`);
  const products = await res.json();
  console.log(`Got ${products.length} products. Writing to Supabase kv_store...`);

  const { error } = await supabase
    .from("kv_store")
    .upsert({ key: "products", value: products, updated_at: new Date().toISOString() });
  if (error) throw error;
  console.log("Products migrated.");
}

async function migrateOrders() {
  console.log("Fetching orders from Netlify (admin)...");
  const res = await fetch(`${NETLIFY_SITE_URL}/.netlify/functions/orders`, {
    headers: { "x-admin-key": ADMIN_KEY },
  });
  if (!res.ok) throw new Error(`orders fetch failed: ${res.status} — check ADMIN_KEY`);
  const orders = await res.json();
  console.log(`Got ${orders.length} orders. Writing to Supabase orders table...`);

  const rows = orders.map((order) => ({
    id: order.id,
    email: (order.email || "").toLowerCase(),
    status: order.status || "Confirmed",
    courier: order.courier || null,
    awb: order.awb || null,
    invoice_number: order.invoiceNumber || null,
    total: order.total || 0,
    currency: order.currency || "INR",
    created_at: order.date || new Date().toISOString(),
    data: order,
  }));

  // Batch in chunks so a very large order history doesn't hit request-size limits.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("orders").upsert(chunk);
    if (error) throw error;
    console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length} orders written`);
  }

  // Advance the invoice sequence past the highest number already in use, so
  // the next new order doesn't collide with historical invoice numbers.
  const numbers = orders
    .map((o) => o.invoiceNumber)
    .filter(Boolean)
    .map((n) => parseInt(String(n).split("-").pop(), 10))
    .filter((n) => !Number.isNaN(n));
  const maxN = numbers.length ? Math.max(...numbers) : 0;
  if (maxN > 0) {
    const { error } = await supabase.rpc("set_invoice_seq", { new_value: maxN });
    if (error) {
      console.warn(
        `Could not auto-advance the invoice sequence (${error.message}). ` +
          `Run this manually in the SQL Editor: select setval('invoice_seq', ${maxN});`
      );
    } else {
      console.log(`Invoice sequence advanced past ${maxN}.`);
    }
  }

  console.log("Orders migrated.");
}

try {
  await migrateProducts();
  await migrateOrders();
  console.log("\nDone. Spot-check a few products and orders in the Supabase table editor before cutting index.html over.");
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exit(1);
}
