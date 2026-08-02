// supabase/functions/products/index.ts
//
// GET  -> full product catalogue (public).
// POST -> replaces the full catalogue. Requires x-admin-key.
// Same logic as netlify/functions/products.mjs, storage swapped from
// Netlify Blobs to a single row in the kv_store table.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    const { data, error } = await supabase.from("kv_store").select("value").eq("key", "products").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json(data ? data.value : []);
  }

  if (req.method === "POST") {
    const key = req.headers.get("x-admin-key") || "";
    if (key !== ADMIN_KEY) return json({ error: "Unauthorized" }, 401);

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (!Array.isArray(body)) return json({ error: "Expected an array of products" }, 400);

    const { error } = await supabase
      .from("kv_store")
      .upsert({ key: "products", value: body, updated_at: new Date().toISOString() });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, count: body.length });
  }

  return json({ error: "Method not allowed" }, 405);
});
