import { randomUUID } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mockPhase7, phase7Storage, PHASE7_PATHS, type Phase7Fixture } from './phase7-fixtures';
import { mockPhase8, phase8Storage, PHASE8_PATHS, type Phase8Fixture } from './phase8-fixtures';
import { createOrganisation } from './support';

/**
 * Shared set-up for the Phase 6b design tests (visual, axe, theme, motif,
 * responsive). Public catalogue responses are fixtures, so screenshots do not
 * depend on what other journeys have published; signed-in pages use a fresh
 * organisation employee (no MFA needed) against the real API.
 */
export type Theme = 'light' | 'dark';
export const THEMES: Theme[] = ['light', 'dark'];

const price = (label: string, amountMinor: number | null, model = 'FIXED') => ({
  model,
  amountMinor,
  currency: 'KES',
  unit: null,
  minQuantity: 1,
  label,
  vatInclusiveMinor: amountMinor === null ? null : Math.round(amountMinor * 1.16),
});

const service = (
  slug: string,
  name: string,
  summary: string,
  category: { slug: string; name: string },
  label: string,
  amountMinor: number | null,
  model = 'FIXED',
) => ({
  slug,
  name,
  summary,
  category,
  audience: 'ALL',
  deliveryMode: 'ON_SITE',
  price: price(label, amountMinor, model),
});

const NETWORKS = { slug: 'networks', name: 'Networks & Wi-Fi' };
const SECURITY = { slug: 'cctv', name: 'CCTV & security' };
const DEVICES = { slug: 'devices', name: 'Computers & devices' };
const CLOUD = { slug: 'cloud', name: 'Cloud & email' };

const SERVICES = [
  service(
    'home-wifi-setup',
    'Home Wi-Fi setup',
    'Router set-up, secure Wi-Fi and coverage for your home.',
    NETWORKS,
    'KES 3,500',
    350_000,
  ),
  service(
    'office-network',
    'Office network installation',
    'Structured cabling, switches and Wi-Fi for small offices.',
    NETWORKS,
    'From KES 45,000',
    4_500_000,
    'FROM',
  ),
  service(
    'cctv-4-camera',
    'CCTV, 4 cameras',
    'Supply and installation of a 4-camera HD system with remote viewing.',
    SECURITY,
    'KES 84,500',
    8_450_000,
  ),
  service(
    'laptop-repair',
    'Laptop diagnosis and repair',
    'Find the fault, quote the fix, repair on site or in the workshop.',
    DEVICES,
    'KES 1,500',
    150_000,
  ),
  service(
    'm365-setup',
    'Microsoft 365 set-up',
    'Business email on your domain, users and backups.',
    CLOUD,
    'KES 1,200 per user',
    120_000,
  ),
  service(
    'server-setup',
    'Server set-up',
    'Linux or Windows servers, sized and secured for your business.',
    DEVICES,
    'Price on quotation',
    null,
    'QUOTE',
  ),
];

const CATEGORIES = [
  {
    ...NETWORKS,
    summary: 'Wi-Fi, cabling and routers.',
    icon: 'wifi',
    serviceCount: 2,
    children: [],
  },
  {
    ...SECURITY,
    summary: 'Cameras and access control.',
    icon: 'cctv',
    serviceCount: 1,
    children: [],
  },
  { ...DEVICES, summary: 'Repairs and set-up.', icon: 'laptop', serviceCount: 2, children: [] },
  { ...CLOUD, summary: 'Email, files and backups.', icon: 'cloud', serviceCount: 1, children: [] },
];

/** Answers the public catalogue endpoints with fixtures. */
export async function mockCatalogue(page: Page): Promise<void> {
  await page.route('**/api/v1/catalogue/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1/catalogue', '');
    if (path === '/categories') {
      return route.fulfill({ json: { categories: CATEGORIES } });
    }
    if (path.startsWith('/categories/')) {
      const slug = path.split('/')[2];
      const category = CATEGORIES.find((c) => c.slug === slug);
      return category
        ? route.fulfill({ json: { category, parent: null } })
        : route.fulfill({ status: 404, json: { error: 'not_found' } });
    }
    if (path === '/services') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const cat = url.searchParams.get('category');
      const services = SERVICES.filter(
        (s) =>
          (q === '' || s.name.toLowerCase().includes(q)) &&
          (cat === null || s.category.slug === cat),
      );
      return route.fulfill({ json: { services, nextCursor: null } });
    }
    const slug = path.split('/')[2];
    const found = SERVICES.find((s) => s.slug === slug);
    if (!found) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({
      json: {
        ...found,
        parentCategory: null,
        description:
          'A technician visits, checks where your router and devices are, and sets up a secure network.\n\nWe test coverage in every room and show you how to manage the network from your phone.',
        inclusions: [
          'Router configuration',
          'Secure Wi-Fi password',
          'Coverage test in every room',
        ],
        exclusions: ['Cabling through walls', 'Hardware purchase'],
        customerRequirements: ['Your internet provider details', 'Access to the router'],
        typicalDuration: '1–2 hours',
      },
    });
  });
}

/** Sets the remembered theme before any page script runs (as a returning visitor). */
export async function rememberTheme(context: BrowserContext, theme: Theme): Promise<void> {
  await context.addInitScript((value) => {
    localStorage.setItem('ogs.theme', value);
  }, theme);
}

/** Waits until web fonts and lazy route chunks have settled. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

export interface Customer {
  email: string;
  password: string;
  tenantId: string;
}

/** A fresh, active organisation whose employee signs in without MFA. */
export async function createCustomer(): Promise<Customer> {
  const id = randomUUID().slice(0, 8);
  const password = `design ${id} pass`;
  // "employee.v…" → "Habari, Employee" and avatar initials "EV" on every run.
  const email = `employee.v${id}@e2e.test`;
  const tenantId = await createOrganisation({
    name: 'Savanna Design Ltd',
    adminEmail: `admin.v${id}@e2e.test`,
    employeeEmail: email,
    password,
    postpaid: false,
  });
  return { email, password, tenantId };
}

/** Signs the customer in and selects their organisation workspace. */
export async function signInCustomer(page: Page, customer: Customer): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(customer.email);
  await page.getByLabel('Password').fill(customer.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Workspace', { exact: true })).toBeVisible();
  await page.getByLabel('Workspace', { exact: true }).selectOption(customer.tenantId);
  await expect(page.getByRole('heading', { name: 'Savanna Design Ltd' })).toBeVisible();
}

/** A signed-in context (cookies + selected workspace) to clone per test. */
export async function customerState(browser: Browser, customer: Customer) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInCustomer(page, customer);
  const state = await context.storageState();
  await context.close();
  return state;
}

export interface DesignPage {
  name: string;
  path: string;
  signedIn: boolean;
  /** Text that proves the page has fully rendered (data included). */
  ready: string | RegExp;
  /** Phase 7 pages answered entirely by API fixtures (phase7-fixtures.ts). */
  fixture?: Phase7Fixture | Phase8Fixture;
}

/** The eighteen pages of the visual and accessibility suites (§9 added four, Phase 8 five). */
export const DESIGN_PAGES: DesignPage[] = [
  { name: 'catalogue', path: '/services', signedIn: false, ready: 'Home Wi-Fi setup' },
  {
    name: 'category',
    path: '/services/c/networks',
    signedIn: false,
    ready: 'Office network installation',
  },
  {
    name: 'service',
    path: '/services/home-wifi-setup',
    signedIn: false,
    ready: 'Sign in to request',
  },
  { name: 'sign-in', path: '/sign-in', signedIn: false, ready: 'Forgot password?' },
  { name: 'sign-up', path: '/sign-up', signedIn: false, ready: 'Create account' },
  { name: 'dashboard', path: '/', signedIn: true, ready: 'Get things done' },
  { name: 'requests-empty', path: '/requests', signedIn: true, ready: 'No requests yet' },
  {
    name: 'request-form',
    path: '/requests/new?service=home-wifi-setup',
    signedIn: true,
    ready: /Estimated total/,
  },
  { name: 'design-system', path: '/design-system', signedIn: true, ready: 'Kitenge motif' },
  {
    name: 'request-detail',
    path: PHASE7_PATHS['customer-request'],
    signedIn: false,
    ready: 'Accept quotation',
    fixture: 'customer-request',
  },
  {
    name: 'quotation-editor',
    path: PHASE7_PATHS['staff-request'],
    signedIn: false,
    ready: 'Issue quotation',
    fixture: 'staff-request',
  },
  {
    name: 'orders',
    path: PHASE7_PATHS.orders,
    signedIn: false,
    ready: 'Mombasa Port Clinic',
    fixture: 'orders',
  },
  {
    name: 'finance-order',
    path: PHASE7_PATHS['finance-order'],
    signedIn: false,
    ready: 'Record a payment',
    fixture: 'finance-order',
  },
  // Phase 8: tickets.
  { name: 'support-empty', path: '/support', signedIn: true, ready: 'No tickets here' },
  { name: 'ticket-form', path: '/support/new', signedIn: true, ready: 'How urgent is it?' },
  {
    name: 'ticket-detail',
    path: PHASE8_PATHS['customer-ticket'],
    signedIn: false,
    ready: 'Can someone be in the boardroom',
    fixture: 'customer-ticket',
  },
  {
    name: 'ticket-queue',
    path: PHASE8_PATHS['ticket-queue'],
    signedIn: false,
    ready: 'Server room alarm keeps sounding',
    fixture: 'ticket-queue',
  },
  {
    name: 'staff-ticket',
    path: PHASE8_PATHS['staff-ticket'],
    signedIn: false,
    ready: 'Bring a spare',
    fixture: 'staff-ticket',
  },
];

const PHASE8_FIXTURES: ReadonlySet<string> = new Set(Object.keys(PHASE8_PATHS));

/** API fixtures and storage for a fixture page (call before navigating). */
export async function prepareFixture(
  context: BrowserContext,
  page: Page,
  fixture: Phase7Fixture | Phase8Fixture | undefined,
): Promise<void> {
  if (fixture === undefined) return;
  if (PHASE8_FIXTURES.has(fixture)) {
    await phase8Storage(context, fixture as Phase8Fixture);
    await mockPhase8(page, fixture as Phase8Fixture);
    return;
  }
  await phase7Storage(context, fixture as Phase7Fixture);
  await mockPhase7(page, fixture as Phase7Fixture);
}

/** Waits for the page's own content, then for fonts and lazy chunks. */
export async function ready(page: Page, text: string | RegExp): Promise<void> {
  // Under load a retried request can leave a short idle gap before the data
  // arrives, so a quiet network alone is not proof the page has rendered.
  await expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await settle(page);
}
