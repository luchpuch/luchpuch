// supabase/functions/_shared/emailTemplates.ts
//
// Ported unchanged from your netlify/functions/lib/emailTemplates.mjs —
// these were already pure template functions with no Node-specific APIs,
// so nothing needed to change beyond the file extension.

function escapeHtml(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(order: any, amount: number) {
  return order.currency === "USD" ? `$${(amount / 88).toFixed(2)}` : `₹${amount}`;
}

function itemsHtml(order: any) {
  return order.items
    .map(
      (it: any) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;">
          ${escapeHtml(it.name)}${it.size ? ` <span style="color:#888;">(Size: ${escapeHtml(it.size)})</span>` : ""}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">
          ${money(order, it.price)}
        </td>
      </tr>`
    )
    .join("");
}

function wrapper(siteUrl: string, order: any, bodyHtml: string) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#2a221c;">
    <div style="padding:28px 0 18px;border-bottom:2px solid #2a221c;">
      <div style="font-size:20px;font-weight:bold;">Luchpuch</div>
    </div>
    <div style="padding:24px 0;">
      ${bodyHtml}
      <table style="width:100%;border-collapse:collapse;margin-top:18px;">
        ${itemsHtml(order)}
      </table>
      <table style="width:100%;margin-top:10px;">
        <tr>
          <td style="font-weight:bold;padding-top:10px;border-top:1.5px solid #2a221c;">Total</td>
          <td style="font-weight:bold;text-align:right;padding-top:10px;border-top:1.5px solid #2a221c;">${money(order, order.total)}</td>
        </tr>
      </table>
      <p style="margin-top:26px;">
        <a href="${siteUrl}/#track-${encodeURIComponent(order.email)}" style="background:#2a221c;color:#fff;text-decoration:none;padding:11px 22px;border-radius:100px;display:inline-block;font-size:14px;">Track this order</a>
      </p>
    </div>
    <div style="padding:18px 0;border-top:1px solid #eee;color:#888;font-size:12px;">
      Order ref: ${order.id} · Invoice: ${order.invoiceNumber || "—"}
    </div>
  </div>`;
}

export function orderConfirmationEmail(siteUrl: string, order: any) {
  const body = `
    <p>Thanks for your order! Here's what we've got:</p>
    <p style="color:#666;font-size:13px;">Order ${order.id} · Placed ${new Date(order.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>`;
  return wrapper(siteUrl, order, body);
}

const STATUS_COPY: Record<string, string> = {
  Confirmed: "Your order has been confirmed.",
  Packed: "Your order has been packed and is getting ready to ship.",
  Shipped: "Your order is on its way!",
  "Out for Delivery": "Your order is out for delivery today.",
  Delivered: "Your order has been delivered. We hope you love it!",
};

export function statusUpdateEmail(siteUrl: string, order: any) {
  const line = STATUS_COPY[order.status] || `Your order status is now: ${order.status}`;
  const trackingLine = order.awb
    ? `<p style="color:#666;font-size:13px;">Shipped via ${escapeHtml(order.courier || "our courier partner")} — AWB / tracking no. <b>${escapeHtml(order.awb)}</b></p>`
    : "";
  const body = `
    <p style="font-size:16px;"><b>${line}</b></p>
    <p style="color:#666;font-size:13px;">Order ${order.id}</p>
    ${trackingLine}`;
  return wrapper(siteUrl, order, body);
}
