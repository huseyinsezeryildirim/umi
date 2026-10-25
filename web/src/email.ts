import type { AppEnv } from "./env";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends one email through the configured provider (EMAIL_PROVIDER):
 * - "resend": Resend's API (RESEND_API_KEY). Free: 3,000 a month, 100 a day.
 * - "brevo":  Brevo's API (BREVO_API_KEY). Free: 300 a day.
 * - "log" (default): nothing is sent; the email is printed to the Worker log, for local development.
 */
export async function sendEmail(env: AppEnv, email: Email): Promise<void> {
  const provider = String(env.EMAIL_PROVIDER || "log");
  const from = String(env.EMAIL_FROM || "Umi <hello@umi.cam>");
  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
    return;
  }
  if (provider === "brevo") {
    const match = /^(.*?)\s*<(.+)>$/.exec(from);
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": String(env.BREVO_API_KEY), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: match ? { name: match[1], email: match[2] } : { email: from },
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
      }),
    });
    if (!res.ok) throw new Error(`Brevo: ${res.status} ${await res.text()}`);
    return;
  }
  console.log(`[email] to=${email.to} subject="${email.subject}"\n${email.text}`);
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A plain, single-button email in Umi's look. */
export function buttonEmail(to: string, subject: string, intro: string, button: string, link: string, outro: string): Email {
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:440px;background:#fff;border-radius:20px;padding:32px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 20px;font-size:18px;font-weight:600">Umi</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#374151">${escape(intro)}</p>
<a href="${escape(link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 22px;border-radius:12px">${escape(button)}</a>
<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b7280">${escape(outro)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;word-break:break-all">${escape(link)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to, subject, html, text: `${intro}\n\n${button}: ${link}\n\n${outro}` };
}
