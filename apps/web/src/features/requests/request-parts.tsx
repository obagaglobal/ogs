import { ORDER_STATUS_LABELS, type Quotation, type ServiceRequest } from '@ogs/contracts';
import { useState, type ReactNode } from 'react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Code, Money } from '@/components/ui/data-display';
import { Timeline as TimelineList } from '@/components/ui/navigation';
import { t } from '@/i18n';
import { formatWhen, orderTone, termsLabel } from './requests-data';

/** Request, quotation and order states as a Badge with a dot (Phase 6b). */
export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'pending';
}) {
  const map: Record<string, Tone> = {
    neutral: 'neutral',
    good: 'success',
    bad: 'danger',
    pending: 'warning',
  };
  return (
    <Badge dot tone={map[tone] ?? 'neutral'}>
      {children}
    </Badge>
  );
}

/** Small uppercase caption used above values and in table headers. */
function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

export function RequestFacts({ request }: { request: ServiceRequest }) {
  const rows: [string, ReactNode][] = [
    ['Service', request.service.name],
    ['Price', <span className="tabular">{request.price.label}</span>],
    ['Quantity', <span className="tabular">{request.quantity}</span>],
    ['County', request.county],
    ['Address', request.address],
    [
      'Preferred dates',
      request.preferredFrom === null ? (
        'Any time'
      ) : (
        <span className="tabular">
          {request.preferredFrom} – {request.preferredTo ?? request.preferredFrom}
        </span>
      ),
    ],
    ['Contact phone', <span className="tabular">{request.contactPhone}</span>],
    ['Submitted', formatWhen(request.createdAt)],
  ];
  return (
    <Card>
      <h2 className="mb-4 font-display text-lg font-medium">{t('requests.details')}</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
      {request.description === '' ? null : (
        <div className="mt-4 border-t border-border pt-3 text-sm">
          <p className="text-muted-foreground">What you asked for</p>
          <p className="mt-0.5 whitespace-pre-line">{request.description}</p>
        </div>
      )}
    </Card>
  );
}

const QUOTATION_TONE: Record<Quotation['status'], 'neutral' | 'good' | 'bad' | 'pending'> = {
  DRAFT: 'neutral',
  ISSUED: 'pending',
  ACCEPTED: 'good',
  REJECTED: 'bad',
  EXPIRED: 'bad',
  SUPERSEDED: 'neutral',
};

/** Expiry within 48 hours is flagged (Phase 6b §9). */
function Validity({ quotation }: { quotation: Quotation }) {
  const [now] = useState(() => Date.now());
  if (quotation.expiresAt === null) return null;
  const when = formatWhen(quotation.expiresAt);
  if (quotation.status !== 'ISSUED') {
    return (
      <p className="text-xs text-muted-foreground">
        {t('quotation.validUntil', { when })} (Kenya time).
      </p>
    );
  }
  const soon = new Date(quotation.expiresAt).getTime() - now < 48 * 3600 * 1000;
  return (
    <Badge tone={soon ? 'warning' : 'neutral'}>
      {soon ? t('quotation.expiresSoon', { when }) : t('quotation.validUntil', { when })} (Kenya
      time)
    </Badge>
  );
}

/** Lines, totals with VAT, validity. Amounts are always integer minor units. */
export function QuotationView({
  quotation,
  children,
}: {
  quotation: Quotation;
  children?: ReactNode;
}) {
  return (
    <Card emphasis={quotation.status === 'ISSUED'}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-medium">
            Quotation <Code>{quotation.number}</Code>{' '}
            <span className="text-sm font-normal text-muted-foreground">
              (revision {quotation.revision})
            </span>
          </h2>
          <Validity quotation={quotation} />
        </div>
        <StatusBadge tone={QUOTATION_TONE[quotation.status]}>
          {quotation.status.toLowerCase()}
        </StatusBadge>
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full min-w-[28rem] text-sm"
          aria-label={`Quotation ${quotation.number} lines`}
        >
          <thead className="border-b border-border text-left font-display text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 text-right font-medium">Qty</th>
              <th className="py-2 pr-3 text-right font-medium">Unit</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quotation.lines.map((line) => (
              <tr key={line.position} className="border-b border-border">
                <td className="py-2 pr-3">{line.description}</td>
                <td className="tabular py-2 pr-3 text-right">{line.quantity}</td>
                <td className="py-2 pr-3 text-right">
                  <Money minor={line.unitAmountMinor} />
                </td>
                <td className="py-2 text-right">
                  <Money minor={line.netMinor} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 pr-3 text-right text-muted-foreground">
                Subtotal
              </td>
              <td className="pt-3 text-right">
                <Money minor={quotation.subtotalMinor} />
              </td>
            </tr>
            <tr>
              <td colSpan={3} className="py-1 pr-3 text-right text-muted-foreground">
                VAT 16%
              </td>
              <td className="py-1 text-right">
                <Money minor={quotation.vatMinor} />
              </td>
            </tr>
            <tr className="font-display text-base font-medium">
              <td colSpan={3} className="border-t-2 border-ink pt-2 pr-3 text-right">
                Total
              </td>
              <td className="border-t-2 border-ink pt-2 text-right">
                <Money minor={quotation.totalMinor} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {quotation.notes === '' ? null : (
        <p className="mt-4 text-sm whitespace-pre-line text-muted-foreground">{quotation.notes}</p>
      )}
      {quotation.decisionReason === null ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          Reason given: {quotation.decisionReason}
        </p>
      )}
      {children}
    </Card>
  );
}

/** Payments recorded against an order (append-only). */
export function PaymentsTable({
  payments,
}: {
  payments: NonNullable<ServiceRequest['order']>['payments'];
}) {
  if (payments.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] text-sm" aria-label={t('orders.payments')}>
        <thead className="border-b border-border text-left font-display text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">{t('orders.col.when')}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('orders.col.amount')}</th>
            <th className="py-2 pr-3 font-medium">{t('orders.col.method')}</th>
            <th className="py-2 font-medium">{t('orders.col.reference')}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-b border-border last:border-b-0">
              <td className="py-2 pr-3">{formatWhen(payment.recordedAt)}</td>
              <td className="py-2 pr-3 text-right">
                <Money minor={payment.amountMinor} />
              </td>
              <td className="py-2 pr-3">
                {payment.method === 'MPESA_PAYBILL' ? 'M-Pesa' : 'Bank transfer'}
              </td>
              <td className="py-2">
                <Code>{payment.reference}</Code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrderSummary({
  order,
  children,
}: {
  order: NonNullable<ServiceRequest['order']>;
  children?: ReactNode;
}) {
  const balance = order.totalMinor - order.paidMinor;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-display text-lg font-medium">
          Order <Code>{order.number}</Code>
        </h2>
        <StatusBadge tone={orderTone(order.status)}>
          {ORDER_STATUS_LABELS[order.status]}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt>
            <Caption>{t('orders.total')}</Caption>
          </dt>
          <dd className="mt-0.5 text-base">
            <Money minor={order.totalMinor} />
          </dd>
        </div>
        <div>
          <dt>
            <Caption>{t('orders.paid')}</Caption>
          </dt>
          <dd className="mt-0.5 text-base">
            <Money minor={order.paidMinor} />
          </dd>
        </div>
        <div>
          <dt>
            <Caption>{t('orders.balance')}</Caption>
          </dt>
          <dd className="mt-0.5 text-base font-medium">
            <Money minor={balance} />
          </dd>
        </div>
        <div>
          <dt>
            <Caption>Terms</Caption>
          </dt>
          <dd className="mt-0.5">{termsLabel(order)}</dd>
        </div>
      </dl>
      {order.payments.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <PaymentsTable payments={order.payments} />
        </div>
      ) : null}
      {order.refundDue ? (
        <p className="mt-3 text-sm text-danger">
          Refund due: OGS finance will contact the customer.
        </p>
      ) : null}
      {order.cancelReason === null ? null : (
        <p className="mt-3 text-sm text-muted-foreground">Cancelled: {order.cancelReason}</p>
      )}
      {children}
    </Card>
  );
}

export function Timeline({ request }: { request: ServiceRequest }) {
  const items = [
    ...request.history.map((event) => ({ ...event, what: 'Request' })),
    ...(request.order?.history.map((event) => ({ ...event, what: 'Order' })) ?? []),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return (
    <Card>
      <h2 className="mb-4 font-display text-lg font-medium">History</h2>
      <TimelineList
        label="History"
        entries={items.map((item, index) => ({
          key: `${item.occurredAt}-${String(index)}`,
          title: `${item.what}: ${item.toStatus.toLowerCase().replace(/_/g, ' ')}`,
          meta: formatWhen(item.occurredAt),
          body: item.reason,
        }))}
      />
    </Card>
  );
}
