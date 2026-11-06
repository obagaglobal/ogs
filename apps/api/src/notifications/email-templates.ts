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
  /** Phase 7: notices about requests, quotations and orders (copy built by the handler). */
  orderNotice: (to: string, subject: string, paragraphs: string[], url: string) =>
    layout(to, subject, paragraphs, { url, label: 'View the request' }),

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

  invitation: (to: string, organisation: string, url: string) =>
    layout(
      to,
      `You are invited to join ${organisation} on OGS`,
      [
        `${organisation} has invited you to join its workspace on OGS.`,
        'The link works once and expires in 7 days. If you do not have an OGS account yet, you can create one with this email address first.',
        'If you were not expecting this, you can ignore this email.',
      ],
      { url, label: 'Accept the invitation' },
    ),

  applicationDecision: (
    to: string,
    organisation: string,
    decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
    reason: string | null,
    url: string,
  ) => {
    const subject = {
      APPROVED: `${organisation} is approved on OGS`,
      REJECTED: `Your OGS application for ${organisation} was not approved`,
      CHANGES_REQUESTED: `OGS needs changes to the application for ${organisation}`,
    }[decision];
    const lead = {
      APPROVED:
        'Your organisation is approved. You can now invite your team and use OGS services. Administrators must set up two-step verification at their next sign-in.',
      REJECTED: 'We could not approve your organisation on OGS.',
      CHANGES_REQUESTED:
        'We reviewed your application and need a few changes before we can approve it.',
    }[decision];
    return layout(to, subject, reason === null ? [lead] : [lead, `Reviewer note: ${reason}`], {
      url,
      label: decision === 'APPROVED' ? 'Open OGS' : 'View the application',
    });
  },

  tenantStatusChanged: (
    to: string,
    organisation: string,
    status: 'SUSPENDED' | 'ACTIVE',
    url: string,
  ) =>
    layout(
      to,
      status === 'SUSPENDED'
        ? `${organisation} has been suspended on OGS`
        : `${organisation} has been reactivated on OGS`,
      [
        status === 'SUSPENDED'
          ? 'OGS has suspended your organisation. Members can sign in and see its status, but cannot use it until it is reactivated. Contact OGS support for details.'
          : 'Your organisation is active again on OGS.',
      ],
      { url, label: 'Open OGS' },
    ),

  /** Phase 5: a provider application decision (company admins or the individual). */
  providerDecision: (
    to: string,
    provider: string,
    decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
    reason: string | null,
    url: string,
  ) => {
    const subject = {
      APPROVED: `${provider} is approved as an OGS provider`,
      REJECTED: `Your OGS provider application for ${provider} was not approved`,
      CHANGES_REQUESTED: `OGS needs changes to the provider application for ${provider}`,
    }[decision];
    const lead = {
      APPROVED:
        'You are approved as a provider on OGS. Keep your skills, coverage and availability up to date: OGS uses them to offer you work.',
      REJECTED: 'We could not approve your provider application on OGS.',
      CHANGES_REQUESTED:
        'We reviewed your provider application and need a few changes before we can approve it.',
    }[decision];
    return layout(to, subject, reason === null ? [lead] : [lead, `Reviewer note: ${reason}`], {
      url,
      label: decision === 'APPROVED' ? 'Open OGS' : 'View the application',
    });
  },

  providerStatusChanged: (
    to: string,
    provider: string,
    status: 'SUSPENDED' | 'ACTIVE',
    url: string,
  ) =>
    layout(
      to,
      status === 'SUSPENDED'
        ? `${provider} has been suspended as an OGS provider`
        : `${provider} is active again as an OGS provider`,
      [
        status === 'SUSPENDED'
          ? 'OGS has suspended your provider account. You will not be offered work, and your profile is read-only until it is reactivated. Contact OGS support for details.'
          : 'Your provider account is active again. OGS can offer you work as before.',
      ],
      { url, label: 'Open OGS' },
    ),

  /** ASVS follow-up F-2: tell the owner about every change to how they sign in. */
  securityNotice: (to: string, notice: SecurityNotice, url: string) => {
    const text: Record<SecurityNotice, [string, string]> = {
      password_changed: [
        'Your OGS password was changed',
        'The password of your OGS account was just changed.',
      ],
      password_reset: [
        'Your OGS password was reset',
        'The password of your OGS account was just reset with an emailed link.',
      ],
      mfa_enabled: [
        'Two-step verification is on',
        'Two-step verification was turned on for your OGS account.',
      ],
      mfa_disabled: [
        'Two-step verification is off',
        'Two-step verification was turned off for your OGS account.',
      ],
      recovery_codes_regenerated: [
        'New OGS recovery codes',
        'New recovery codes were created for your OGS account. The old ones no longer work.',
      ],
    };
    const [subject, line] = text[notice];
    return layout(
      to,
      subject,
      [
        line,
        'If this was you, no action is needed. If it was not, reset your password immediately and contact OGS support.',
      ],
      { url, label: 'Review your security settings' },
    );
  },
};

export type SecurityNotice =
  | 'password_changed'
  | 'password_reset'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'recovery_codes_regenerated';
