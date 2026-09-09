type MailInput = { to: string; subject: string; html: string; text: string };

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const emailFrom = process.env.EMAIL_FROM?.trim();
const appWebUrl = process.env.APP_WEB_URL?.trim();
if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && (!resendApiKey || !emailFrom || !appWebUrl)) {
  throw new Error('RESEND_API_KEY, EMAIL_FROM and APP_WEB_URL are required when email verification is enabled');
}
if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !appWebUrl?.startsWith('https://')) throw new Error('APP_WEB_URL must be HTTPS in production');

/**
 * Email delivery is deliberately tiny and provider-agnostic. Resend is used
 * when configured, while local/test environments log a safe preview and let
 * the API return the one-time token to the smoke harness.
 */
export async function sendTransactionalEmail(input: MailInput) {
  if (!resendApiKey || !emailFrom) {
    if (process.env.NODE_ENV === 'production') throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
    console.info(`[email:dev] ${input.subject} -> ${input.to}\n${input.text}`);
    return { delivered: false as const };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: emailFrom, to: [input.to], subject: input.subject, html: input.html, text: input.text })
  });
  if (!response.ok) throw new Error('EMAIL_DELIVERY_FAILED');
  return { delivered: true as const };
}

export function verificationUrl(token: string) {
  const base = (process.env.APP_WEB_URL?.trim() || process.env.PUBLIC_API_URL?.trim() || 'http://localhost:8081').replace(/\/$/, '');
  return `${base}/verify-email?token=${encodeURIComponent(token)}`;
}

export function passwordResetUrl(token: string) {
  const base = (process.env.APP_WEB_URL?.trim() || process.env.PUBLIC_API_URL?.trim() || 'http://localhost:8081').replace(/\/$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}
