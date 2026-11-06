import { describe, expect, it } from 'vitest';
import { InvalidDbContextError, toSessionSettings } from './db-context.js';

const USER = '01930000-0000-7000-8000-000000000101';
const TENANT = '01930000-0000-7000-8000-000000000002';

describe('toSessionSettings', () => {
  it('personal (user) context sets only the user', () => {
    expect(toSessionSettings({ kind: 'user', userId: USER })).toEqual({
      'app.user_id': USER,
      'app.tenant_id': '',
      'app.is_platform': 'false',
      'app.actor_kind': 'USER',
      'app.job': '',
    });
  });

  it('workspace context sets user and tenant, never platform', () => {
    expect(
      toSessionSettings({ kind: 'workspace', userId: USER, tenantId: TENANT, restricted: false }),
    ).toEqual({
      'app.user_id': USER,
      'app.tenant_id': TENANT,
      'app.is_platform': 'false',
      'app.actor_kind': 'USER',
      'app.job': '',
    });
  });

  it('anonymous context sets no identity at all (P6-1)', () => {
    expect(toSessionSettings({ kind: 'anonymous' })).toEqual({
      'app.user_id': '',
      'app.tenant_id': '',
      'app.is_platform': 'false',
      'app.actor_kind': '',
      'app.job': '',
    });
  });

  it('platform context sets is_platform and requires a reason', () => {
    expect(
      toSessionSettings({ kind: 'platform', userId: USER, reason: 'Support ticket TCK-1' })[
        'app.is_platform'
      ],
    ).toBe('true');
    expect(() => toSessionSettings({ kind: 'platform', userId: USER, reason: '   ' })).toThrow(
      InvalidDbContextError,
    );
    expect(() =>
      toSessionSettings({ kind: 'platform', userId: USER, reason: 'x'.repeat(501) }),
    ).toThrow(InvalidDbContextError);
  });

  it('system context has no user and the SYSTEM actor kind', () => {
    expect(toSessionSettings({ kind: 'system', job: 'outbox.dispatch', tenantId: TENANT })).toEqual(
      {
        'app.user_id': '',
        'app.tenant_id': TENANT,
        'app.is_platform': 'false',
        'app.actor_kind': 'SYSTEM',
        'app.job': 'outbox.dispatch',
      },
    );
    expect(() => toSessionSettings({ kind: 'system', job: 'Bad Job' })).toThrow(
      InvalidDbContextError,
    );
  });

  it('rejects malformed identifiers instead of passing them to SQL', () => {
    expect(() => toSessionSettings({ kind: 'user', userId: "x' OR '1'='1" })).toThrow(
      InvalidDbContextError,
    );
    expect(() =>
      toSessionSettings({ kind: 'workspace', userId: USER, tenantId: '', restricted: false }),
    ).toThrow(InvalidDbContextError);
  });

  it('normalises UUID case', () => {
    expect(toSessionSettings({ kind: 'user', userId: USER.toUpperCase() })['app.user_id']).toBe(
      USER,
    );
  });
});
