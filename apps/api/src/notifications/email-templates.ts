import type { EmailMessage } from './email-sender.js';

/**
 * Email copy. English only for v1; every string lives here so translation
 * (ADR-024) touches one file. Links carry tokens in the URL FRAGMENT (#token=),
 * which browsers never send to servers or put in Referer headers.
 */

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

function layout(
  to: string,
  subject: string,
  paragraphs: string[],
  link?: { url: string; label: string },
): EmailMessage {
  const text = [
    ...paragraphs,
    ...(link ? [`${link.label}: ${link.url}`] : []),
    '',
    '— OGS, ObagaGlobal Services',
  ].join('\n\n');
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1c1917">',
    ...paragraphs.map((p) => `<p>${escape(p)}</p>`),
    link
      ? `<p><a href="${escape(link.url)}" style="color:#065f46">${escape(link.label)}</a></p><p style="font-size:12px;color:#57534e">${escape(link.url)}</p>`
      : '',
    '<p style="font-size:12px;color:#57534e">OGS, ObagaGlobal Services</p>',
    '</body></html>',
  ].join('');
  return { to, subject, text, html };
}

export const templates = {
  emailVerification: (to: string, url: string) =>
    layout(
      to,
      'Confirm your email address',
      [
        'Welcome to OGS. Please confirm that this is your email address.',
        'The link works once and expires in 24 hours. If you did not create an OGS account, ignore this email.',
      ],
      { url, label: 'Confirm email address' },
    ),

  passwordReset: (to: string, url: string) =>
    layout(
      to,
      'Reset your OGS password',
      [
        'Someone asked to reset the password for your OGS account.',
        'The link works once and expires in 30 minutes. Resetting your password signs you out on every device.',
        'If this was not you, ignore this email: your password has not changed.',
      ],
      { url, label: 'Choose a new password' },
    ),

  accountExists: (to: string, signInUrl: string, resetUrl: string) =>
    layout(to, 'You already have an OGS account', [
      'Someone tried to create a new OGS account with this email address, but you already have one.',
      `Sign in at ${signInUrl}. Forgot your password? Reset it at ${resetUrl}.`,
      'If this was not you, you can ignore this email.',
    ]),

  accountLocked: (to: string, resetUrl: string) =>
    layout(
      to,
      'Your OGS account was temporarily locked',
      [
        'We locked your account for 15 minutes after several failed sign-in attempts.',
        'If this was you, wait 15 minutes and try again. If it was not you, reset your password now.',
      ],
      { url: resetUrl, label: 'Reset your password' },
    ),
};
