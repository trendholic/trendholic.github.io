// send-email — transactional notifications via Resend.
// NOTIFICATION ONLY: never part of auth. Invoked by a DB webhook (on
// notifications insert) or by other edge functions, authenticated with a
// shared WEBHOOK_SECRET header. Secrets live only in Edge Function env.
//
// Required secrets (set in Supabase dashboard, NEVER in the browser/repo):
//   RESEND_API_KEY, RESEND_FROM, WEBHOOK_SECRET, ADMIN_NOTIFY_EMAILS (csv)

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }

  const { to, subject, html, text } = await req.json().catch(() => ({}));
  if (!to || !subject) return new Response("missing to/subject", { status: 400 });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM"),
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html ?? undefined,
      text: text ?? undefined,
    }),
  });

  if (!resp.ok) {
    // Email failure must never break the app; log and 200 so a DB webhook
    // does not retry-storm. Authorization/state remain DB-authoritative.
    console.error("resend error", resp.status, await resp.text());
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
