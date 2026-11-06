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
import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Money } from '@/components/ui/data-display';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import { minorToInput, parseKesToMinor } from '@/features/catalogue/catalogue-data';
import {
  OrderSummary,
  QuotationView,
  RequestFacts,
  StatusBadge,
  Timeline,
} from '@/features/requests/request-parts';
import {
  formatWhen,
  idempotent,
  requestLabel,
  useIdempotencyKey,
} from '@/features/requests/requests-data';
import { api, ApiError, describeError } from '@/lib/api';
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

function forgetExpiredElevation(error: unknown) {
  if (error instanceof ApiError && error.code === 'elevation_required') {
    sessionStorage.removeItem(ELEVATION_KEY);
  }
}

function StatusFilter({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        Status
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-11 md:min-h-9 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
      >
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
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
    <Card>
      <StatusFilter
        id="request-status"
        value={status}
        options={REQUEST_STATUSES}
        onChange={setStatus}
      />
      {queue.isError ? <Notice tone="error">{describeError(queue.error)}</Notice> : null}
      <ul className="divide-y text-sm" aria-label="Request queue">
        {(queue.data ?? []).map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <Link
                to={`/platform/requests/${request.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {request.number}
              </Link>{' '}
              · {request.service.name} · {request.customerName ?? '—'}
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {formatWhen(request.createdAt)}
              <StatusBadge>{requestLabel(request, true)}</StatusBadge>
            </span>
          </li>
        ))}
        {queue.data?.length === 0 ? (
          <li className="py-2 text-muted-foreground">Nothing here.</li>
        ) : null}
      </ul>
    </Card>
  );
}

/** /platform/requests/:id — decide, and write quotations. */
export function StaffRequestPage() {
  return (
    <div className="space-y-6">
      <Link to="/platform/requests" className="text-sm underline-offset-4 hover:underline">
        ← Requests
      </Link>
      <ElevationGate>
        <StaffRequest />
      </ElevationGate>
    </div>
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
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const quoting = data.status === 'AWAITING_QUOTATION' || data.status === 'QUOTATION_ISSUED';
  const fixedPrice = data.price.model === 'FIXED' || data.price.model === 'PER_UNIT';
  const preOrder = ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_QUOTATION', 'QUOTATION_ISSUED'].includes(
    data.status,
  );
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {data.number} <StatusBadge>{requestLabel(data, true)}</StatusBadge>
      </h1>
      {decide.isError ? <Notice tone="error">{describeError(decide.error)}</Notice> : null}
      <Card>
        <h2 className="mb-3 font-medium">Decision</h2>
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
              variant="outline"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate('needs-quotation');
              }}
            >
              Needs a quotation
            </Button>
          ) : null}
        </div>
        {preOrder ? (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field
              label="Cancellation reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <Button
              variant="destructive"
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
      {data.order === null ? null : <OrderSummary order={data.order} />}
      <RequestFacts request={data} />
      <Timeline request={data} />
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
  return (
    <Card>
      <h2 className="mb-1 font-medium">
        {draft === undefined ? 'New quotation' : `Draft ${draft.number}`}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Amounts exclude VAT; 16% VAT is added per line.
      </p>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      {issue.isError ? <Notice tone="error">{describeError(issue.error)}</Notice> : null}
      <form
        className="space-y-3"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        {lines.map((line, index) => (
          <fieldset key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-6">
            <legend className="sr-only">Line {index + 1}</legend>
            <div className="sm:col-span-3">
              <Field
                label={`Line ${String(index + 1)} description`}
                value={line.description}
                onChange={(event) => {
                  update(index, 'description', event.target.value);
                }}
              />
            </div>
            <Field
              label={`Line ${String(index + 1)} quantity`}
              inputMode="numeric"
              value={line.quantity}
              onChange={(event) => {
                update(index, 'quantity', event.target.value);
              }}
            />
            <div className="sm:col-span-2">
              <Field
                label={`Line ${String(index + 1)} unit price (KES)`}
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => {
                  update(index, 'amount', event.target.value);
                }}
              />
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLines([...lines, { description: '', quantity: '1', amount: '' }]);
            }}
          >
            Add line
          </Button>
          {lines.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLines(lines.slice(0, -1));
              }}
            >
              Remove last line
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Valid for (days)"
            inputMode="numeric"
            value={validDays}
            onChange={(event) => {
              setValidDays(event.target.value);
            }}
          />
          <div className="sm:col-span-2">
            <Field
              label="Notes for the customer"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </div>
        </div>
        <p className={totals === null ? 'text-sm' : 'tabular text-sm'} aria-live="polite">
          {totals === null
            ? 'Complete every line to see the totals.'
            : `Subtotal ${formatKes(totals.subtotalMinor)} + VAT ${formatKes(totals.vatMinor)} = ${formatKes(totals.totalMinor)}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={save.isPending || !valid}>
            Save draft
          </Button>
          {draft === undefined ? null : (
            <Button
              type="button"
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
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Orders</h1>
      <ElevationGate>
        <OrderList />
      </ElevationGate>
    </div>
  );
}

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
    <Card>
      <StatusFilter
        id="order-status"
        value={status}
        options={{ '': 'All', ...ORDER_STATUS_LABELS }}
        onChange={setStatus}
      />
      {orders.isError ? <Notice tone="error">{describeError(orders.error)}</Notice> : null}
      <ul className="divide-y text-sm" aria-label="Orders">
        {(orders.data ?? []).map((order) => (
          <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <Link
                to={`/platform/orders/${order.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {order.number}
              </Link>{' '}
              · {order.serviceName} · {order.customerName ?? '—'}
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <Money minor={order.paidMinor} /> of <Money minor={order.totalMinor} />
              <StatusBadge>{ORDER_STATUS_LABELS[order.status]}</StatusBadge>
            </span>
          </li>
        ))}
        {orders.data?.length === 0 ? (
          <li className="py-2 text-muted-foreground">Nothing here.</li>
        ) : null}
      </ul>
    </Card>
  );
}

/** /platform/orders/:id — record payments, cancel, billing terms. */
export function OrderPage() {
  return (
    <div className="space-y-6">
      <Link to="/platform/orders" className="text-sm underline-offset-4 hover:underline">
        ← Orders
      </Link>
      <ElevationGate>
        <FinanceOrder />
      </ElevationGate>
    </div>
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
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {data.order.number}{' '}
        <span className="text-base font-normal text-muted-foreground">for {data.number}</span>
      </h1>
      <OrderSummary order={data.order} />
      {data.order.status === 'AWAITING_PAYMENT' ? (
        <PaymentForm
          orderId={data.order.id}
          balance={data.order.totalMinor - data.order.paidMinor}
        />
      ) : null}
      {data.order.status !== 'CANCELLED' ? (
        <CancelOrder
          orderId={data.order.id}
          version={data.order.version}
          paid={data.order.paidMinor > 0}
        />
      ) : null}
      {data.customerTenantId === null ? null : <BillingTerms tenantId={data.customerTenantId} />}
      <RequestFacts request={data} />
      <Timeline request={data} />
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
    <Card>
      <h2 className="mb-3 font-medium">Record a payment</h2>
      {record.isError ? <Notice tone="error">{describeError(record.error)}</Notice> : null}
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-4"
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
        <Field
          label="Amount (KES)"
          inputMode="decimal"
          value={amount}
          error={
            amount !== '' && amountMinor === null ? 'Use a number like 4060 or 4060.50' : undefined
          }
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
        <div className="space-y-1.5">
          <label htmlFor="payment-method" className="text-sm font-medium">
            Method
          </label>
          <select
            id="payment-method"
            value={method}
            onChange={(event) => {
              setMethod(event.target.value);
            }}
            className="min-h-11 md:min-h-10 w-full rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
          >
            <option value="MPESA_PAYBILL">M-Pesa paybill</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </div>
        <Field
          label="Reference"
          hint="M-Pesa code or bank reference"
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
          }}
        />
        <div className="flex items-end">
          <Button
            type="submit"
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
    <Card>
      <h2 className="mb-1 font-medium">Cancel the order</h2>
      {paid ? (
        <p className="mb-2 text-sm text-muted-foreground">
          Payments were made: the order will be marked "refund due".
        </p>
      ) : null}
      {cancel.isError ? <Notice tone="error">{describeError(cancel.error)}</Notice> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <Button
          variant="destructive"
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
      <h2 className="mb-1 font-medium">Organisation billing terms</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Applies to new orders only; existing orders keep their terms.
      </p>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">Billing terms saved.</Notice> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="billing-terms" className="text-sm font-medium">
            Terms
          </label>
          <select
            id="billing-terms"
            value={chosen}
            onChange={(event) => {
              setTerms(event.target.value);
            }}
            className="min-h-11 md:min-h-10 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
          >
            <option value="PREPAY">Prepay</option>
            <option value="POSTPAID">Postpaid (invoice)</option>
          </select>
        </div>
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
          variant="outline"
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
