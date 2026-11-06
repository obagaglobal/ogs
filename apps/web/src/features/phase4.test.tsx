import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, signedIn } from '@/test/render-app';

const ORG = '01930000-0000-7000-8000-0000000000aa';
const ROLE_EMPLOYEE = '01930000-0000-7000-8000-0000000000e1';
const ROLE_ADMIN = '01930000-0000-7000-8000-0000000000e2';

const orgWorkspace = (restricted: boolean, permissions: string[]) => ({
  status: 200,
  body: {
    kind: 'ORGANISATION',
    tenantId: ORG,
    name: 'Kilimo Tech Ltd',
    status: restricted ? 'PENDING_APPROVAL' : 'ACTIVE',
    restricted,
    membershipId: '01930000-0000-7000-8000-0000000000bb',
    roles: ['org_admin'],
    permissions,
  },
});

const workspaces = (restricted: boolean) => ({
  status: 200,
  body: {
    workspaces: [
      {
        tenantId: ORG,
        kind: 'ORGANISATION',
        name: 'Kilimo Tech Ltd',
        status: restricted ? 'PENDING_APPROVAL' : 'ACTIVE',
        restricted,
      },
    ],
  },
});

const draftApplication = {
  status: 200,
  body: {
    applicationId: '01930000-0000-7000-8000-0000000000cc',
    tenantId: ORG,
    tenantStatus: 'PENDING_APPROVAL',
    status: 'CHANGES_REQUESTED',
    decisionReason: 'Please upload the KRA PIN certificate.',
    submittedAt: null,
    decidedAt: null,
    missing: ['kraPin', 'documents'],
    profile: {
      legalName: 'Kilimo Tech Ltd',
      tradingName: null,
      registrationNumber: 'PVT-1',
      registrationNumberAbsentWhy: null,
      kraPin: null,
      kraPinAbsentWhy: null,
      country: 'KE',
      region: 'Nairobi',
      address: 'Moi Avenue',
      phone: '+254712345678',
      contactEmail: 'info@kilimo.test',
      industry: null,
      employeeBand: null,
    },
    documents: [],
    history: [
      { fromStatus: null, toStatus: 'DRAFT', reason: null, occurredAt: '2026-11-06T08:00:00.000Z' },
    ],
  },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('ogs.workspace', ORG);
});

describe('Phase 4 web (C11)', () => {
  it('shows the reviewer’s reason and blocks submission until nothing is missing', async () => {
    mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': workspaces(true),
      'GET /workspace': orgWorkspace(true, ['organisation.profile.manage', 'workspace.read']),
      'GET /organisation/application': draftApplication,
    });
    renderApp('/organisation/application');
    expect(await screen.findByText('Please upload the KRA PIN certificate.')).toBeInTheDocument();
    expect(screen.getByText('At least one supporting document')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    // A pending organisation sees "Application" but no team pages.
    expect(screen.getByRole('link', { name: 'Application' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('invites a colleague with the chosen role', async () => {
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': workspaces(false),
      'GET /workspace': orgWorkspace(false, ['membership.read', 'membership.invite', 'role.read']),
      'GET /workspace/members': { status: 200, body: { members: [] } },
      'GET /workspace/invitations': { status: 200, body: { invitations: [] } },
      'GET /workspace/roles': {
        status: 200,
        body: {
          roles: [
            {
              id: ROLE_ADMIN,
              code: 'org_admin',
              name: 'Organisation administrator',
              description: null,
              isSystem: true,
              permissions: [],
            },
            {
              id: ROLE_EMPLOYEE,
              code: 'org_employee',
              name: 'Organisation employee',
              description: null,
              isSystem: true,
              permissions: [],
            },
          ],
        },
      },
      'GET /auth/csrf': { status: 200, body: { csrfToken: 'c'.repeat(43) } },
      'POST /workspace/invitations': { status: 201, body: {} },
    });
    renderApp('/team');
    await userEvent.type(await screen.findByLabelText('Email'), 'wanjiru@kilimo.test');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Organisation employee' })).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText('Role'), ROLE_EMPLOYEE);
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Invitation sent. It is valid for 7 days.')).toBeInTheDocument();
    const invite = calls.find(
      (call) => call.path === '/workspace/invitations' && call.method === 'POST',
    );
    expect(invite?.body).toEqual({ email: 'wanjiru@kilimo.test', roleIds: [ROLE_EMPLOYEE] });
    expect(invite?.headers['x-ogs-workspace']).toBe(ORG);
    expect(invite?.headers['x-csrf-token']).toBe('c'.repeat(43));
  });

  it('a signed-out invitee is sent to sign up with the invited email locked', async () => {
    mockApi({ 'GET /auth/session': { status: 401, body: { error: 'unauthenticated' } } });
    renderApp(`/invitations/accept#token=${'t'.repeat(43)}&email=wanjiru%40kilimo.test`);
    const signUp = await screen.findByRole('link', { name: 'create an account' });
    expect(signUp).toHaveAttribute('href', '/sign-up?email=wanjiru%40kilimo.test');
    expect(sessionStorage.getItem('ogs.pendingInvitation')).toBe('t'.repeat(43));
    await userEvent.click(signUp);
    expect(await screen.findByLabelText('Email')).toHaveValue('wanjiru@kilimo.test');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
  });

  it('a signed-in invitee accepts and lands in the new workspace', async () => {
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /auth/csrf': { status: 200, body: { csrfToken: 'c'.repeat(43) } },
      'POST /invitations/accept': {
        status: 200,
        body: { tenantId: ORG, tenantName: 'Kilimo Tech Ltd', kind: 'ORGANISATION' },
      },
      'GET /me/workspaces': workspaces(false),
      'GET /workspace': orgWorkspace(false, ['workspace.read']),
    });
    localStorage.clear();
    renderApp(`/invitations/accept#token=${'t'.repeat(43)}&email=alice%40acme.test`);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('heading', { name: 'Kilimo Tech Ltd' })).toBeInTheDocument();
    expect(calls.find((call) => call.path === '/invitations/accept')?.body).toEqual({
      token: 't'.repeat(43),
    });
  });

  it('shows password strength while choosing a password', async () => {
    mockApi({});
    renderApp('/sign-up');
    await userEvent.type(screen.getByLabelText('Password'), 'password1234');
    expect(await screen.findByText(/Strength:/)).toHaveTextContent('Weak');
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'tea plantation sunrise kericho');
    expect(screen.getByText(/Strength:/)).toHaveTextContent(/Good|Strong/);
  });
});
