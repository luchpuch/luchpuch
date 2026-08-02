// supabase/functions/order-status/index.ts
//
// POST {id, status?, courier?, awb?} with header "x-admin-key" -> updates
// only the fields provided. Emails the customer only when status actually
// changes (a tracking-only save shouldn't re-notify them). Same logic as
// netlify/functions/order-status.mjs — updates just the indexed columns,
// no need to read/rewrite the whole order's JSON blob.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { statusUpdateEmail } from "../_shared/emailTemplates.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") || "luchpuch2026";
const SITE_URL = Deno.env.get("SITE_URL") || "";
const ORDER_STATUSES = ["Confirmed", "Packed", "Shipped", "Out for Delivery", "Delivered"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const key = req.headers.get("x-admin-key") || "";
  if (key !== ADMIN_KEY) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { id, status, courier, awb } = body || {};
  if (!id) return json({ error: "Missing order id" }, 400);
  if (status !== undefined && !ORDER_STATUSES.includes(status)) {
    return json({ error: `status must be one of: ${ORDER_STATUSES.join(", ")}` }, 400);
  }
  if (status === undefined && courier === undefined && awb === undefined) {
    return json({ error: "Nothing to update — provide status, courier, and/or awb" }, 400);
  }

  const { data: existing, error: fetchErr } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!existing) return json({ error: "Order not found" }, 404);

  const statusChanged = status !== undefined && status !== existing.status;
  const newStatus = status !== undefined ? status : existing.status;
  const newCourier = courier !== undefined ? courier : existing.courier;
  const newAwb = awb !== undefined ? awb : existing.awb;

  const { error: updateErr } = await supabase
    .from("orders")
    .update({ status: newStatus, courier: newCourier, awb: newAwb })
    .eq("id", id);
  if (updateErr) return json({ error: updateErr.message }, 500);

  const order = { ...existing.data, status: newStatus, courier: newCourier, awb: newAwb, id: existing.id, email: existing.email };

  if (statusChanged) {
    sendEmail({
      to: order.email,
      subject: `Order update — ${order.status}`,
      html: statusUpdateEmail(SITE_URL, order),
    }).catch(() => {});
  }

  return json({ ok: true, order });
});
