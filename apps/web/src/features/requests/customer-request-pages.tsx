import {
  documentTotals,
  lineTotals,
  type PublicServiceDetail,
  type ServiceRequest,
  type ServiceRequestListResponse,
} from '@ogs/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Code, Money } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Field, Notice } from '@/components/ui/form-controls';
import { FormField } from '@/components/ui/form-field';
import { Select, Textarea } from '@/components/ui/input';
import { Breadcrumbs, Stepper } from '@/components/ui/navigation';
import { t } from '@/i18n';
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

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-9 w-80 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
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
    return <PageSkeleton />;
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
    <div className="space-y-6">
      <div className="space-y-2">
        <Breadcrumbs
          items={[
            { label: 'Services', to: '/services' },
            { label: service.name, to: `/services/${service.slug}` },
            { label: t('requests.new') },
          ]}
        />
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Request: {service.name}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          For {forWhom}. {service.summary}
        </p>
      </div>
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <div className="min-w-0 space-y-6">
          {submit.isError ? <Notice tone="error">{describeError(submit.error)}</Notice> : null}
          <Card>
            <h2 className="mb-4 font-display text-lg font-medium">{t('requests.whereWhen')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="County">
                {(ids) => (
                  <Select
                    {...ids}
                    value={form.county}
                    onChange={(event) => {
                      set('county')(event.target.value);
                    }}
                  >
                    {(regions.data ?? []).map((region) => (
                      <option key={region.code} value={region.code}>
                        {region.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              {perUnit ? (
                <Field
                  label={`Quantity (minimum ${String(price.minQuantity)})`}
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(event) => {
                    set('quantity')(event.target.value);
                  }}
                />
              ) : (
                <div className="hidden sm:block" />
              )}
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
            </div>
          </Card>
          <Card>
            <h2 className="mb-4 font-display text-lg font-medium">{t('requests.aboutJob')}</h2>
            <div className="grid grid-cols-1 gap-4">
              <FormField label="What do you need?">
                {(ids) => (
                  <Textarea
                    {...ids}
                    rows={4}
                    maxLength={2000}
                    value={form.description}
                    onChange={(event) => {
                      set('description')(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <div className="sm:max-w-xs">
                <Field
                  label="Contact phone"
                  hint="e.g. +254712345678"
                  inputMode="tel"
                  value={form.contactPhone}
                  onChange={(event) => {
                    set('contactPhone')(event.target.value);
                  }}
                  required
                />
              </div>
            </div>
          </Card>
        </div>
        <Card emphasis className="space-y-4 lg:sticky lg:top-20">
          <h2 className="font-display text-lg font-medium">{t('requests.estimate')}</h2>
          <div aria-live="polite" className="space-y-2 text-sm">
            {estimate === null ? (
              <Alert>
                <span className="tabular">{price?.label ?? 'Price on request'}</span>. OGS will send
                you a quotation before any work starts.
              </Alert>
            ) : (
              <>
                <dl className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('requests.subtotal')}</dt>
                    <dd>
                      <Money minor={estimate.subtotalMinor} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('requests.vat')}</dt>
                    <dd>
                      <Money minor={estimate.vatMinor} />
                    </dd>
                  </div>
                </dl>
                <p className="flex justify-between gap-3 border-t-2 border-ink pt-2 font-display text-base font-medium">
                  Estimated total: <Money minor={estimate.totalMinor} />
                </p>
                <p className="text-xs text-muted-foreground">{t('requests.estimateNote')}</p>
              </>
            )}
          </div>
          <Button
            type="submit"
            variant="highlight"
            size="lg"
            className="w-full"
            disabled={submit.isPending}
          >
            Send request
          </Button>
        </Card>
      </form>
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Requests</h1>
        <Link to="/services" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Browse services
        </Link>
      </div>
      {requests.isError ? <Notice tone="error">{describeError(requests.error)}</Notice> : null}
      {requests.data?.length === 0 ? (
        <EmptyState
          title="No requests yet"
          body="When you request a service, you can follow it here, from quotation to confirmation."
          action={
            <Link to="/services" className={buttonVariants({ variant: 'secondary' })}>
              Find a service
            </Link>
          }
        />
      ) : (
        <DataTable
          caption={t('requests.title')}
          columns={REQUEST_COLUMNS}
          rows={requests.data}
          rowKey={(request) => request.id}
          loading={requests.isLoading}
          card={(request) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <Link
                  to={`/requests/${request.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  <Code>{request.number}</Code>
                </Link>
                <StatusBadge>{requestLabel(request)}</StatusBadge>
              </div>
              <p className="text-sm">{request.service.name}</p>
              <p className="text-xs text-muted-foreground">{formatWhen(request.createdAt)}</p>
            </div>
          )}
        />
      )}
    </div>
  );
}

type RequestRow = ServiceRequestListResponse['requests'][number];

const REQUEST_COLUMNS: Column<RequestRow>[] = [
  {
    key: 'number',
    header: t('requests.col.number'),
    cell: (request) => (
      <Link
        to={`/requests/${request.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        <Code>{request.number}</Code>
      </Link>
    ),
    sortValue: (request) => request.number,
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
    cell: (request) => <StatusBadge>{requestLabel(request)}</StatusBadge>,
    sortValue: (request) => requestLabel(request),
  },
];

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
    return <PageSkeleton />;
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
  const steps = [
    t('requests.step.submitted'),
    t('requests.step.review'),
    t('requests.step.quotation'),
    t('requests.step.payment'),
    t('requests.step.confirmed'),
  ];
  const progress = stepOf(request);
  const cancelled = request.status === 'CANCELLED' || order?.status === 'CANCELLED';
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Breadcrumbs
          items={[{ label: t('requests.title'), to: '/requests' }, { label: request.number }]}
        />
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="tabular">{request.number}</span>{' '}
          <StatusBadge tone={cancelled ? 'bad' : progress >= 5 ? 'good' : 'pending'}>
            {requestLabel(request)}
          </StatusBadge>
        </h1>
        <p className="text-muted-foreground">{request.service.name}</p>
        {request.cancelReason === null ? null : (
          <p className="text-sm text-muted-foreground">Cancelled: {request.cancelReason}</p>
        )}
      </div>
      {cancelled ? null : (
        <Stepper label={t('requests.progress')} steps={steps} current={progress} />
      )}
      {error === undefined ? null : <Notice tone="error">{describeError(error)}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {request.quotations.map((quotation) => (
            <QuotationView key={quotation.id} quotation={quotation}>
              {quotation.status === 'ISSUED' && canDecide ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button
                    variant="highlight"
                    disabled={accept.isPending}
                    onClick={() => {
                      accept.mutate(quotation.id, { onSuccess: idempotency.renew });
                    }}
                  >
                    Accept quotation
                  </Button>
                  <Button
                    variant="secondary"
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
                <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
                  An organisation administrator accepts or rejects quotations.
                </p>
              ) : null}
            </QuotationView>
          ))}
          <RequestFacts request={request} />
          <Timeline request={request} />
        </div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-20">
          {order === null ? null : (
            <OrderSummary order={order}>
              {order.status === 'AWAITING_PAYMENT' ? (
                <div className="mt-4">
                  <Alert tone="warning" title="How to pay">
                    Pay <Money minor={order.totalMinor - order.paidMinor} /> by bank transfer or
                    M-Pesa paybill, quoting <Code>{order.number}</Code> as the reference. We confirm
                    the order as soon as the payment is recorded.
                  </Alert>
                </div>
              ) : null}
            </OrderSummary>
          )}
          {preOrder || order?.status === 'AWAITING_PAYMENT' ? (
            <Card>
              <h2 className="mb-4 font-display text-lg font-medium">
                {t('requests.changeOfPlan')}
              </h2>
              <Field
                label="Reason (to reject a quotation or cancel)"
                hint="At least 5 characters"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {preOrder ? (
                  <Button
                    variant="danger"
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
                    variant="danger"
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
        </div>
      </div>
    </div>
  );
}

/** Where the request is on the customer's path (zero-based; 5 = every step done). */
function stepOf(request: ServiceRequest): number {
  const order = request.order;
  if (order !== null) {
    return order.status === 'READY_FOR_ASSIGNMENT' ? 5 : 3;
  }
  switch (request.status) {
    case 'SUBMITTED':
      return 0;
    case 'QUOTATION_ISSUED':
      return 2;
    default:
      return 1;
  }
}
