// supabase/functions/_shared/cors.ts
//
// Your site (GitHub Pages) and your API (Supabase Edge Functions) are now
// on different domains — something Netlify Functions never had to deal
// with, since everything was same-origin under your own site. Without
// these headers, every fetch() from index.html would be silently blocked
// by the browser.
//
// "*" works everywhere but lets ANY website call your functions, not just
// yours — fine while you're setting this up, but once your GitHub Pages
// URL is final, tighten this to that exact origin, e.g.
// "https://yourusername.github.io" (no trailing slash/path).
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
