import nodemailer, { Transporter } from 'nodemailer';
import { OtpChannel } from '@prisma/client';
import { env } from '../config/env';

export interface OutgoingMessage {
  channel: OtpChannel;
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body (EMAIL only). `text` is always sent as the plain-text alternative. */
  html?: string;
}

/** Messages captured by the `memory` provider (tests only). */
export const outbox: OutgoingMessage[] = [];

let smtp: Transporter | null = null;
const getSmtp = () => {
  if (!env.SMTP_HOST) throw new Error('SMTP_HOST is not configured');
  smtp ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return smtp;
};

async function sendTwilioSms(to: string, body: string) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env;
  if (!sid || !token || !from) throw new Error('Twilio is not configured');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio responded with ${res.status}`);
}

/** Which channel the configured provider can deliver on. */
export function channelFor(user: { email: string | null; phone: string }): { channel: OtpChannel; to: string } | null {
  switch (env.OTP_PROVIDER) {
    case 'smtp':
      return user.email ? { channel: 'EMAIL', to: user.email } : null;
    case 'twilio':
      return { channel: 'SMS', to: user.phone };
    default:
      return user.email ? { channel: 'EMAIL', to: user.email } : { channel: 'SMS', to: user.phone };
  }
}

/** Throws when delivery fails - callers must not report success in that case. */
export async function deliver(msg: OutgoingMessage): Promise<void> {
  switch (env.OTP_PROVIDER) {
    case 'smtp':
      await getSmtp().sendMail({ from: env.SMTP_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
      return;
    case 'twilio':
      await sendTwilioSms(msg.to, msg.text);
      return;
    case 'memory':
      outbox.push(msg);
      return;
    case 'console':
      console.log(
        `\n[DEV-ONLY MESSAGE via ${msg.channel}] to=${msg.to}\n  ${msg.subject}\n  ${msg.text}\n`,
      );
      return;
  }
}

