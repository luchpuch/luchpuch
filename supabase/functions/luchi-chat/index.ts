// supabase/functions/luchi-chat/index.ts
//
// Backend for Luchi, ported from netlify/functions/luchi-chat.mjs. Same
// Gemini 3.6 Flash model, same catalogue-grounding + order-lookup tool,
// same abuse guards — only the storage calls changed (kv_store for the
// catalogue, the orders table for lookups instead of a single Blobs array).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = "gemini-3.6-flash";
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") || "hello@luchpuch.com";

const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 1200;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadCatalogueSummary() {
  const { data } = await supabase.from("kv_store").select("value").eq("key", "products").maybeSingle();
  const products = data ? data.value : [];
  if (!products.length) return "The catalogue is currently empty — let the customer know new designs are coming soon.";
  return products
    .map((p: any) => `#${p.id} | ${p.name} | category: ${p.cat} | mood: ${p.mood} | ₹${p.price} | sizes: ${(p.sizes || []).join(", ")}`)
    .join("\n");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function lookupOrder(email: string, orderId?: string) {
  if (!email || !isValidEmail(email)) {
    return { error: "Need a valid email address to look up orders." };
  }
  let query = supabase.from("orders").select("*").eq("email", email.toLowerCase());
  if (orderId) query = query.ilike("id", orderId);
  const { data, error } = await query;
  if (error || !data || !data.length) return { found: false };
  return {
    found: true,
    orders: data.map((row: any) => ({
      id: row.id,
      status: row.status || "Confirmed",
      date: row.data.date,
      total: row.total,
      currency: row.currency,
      items: (row.data.items || []).map((it: any) => ({ name: it.name, size: it.size, price: it.price })),
    })),
  };
}

const LOOKUP_TOOL = {
  name: "lookup_order",
  description: "Look up a customer's real order(s) by email, optionally narrowed to one order ID. Use this whenever a customer asks about order status, tracking, or delivery — never guess or invent order info.",
  parameters: {
    type: "OBJECT",
    properties: {
      email: { type: "STRING", description: "The customer's email address, exactly as they gave it." },
      orderId: { type: "STRING", description: "Optional specific order ID, e.g. LP7K3M9Q, if the customer provided one." },
    },
    required: ["email"],
  },
};

function buildSystemPrompt(catalogueSummary: string) {
  return `You are Luchi, the friendly shopping assistant for Luchpuch — an Indian streetwear/loungewear brand. Every design is built around a "mood" (like "Lazy but happy"), across categories: Tees, Sleeveless, Trousers, Shorts.

Tone: warm, playful, concise. Usually 1-4 sentences. Use light emoji sparingly, not every message.

STRICT RULES:
- Only recommend or describe products that appear in CURRENT CATALOGUE below. Never invent a product, price, mood, or size that isn't listed there — the catalogue changes, so trust only what's given to you right now, not anything you might remember from earlier in the conversation.
- To link to a product, write it like this: [Product Name](#product-ID) — using the #ID exactly as given in the catalogue.
- For anything about a specific order's status, tracking, or delivery: use the lookup_order tool. Ask for the customer's email (and order ID if they have it) if you don't already have it in the conversation. Never guess a status.
- You cannot place orders, modify carts, cancel orders, or change addresses yourself. For anything beyond looking up status, point the customer to Track Order (#track) for invoices, or ${SUPPORT_EMAIL} for anything you can't resolve.
- Sizing: point to the Size Guide (#fit) for measurements — you don't have exact body-measurement charts yourself, only the sizes each product is offered in.
- Shipping: within India via Razorpay (UPI/cards/netbanking/COD), international via PayPal (charged in USD).
- If asked something with nothing to do with Luchpuch or shopping, gently redirect back to how you can help with their mood or order today.

CURRENT CATALOGUE:
${catalogueSummary}`;
}

function toGeminiContents(history: { role: string; content: string }[]) {
  return history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!GEMINI_API_KEY) {
    return json({
      reply: "Hey, I'm Luchi — but I'm not quite switched on yet (the store owner still needs to connect my API key). Try Track Order (#track) or the Size Guide (#fit) in the meantime!",
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  let history = Array.isArray(body.messages) ? body.messages : [];
  history = history
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  if (!history.length || history[history.length - 1].role !== "user") {
    return json({ error: "Expected a trailing user message" }, 400);
  }

  const catalogueSummary = await loadCatalogueSummary();
  const systemInstruction = { parts: [{ text: buildSystemPrompt(catalogueSummary) }] };

  let contents: any = toGeminiContents(history);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    for (let round = 0; round < 3; round++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: systemInstruction,
          contents,
          tools: [{ function_declarations: [LOOKUP_TOOL] }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.log(`[luchi-chat] Gemini API error ${res.status}: ${errText}`);
        if (res.status === 429) {
          return json({ reply: "I'm getting a lot of questions right now and hit my limit for the moment — try again in a minute, or use Track Order (#track) for order status." });
        }
        return json({ reply: "Sorry, I'm having a bit of trouble thinking right now — try again in a moment, or use Track Order (#track) for order status." });
      }

      const data = await res.json();
      const candidate = data.candidates && data.candidates[0];
      const parts = (candidate && candidate.content && candidate.content.parts) || [];
      const functionCallPart = parts.find((p: any) => p.functionCall);

      if (functionCallPart) {
        contents.push({ role: "model", parts });
        const { name, args } = functionCallPart.functionCall;
        let result;
        if (name === "lookup_order") {
          result = await lookupOrder(args.email, args.orderId);
        } else {
          result = { error: "Unknown tool" };
        }
        contents.push({
          role: "function",
          parts: [{ functionResponse: { name, response: result } }],
        });
        continue;
      }

      const textPart = parts.find((p: any) => typeof p.text === "string");
      return json({ reply: textPart ? textPart.text : "Sorry, I didn't quite catch that — could you rephrase?" });
    }
    return json({ reply: "Sorry, that took a bit long to figure out — could you try asking again, maybe a little more simply?" });
  } catch (e) {
    console.log(`[luchi-chat] error: ${(e as Error).message}`);
    return json({ reply: "Sorry, I'm having trouble connecting right now — try Track Order (#track) instead." });
  }
});
