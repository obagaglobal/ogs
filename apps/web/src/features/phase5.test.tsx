import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { HoursEntry, SkillChoice } from '@/features/provider/provider-data';
import { nairobiInputToIso } from '@/features/provider/provider-data';
import {
  AvailabilityEditor,
  RegionPicker,
  SkillPicker,
} from '@/features/provider/provider-pickers';
import { mockApi, renderApp, signedIn } from '@/test/render-app';

const SKILLS = [
  { code: 'networking', name: 'Network installation', category: 'Networks', active: true },
  { code: 'wifi', name: 'Wi-Fi design', category: 'Networks', active: true },
  { code: 'cctv', name: 'CCTV installation', category: 'Security systems', active: true },
];
const REGIONS = [
  { code: 'KE-30', name: 'Nairobi City', country: 'KE' },
  { code: 'KE-28', name: 'Mombasa', country: 'KE' },
  { code: 'KE-13', name: 'Kiambu', country: 'KE' },
];

let lastSkills: SkillChoice[] = [];
function SkillHarness({ initial }: { initial: SkillChoice[] }) {
  const [value, setValue] = useState(initial);
  return (
    <SkillPicker
      skills={SKILLS}
      value={value}
      onChange={(next) => {
        lastSkills = next;
        setValue(next);
      }}
    />
  );
}

let lastRegions: string[] = [];
function RegionHarness() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <RegionPicker
      regions={REGIONS}
      value={value}
      onChange={(next) => {
        lastRegions = next;
        setValue(next);
      }}
    />
  );
}

let lastHours: HoursEntry[] = [];
function HoursHarness() {
  const [value, setValue] = useState<HoursEntry[]>([]);
  return (
    <AvailabilityEditor
      value={value}
      onChange={(next) => {
        lastHours = next;
        setValue(next);
      }}
    />
  );
}

describe('Phase 5 pickers (D10)', () => {
  it('SkillPicker groups by category, adds a skill with a default band, edits the band', async () => {
    const user = userEvent.setup();
    render(<SkillHarness initial={[]} />);
    expect(screen.getByRole('group', { name: 'Networks' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Security systems' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('CCTV installation'));
    expect(lastSkills).toEqual([{ code: 'cctv', experience: 'YEARS_1_3' }]);
    await user.selectOptions(
      screen.getByLabelText('Experience in CCTV installation'),
      'OVER_5_YEARS',
    );
    expect(lastSkills).toEqual([{ code: 'cctv', experience: 'OVER_5_YEARS' }]);
    await user.click(screen.getByLabelText('CCTV installation'));
    expect(lastSkills).toEqual([]);
  });

  it('SkillPicker keeps a skill OGS has retired, so saving never drops it silently', () => {
    render(<SkillHarness initial={[{ code: 'old_skill', experience: 'YEARS_3_5' }]} />);
    const retired = screen.getByRole('group', { name: 'No longer offered by OGS' });
    expect(within(retired).getByLabelText('old_skill')).toBeChecked();
    expect(within(retired).getByLabelText('Experience in old_skill')).toHaveValue('YEARS_3_5');
  });

  it('RegionPicker filters counties and counts the selection', async () => {
    const user = userEvent.setup();
    render(<RegionHarness />);
    await user.type(screen.getByLabelText('Find a county'), 'mom');
    expect(screen.queryByLabelText('Nairobi City')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Mombasa'));
    expect(lastRegions).toEqual(['KE-28']);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('AvailabilityEditor: a day gets 08:00–17:00, 00:00 as end means midnight, bad ranges are flagged', async () => {
    const user = userEvent.setup();
    render(<HoursHarness />);
    await user.click(screen.getByLabelText('Monday'));
    expect(lastHours).toEqual([{ weekday: 1, start: '08:00', end: '17:00' }]);
    fireEvent.change(screen.getByLabelText('Monday end'), { target: { value: '00:00' } });
    expect(lastHours).toEqual([{ weekday: 1, start: '08:00', end: '24:00' }]);
    await user.click(screen.getByLabelText('Sunday'));
    expect(lastHours.map((entry) => entry.weekday)).toEqual([1, 7]);
    fireEvent.change(screen.getByLabelText('Sunday start'), { target: { value: '18:00' } });
    expect(screen.getByText('End must be after start')).toBeInTheDocument();
  });

  it('reads datetime-local values as Nairobi time', () => {
    expect(nairobiInputToIso('2026-12-24T08:00')).toBe('2026-12-24T08:00:00+03:00');
  });
});

// ---------------------------------------------------------------- pages

const PROVIDER_ID = '01930000-0000-7000-8000-0000000000f1';
const APPLICATION_ID = '01930000-0000-7000-8000-0000000000f2';

const providerView = (overrides: Record<string, unknown> = {}) => ({
  providerId: PROVIDER_ID,
  kind: 'INDIVIDUAL',
  displayName: 'Jane Wanjiru',
  status: 'PENDING_APPROVAL',
  phone: '+254712345678',
  homeRegion: 'KE-30',
  remoteOk: false,
  acceptingWork: true,
  application: {
    applicationId: APPLICATION_ID,
    status: 'CHANGES_REQUESTED',
    decisionReason: 'Please upload a clearer copy of your ID.',
    submittedAt: null,
    missing: ['identityDocument'],
    history: [],
  },
  skills: [{ code: 'networking', name: 'Network installation', experience: 'YEARS_3_5' }],
  regions: [{ code: 'KE-30', name: 'Nairobi City' }],
  workingHours: [],
  timeOff: [],
  documents: [],
  business: null,
  ...overrides,
});

const providerWorkspace = {
  status: 200,
  body: { kind: 'provider', providerId: PROVIDER_ID, status: 'PENDING_APPROVAL', restricted: true },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Phase 5 pages (D10)', () => {
  it('the Provider workspace shows the reviewer note, what is missing, and saves skills', async () => {
    localStorage.setItem('ogs.workspace', 'provider');
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': {
        status: 200,
        body: {
          workspaces: [],
          provider: { providerId: PROVIDER_ID, status: 'PENDING_APPROVAL', restricted: true },
        },
      },
      'GET /workspace': providerWorkspace,
      'GET /provider': { status: 200, body: providerView() },
      'GET /reference/skills': { status: 200, body: { skills: SKILLS } },
      'GET /reference/regions': { status: 200, body: { regions: REGIONS } },
      'GET /auth/csrf': { status: 200, body: { csrfToken: 'x'.repeat(43) } },
      'PUT /provider/skills': { status: 200, body: providerView() },
    });
    renderApp('/provider');
    expect(await screen.findByText(/Please upload a clearer copy of your ID/)).toBeInTheDocument();
    expect(
      screen.getByText('Government ID (national ID or passport)', { selector: 'li' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Application' })).toBeInTheDocument();

    await user.click(await screen.findByLabelText('Wi-Fi design'));
    await user.click(screen.getByRole('button', { name: 'Save skills' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
        path: '/provider/skills',
        headers: { 'x-ogs-workspace': 'provider' },
        body: {
          skills: [
            { code: 'networking', experience: 'YEARS_3_5' },
            { code: 'wifi', experience: 'YEARS_1_3' },
          ],
        },
      });
    });
  });

  it('under review the profile is read-only but the pause switch still works', async () => {
    localStorage.setItem('ogs.workspace', 'provider');
    const user = userEvent.setup();
    const submitted = providerView({
      application: { ...providerView().application, status: 'SUBMITTED', missing: [] },
    });
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': {
        status: 200,
        body: {
          workspaces: [],
          provider: { providerId: PROVIDER_ID, status: 'PENDING_APPROVAL', restricted: true },
        },
      },
      'GET /workspace': providerWorkspace,
      'GET /provider': { status: 200, body: submitted },
      'GET /auth/csrf': { status: 200, body: { csrfToken: 'x'.repeat(43) } },
      'PATCH /provider/profile': { status: 200, body: submitted },
    });
    renderApp('/provider/availability');
    expect(
      await screen.findByText('While OGS reviews the application, its details cannot be changed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save working hours' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Monday')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Pause new work' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        acceptingWork: false,
      });
    });
  });

  it('staff approve a provider with the verification checklist', async () => {
    const PLATFORM = '01930000-0000-7000-8000-000000000001';
    localStorage.setItem('ogs.workspace', PLATFORM);
    sessionStorage.setItem(
      'ogs.elevation',
      JSON.stringify({
        id: '01930000-0000-7000-8000-0000000000e9',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': {
        status: 200,
        body: {
          workspaces: [
            {
              tenantId: PLATFORM,
              kind: 'PLATFORM',
              name: 'OGS Platform',
              status: 'ACTIVE',
              restricted: false,
            },
          ],
          provider: null,
        },
      },
      'GET /workspace': {
        status: 200,
        body: {
          kind: 'PLATFORM',
          tenantId: PLATFORM,
          name: 'OGS Platform',
          status: 'ACTIVE',
          restricted: false,
          membershipId: '01930000-0000-7000-8000-0000000000bb',
          roles: ['provider_relationship_manager'],
          permissions: ['platform.tenant.review', 'platform.provider.approve'],
        },
      },
      [`GET /platform/provider-applications/${APPLICATION_ID}`]: {
        status: 200,
        body: {
          ...providerView({
            application: { ...providerView().application, status: 'SUBMITTED', missing: [] },
          }),
          applicantEmail: 'jane@provider.test',
          documents: [],
          verification: null,
        },
      },
      'GET /auth/csrf': { status: 200, body: { csrfToken: 'x'.repeat(43) } },
      [`POST /platform/provider-applications/${APPLICATION_ID}/approve`]: { status: 204 },
    });
    renderApp(`/platform/provider-applications/${APPLICATION_ID}`);
    expect(await screen.findByRole('heading', { name: 'Jane Wanjiru' })).toBeInTheDocument();
    // Individuals: identity and skills checks only (no company registration or KRA).
    expect(screen.queryByLabelText('KRA PIN checked')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Identity checked against the ID document'));
    await user.click(screen.getByLabelText('Skills evidence checked'));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      const approve = calls.find((call) => call.path.endsWith('/approve'));
      expect(approve?.headers['x-ogs-elevation']).toBe('01930000-0000-7000-8000-0000000000e9');
      expect(approve?.body).toEqual({
        checklist: {
          identityChecked: true,
          registrationChecked: false,
          taxChecked: false,
          skillsChecked: true,
        },
      });
    });
    expect(await screen.findByText('Decision recorded and emailed.')).toBeInTheDocument();
  });
});
