import { ekartService } from "../_shared/ekart.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const token = await ekartService.getAccessToken();
    return new Response(
      JSON.stringify({ success: true, message: "Ekart authentication successful", token_preview: token.substring(0, 20) + "..." }),
      {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        status: 200
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, message: "Ekart authentication failed", error: error.message }),
      {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        status: 500
      }
    );
  }
});