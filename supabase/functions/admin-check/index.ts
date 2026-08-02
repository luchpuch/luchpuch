// supabase/functions/admin-check/index.ts
//
// GET with header "x-admin-key" -> 200 if it matches ADMIN_KEY, else 401.
// Same logic as netlify/functions/admin-check.mjs, unchanged.
import { corsHeaders } from "../_shared/cors.ts";

const ADMIN_KEY = Deno.env.get("ADMIN_KEY") || "luchpuch2026";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const key = req.headers.get("x-admin-key") || "";
  if (key === ADMIN_KEY) return json({ ok: true });
  return json({ ok: false }, 401);
});
