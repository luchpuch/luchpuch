// supabase/functions/_shared/email.ts
//
// Same logic as lib/email.mjs — only process.env.X became Deno.env.get("X").
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Luchpuch <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY) {
    console.log(`[email skipped — no RESEND_API_KEY set] "${subject}" to ${to}`);
    return { skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.log(`[email failed ${res.status}] ${text}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.log(`[email error] ${(e as Error).message}`);
    return { ok: false };
  }
}
