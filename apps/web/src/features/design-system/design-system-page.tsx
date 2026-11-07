import { useState, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { StatusPill, type Status } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Checkbox, RadioGroup, RadioGroupItem, Switch } from '@/components/ui/choice-controls';
import { Avatar, Code, Money, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Alert, EmptyState, ErrorState, RouteFallback, Skeleton } from '@/components/ui/feedback';
import { FileUpload } from '@/components/ui/file-upload';
import { FormField } from '@/components/ui/form-field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { KitengeMotif } from '@/components/ui/kitenge-motif';
import {
  Breadcrumbs,
  Pagination,
  Stepper,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Timeline,
} from '@/components/ui/navigation';
import {
  DialogContent,
  DialogRoot,
  DialogTrigger,
  Drawer,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Tooltip,
} from '@/components/ui/overlays';
import { Combobox, DatePicker } from '@/components/ui/pickers';
import { useCurrentWorkspace } from '@/features/workspace/workspace-state';
import { t } from '@/i18n';
import { useTheme, type ThemeChoice } from '@/theme/theme';

/**
 * /design-system: the living reference for Kitenge signal (Phase 6b). Shown in
 * development builds and, in production, to platform staff only. It is the one
 * signed-in page allowed to show the motif more than once: it documents it.
 */
const TOKENS: { name: string; swatch: string; note: string }[] = [
  { name: 'ink', swatch: 'bg-ink', note: 'Text, primary buttons' },
  { name: 'paper', swatch: 'bg-paper', note: 'Page background' },
  { name: 'surface', swatch: 'bg-surface', note: 'Cards, inputs' },
  { name: 'surface-muted', swatch: 'bg-surface-muted', note: 'Hover, table header' },
  { name: 'muted', swatch: 'bg-muted-foreground', note: 'Secondary text' },
  { name: 'border', swatch: 'bg-border', note: 'Hairlines' },
  { name: 'control-border', swatch: 'bg-control-border', note: 'Input outlines (3:1)' },
  { name: 'saffron', swatch: 'bg-saffron', note: 'Highlight, focus, live' },
  { name: 'danger', swatch: 'bg-danger', note: 'Errors, destructive' },
  { name: 'success', swatch: 'bg-success', note: 'Done, paid' },
  { name: 'warning', swatch: 'bg-warning', note: 'Pending, attention' },
];

const TYPE_SCALE: { label: string; className: string }[] = [
  { label: '48 · Display', className: 'font-display text-5xl font-bold' },
  { label: '36 · Page hero', className: 'font-display text-4xl font-bold' },
  { label: '28 · Page title', className: 'font-display text-3xl font-bold' },
  { label: '22 · Section', className: 'font-display text-2xl font-medium' },
  { label: '18 · Card title', className: 'font-display text-lg font-medium' },
  { label: '16 · Body', className: 'text-base' },
  { label: '14 · Small', className: 'text-sm' },
  { label: '12 · Caption', className: 'text-xs' },
];

const STATUSES: Status[] = [
  'draft',
  'pending',
  'active',
  'live',
  'completed',
  'paid',
  'overdue',
  'breached',
  'suspended',
];

interface SampleOrder {
  number: string;
  customer: string;
  status: Status;
  totalMinor: number;
}
const ORDERS: SampleOrder[] = [
  { number: 'ORD-2026-000067', customer: 'Acme Kenya Ltd', status: 'paid', totalMinor: 8_450_000 },
  { number: 'ORD-2026-000068', customer: 'Grace Achieng', status: 'pending', totalMinor: 406_000 },
  {
    number: 'ORD-2026-000069',
    customer: 'Mombasa Port Clinic',
    status: 'overdue',
    totalMinor: 1_276_000,
  },
  {
    number: 'ORD-2026-000070',
    customer: 'Kisumu Agro Co-op',
    status: 'completed',
    totalMinor: 2_320_000,
  },
];
const ORDER_COLUMNS: Column<SampleOrder>[] = [
  {
    key: 'number',
    header: 'Order',
    cell: (o) => <Code>{o.number}</Code>,
    sortValue: (o) => o.number,
  },
  { key: 'customer', header: 'Customer', cell: (o) => o.customer, sortValue: (o) => o.customer },
  { key: 'status', header: 'Status', cell: (o) => <StatusPill status={o.status} /> },
  {
    key: 'total',
    header: 'Total',
    cell: (o) => <Money minor={o.totalMinor} />,
    sortValue: (o) => o.totalMinor,
    numeric: true,
  },
];

const COUNTIES = ['Nairobi City', 'Mombasa', 'Kisumu', 'Nakuru', 'Uasin Gishu', 'Kiambu'].map(
  (name) => ({ value: name, label: name }),
);

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 border-t border-border pt-8">
      <h2 id={id} className="font-display text-2xl font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

function fakeUpload(_file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve) => {
    let done = 0;
    const timer = window.setInterval(() => {
      done += 0.2;
      onProgress(Math.min(done, 1));
      if (done >= 1) {
        window.clearInterval(timer);
        resolve();
      }
    }, 200);
  });
}

export function DesignSystemPage() {
  const workspace = useCurrentWorkspace();
  const { choice, setChoice } = useTheme();
  const [county, setCounty] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [page, setPage] = useState(2);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const staff = workspace.data?.kind === 'PLATFORM';
  if (!import.meta.env.DEV) {
    if (workspace.isLoading) return <RouteFallback />;
    if (!staff) return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Kitenge signal"
        title={t('design.title')}
        description={t('design.intro')}
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="ds-theme" className="text-sm font-medium">
              {t('shell.theme')}
            </label>
            <Select
              id="ds-theme"
              value={choice}
              className="w-auto"
              onChange={(event) => {
                setChoice(event.target.value as ThemeChoice);
              }}
            >
              <option value="light">{t('shell.theme.light')}</option>
              <option value="dark">{t('shell.theme.dark')}</option>
              <option value="system">{t('shell.theme.system')}</option>
            </Select>
          </div>
        }
      />

      <Section id="ds-colour" title="Colour tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TOKENS.map((token) => (
            <li key={token.name} className="rounded-md border border-border bg-surface p-3">
              <span
                aria-hidden="true"
                className={`mb-2 block h-12 rounded-sm border border-border ${token.swatch}`}
              />
              <Code>--{token.name}</Code>
              <p className="text-xs text-muted-foreground">{token.note}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="ds-type" title="Typography">
        <div className="space-y-3">
          {TYPE_SCALE.map((style) => (
            <div key={style.label} className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{style.label}</span>
              <span className={style.className}>Habari, Wanjiru</span>
            </div>
          ))}
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">Mono · money, IDs</span>
            <span>
              <Money minor={8_450_000} /> · <Code>REQ-2026-000123</Code>
            </span>
          </div>
        </div>
      </Section>

      <Section id="ds-buttons" title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="highlight">Request this service</Button>
          <Button variant="danger">Cancel order</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section id="ds-forms" title="Form controls">
        <div className="grid gap-6 md:grid-cols-2">
          <FormField label="Contact phone" help="Safaricom or Airtel, e.g. 0712 345 678">
            {(ids) => <Input {...ids} inputMode="tel" placeholder="0712 345 678" />}
          </FormField>
          <FormField label="Quantity" error="Enter at least 5 devices">
            {(ids) => <Input {...ids} type="number" defaultValue={2} />}
          </FormField>
          <FormField label="Delivery">
            {(ids) => (
              <Select {...ids} defaultValue="ON_SITE">
                <option value="ON_SITE">On site</option>
                <option value="REMOTE">Remote</option>
              </Select>
            )}
          </FormField>
          <FormField label="County">
            {(ids) => (
              <Combobox
                {...ids}
                options={COUNTIES}
                value={county}
                onChange={setCounty}
                placeholder="Choose a county"
                searchLabel="Search counties"
              />
            )}
          </FormField>
          <FormField label="Preferred date">
            {(ids) => (
              <DatePicker {...ids} value={date} onChange={setDate} disabledBefore={new Date()} />
            )}
          </FormField>
          <FormField label="Details" optional>
            {(ids) => <Textarea {...ids} placeholder="What should the technician know?" />}
          </FormField>
          <FileUpload
            label="KRA PIN certificate"
            help="PDF or image, up to 10 MB (demo upload)"
            accept="application/pdf,image/*"
            upload={fakeUpload}
          />
          <fieldset className="space-y-3">
            <legend className="mb-2 font-display text-sm font-medium">Choices</legend>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox defaultChecked /> Email me when the quotation is ready
            </label>
            <label className="flex items-center gap-3 text-sm">
              <Switch defaultChecked /> Postpaid terms
            </label>
            <RadioGroup defaultValue="mpesa" aria-label="Payment method">
              <label className="flex items-center gap-3 text-sm">
                <RadioGroupItem value="mpesa" /> M-Pesa paybill
              </label>
              <label className="flex items-center gap-3 text-sm">
                <RadioGroupItem value="bank" /> Bank transfer
              </label>
            </RadioGroup>
          </fieldset>
        </div>
      </Section>

      <Section id="ds-status" title="Badges and status">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section id="ds-data" title="Cards, stats and tables">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Open requests" value={12} hint="3 need a quotation" />
          <StatTile label="Paid this month" value={<Money minor={84_500_00} />} emphasis />
          <StatTile label="Overdue" value={2} />
        </div>
        <Card>
          <CardHeader title="Recent orders" description="Sortable columns, paginated rows." />
          <DataTable
            caption="Recent orders"
            columns={ORDER_COLUMNS}
            rows={ORDERS}
            rowKey={(order) => order.number}
            pageSize={3}
          />
        </Card>
        <Card>
          <CardHeader title="Loading and empty" />
          <div className="grid gap-4 md:grid-cols-2">
            <DataTable
              caption="Loading"
              columns={ORDER_COLUMNS}
              rows={undefined}
              rowKey={(o) => o.number}
              loading
            />
            <DataTable
              caption="Empty"
              columns={ORDER_COLUMNS}
              rows={[]}
              rowKey={(o) => o.number}
              empty="No orders yet."
            />
          </div>
        </Card>
        <div className="flex items-center gap-3">
          <Avatar name="Wanjiru Kamau" />
          <Avatar name="otieno.amina@example.co.ke" size={40} />
        </div>
      </Section>

      <Section id="ds-nav" title="Navigation">
        <Breadcrumbs
          items={[
            { label: 'Services', to: '/services' },
            { label: 'Networks & Wi-Fi', to: '/services' },
            { label: 'Home Wi-Fi setup' },
          ]}
        />
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="quotation">Quotation</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="details">Request details go here.</TabsContent>
          <TabsContent value="quotation">The quotation and its lines.</TabsContent>
          <TabsContent value="history">Every change, newest last.</TabsContent>
        </Tabs>
        <Stepper steps={['Service', 'Details', 'Review']} current={1} />
        <Timeline
          label="Sample history"
          entries={[
            { key: '1', title: 'Request: submitted', meta: '6 Nov 2026, 09:12' },
            { key: '2', title: 'Request: under review', meta: '6 Nov 2026, 10:03' },
            {
              key: '3',
              title: 'Quotation issued',
              meta: '6 Nov 2026, 14:40',
              body: 'Valid for 14 days.',
            },
          ]}
        />
        <Pagination page={page} pages={5} onPage={setPage} />
      </Section>

      <Section id="ds-overlays" title="Overlays">
        <div className="flex flex-wrap gap-3">
          <DialogRoot>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="Cancel this request?"
              description="The customer is told by email. This cannot be undone."
              footer={
                <>
                  <Button variant="ghost">Keep it</Button>
                  <Button variant="danger">Cancel request</Button>
                </>
              }
            />
          </DialogRoot>
          <Button
            variant="secondary"
            onClick={() => {
              setDrawerOpen(true);
            }}
          >
            Open drawer
          </Button>
          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Filters" side="right">
            <p className="text-sm">Drawers slide up on phones and in from the side elsewhere.</p>
          </Drawer>
          <MenuRoot>
            <MenuTrigger asChild>
              <Button variant="secondary">Open menu</Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem>View order</MenuItem>
              <MenuItem>Record payment</MenuItem>
            </MenuContent>
          </MenuRoot>
          <Tooltip content="Prices exclude 16% VAT">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
          <Button
            variant="secondary"
            onClick={() => {
              toast.success('Payment recorded', { description: 'KES 84,500 by M-Pesa.' });
            }}
          >
            Show toast
          </Button>
        </div>
      </Section>

      <Section id="ds-feedback" title="Feedback">
        <div className="space-y-3">
          <Alert title="Heads up">Quotations expire after 14 days.</Alert>
          <Alert tone="success" title="Payment recorded">
            The order is ready for assignment.
          </Alert>
          <Alert tone="warning" title="Waiting for approval">
            OGS is reviewing this organisation.
          </Alert>
          <Alert tone="error" title="Could not save">
            Check the highlighted fields.
          </Alert>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            title="No requests yet"
            body="When you request a service, it shows up here."
            action={<Button variant="secondary">Find a service</Button>}
          />
          <ErrorState onRetry={() => undefined} />
        </div>
      </Section>

      <Section id="ds-motif" title="Kitenge motif">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Only in the public header strip, the public hero, empty states, the page loader, sign-in
          and sign-up, and marketing dividers. Never behind text, in tables or forms; at most once
          per screen in signed-in workspaces. This page is the documented exception.
        </p>
        <div className="space-y-4">
          <KitengeMotif variant="band" height={14} />
          <KitengeMotif variant="band" tone="saffron-only" height={10} />
          <KitengeMotif variant="divider" tone="muted" height={8} />
          <KitengeMotif variant="corner" height={16} />
        </div>
      </Section>
    </div>
  );
}
