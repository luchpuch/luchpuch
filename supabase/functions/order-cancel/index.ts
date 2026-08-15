// supabase/functions/order-cancel/index.ts
//
// POST {id, reason} with Authorization: Bearer <access_token> -> lets a
// signed-in customer cancel ONE OF THEIR OWN orders, as long as it hasn't
// shipped yet. Unlike order-status (admin-only, x-admin-key), this route
// is customer-facing: it verifies the caller is a real signed-in user
// (_shared/auth.ts) AND that the order actually belongs to them, either via
// order.userId (set on every order placed since sign-in was required) or a
// case-insensitive match on the order's email (covers older orders placed
// before userId existed). Sets refund_status to "Requested" so the admin
// dashboard has something to work from — the actual refund is still a
// manual step for now, this just starts the paper trail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { statusUpdateEmail } from "../_shared/emailTemplates.ts";
import { getUser } from "../_shared/auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE_URL = Deno.env.get("SITE_URL") || "";

// Once an order reaches any of these, it's too far along to self-cancel —
// the customer should contact support instead.
const CANCELLABLE_STATUSES = ["Confirmed", "Packed"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(str: unknown, max: number) {
  return String(str == null ? "" : str).trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await getUser(req);
  if (!user) return json({ error: "Sign in to cancel an order" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const id = clamp(body?.id, 100);
  const reason = clamp(body?.reason, 300);
  if (!id) return json({ error: "Missing order id" }, 400);
  if (!reason) return json({ error: "Tell us why you're cancelling — pick or type a reason" }, 400);

  const { data: existing, error: fetchErr } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!existing) return json({ error: "Order not found" }, 404);

  const ownsOrder =
    (existing.data && existing.data.userId && existing.data.userId === user.id) ||
    (existing.email && user.email && existing.email.toLowerCase() === user.email.toLowerCase());
  if (!ownsOrder) return json({ error: "This order doesn't belong to your account" }, 403);

  if (existing.status === "Cancelled") {
    return json({ error: "This order is already cancelled" }, 409);
  }
  if (!CANCELLABLE_STATUSES.includes(existing.status)) {
    return json({ error: `This order can no longer be cancelled — it's already "${existing.status}". Contact us if you need help.` }, 409);
  }

  const { error: updateErr } = await supabase
    .from("orders")
    .update({ status: "Cancelled", cancel_reason: reason, refund_status: "Requested" })
    .eq("id", id);
  if (updateErr) return json({ error: updateErr.message }, 500);

  const order = {
    ...existing.data,
    status: "Cancelled",
    cancelReason: reason,
    refundStatus: "Requested",
    id: existing.id,
    email: existing.email,
  };

  sendEmail({
    to: order.email,
    subject: `Order cancelled — ${order.invoiceNumber || order.id}`,
    html: statusUpdateEmail(SITE_URL, order),
  }).catch(() => {});

  return json({ ok: true, order });
});
