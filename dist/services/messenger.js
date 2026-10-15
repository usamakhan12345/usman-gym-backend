"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.outbox = void 0;
exports.channelFor = channelFor;
exports.deliver = deliver;
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../config/env");
/** Messages captured by the `memory` provider (tests only). */
exports.outbox = [];
let smtp = null;
const getSmtp = () => {
    if (!env_1.env.SMTP_HOST)
        throw new Error('SMTP_HOST is not configured');
    smtp ??= nodemailer_1.default.createTransport({
        host: env_1.env.SMTP_HOST,
        port: env_1.env.SMTP_PORT,
        secure: env_1.env.SMTP_PORT === 465,
        auth: env_1.env.SMTP_USER ? { user: env_1.env.SMTP_USER, pass: env_1.env.SMTP_PASS } : undefined,
    });
    return smtp;
};
async function sendTwilioSms(to, body) {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env_1.env;
    if (!sid || !token || !from)
        throw new Error('Twilio is not configured');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!res.ok)
        throw new Error(`Twilio responded with ${res.status}`);
}
/** Which channel the configured provider can deliver on. */
function channelFor(user) {
    switch (env_1.env.OTP_PROVIDER) {
        case 'smtp':
            return user.email ? { channel: 'EMAIL', to: user.email } : null;
        case 'twilio':
            return { channel: 'SMS', to: user.phone };
        default:
            return user.email ? { channel: 'EMAIL', to: user.email } : { channel: 'SMS', to: user.phone };
    }
}
/** Throws when delivery fails - callers must not report success in that case. */
async function deliver(msg) {
    switch (env_1.env.OTP_PROVIDER) {
        case 'smtp':
            await getSmtp().sendMail({ from: env_1.env.SMTP_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
            return;
        case 'twilio':
            await sendTwilioSms(msg.to, msg.text);
            return;
        case 'memory':
            exports.outbox.push(msg);
            return;
        case 'console':
            console.log(`\n[DEV-ONLY MESSAGE via ${msg.channel}] to=${msg.to}\n  ${msg.subject}\n  ${msg.text}\n`);
            return;
    }
}
