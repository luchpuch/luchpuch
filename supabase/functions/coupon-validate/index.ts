import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getUser } from "../_shared/auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") || "luchpuch2026";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeCode(code: string): string {
  return code.toUpperCase().trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "POST") {
    // Get user for customer-specific limits (optional for guest checkout)
    const user = await getUser(req);
    const customerEmail = user?.email?.toLowerCase() || "";

    let body: { couponCode: string; cartTotal: number; cartItems: Array<{ id: number; name: string; cat: string; price: number }> };
    try {
      body = await req.json();
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.couponCode || typeof body.couponCode !== "string") {
      return json({ error: "Coupon code is required" }, 400);
    }

    if (typeof body.cartTotal !== "number" || body.cartTotal < 0) {
      return json({ error: "Valid cart total is required" }, 400);
    }

    if (!Array.isArray(body.cartItems)) {
      return json({ error: "Cart items array is required" }, 400);
    }

    const code = normalizeCode(body.couponCode);

    // Fetch coupon from database
    const { data: couponData, error: couponError } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", code)
      .single();

    if (couponError) {
      return json({ error: "Invalid coupon code" }, 404);
    }

    if (!couponData) {
      return json({ error: "Invalid coupon code" }, 404);
    }

    const coupon = couponData;

    // Check if coupon is active
    if (!coupon.is_active) {
      return json({ error: "This coupon is no longer active" }, 400);
    }

    // Check if coupon has started
    if (coupon.starts_at && new Date(coupon.starts_at) > new Date()) {
      return json({ error: "This coupon is not yet active" }, 400);
    }

    // Check if coupon has expired
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return json({ error: "This coupon has expired" }, 400);
    }

    // Check usage limit
    if (coupon.usage_limit !== null) {
      const { count } = await supabase
        .from("coupon_usage")
        .select("id", { count: "exact" })
        .eq("coupon_id", coupon.id);

      if (count && count >= coupon.usage_limit) {
        return json({ error: "This coupon has reached its usage limit" }, 400);
      }
    }

    // Check per-customer limit (if user is signed in)
    if (customerEmail && coupon.per_customer_limit !== null) {
      const { count } = await supabase
        .from("coupon_usage")
        .select("id", { count: "exact" })
        .eq("coupon_id", coupon.id)
        .eq("customer_email", customerEmail);

      if (count && count >= coupon.per_customer_limit) {
        return json({ error: "You have already used this coupon the maximum number of times" }, 400);
      }
    }

    // Check minimum order value
    if (body.cartTotal < coupon.minimum_order_value) {
      return json({
        error: `Minimum order value of ₹${coupon.minimum_order_value} required`
      }, 400);
    }

    // Check product/category eligibility
    let eligibleItems = body.cartItems;
    let hasIneligibleItem = false;

    // Check applicable products
    if (coupon.applicable_products && coupon.applicable_products.length > 0) {
      eligibleItems = eligibleItems.filter(item =>
        coupon.applicable_products?.includes(item.id.toString())
      );
    }

    // Check applicable categories
    if (coupon.applicable_categories && coupon.applicable_categories.length > 0) {
      eligibleItems = eligibleItems.filter(item =>
        coupon.applicable_categories?.includes(item.cat)
      );
    }

    // Check excluded products
    if (coupon.excluded_products && coupon.excluded_products.length > 0) {
      eligibleItems = eligibleItems.filter(item =>
        !coupon.excluded_products?.includes(item.id.toString())
      );
    }

    // Check excluded categories
    if (coupon.excluded_categories && coupon.excluded_categories.length > 0) {
      eligibleItems = eligibleItems.filter(item =>
        !coupon.excluded_categories?.includes(item.cat)
      );
    }

    // If any items were filtered out, the coupon doesn't apply to the entire cart
    if (eligibleItems.length !== body.cartItems.length) {
      return json({
        error: "This coupon is not applicable to some items in your cart"
      }, 400);
    }

    // Calculate discount
    let discountAmount = 0;
    const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + item.price, 0);

    if (coupon.discount_type === "fixed") {
      discountAmount = Math.min(coupon.discount_value, eligibleSubtotal);
    } else if (coupon.discount_type === "percentage") {
      discountAmount = Math.round((eligibleSubtotal * coupon.discount_value) / 100);

      // Apply maximum discount if set
      if (coupon.maximum_discount !== null) {
        discountAmount = Math.min(discountAmount, coupon.maximum_discount);
      }
    }

    // Ensure discount doesn't exceed eligible subtotal
    discountAmount = Math.min(discountAmount, eligibleSubtotal);

    const finalTotal = Math.max(0, eligibleSubtotal - discountAmount);

    return json({
      valid: true,
      couponCode: coupon.code,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      discountAmount,
      subtotal: eligibleSubtotal,
      finalTotal,
      description: coupon.description || undefined
    });
  }

  return json({ error: "Method not allowed" }, 405);
});