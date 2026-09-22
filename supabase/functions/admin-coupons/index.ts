import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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

// Verify admin access
async function verifyAdmin(req: Request): Promise<boolean> {
  const key = req.headers.get("x-admin-key") || "";
  return key === ADMIN_KEY;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify admin access for all methods
  if (!(await verifyAdmin(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (req.method === "GET") {
    // Get all coupons with optional filtering
    const url = new URL(req.url);
    const activeOnly = url.searchParams.get("active") === "true";
    const expiredOnly = url.searchParams.get("expired") === "true";
    const inactiveOnly = url.searchParams.get("inactive") === "true";

    let query = supabase.from("coupons").select("*");

    if (activeOnly) {
      query = query.eq("is_active", true);
    } else if (inactiveOnly) {
      query = query.eq("is_active", false);
    } else if (expiredOnly) {
      query = query.lt("expires_at", new Date().toISOString());
    }

    // Order by creation date newest first
    query = query.order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error) return json({ error: error.message }, 500);

    // Add usage count for each coupon
    const couponsWithUsage = await Promise.all(
      (data || []).map(async (coupon) => {
        const { count } = await supabase
          .from("coupon_usage")
          .select("id", { count: "exact" })
          .eq("coupon_id", coupon.id);

        return {
          ...coupon,
          usage_count: count || 0
        };
      })
    );

    return json(couponsWithUsage);
  }

  if (req.method === "POST") {
    // Create a new coupon
    let body: {
      code: string;
      description?: string;
      discount_type: "fixed" | "percentage";
      discount_value: number;
      minimum_order_value?: number;
      maximum_discount?: number;
      starts_at?: string;
      expires_at?: string;
      usage_limit?: number;
      per_customer_limit?: number;
      is_active?: boolean;
      applicable_products?: number[];
      applicable_categories?: string[];
      excluded_products?: number[];
      excluded_categories?: string[];
    };

    try {
      body = await req.json();
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.code || typeof body.code !== "string") {
      return json({ error: "Coupon code is required" }, 400);
    }

    if (!body.discount_type || !["fixed", "percentage"].includes(body.discount_type)) {
      return json({ error: "Valid discount type is required (fixed or percentage)" }, 400);
    }

    if (typeof body.discount_value !== "number" || body.discount_value < 0) {
      return json({ error: "Valid discount value is required" }, 400);
    }

    // Normalize code to uppercase
    const code = normalizeCode(body.code);

    // Check if coupon code already exists
    const { data: existingCoupon } = await supabase
      .from("coupons")
      .select("id")
      .eq("code", code)
      .single();

    if (existingCoupon) {
      return json({ error: "Coupon code already exists" }, 409);
    }

    // Set defaults
    const couponData = {
      code,
      description: body.description || null,
      discount_type: body.discount_type,
      discount_value: body.discount_value,
      minimum_order_value: body.minimum_order_value ?? 0,
      maximum_discount: body.maximum_discount ?? null,
      starts_at: body.starts_at ?? null,
      expires_at: body.expires_at ?? null,
      usage_limit: body.usage_limit ?? null,
      per_customer_limit: body.per_customer_limit ?? 1,
      is_active: body.is_active ?? true,
      applicable_products: body.applicable_products ?? null,
      applicable_categories: body.applicable_categories ?? null,
      excluded_products: body.excluded_products ?? null,
      excluded_categories: body.excluded_categories ?? null
    };

    const { data, error } = await supabase
      .from("coupons")
      .insert([couponData])
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, coupon: data }, 201);
  }

  if (req.method === "PUT") {
    // Update an existing coupon
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return json({ error: "Coupon ID is required" }, 400);
    }

    let body: Partial<{
      code: string;
      description?: string;
      discount_type: "fixed" | "percentage";
      discount_value: number;
      minimum_order_value?: number;
      maximum_discount?: number;
      starts_at?: string;
      expires_at?: string;
      usage_limit?: number;
      per_customer_limit?: number;
      is_active?: boolean;
      applicable_products?: number[];
      applicable_categories?: string[];
      excluded_products?: number[];
      excluded_categories?: string[];
    }>;

    try {
      body = await req.json();
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400);
    }

    // Check if coupon exists
    const { data: existingCoupon } = await supabase
      .from("coupons")
      .select("*")
      .eq("id", id)
      .single();

    if (!existingCoupon) {
      return json({ error: "Coupon not found" }, 404);
    }

    // Prepare update data
    const updateData: any = {};

    if (body.code !== undefined) {
      if (typeof body.code !== "string") {
        return json({ error: "Coupon code must be a string" }, 400);
      }
      const code = normalizeCode(body.code);

      // Check if another coupon with this code exists
      const { data: duplicate } = await supabase
        .from("coupons")
        .select("id")
        .eq("code", code)
        .neq("id", id)
        .single();

      if (duplicate) {
        return json({ error: "Coupon code already exists" }, 409);
      }

      updateData.code = code;
    }

    if (body.description !== undefined) updateData.description = body.description;
    if (body.discount_type !== undefined) {
      if (!["fixed", "percentage"].includes(body.discount_type)) {
        return json({ error: "Discount type must be fixed or percentage" }, 400);
      }
      updateData.discount_type = body.discount_type;
    }
    if (body.discount_value !== undefined) {
      if (typeof body.discount_value !== "number" || body.discount_value < 0) {
        return json({ error: "Discount value must be a positive number" }, 400);
      }
      updateData.discount_value = body.discount_value;
    }
    if (body.minimum_order_value !== undefined) {
      if (typeof body.minimum_order_value !== "number" || body.minimum_order_value < 0) {
        return json({ error: "Minimum order value must be a positive number" }, 400);
      }
      updateData.minimum_order_value = body.minimum_order_value;
    }
    if (body.maximum_discount !== undefined) {
      if (body.maximum_discount !== null && (typeof body.maximum_discount !== "number" || body.maximum_discount < 0)) {
        return json({ error: "Maximum discount must be a positive number or null" }, 400);
      }
      updateData.maximum_discount = body.maximum_discount;
    }
    if (body.starts_at !== undefined) updateData.starts_at = body.starts_at ?? null;
    if (body.expires_at !== undefined) updateData.expires_at = body.expires_at ?? null;
    if (body.usage_limit !== undefined) {
      if (body.usage_limit !== null && (typeof body.usage_limit !== "number" || body.usage_limit < 0)) {
        return json({ error: "Usage limit must be a positive number or null" }, 400);
      }
      updateData.usage_limit = body.usage_limit;
    }
    if (body.per_customer_limit !== undefined) {
      if (body.per_customer_limit !== null && (typeof body.per_customer_limit !== "number" || body.per_customer_limit < 0)) {
        return json({ error: "Per customer limit must be a positive number or null" }, 400);
      }
      updateData.per_customer_limit = body.per_customer_limit;
    }
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    if (body.applicable_products !== undefined) updateData.applicable_products = body.applicable_products ?? null;
    if (body.applicable_categories !== undefined) updateData.applicable_categories = body.applicable_categories ?? null;
    if (body.excluded_products !== undefined) updateData.excluded_products = body.excluded_products ?? null;
    if (body.excluded_categories !== undefined) updateData.excluded_categories = body.excluded_categories ?? null;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("coupons")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, coupon: data });
  }

  if (req.method === "DELETE") {
    // Delete a coupon
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return json({ error: "Coupon ID is required" }, 400);
    }

    // Check if coupon exists
    const { data: existingCoupon } = await supabase
      .from("coupons")
      .select("id")
      .eq("id", id)
      .single();

    if (!existingCoupon) {
      return json({ error: "Coupon not found" }, 404);
    }

    const { error } = await supabase
      .from("coupons")
      .delete()
      .eq("id", id);

    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, message: "Coupon deleted successfully" });
  }

  return json({ error: "Method not allowed" }, 405);
});