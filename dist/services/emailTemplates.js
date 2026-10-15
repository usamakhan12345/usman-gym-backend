"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteSms = exports.otpSms = void 0;
exports.otpEmail = otpEmail;
exports.inviteEmail = inviteEmail;
exports.notificationEmail = notificationEmail;
const env_1 = require("../config/env");
/**
 * Branded transactional emails (Usman Gym: black + yellow).
 * Built with tables and inline styles because email clients ignore external CSS and modern layout.
 */
const YELLOW = '#ffc700';
const BLACK = '#0a0a0b';
const INK = '#111214';
const GRAY = '#6c727b';
const LIGHT = '#f3f4f6';
const HEADING_FONT = "'Oswald', 'Arial Narrow', Impact, Arial, sans-serif";
const BODY_FONT = "'Inter', 'Segoe UI', Arial, Helvetica, sans-serif";
const escapeHtml = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function layout(opts) {
    const year = new Date().getFullYear();
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${LIGHT};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${LIGHT};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="background:${BLACK};padding:22px 28px;border-bottom:5px solid ${YELLOW};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${YELLOW};width:38px;height:38px;border-radius:6px;text-align:center;font-family:${HEADING_FONT};font-size:22px;font-weight:700;color:${BLACK};line-height:38px;">U</td>
          <td style="padding-left:12px;font-family:${HEADING_FONT};font-size:24px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff;">Usman <span style="color:${YELLOW};">Gym</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px 28px 8px;font-family:${BODY_FONT};color:${INK};font-size:16px;line-height:1.6;">
        ${opts.bodyHtml}
      </td></tr>
      <tr><td style="padding:8px 28px 28px;"></td></tr>
      <tr><td style="background:${BLACK};padding:20px 28px;font-family:${BODY_FONT};font-size:12px;line-height:1.6;color:#9aa0a8;text-align:center;">
        <strong style="color:#ffffff;letter-spacing:1px;text-transform:uppercase;">Build Strength. Build Discipline.</strong><br>
        &copy; ${year} Usman Gym. This is an automated message, please do not reply.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
const h1 = (text) => `<h1 style="margin:0 0 12px;font-family:${HEADING_FONT};font-size:30px;line-height:1.15;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BLACK};">${text}</h1>`;
const p = (text, extra = '') => `<p style="margin:0 0 16px;${extra}">${text}</p>`;
const OTP_COPY = {
    SIGNUP: {
        subject: 'Verify your Usman Gym account',
        title: 'Verify your account',
        intro: 'Welcome to Usman Gym! Use the code below to verify your email address and finish creating your account.',
    },
    PASSWORD_RESET: {
        subject: 'Reset your Usman Gym password',
        title: 'Password reset code',
        intro: 'We received a request to set or reset the password on your Usman Gym account. Enter the code below to continue.',
    },
};
function otpEmail(purpose, code) {
    const copy = OTP_COPY[purpose];
    const minutes = env_1.env.OTP_TTL_MINUTES;
    const digits = code
        .split('')
        .map((d) => `<td style="padding:0 3px;"><div style="width:42px;height:54px;line-height:54px;background:${BLACK};color:${YELLOW};font-family:${HEADING_FONT};font-size:30px;font-weight:700;text-align:center;border-radius:8px;">${escapeHtml(d)}</div></td>`)
        .join('');
    const bodyHtml = [
        h1(copy.title),
        p(copy.intro),
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;"><tr>${digits}</tr></table>`,
        `<p style="margin:0 0 20px;text-align:center;font-size:14px;color:${GRAY};">This code expires in <strong style="color:${INK};">${minutes} minutes</strong> and can be used once.</p>`,
        `<div style="background:${LIGHT};border-left:5px solid ${YELLOW};border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;color:${GRAY};">
       <strong style="color:${INK};">Never share this code.</strong> Usman Gym staff will never ask you for it. If you did not request it, you can safely ignore this email.
     </div>`,
    ].join('');
    return {
        subject: copy.subject,
        html: layout({ preheader: `Your verification code is ${code}`, title: copy.subject, bodyHtml }),
        text: `${copy.intro}\n\nYour verification code: ${code}\n\nIt expires in ${minutes} minutes and can be used once. Never share this code. If you did not request it, ignore this email.\n\n- Usman Gym`,
    };
}
function inviteEmail(gymId) {
    const url = `${env_1.env.APP_URL.replace(/\/$/, '')}/activate`;
    const bodyHtml = [
        h1('Welcome to the team'),
        p('The gym has registered your membership. Here is your Gym ID:'),
        `<div style="margin:0 0 20px;"><span style="display:inline-block;background:${YELLOW};color:${BLACK};font-family:${HEADING_FONT};font-size:30px;font-weight:700;letter-spacing:3px;padding:6px 20px;border-radius:6px;">${escapeHtml(gymId)}</span></div>`,
        p('Activate your online account to check your monthly fee status and payment history. You will set your own password, so we never send one.'),
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${YELLOW};border-radius:6px;">
       <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 30px;font-family:${HEADING_FONT};font-size:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${BLACK};text-decoration:none;">Activate my account</a>
     </td></tr></table>`,
        `<p style="margin:0 0 8px;font-size:14px;color:${GRAY};">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(url)}" style="color:${INK};word-break:break-all;">${escapeHtml(url)}</a></p>`,
        `<div style="background:${LIGHT};border-left:5px solid ${YELLOW};border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;color:${GRAY};margin-top:16px;">
       Enter the email address or phone number the gym has on file and we will send you a one-time code.
     </div>`,
    ].join('');
    return {
        subject: 'Welcome to Usman Gym',
        html: layout({ preheader: `Your Gym ID is ${gymId}. Activate your account.`, title: 'Welcome to Usman Gym', bodyHtml }),
        text: `Welcome to Usman Gym! Your Gym ID is ${gymId}.\n\nActivate your member account and set your own password: ${url}\nUse the email address or phone number the gym has on file.\n\n- Usman Gym`,
    };
}
/** Short plain text for SMS delivery. */
const otpSms = (code) => `Usman Gym: your verification code is ${code}. It expires in ${env_1.env.OTP_TTL_MINUTES} minutes. Never share this code.`;
exports.otpSms = otpSms;
const inviteSms = (gymId) => `Welcome to Usman Gym! Your Gym ID is ${gymId}. Activate your account at ${env_1.env.APP_URL.replace(/\/$/, '')}/activate`;
exports.inviteSms = inviteSms;
// ---------------------------------------------------------------- generic notification
function notificationEmail(opts) {
    const base = env_1.env.APP_URL.replace(/\/$/, '');
    const rows = (opts.rows ?? [])
        .map(([k, v]) => `<tr><td style="padding:8px 0;font-size:14px;color:${GRAY};border-bottom:1px solid ${LIGHT};">${escapeHtml(k)}</td><td style="padding:8px 0;font-size:15px;font-weight:700;text-align:right;color:${INK};border-bottom:1px solid ${LIGHT};">${escapeHtml(v)}</td></tr>`)
        .join('');
    const noteColor = opts.note?.tone === 'danger' ? '#d03b3b' : YELLOW;
    const bodyHtml = [
        h1(escapeHtml(opts.title)),
        p(escapeHtml(opts.intro)),
        rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>` : '',
        opts.note
            ? `<div style="background:${LIGHT};border-left:5px solid ${noteColor};border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;color:${INK};margin:0 0 20px;">${escapeHtml(opts.note.text)}</div>`
            : '',
        opts.cta
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${YELLOW};border-radius:6px;"><a href="${escapeHtml(base + opts.cta.path)}" style="display:inline-block;padding:14px 30px;font-family:${HEADING_FONT};font-size:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${BLACK};text-decoration:none;">${escapeHtml(opts.cta.label)}</a></td></tr></table>`
            : '',
    ].join('');
    const text = [opts.intro, ...(opts.rows ?? []).map(([k, v]) => `${k}: ${v}`), opts.note?.text ?? '', opts.cta ? `${opts.cta.label}: ${base}${opts.cta.path}` : '']
        .filter(Boolean)
        .join('\n');
    return { subject: opts.subject, text: `${text}\n\n- Usman Gym`, html: layout({ preheader: opts.intro, title: opts.subject, bodyHtml }) };
}
