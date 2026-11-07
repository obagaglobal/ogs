import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { minorToInput, parseKesToMinor } from '@/features/catalogue/catalogue-data';
import { mockApi, renderApp, signedIn } from '@/test/render-app';

const price = (label: string, amountMinor: number | null, model = 'FIXED') => ({
  model,
  amountMinor,
  currency: 'KES',
  unit: null,
  minQuantity: 1,
  label,
  vatInclusiveMinor: amountMinor === null ? null : Math.round(amountMinor * 1.16),
});

const summary = (slug: string, name: string, label: string, amountMinor: number | null) => ({
  slug,
  name,
  summary: `${name} summary`,
  category: { slug: 'wifi', name: 'Wi-Fi' },
  audience: 'ALL',
  deliveryMode: 'ON_SITE',
  price: price(label, amountMinor),
});

const signedOut = { status: 401, body: { error: 'unauthenticated' } };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('money input (E9)', () => {
  it('turns typed shillings into exact minor units, never via floats', () => {
    expect(parseKesToMinor('3,500.50')).toBe(350_050);
    expect(parseKesToMinor('KES 3500')).toBe(350_000);
    expect(parseKesToMinor('0.1')).toBe(10);
    expect(parseKesToMinor('19.99')).toBe(1_999);
    expect(parseKesToMinor('1.005')).toBeNull();
    expect(parseKesToMinor('-5')).toBeNull();
    expect(parseKesToMinor('abc')).toBeNull();
    expect(minorToInput(350_050)).toBe('3500.50');
    expect(minorToInput(350_000)).toBe('3500');
  });
});

describe('public catalogue pages (E9)', () => {
  it('browses without signing in: categories, prices, filters and "Load more"', async () => {
    const user = userEvent.setup();
    let page = 0;
    const calls = mockApi({
      'GET /auth/session': signedOut,
      'GET /catalogue/categories': {
        status: 200,
        body: {
          categories: [
            {
              slug: 'networks',
              name: 'Networks & Wi-Fi',
              summary: null,
              icon: 'network',
              serviceCount: 3,
              children: [],
            },
          ],
        },
      },
      'GET /catalogue/services': () => {
        page += 1;
        return page === 1
          ? {
              status: 200,
              body: {
                services: [summary('home-wifi-setup', 'Home Wi-Fi setup', 'KES 3,500', 350_000)],
                nextCursor: 'CURSOR-1',
              },
            }
          : {
              status: 200,
              body: {
                services: [summary('wifi-site-survey', 'Wi-Fi site survey', 'KES 8,500', 850_000)],
                nextCursor: null,
              },
            };
      },
    });
    renderApp('/services');
    expect(await screen.findByRole('link', { name: 'Home Wi-Fi setup' })).toBeInTheDocument();
    expect(screen.getByText('KES 3,500')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Networks & Wi-Fi/ })).toHaveAttribute(
      'href',
      '/services/c/networks',
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Wi-Fi site survey' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    const searches = calls.filter((call) => call.path === '/catalogue/services');
    expect(searches[1]?.query).toContain('cursor=CURSOR-1');

    await user.selectOptions(screen.getByLabelText('Pricing'), 'QUOTE');
    await waitFor(() => {
      expect(calls.filter((call) => call.path === '/catalogue/services').at(-1)?.query).toContain(
        'model=QUOTE',
      );
    });
    await user.type(screen.getByLabelText('Search services'), 'cctv');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.path === '/catalogue/services').at(-1)?.query).toContain(
        'q=cctv',
      );
    });
  });

  it('a service page shows the price, indicative VAT and plain-text content; unknown → not found', async () => {
    mockApi({
      'GET /auth/session': signedOut,
      'GET /catalogue/services/home-wifi-setup': {
        status: 200,
        body: {
          ...summary('home-wifi-setup', 'Home Wi-Fi setup', 'KES 3,500', 350_000),
          parentCategory: { slug: 'networks', name: 'Networks & Wi-Fi' },
          description: 'First paragraph.\n\n<b>Second</b> paragraph.',
          inclusions: ['Router configuration'],
          exclusions: [],
          customerRequirements: [],
          typicalDuration: '1–2 hours',
        },
      },
    });
    renderApp('/services/home-wifi-setup');
    expect(await screen.findByRole('heading', { name: 'Home Wi-Fi setup' })).toBeInTheDocument();
    expect(screen.getByText(/About KES 4,060 including 16% VAT/)).toBeInTheDocument();
    // Content is text: markup is shown literally, never rendered.
    expect(screen.getByText('<b>Second</b> paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Router configuration')).toBeInTheDocument();
    // Signed out: sign in first, then come back to the request form (Phase 7).
    expect(screen.getByRole('link', { name: 'Sign in to request' })).toHaveAttribute(
      'href',
      `/sign-in?next=${encodeURIComponent('/requests/new?service=home-wifi-setup')}`,
    );
  });

  it('an unknown or withdrawn service says so', async () => {
    mockApi({ 'GET /auth/session': signedOut });
    renderApp('/services/gone-service');
    expect(await screen.findByRole('heading', { name: 'Service not found' })).toBeInTheDocument();
  });
});

describe('staff service editor (E9)', () => {
  const PLATFORM = '01930000-0000-7000-8000-000000000001';
  const SERVICE = '01930000-0000-7000-8000-0000000000c1';
  const draft = {
    id: SERVICE,
    slug: 'ups-installation',
    name: 'UPS installation',
    summary: '',
    description: '',
    inclusions: [],
    exclusions: [],
    customerRequirements: [],
    typicalDuration: null,
    audience: 'ALL',
    deliveryMode: 'ON_SITE',
    channelOgs: true,
    channelIndividual: true,
    channelCompany: true,
    status: 'DRAFT',
    category: { slug: 'servers-backup', name: 'Servers, backup & recovery', status: 'ACTIVE' },
    publishedAt: null,
    retiredAt: null,
    version: 0,
    price: null,
    priceHistory: [],
    skills: [],
    missing: ['summary', 'description', 'price', 'skills'],
    updatedAt: '2026-11-06T10:00:00.000Z',
  };

  it('lists what blocks publishing and saves prices as exact minor units', async () => {
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
          roles: ['service_manager'],
          permissions: ['platform.catalogue.manage'],
        },
      },
      'GET /reference/skills': { status: 200, body: { skills: [] } },
      [`GET /platform/catalogue/services/${SERVICE}`]: { status: 200, body: draft },
      'GET /auth/csrf': { status: 200, body: { csrfToken: 'x'.repeat(43) } },
      [`POST /platform/catalogue/services/${SERVICE}/prices`]: {
        status: 201,
        body: { ...draft, missing: ['summary', 'description', 'skills'] },
      },
    });
    renderApp(`/platform/catalogue/services/${SERVICE}`);
    const missing = await screen.findByRole('list', { name: 'Missing before publishing' });
    expect(missing).toHaveTextContent('A price');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Catalogue' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Amount (KES)'), '3,500.50');
    await user.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/prices'))?.body).toEqual({
        model: 'FIXED',
        amountMinor: 350_050,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Missing before publishing' })).not.toHaveTextContent(
        'A price',
      );
    });
  });
});
