import {
  documentTotals,
  lineTotals,
  type PublicServiceDetail,
  type ServiceRequest,
} from '@ogs/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Money } from '@/components/ui/data-display';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import { useRegions } from '@/features/provider/provider-data';
import { useCurrentWorkspace, useWorkspace } from '@/features/workspace/workspace-state';
import { api, describeError } from '@/lib/api';
import { OrderSummary, QuotationView, RequestFacts, StatusBadge, Timeline } from './request-parts';
import {
  formatWhen,
  idempotent,
  requestLabel,
  useIdempotencyKey,
  useMyRequest,
  useMyRequests,
  useRequestWrite,
} from './requests-data';

/** Only the personal workspace and active organisation workspaces can order. */
function useCustomerWorkspace(): { ok: boolean; label: string } {
  const { selected, current } = useWorkspace();
  const workspace = useCurrentWorkspace();
  if (selected === 'personal') {
    return { ok: true, label: 'yourself' };
  }
  const data = workspace.data;
  const ok = data?.kind === 'ORGANISATION' && !data.restricted;
  return { ok, label: current?.name ?? 'your organisation' };
}

function WrongWorkspace() {
  return (
    <Notice>
      Requests are made from your personal workspace or an active organisation workspace. Switch
      workspace in the menu above.
    </Notice>
  );
}

// ---------------------------------------------------------------- new request

/** /requests/new?service=<slug> — request a catalogue service (Phase 7 plan §2.3). */
export function NewRequestPage() {
  const [params] = useSearchParams();
  const slug = params.get('service') ?? '';
  const customer = useCustomerWorkspace();
  const service = useQuery({
    queryKey: ['catalogue', 'service', slug],
    queryFn: async () => api<PublicServiceDetail>(`/catalogue/services/${slug}`),
    enabled: slug !== '',
    retry: false,
  });
  if (!customer.ok) {
    return <WrongWorkspace />;
  }
  if (slug === '') {
    return (
      <Notice>
        Choose a service in the{' '}
        <Link to="/services" className="underline">
          catalogue
        </Link>{' '}
        first.
      </Notice>
    );
  }
  if (service.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (service.isError || service.data === undefined) {
    return <Notice tone="error">This service is not available any more.</Notice>;
  }
  return <RequestForm service={service.data} forWhom={customer.label} />;
}

function RequestForm({ service, forWhom }: { service: PublicServiceDetail; forWhom: string }) {
  const navigate = useNavigate();
  const { selected } = useWorkspace();
  const regions = useRegions();
  const idempotency = useIdempotencyKey();
  const price = service.price;
  const perUnit = price?.model === 'PER_UNIT';
  const [form, setForm] = useState({
    quantity: String(price?.minQuantity ?? 1),
    county: 'KE-30',
    address: '',
    preferredFrom: '',
    preferredTo: '',
    description: '',
    contactPhone: '',
  });
  const quantity = Number.parseInt(form.quantity, 10);
  const estimate =
    price !== null &&
    price.amountMinor !== null &&
    (price.model === 'FIXED' || price.model === 'PER_UNIT') &&
    quantity >= 1
      ? documentTotals([
          lineTotals({ quantity: perUnit ? quantity : 1, unitAmountMinor: price.amountMinor }),
        ])
      : null;
  const submit = useMutation({
    mutationFn: async () =>
      api<ServiceRequest>('/requests', {
        method: 'POST',
        workspace: selected,
        headers: idempotent(idempotency.key()),
        body: {
          serviceSlug: service.slug,
          ...(perUnit ? { quantity } : {}),
          county: form.county,
          address: form.address.trim(),
          ...(form.preferredFrom === '' ? {} : { preferredFrom: form.preferredFrom }),
          ...(form.preferredTo === '' ? {} : { preferredTo: form.preferredTo }),
          description: form.description.trim(),
          contactPhone: form.contactPhone.trim(),
        },
      }),
    onSuccess: async (request) => {
      idempotency.renew();
      await navigate(`/requests/${request.id}`);
    },
  });
  const set = (key: keyof typeof form) => (value: string) => {
    setForm({ ...form, [key]: value });
  };
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Request: {service.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          For {forWhom}. {service.summary}
        </p>
      </div>
      <Card>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          {submit.isError ? (
            <div className="sm:col-span-2">
              <Notice tone="error">{describeError(submit.error)}</Notice>
            </div>
          ) : null}
          {perUnit ? (
            <Field
              label={`Quantity (minimum ${String(price.minQuantity)})`}
              inputMode="numeric"
              value={form.quantity}
              onChange={(event) => {
                set('quantity')(event.target.value);
              }}
            />
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="request-county" className="text-sm font-medium">
              County
            </label>
            <select
              id="request-county"
              value={form.county}
              onChange={(event) => {
                set('county')(event.target.value);
              }}
              className="min-h-11 md:min-h-10 w-full rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
            >
              {(regions.data ?? []).map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Address"
              hint="Building, street and area"
              value={form.address}
              onChange={(event) => {
                set('address')(event.target.value);
              }}
              required
            />
          </div>
          <Field
            label="Preferred from"
            type="date"
            value={form.preferredFrom}
            onChange={(event) => {
              set('preferredFrom')(event.target.value);
            }}
          />
          <Field
            label="Preferred until"
            type="date"
            value={form.preferredTo}
            onChange={(event) => {
              set('preferredTo')(event.target.value);
            }}
          />
          <Field
            label="Contact phone"
            hint="e.g. +254712345678"
            value={form.contactPhone}
            onChange={(event) => {
              set('contactPhone')(event.target.value);
            }}
            required
          />
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="request-description" className="text-sm font-medium">
              What do you need?
            </label>
            <textarea
              id="request-description"
              rows={4}
              maxLength={2000}
              value={form.description}
              onChange={(event) => {
                set('description')(event.target.value);
              }}
              className="w-full py-2 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
            />
          </div>
          <div className="text-sm sm:col-span-2" aria-live="polite">
            {estimate === null ? (
              <p className="text-muted-foreground">
                {price?.label ?? 'Price on request'}. OGS will send you a quotation before any work
                starts.
              </p>
            ) : (
              <p>
                Estimated total:{' '}
                <strong>
                  <Money minor={estimate.totalMinor} />
                </strong>{' '}
                including VAT (
                <Money minor={estimate.subtotalMinor} /> + <Money minor={estimate.vatMinor} /> VAT).
                OGS confirms the price when it reviews your request.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={submit.isPending}>
              Send request
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- list

/** /requests — the customer's requests in the current workspace. */
export function RequestsPage() {
  const customer = useCustomerWorkspace();
  const requests = useMyRequests();
  if (!customer.ok) {
    return <WrongWorkspace />;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Requests</h1>
        <Link to="/services" className="text-sm underline-offset-4 hover:underline">
          Browse services
        </Link>
      </div>
      {requests.isError ? <Notice tone="error">{describeError(requests.error)}</Notice> : null}
      <Card>
        <ul className="divide-y text-sm" aria-label="Requests">
          {(requests.data ?? []).map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Link
                  to={`/requests/${request.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {request.number}
                </Link>{' '}
                · {request.service.name}
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {formatWhen(request.createdAt)}
                <StatusBadge>{requestLabel(request)}</StatusBadge>
              </span>
            </li>
          ))}
          {requests.data?.length === 0 ? (
            <li className="py-2 text-muted-foreground">
              No requests yet.{' '}
              <Link to="/services" className="underline">
                Find a service
              </Link>
              .
            </li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- detail

/** /requests/:id — status, quotation (accept or reject), order and payment. */
export function RequestDetailPage() {
  const { id = '' } = useParams();
  const customer = useCustomerWorkspace();
  const request = useMyRequest(id);
  if (!customer.ok) {
    return <WrongWorkspace />;
  }
  if (request.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (request.isError || request.data === undefined) {
    return <Notice tone="error">{describeError(request.error)}</Notice>;
  }
  return <RequestDetail request={request.data} />;
}

function RequestDetail({ request }: { request: ServiceRequest }) {
  const { selected } = useWorkspace();
  const workspace = useCurrentWorkspace();
  const canDecide =
    selected === 'personal' ||
    (workspace.data !== undefined &&
      'permissions' in workspace.data &&
      workspace.data.permissions.includes('quotation.accept'));
  const [reason, setReason] = useState('');
  const idempotency = useIdempotencyKey();
  const open = request.quotations.find((quotation) => quotation.status === 'ISSUED');
  const accept = useRequestWrite((quotationId: string) => ({
    path: `/requests/${request.id}/quotations/${quotationId}/accept`,
    body: { version: open?.version },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  const reject = useRequestWrite((quotationId: string) => ({
    path: `/requests/${request.id}/quotations/${quotationId}/reject`,
    body: { version: open?.version, reason },
    options: { workspace: selected },
  }));
  const cancel = useRequestWrite(() => ({
    path: `/requests/${request.id}/cancel`,
    body: { version: request.version, reason },
    options: { workspace: selected },
  }));
  const cancelOrder = useRequestWrite(() => ({
    path: `/requests/${request.id}/order/cancel`,
    body: { version: request.order?.version, reason },
    options: { workspace: selected },
  }));
  const error = [accept, reject, cancel, cancelOrder].find((mutation) => mutation.isError)?.error;
  const preOrder = ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_QUOTATION', 'QUOTATION_ISSUED'].includes(
    request.status,
  );
  const order = request.order;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link to="/requests" className="text-sm underline-offset-4 hover:underline">
          ← Requests
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {request.number} <StatusBadge>{requestLabel(request)}</StatusBadge>
        </h1>
        {request.cancelReason === null ? null : (
          <p className="text-sm text-muted-foreground">Cancelled: {request.cancelReason}</p>
        )}
      </div>
      {error === undefined ? null : <Notice tone="error">{describeError(error)}</Notice>}
      {order === null ? null : (
        <OrderSummary order={order}>
          {order.status === 'AWAITING_PAYMENT' ? (
            <Notice>
              Pay <Money minor={order.totalMinor - order.paidMinor} /> by bank transfer or M-Pesa
              paybill, quoting <strong>{order.number}</strong> as the reference. We confirm the
              order as soon as the payment is recorded.
            </Notice>
          ) : null}
        </OrderSummary>
      )}
      {request.quotations.map((quotation) => (
        <QuotationView key={quotation.id} quotation={quotation}>
          {quotation.status === 'ISSUED' && canDecide ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={accept.isPending}
                onClick={() => {
                  accept.mutate(quotation.id, { onSuccess: idempotency.renew });
                }}
              >
                Accept quotation
              </Button>
              <Button
                variant="outline"
                disabled={reject.isPending || reason.trim().length < 5}
                onClick={() => {
                  reject.mutate(quotation.id);
                }}
              >
                Reject quotation
              </Button>
            </div>
          ) : null}
          {quotation.status === 'ISSUED' && !canDecide ? (
            <p className="mt-3 text-sm text-muted-foreground">
              An organisation administrator accepts or rejects quotations.
            </p>
          ) : null}
        </QuotationView>
      ))}
      <RequestFacts request={request} />
      {preOrder || order?.status === 'AWAITING_PAYMENT' ? (
        <Card>
          <Field
            label="Reason (to reject a quotation or cancel)"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {preOrder ? (
              <Button
                variant="destructive"
                disabled={cancel.isPending || reason.trim().length < 5}
                onClick={() => {
                  cancel.mutate(undefined);
                }}
              >
                Cancel request
              </Button>
            ) : null}
            {order?.status === 'AWAITING_PAYMENT' && order.paidMinor === 0 ? (
              <Button
                variant="destructive"
                disabled={cancelOrder.isPending || reason.trim().length < 5}
                onClick={() => {
                  cancelOrder.mutate(undefined);
                }}
              >
                Cancel order
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}
      <Timeline request={request} />
    </div>
  );
}
