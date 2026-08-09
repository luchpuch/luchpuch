// supabase/functions/_shared/auth.ts
//
// Verifies the Supabase Auth JWT sent by the frontend (Authorization:
// Bearer <access_token>, set via `getAccessToken()` in index.html) and,
// for admin-only routes, checks profiles.is_admin. Replaces the old
// shared-passcode (x-admin-key) check used before the login system.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Service-role client: only used here to (a) verify a token belongs to a
// real user and (b) look up that user's profile — never exposed to the client.
const adminClient = createClient(supabaseUrl, serviceKey);

// Returns the authenticated user for this request, or null if the
// Authorization header is missing/invalid/expired.
export async function getUser(req: Request) {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// Returns the authenticated user only if their profile has is_admin = true,
// otherwise null. Use this to gate every admin-only edge function route.
export async function requireAdmin(req: Request) {
  const user = await getUser(req);
  if (!user) return null;
  const { data, error } = await adminClient
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data?.is_admin) return null;
  return user;
}
