import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, signedIn } from './test/render-app';

const ACME = '01930000-0000-7000-8000-000000000002';
const NTP = '01930000-0000-7000-8000-000000000004';

const workspaces = {
  status: 200,
  body: {
    workspaces: [
      {
        tenantId: ACME,
        kind: 'ORGANISATION',
        name: 'Acme Kenya Ltd',
        status: 'ACTIVE',
        restricted: false,
      },
      {
        tenantId: NTP,
        kind: 'PROVIDER_COMPANY',
        name: 'Nairobi Tech Partners',
        status: 'ACTIVE',
        restricted: false,
      },
    ],
  },
};

beforeEach(() => {
  localStorage.clear();
});

describe('web shell (B5)', () => {
  it('sends a signed-out visitor to sign-in', async () => {
    mockApi({ 'GET /auth/session': { status: 401, body: { error: 'unauthenticated' } } });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Karibu. Sign in to OGS' }),
    ).toBeInTheDocument();
  });

  it('signs in with JSON and moves on to the MFA prompt when a second factor is owed', async () => {
    const calls = mockApi({
      'GET /auth/session': { status: 401, body: { error: 'unauthenticated' } },
      'GET /auth/csrf': { status: 401, body: { error: 'unauthenticated' } },
      'POST /auth/login': signedIn({ mfaPending: true }),
    });
    renderApp('/sign-in');
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@acme.test');
    await userEvent.type(screen.getByLabelText('Password'), 'change-me-local-only');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();
    const login = calls.find((call) => call.path === '/auth/login');
    expect(login?.body).toEqual({ email: 'alice@acme.test', password: 'change-me-local-only' });
    expect(login?.headers['content-type']).toBe('application/json');
  });

  it('shows the server’s reason when sign-in fails, without saying which field was wrong', async () => {
    mockApi({
      'GET /auth/csrf': { status: 401, body: { error: 'unauthenticated' } },
      'POST /auth/login': { status: 401, body: { error: 'invalid_credentials' } },
    });
    renderApp('/sign-in');
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@acme.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match.',
    );
  });

  it('always shows the current workspace and sends it as X-OGS-Workspace after a switch', async () => {
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': workspaces,
      'GET /workspace': (init) => {
        const header = (init.headers as Record<string, string>)['X-OGS-Workspace'];
        return header === NTP
          ? {
              status: 200,
              body: {
                kind: 'PROVIDER_COMPANY',
                tenantId: NTP,
                name: 'Nairobi Tech Partners',
                status: 'ACTIVE',
                restricted: false,
                membershipId: '01930000-0000-7000-8000-000000000205',
                roles: ['provider_technician'],
                permissions: ['ticket.read', 'workspace.read'],
              },
            }
          : { status: 200, body: { kind: 'personal' } };
      },
    });
    renderApp('/');

    const switcher = await screen.findByLabelText('Workspace');
    expect(switcher).toHaveDisplayValue('Personal');
    expect(await screen.findByRole('heading', { name: 'Personal' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Nairobi Tech Partners/ })).toBeInTheDocument();
    });
    await userEvent.selectOptions(switcher, NTP);

    expect(
      await screen.findByRole('heading', { name: 'Nairobi Tech Partners' }),
    ).toBeInTheDocument();
    expect(screen.getByText('provider_technician')).toBeInTheDocument();
    expect(localStorage.getItem('ogs.workspace')).toBe(NTP);
    expect(
      calls.some((call) => call.path === '/workspace' && call.headers['x-ogs-workspace'] === NTP),
    ).toBe(true);
  });

  it('sends a user who must enrol in MFA to the setup page', async () => {
    mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': { status: 403, body: { error: 'mfa_enrollment_required' } },
      'GET /workspace': { status: 403, body: { error: 'mfa_enrollment_required' } },
      'GET /auth/csrf': { status: 200, body: { csrfToken: 'x'.repeat(43) } },
      'POST /auth/mfa/totp/setup': {
        status: 201,
        body: {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/OGS:alice?secret=JBSWY3DPEHPK3PXP',
        },
      },
    });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Set up two-step verification' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  });

  it('sends a user whose email is not verified to the confirmation screen', async () => {
    mockApi({ 'GET /auth/session': signedIn({ status: 'PENDING_VERIFICATION' }) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  });

  it('verifies an email from the link fragment, never from the query string', async () => {
    const calls = mockApi({
      'GET /auth/csrf': { status: 401, body: { error: 'unauthenticated' } },
      'POST /auth/verify-email': { status: 204 },
    });
    const token = 'A'.repeat(43);
    renderApp(`/verify-email#token=${token}`);
    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    expect(calls.find((call) => call.path === '/auth/verify-email')?.body).toEqual({ token });
  });
});
