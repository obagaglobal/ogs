import {
  documentTotals,
  formatKes,
  lineTotals,
  ORDER_STATUS_LABELS,
  type BillingResponse,
  type ServiceRequest,
  type ServiceRequestListResponse,
} from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Code, Money, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/feedback';
import { Field, Notice } from '@/components/ui/form-controls';
import { FormField } from '@/components/ui/form-field';
import { Input, Select } from '@/components/ui/input';
import { Breadcrumbs } from '@/components/ui/navigation';
import { minorToInput, parseKesToMinor } from '@/features/catalogue/catalogue-data';
import {
  OrderSummary,
  PaymentsTable,
  QuotationView,
  RequestFacts,
  StatusBadge,
  Timeline,
} from '@/features/requests/request-parts';
import {
  formatWhen,
  idempotent,
  orderTone,
  requestLabel,
  termsLabel,
  useIdempotencyKey,
} from '@/features/requests/requests-data';
import { t } from '@/i18n';
import { api, ApiError, describeError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ElevationGate } from './elevation-gate';
import { ELEVATION_KEY, useElevated } from './elevation-state';

const REQUEST_STATUSES: Record<string, string> = {
  '': 'All',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  AWAITING_QUOTATION: 'Awaiting quotation',
  QUOTATION_ISSUED: 'Quotation issued',
  ORDERED: 'Ordered',
  CANCELLED: 'Cancelled',
};

/** Quotation validity choices, in days (the API accepts 1–60). */
const VALIDITY_DAYS = [7, 14, 21, 30, 45, 60];

function forgetExpiredElevation(error: unknown) {
  if (error instanceof ApiError && error.code === 'elevation_required') {
    sessionStorage.removeItem(ELEVATION_KEY);
  }
}

function StatusFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="mb-4 flex items-center gap-3">
      <label htmlFor={id} className="font-display text-sm font-medium">
        Status
      </label>
      <Select
        id={id}
        value={value}
        className="w-auto min-w-48"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </Select>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-9 w-80 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** A staff write returning the updated request; refreshes every staff view. */
function useStaffWrite<V>(
  request: (value: V) => {
    path: string;
    method?: 'POST' | 'PUT';
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  const { options } = useElevated();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: V) => {
      const { path, method, body, headers } = request(value);
      return api<ServiceRequest>(path, {
        method: method ?? 'POST',
        body,
        ...options,
        headers: { ...options.headers, ...headers },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });
}

// ---------------------------------------------------------------- requests

/** /platform/requests — the request queue (platform.quotation.issue). */
export function StaffRequestsPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Requests</h1>
      <ElevationGate>
        <RequestQueue />
      </ElevationGate>
    </div>
  );
}

type QueueRow = ServiceRequestListResponse['requests'][number];

const QUEUE_COLUMNS: Column<QueueRow>[] = [
  {
    key: 'number',
    header: t('requests.col.number'),
    cell: (request) => (
      <Link
        to={`/platform/requests/${request.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        <Code>{request.number}</Code>
      </Link>
    ),
    sortValue: (request) => request.number,
  },
  {
    key: 'customer',
    header: t('requests.col.customer'),
    cell: (request) => request.customerName ?? '—',
    sortValue: (request) => request.customerName ?? '',
  },
  {
    key: 'service',
    header: t('requests.col.service'),
    cell: (request) => request.service.name,
    sortValue: (request) => request.service.name,
  },
  {
    key: 'submitted',
    header: t('requests.col.submitted'),
    cell: (request) => formatWhen(request.createdAt),
    sortValue: (request) => request.createdAt,
  },
  {
    key: 'status',
    header: t('requests.col.status'),
    cell: (request) => <StatusBadge>{requestLabel(request, true)}</StatusBadge>,
    sortValue: (request) => requestLabel(request, true),
  },
];

function RequestQueue() {
  const { options } = useElevated();
  const [status, setStatus] = useState('SUBMITTED');
  const queue = useQuery({
    queryKey: ['platform', 'requests', status],
    queryFn: async () =>
      (
        await api<ServiceRequestListResponse>(
          `/platform/requests${status === '' ? '' : `?status=${status}`}`,
          options,
        )
      ).requests,
    retry: false,
  });
  if (queue.isError) {
    forgetExpiredElevation(queue.error);
  }
  return (
    <div>
      <StatusFilter value={status} options={REQUEST_STATUSES} onChange={setStatus} />
      {queue.isError ? <Notice tone="error">{describeError(queue.error)}</Notice> : null}
      <DataTable
        caption="Request queue"
        columns={QUEUE_COLUMNS}
        rows={queue.data}
        rowKey={(request) => request.id}
        initialSort={{ key: 'submitted', dir: 'desc' }}
        loading={queue.isLoading}
        empty="Nothing here."
        pageSize={20}
        card={(request) => (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <Link
                to={`/platform/requests/${request.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                <Code>{request.number}</Code>
              </Link>
              <StatusBadge>{requestLabel(request, true)}</StatusBadge>
            </div>
            <p className="text-sm">
              {request.service.name} · {request.customerName ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground">{formatWhen(request.createdAt)}</p>
          </div>
        )}
      />
    </div>
  );
}

/** /platform/requests/:id — decide, and write quotations. */
export function StaffRequestPage() {
  return (
    <ElevationGate>
      <StaffRequest />
    </ElevationGate>
  );
}

function StaffRequest() {
  const { id = '' } = useParams();
  const { options } = useElevated();
  const [reason, setReason] = useState('');
  const detail = useQuery({
    queryKey: ['platform', 'request', id],
    queryFn: async () => api<ServiceRequest>(`/platform/requests/${id}`, options),
    retry: false,
  });
  const data = detail.data;
  const decide = useStaffWrite((action: 'review' | 'accept' | 'needs-quotation' | 'cancel') => ({
    path: `/platform/requests/${id}/${action}`,
    body: action === 'cancel' ? { version: data?.version, reason } : { version: data?.version },
  }));
  if (detail.isError) {
    forgetExpiredElevation(detail.error);
    return <Notice tone="error">{describeError(detail.error)}</Notice>;
  }
  if (data === undefined) {
    return <DetailSkeleton />;
  }
  const quoting = data.status === 'AWAITING_QUOTATION' || data.status === 'QUOTATION_ISSUED';
  const fixedPrice = data.price.model === 'FIXED' || data.price.model === 'PER_UNIT';
  const preOrder = ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_QUOTATION', 'QUOTATION_ISSUED'].includes(
    data.status,
  );
  const decisions = data.status === 'SUBMITTED' || data.status === 'UNDER_REVIEW';
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Breadcrumbs
          items={[{ label: t('requests.title'), to: '/platform/requests' }, { label: data.number }]}
        />
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="tabular">{data.number}</span>{' '}
          <StatusBadge>{requestLabel(data, true)}</StatusBadge>
        </h1>
        <p className="text-muted-foreground">
          {data.service.name} · <span className="tabular">{data.price.label}</span>
        </p>
      </div>
      {decide.isError ? <Notice tone="error">{describeError(decide.error)}</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {quoting ? (
            <QuotationEditor
              key={data.quotations.find((q) => q.status === 'DRAFT')?.id ?? 'new'}
              request={data}
            />
          ) : null}
          {data.quotations
            .filter((q) => q.status !== 'DRAFT')
            .map((quotation) => (
              <QuotationView key={quotation.id} quotation={quotation} />
            ))}
          <RequestFacts request={data} />
          <Timeline request={data} />
        </div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-20">
          {decisions || preOrder ? (
            <Card>
              <h2 className="mb-4 font-display text-lg font-medium">{t('requests.decision')}</h2>
              {decisions ? (
                <div className="flex flex-wrap gap-2">
                  {data.status === 'SUBMITTED' ? (
                    <Button
                      disabled={decide.isPending}
                      onClick={() => {
                        decide.mutate('review');
                      }}
                    >
                      Start review
                    </Button>
                  ) : null}
                  {data.status === 'UNDER_REVIEW' && fixedPrice ? (
                    <Button
                      variant="highlight"
                      disabled={decide.isPending}
                      onClick={() => {
                        decide.mutate('accept');
                      }}
                    >
                      Accept at {data.price.label}
                    </Button>
                  ) : null}
                  {data.status === 'UNDER_REVIEW' ? (
                    <Button
                      variant="secondary"
                      disabled={decide.isPending}
                      onClick={() => {
                        decide.mutate('needs-quotation');
                      }}
                    >
                      Needs a quotation
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {preOrder ? (
                <div className={cn('space-y-3', decisions && 'mt-4 border-t border-border pt-4')}>
                  <Field
                    label="Cancellation reason"
                    hint="At least 5 characters; the customer sees it"
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                    }}
                  />
                  <Button
                    variant="danger"
                    disabled={decide.isPending || reason.trim().length < 5}
                    onClick={() => {
                      decide.mutate('cancel');
                    }}
                  >
                    Cancel request
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
          {data.order === null ? null : <OrderSummary order={data.order} />}
        </div>
      </div>
    </div>
  );
}

interface LineDraft {
  description: string;
  quantity: string;
  amount: string;
}

function QuotationEditor({ request }: { request: ServiceRequest }) {
  const draft = request.quotations.find((q) => q.status === 'DRAFT');
  const [lines, setLines] = useState<LineDraft[]>(
    draft?.lines.map((line) => ({
      description: line.description,
      quantity: String(line.quantity),
      amount: minorToInput(line.unitAmountMinor),
    })) ?? [
      {
        description: request.service.name,
        quantity: String(request.quantity),
        amount: minorToInput(request.price.unitAmountMinor),
      },
    ],
  );
  const [validDays, setValidDays] = useState(String(draft?.validDays ?? 14));
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const parsed = lines.map((line) => ({
    description: line.description.trim(),
    quantity: Number.parseInt(line.quantity, 10),
    unitAmountMinor: parseKesToMinor(line.amount),
  }));
  const valid = parsed.every(
    (line) =>
      line.description.length >= 2 &&
      Number.isInteger(line.quantity) &&
      line.quantity >= 1 &&
      line.unitAmountMinor !== null,
  );
  const totals = valid
    ? documentTotals(
        parsed.map((line) =>
          lineTotals({ quantity: line.quantity, unitAmountMinor: line.unitAmountMinor ?? 0 }),
        ),
      )
    : null;
  const save = useStaffWrite(() => ({
    path: `/platform/requests/${request.id}/quotation`,
    method: 'PUT',
    body: { lines: parsed, validDays: Number.parseInt(validDays, 10), notes: notes.trim() },
  }));
  const issue = useStaffWrite(() => ({
    path: `/platform/requests/${request.id}/quotations/${draft?.id ?? ''}/issue`,
    body: { version: draft?.version },
  }));
  const update = (index: number, key: keyof LineDraft, value: string) => {
    setLines(lines.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  };
  // Keep the draft's own validity selectable even if it is not a preset.
  const validityOptions = VALIDITY_DAYS.includes(Number.parseInt(validDays, 10))
    ? VALIDITY_DAYS
    : [...VALIDITY_DAYS, Number.parseInt(validDays, 10)].sort((a, b) => a - b);
  return (
    <Card emphasis>
      <div className="mb-4 space-y-1">
        <h2 className="font-display text-lg font-medium">
          {draft === undefined ? (
            'New quotation'
          ) : (
            <>
              Draft <Code>{draft.number}</Code>
            </>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          Amounts exclude VAT; 16% VAT is added per line.
        </p>
      </div>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      {issue.isError ? <Notice tone="error">{describeError(issue.error)}</Notice> : null}
      <form
        className="space-y-5"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <div>
          {/* Column headings from sm up; each line repeats its labels on phones. */}
          <div
            aria-hidden="true"
            className="hidden gap-3 border-b border-border pb-2 font-display text-xs font-medium uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_9rem_2.75rem]"
          >
            <span>Item</span>
            <span>Qty</span>
            <span>Unit price (KES)</span>
            <span />
          </div>
          {lines.map((line, index) => {
            const n = String(index + 1);
            return (
              <fieldset
                key={index}
                className="grid grid-cols-2 gap-3 border-b border-border py-3 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_2.75rem] sm:items-start"
              >
                <legend className="sr-only">Line {n}</legend>
                <LineInput
                  className="col-span-2 sm:col-span-1"
                  label={`Line ${n} description`}
                  value={line.description}
                  onChange={(value) => {
                    update(index, 'description', value);
                  }}
                />
                <LineInput
                  label={`Line ${n} quantity`}
                  inputMode="numeric"
                  mono
                  value={line.quantity}
                  onChange={(value) => {
                    update(index, 'quantity', value);
                  }}
                />
                <LineInput
                  label={`Line ${n} unit price (KES)`}
                  inputMode="decimal"
                  mono
                  value={line.amount}
                  onChange={(value) => {
                    update(index, 'amount', value);
                  }}
                />
                <div className="col-span-2 flex justify-end sm:col-span-1">
                  {lines.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('quotation.removeLine', { n })}
                      title={t('quotation.removeLine', { n })}
                      onClick={() => {
                        setLines(lines.filter((_, i) => i !== index));
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setLines([...lines, { description: '', quantity: '1', amount: '' }]);
            }}
          >
            <Plus aria-hidden="true" />
            {t('quotation.addLine')}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <FormField label="Valid for">
            {(ids) => (
              <Select
                {...ids}
                value={validDays}
                onChange={(event) => {
                  setValidDays(event.target.value);
                }}
              >
                {validityOptions.map((days) => (
                  <option key={days} value={String(days)}>
                    {days} days
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <Field
            label="Notes for the customer"
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
        </div>
        <div
          className="rounded-md border border-border bg-surface-muted px-4 py-3"
          aria-label={t('quotation.totals')}
          role="group"
        >
          <p
            className={cn('text-sm', totals !== null && 'tabular text-base text-ink')}
            aria-live="polite"
          >
            {totals === null
              ? 'Complete every line to see the totals.'
              : `Subtotal ${formatKes(totals.subtotalMinor)} + VAT ${formatKes(totals.vatMinor)} = ${formatKes(totals.totalMinor)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={save.isPending || !valid}>
            Save draft
          </Button>
          {draft === undefined ? null : (
            <Button
              type="button"
              variant="highlight"
              disabled={issue.isPending || save.isPending}
              onClick={() => {
                issue.mutate(undefined);
              }}
            >
              Issue quotation
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/** A quotation-line input: labelled on phones, column headings label it from sm up. */
function LineInput({
  label,
  value,
  onChange,
  inputMode,
  mono = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: 'numeric' | 'decimal';
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block font-display text-sm font-medium sm:sr-only">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        {...(inputMode ? { inputMode } : {})}
        className={cn(mono && 'tabular')}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- finance

interface OrderRow {
  id: string;
  number: string;
  status: keyof typeof ORDER_STATUS_LABELS;
  totalMinor: number;
  paidMinor: number;
  refundDue: boolean;
  createdAt: string;
  requestNumber: string;
  serviceName: string;
  customerName: string | null;
}

/** /platform/orders — orders and payments (platform.finance.manage). */
export function OrdersPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {t('orders.title')}
      </h1>
      <ElevationGate>
        <OrderList />
      </ElevationGate>
    </div>
  );
}

const ORDER_COLUMNS: Column<OrderRow>[] = [
  {
    key: 'order',
    header: t('orders.col.order'),
    cell: (order) => (
      <Link
        to={`/platform/orders/${order.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        <Code>{order.number}</Code>
      </Link>
    ),
    sortValue: (order) => order.number,
  },
  {
    key: 'customer',
    header: t('requests.col.customer'),
    cell: (order) => (
      <span>
        {order.customerName ?? '—'}
        <span className="block text-xs text-muted-foreground">{order.serviceName}</span>
      </span>
    ),
    sortValue: (order) => order.customerName ?? '',
  },
  {
    key: 'total',
    header: t('orders.col.total'),
    cell: (order) => <Money minor={order.totalMinor} />,
    sortValue: (order) => order.totalMinor,
    numeric: true,
  },
  {
    key: 'paid',
    header: t('orders.col.paid'),
    cell: (order) => <Money minor={order.paidMinor} />,
    sortValue: (order) => order.paidMinor,
    numeric: true,
  },
  {
    key: 'balance',
    header: t('orders.col.balance'),
    cell: (order) => <Money minor={order.totalMinor - order.paidMinor} />,
    sortValue: (order) => order.totalMinor - order.paidMinor,
    numeric: true,
  },
  {
    key: 'status',
    header: t('requests.col.status'),
    cell: (order) => (
      <StatusBadge tone={orderTone(order.status)}>{ORDER_STATUS_LABELS[order.status]}</StatusBadge>
    ),
    sortValue: (order) => ORDER_STATUS_LABELS[order.status],
  },
];

function OrderList() {
  const { options } = useElevated();
  const [status, setStatus] = useState('AWAITING_PAYMENT');
  const orders = useQuery({
    queryKey: ['platform', 'orders', status],
    queryFn: async () =>
      (
        await api<{ orders: OrderRow[] }>(
          `/platform/orders${status === '' ? '' : `?status=${status}`}`,
          options,
        )
      ).orders,
    retry: false,
  });
  if (orders.isError) {
    forgetExpiredElevation(orders.error);
  }
  return (
    <div>
      <StatusFilter
        value={status}
        options={{ '': 'All', ...ORDER_STATUS_LABELS }}
        onChange={setStatus}
      />
      {orders.isError ? <Notice tone="error">{describeError(orders.error)}</Notice> : null}
      <DataTable
        caption={t('orders.title')}
        columns={ORDER_COLUMNS}
        rows={orders.data}
        rowKey={(order) => order.id}
        initialSort={{ key: 'order', dir: 'desc' }}
        loading={orders.isLoading}
        empty="Nothing here."
        pageSize={20}
        card={(order) => (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <Link
                to={`/platform/orders/${order.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                <Code>{order.number}</Code>
              </Link>
              <StatusBadge tone={orderTone(order.status)}>
                {ORDER_STATUS_LABELS[order.status]}
              </StatusBadge>
            </div>
            <p className="text-sm">
              {order.customerName ?? '—'} · {order.serviceName}
            </p>
            <p className="text-sm">
              <Money minor={order.paidMinor} /> of <Money minor={order.totalMinor} />
            </p>
          </div>
        )}
      />
    </div>
  );
}

/** /platform/orders/:id — record payments, cancel, billing terms. */
export function OrderPage() {
  return (
    <ElevationGate>
      <FinanceOrder />
    </ElevationGate>
  );
}

function FinanceOrder() {
  const { id = '' } = useParams();
  const { options } = useElevated();
  const detail = useQuery({
    queryKey: ['platform', 'order', id],
    queryFn: async () => api<ServiceRequest>(`/platform/orders/${id}`, options),
    retry: false,
  });
  if (detail.isError) {
    forgetExpiredElevation(detail.error);
    return <Notice tone="error">{describeError(detail.error)}</Notice>;
  }
  const data = detail.data;
  if (data === undefined || data.order === null) {
    return <DetailSkeleton />;
  }
  const order = data.order;
  const balance = order.totalMinor - order.paidMinor;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Breadcrumbs
          items={[{ label: t('orders.title'), to: '/platform/orders' }, { label: order.number }]}
        />
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="tabular">{order.number}</span>{' '}
          <StatusBadge tone={orderTone(order.status)}>
            {ORDER_STATUS_LABELS[order.status]}
          </StatusBadge>
        </h1>
        <p className="text-muted-foreground">
          for <Code>{data.number}</Code> · {data.service.name} · {termsLabel(order)}
        </p>
        {order.refundDue ? (
          <p className="text-sm text-danger">Refund due: OGS finance will contact the customer.</p>
        ) : null}
        {order.cancelReason === null ? null : (
          <p className="text-sm text-muted-foreground">Cancelled: {order.cancelReason}</p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label={t('orders.total')} value={<Money minor={order.totalMinor} />} />
        <StatTile label={t('orders.paid')} value={<Money minor={order.paidMinor} />} />
        <StatTile label={t('orders.balance')} value={<Money minor={balance} />} emphasis />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {order.status === 'AWAITING_PAYMENT' ? (
            <PaymentForm orderId={order.id} balance={balance} />
          ) : null}
          {order.payments.length > 0 ? (
            <Card>
              <h2 className="mb-3 font-display text-lg font-medium">{t('orders.payments')}</h2>
              <PaymentsTable payments={order.payments} />
            </Card>
          ) : null}
          <RequestFacts request={data} />
          <Timeline request={data} />
        </div>
        <div className="min-w-0 space-y-6">
          {data.customerTenantId === null ? null : (
            <BillingTerms tenantId={data.customerTenantId} />
          )}
          {order.status !== 'CANCELLED' ? (
            <CancelOrder orderId={order.id} version={order.version} paid={order.paidMinor > 0} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PaymentForm({ orderId, balance }: { orderId: string; balance: number }) {
  const idempotency = useIdempotencyKey();
  const [amount, setAmount] = useState(minorToInput(balance));
  const [method, setMethod] = useState('MPESA_PAYBILL');
  const [reference, setReference] = useState('');
  const amountMinor = parseKesToMinor(amount);
  const record = useStaffWrite(() => ({
    path: `/platform/orders/${orderId}/payments`,
    body: { amountMinor, method, reference: reference.trim() },
    headers: idempotent(idempotency.key()),
  }));
  return (
    <Card emphasis>
      <h2 className="mb-1 font-display text-lg font-medium">Record a payment</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Balance due: <Money minor={balance} />
      </p>
      {record.isError ? <Notice tone="error">{describeError(record.error)}</Notice> : null}
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          record.mutate(undefined, {
            onSuccess: () => {
              idempotency.renew();
              setReference('');
            },
          });
        }}
      >
        <FormField
          label="Amount (KES)"
          error={
            amount !== '' && amountMinor === null ? 'Use a number like 4060 or 4060.50' : undefined
          }
        >
          {(ids) => (
            <div className="relative">
              <span
                aria-hidden="true"
                className="tabular pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
              >
                KES
              </span>
              <Input
                {...ids}
                inputMode="decimal"
                value={amount}
                className="tabular pl-12"
                onChange={(event) => {
                  setAmount(event.target.value);
                }}
              />
            </div>
          )}
        </FormField>
        <FormField label="Method">
          {(ids) => (
            <Select
              {...ids}
              value={method}
              onChange={(event) => {
                setMethod(event.target.value);
              }}
            >
              <option value="MPESA_PAYBILL">M-Pesa paybill</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
            </Select>
          )}
        </FormField>
        <FormField label="Reference" help="M-Pesa code or bank reference" className="sm:col-span-2">
          {(ids) => (
            <Input
              {...ids}
              value={reference}
              className="tabular sm:max-w-xs"
              autoComplete="off"
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          )}
        </FormField>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            variant="highlight"
            disabled={
              record.isPending ||
              amountMinor === null ||
              amountMinor <= 0 ||
              reference.trim().length < 3
            }
          >
            Record payment
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CancelOrder({
  orderId,
  version,
  paid,
}: {
  orderId: string;
  version: number;
  paid: boolean;
}) {
  const [reason, setReason] = useState('');
  const cancel = useStaffWrite(() => ({
    path: `/platform/orders/${orderId}/cancel`,
    body: { version, reason },
  }));
  return (
    <Card className="border-danger">
      <h2 className="mb-1 font-display text-lg font-medium">Cancel the order</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {paid
          ? 'Payments were made: the order will be marked "refund due".'
          : 'The customer is told by email.'}
      </p>
      {cancel.isError ? <Notice tone="error">{describeError(cancel.error)}</Notice> : null}
      <div className="space-y-3">
        <Field
          label="Reason"
          hint="At least 5 characters"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <Button
          variant="danger"
          disabled={cancel.isPending || reason.trim().length < 5}
          onClick={() => {
            cancel.mutate(undefined);
          }}
        >
          Cancel order
        </Button>
      </div>
    </Card>
  );
}

function BillingTerms({ tenantId }: { tenantId: string }) {
  const { options } = useElevated();
  const queryClient = useQueryClient();
  const billing = useQuery({
    queryKey: ['platform', 'billing', tenantId],
    queryFn: async () =>
      api<BillingResponse>(`/platform/organisations/${tenantId}/billing`, options),
    retry: false,
  });
  const [terms, setTerms] = useState<string | null>(null);
  const [netDays, setNetDays] = useState<string | null>(null);
  const current = billing.data;
  const chosen = terms ?? current?.paymentTerms ?? 'PREPAY';
  const days = netDays ?? String(current?.netDays ?? 30);
  const save = useMutation({
    mutationFn: async () =>
      api<BillingResponse>(`/platform/organisations/${tenantId}/billing`, {
        method: 'PUT',
        body: {
          paymentTerms: chosen,
          netDays: chosen === 'POSTPAID' ? Number.parseInt(days, 10) : null,
        },
        ...options,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform', 'billing', tenantId] }),
  });
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-display text-lg font-medium">Organisation billing terms</h2>
        {current === undefined ? null : <Badge>{termsLabel(current)}</Badge>}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Applies to new orders only; existing orders keep their terms.
      </p>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">Billing terms saved.</Notice> : null}
      <div className="space-y-3">
        <FormField label="Terms">
          {(ids) => (
            <Select
              {...ids}
              value={chosen}
              onChange={(event) => {
                setTerms(event.target.value);
              }}
            >
              <option value="PREPAY">Prepay</option>
              <option value="POSTPAID">Postpaid (invoice)</option>
            </Select>
          )}
        </FormField>
        {chosen === 'POSTPAID' ? (
          <Field
            label="Net days"
            inputMode="numeric"
            value={days}
            onChange={(event) => {
              setNetDays(event.target.value);
            }}
          />
        ) : null}
        <Button
          variant="secondary"
          disabled={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          Save terms
        </Button>
      </div>
    </Card>
  );
}
