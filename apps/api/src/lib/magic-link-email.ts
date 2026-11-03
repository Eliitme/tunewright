/** Login email: web gets a link plus a code, the Mac app gets only a code. */
import type { Env } from "../env.ts";

export interface LoginMail {
  to: string;
  code: string;
  /** Present for web logins only. */
  link?: string;
}

export interface Mailer {
  sendLogin(mail: LoginMail): Promise<void>;
}

export function buildLoginMail({ code, link }: LoginMail) {
  const subject = `Tunewright sign-in code: ${code}`;
  const linkText = link ? `Open this link to sign in:\n${link}\n\nOr enter this code: ${code}` : `Enter this code in the app: ${code}`;
  const text = `${linkText}\n\nThe code expires in 15 minutes. If you did not ask to sign in, ignore this email.`;
  const button = link
    ? `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">Sign in to Tunewright</a></p><p>Or enter this code:</p>`
    : `<p>Enter this code in the app:</p>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px">${button}<p style="font-size:28px;letter-spacing:6px;font-weight:600">${code}</p><p style="color:#666">The code expires in 15 minutes. If you did not ask to sign in, ignore this email.</p></div>`;
  return { subject, text, html };
}

export function emailBindingMailer(env: Env): Mailer {
  return {
    async sendLogin(mail) {
      const { subject, text, html } = buildLoginMail(mail);
      await env.EMAIL.send({ to: mail.to, from: { email: env.MAIL_FROM, name: "Tunewright" }, subject, text, html });
    },
  };
}
