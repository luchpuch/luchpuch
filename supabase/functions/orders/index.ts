// supabase/functions/orders/index.ts
//
// GET  (x-admin-key header, no ?email=) -> ALL orders, for the admin dashboard.
// GET  ?email=someone@example.com        -> only that person's orders (public).
// POST -> creates ONE new order (checkout). Requires a signed-in customer —
//        the Authorization: Bearer <access_token> header must belong to a
//        real Supabase Auth session (see _shared/auth.ts), so an order can
//        no longer be created by a browser that never completed the email
//        sign-in. This mirrors the "must sign in to check out" gate already
//        enforced in index.html — this is the server-side half of it, since
//        a client-side-only check can always be bypassed by calling the API
//        directly. Re-prices every line item against the live product
//        catalogue so a client-tampered price can never be stored or
//        invoiced. Assigns the sequential GST invoice number via Postgres's
//        nextval(), which is atomic under real concurrency — unlike the old
//        Blobs read-modify-write, two simultaneous checkouts genuinely
//        cannot collide. Computes the CGST/SGST/IGST tax breakdown and
//        sends the confirmation email, same as before.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { orderConfirmationEmail } from "../_shared/emailTemplates.ts";
import { getUser } from "../_shared/auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") || "luchpuch2026";
const SITE_URL = Deno.env.get("SITE_URL") || "";

// Keep these in sync with the GST / INVOICE CONFIG block in index.html.
const BUSINESS_STATE = "Jharkhand";
const GST_RATE = 5; // percent, applied to GST-inclusive prices
const ORDER_STATUSES = ["Confirmed", "Packed", "Shipped", "Out for Delivery", "Delivered"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

function clamp(str: unknown, max: number) {
  return String(str == null ? "" : str).trim().slice(0, max);
}

function sanitizeBilling(billing: any) {
  return {
    name: clamp(billing.name, 120),
    address: clamp(billing.address, 400),
    city: clamp(billing.city, 100),
    pin: clamp(billing.pin, 20),
    state: clamp(billing.state, 60),
    country: clamp(billing.country, 60),
    gstin: clamp(billing.gstin, 20),
  };
}

// A DB row's status/courier/awb/invoice_number are the source of truth
// (order-status updates only those columns, not the JSON blob) — so they
// get layered back over the stored order object on every read.
function rowToOrder(row: any) {
  return {
    ...row.data,
    status: row.status,
    courier: row.courier || undefined,
    awb: row.awb || undefined,
    invoiceNumber: row.invoice_number,
  };
}

function applyTax(order: any) {
  const isDomestic = order.currency === "INR";
  order.isExport = !isDomestic;
  const buyerState = (order.billing && order.billing.state) || "";
  const sameState = isDomestic && buyerState && buyerState === BUSINESS_STATE;

  let taxableTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
  order.items = order.items.map((item: any) => {
    if (!isDomestic) return { ...item, taxable: item.price, cgst: 0, sgst: 0, igst: 0 };
    const taxable = Math.round((item.price / (1 + GST_RATE / 100)) * 100) / 100;
    const tax = Math.round((item.price - taxable) * 100) / 100;
    const cgst = sameState ? Math.round((tax / 2) * 100) / 100 : 0;
    const sgst = sameState ? Math.round((tax / 2) * 100) / 100 : 0;
    const igst = sameState ? 0 : tax;
    taxableTotal += taxable; cgstTotal += cgst; sgstTotal += sgst; igstTotal += igst;
    return { ...item, taxable, cgst, sgst, igst };
  });
  order.taxSummary = isDomestic
    ? {
        taxableTotal: Math.round(taxableTotal * 100) / 100,
        cgstTotal: Math.round(cgstTotal * 100) / 100,
        sgstTotal: Math.round(sgstTotal * 100) / 100,
        igstTotal: Math.round(igstTotal * 100) / 100,
        gstRate: GST_RATE,
        sameState,
      }
    : null;
  return order;
}

// Re-prices every line item against the real product catalogue, so a
// customer can never buy at a price they edited client-side. Any item that
// no longer matches a real product causes the whole order to be rejected.
async function repriceFromCatalogue(order: any) {
  const { data, error } = await supabase.from("kv_store").select("value").eq("key", "products").maybeSingle();
  if (error) throw error;
  const products = data ? data.value : [];

  const repriced = [];
  for (const item of order.items) {
    const product = products[item.id];
    if (!product || product.name !== item.name) {
      return { error: `"${item.name || "An item"}" in your bag no longer matches our catalogue — please refresh and re-add it.` };
    }
    repriced.push({
      ...item,
      name: product.name,
      cat: product.cat,
      mood: product.mood,
      price: product.price,
      img: product.img,
      hsn: product.hsn || item.hsn,
    });
  }
  order.items = repriced;
  order.total = repriced.reduce((s: number, it: any) => s + it.price, 0);
  return { order };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const adminKey = req.headers.get("x-admin-key") || "";
    if (adminKey === ADMIN_KEY) {
      const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json(data.map(rowToOrder));
    }

    const email = (url.searchParams.get("email") || "").trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      return json({ error: "Provide a valid ?email= to look up orders" }, 400);
    }
    const { data, error } = await supabase.from("orders").select("*").eq("email", email).order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json(data.map(rowToOrder));
  }

  if (req.method === "POST") {
    const user = await getUser(req);
    if (!user) return json({ error: "Sign in before placing an order" }, 401);

    let order: any;
    try {
      order = await req.json();
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      return json({ error: "Expected a single order object" }, 400);
    }
    if (!order.id || !order.email || !isValidEmail(order.email) || !Array.isArray(order.items) || order.items.length === 0) {
      return json({ error: "Order is missing required fields (id, email, items)" }, 400);
    }
    if (!order.billing || !order.billing.name || !order.billing.address || !order.billing.city) {
      return json({ error: "Order is missing billing details required for the invoice" }, 400);
    }

    const repriceResult = await repriceFromCatalogue(order);
    if (repriceResult.error) return json({ error: repriceResult.error }, 409);
    order = repriceResult.order;
    order.billing = sanitizeBilling(order.billing);
    order.email = order.email.toLowerCase().trim();
    order.currency = order.currency === "USD" ? "USD" : "INR";

    const { data: invoiceNumber, error: invoiceErr } = await supabase.rpc("next_invoice_number");
    if (invoiceErr) return json({ error: invoiceErr.message }, 500);
    order.invoiceNumber = invoiceNumber;
    order.invoiceDate = order.date;
    order.status = ORDER_STATUSES[0];
    order.statusUpdatedAt = order.date;
    order.userId = user.id; // links the order to the signed-in customer, independent of order.email
    applyTax(order);

    const { error: insertErr } = await supabase.from("orders").insert({
      id: order.id,
      email: order.email.toLowerCase(),
      status: order.status,
      invoice_number: order.invoiceNumber,
      total: order.total,
      currency: order.currency || "INR",
      data: order,
    });
    if (insertErr) return json({ error: insertErr.message }, 500);

    // Email failure should never fail the order — it already saved above.
    sendEmail({
      to: order.email,
      subject: `Order confirmed — ${order.invoiceNumber}`,
      html: orderConfirmationEmail(SITE_URL, order),
    }).catch(() => {});

    return json({ ok: true, order });
  }

  return json({ error: "Method not allowed" }, 405);
});
