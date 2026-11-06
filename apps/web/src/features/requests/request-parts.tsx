import { ORDER_STATUS_LABELS, type Quotation, type ServiceRequest } from '@ogs/contracts';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Code, Money } from '@/components/ui/data-display';
import { Timeline as TimelineList } from '@/components/ui/navigation';
import { Card } from '@/components/ui/form-controls';
import { formatWhen } from './requests-data';

/** Request, quotation and order states as a Badge with a dot (Phase 6b). */
export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  return (
    <Badge dot tone={tone === 'good' ? 'success' : tone === 'bad' ? 'danger' : 'neutral'}>
      {children}
    </Badge>
  );
}

export function RequestFacts({ request }: { request: ServiceRequest }) {
  const rows: [string, string][] = [
    ['Service', request.service.name],
    ['Price', request.price.label],
    ['Quantity', String(request.quantity)],
    ['County', request.county],
    ['Address', request.address],
    [
      'Preferred dates',
      request.preferredFrom === null
        ? 'Any time'
        : `${request.preferredFrom} – ${request.preferredTo ?? request.preferredFrom}`,
    ],
    ['Contact phone', request.contactPhone],
    ['Submitted', formatWhen(request.createdAt)],
  ];
  return (
    <Card>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {request.description === '' ? null : (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Details: </span>
          {request.description}
        </p>
      )}
    </Card>
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
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">
          Quotation <Code>{quotation.number}</Code>{' '}
          <span className="text-muted-foreground">(revision {quotation.revision})</span>
        </h2>
        <StatusBadge
          tone={
            quotation.status === 'ACCEPTED'
              ? 'good'
              : quotation.status === 'ISSUED'
                ? 'neutral'
                : 'bad'
          }
        >
          {quotation.status.toLowerCase()}
        </StatusBadge>
      </div>
      <table className="w-full text-sm" aria-label={`Quotation ${quotation.number} lines`}>
        <thead className="text-left font-display text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Item</th>
            <th className="py-1 text-right font-normal">Qty</th>
            <th className="py-1 text-right font-normal">Unit</th>
            <th className="py-1 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quotation.lines.map((line) => (
            <tr key={line.position} className="border-t border-border">
              <td className="py-1">{line.description}</td>
              <td className="tabular py-1 text-right">{line.quantity}</td>
              <td className="py-1 text-right">
                <Money minor={line.unitAmountMinor} />
              </td>
              <td className="py-1 text-right">
                <Money minor={line.netMinor} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <td colSpan={3} className="py-1 text-right text-muted-foreground">
              Subtotal
            </td>
            <td className="py-1 text-right">
              <Money minor={quotation.subtotalMinor} />
            </td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 text-right text-muted-foreground">
              VAT 16%
            </td>
            <td className="py-1 text-right">
              <Money minor={quotation.vatMinor} />
            </td>
          </tr>
          <tr className="border-t border-ink font-medium">
            <td colSpan={3} className="py-1 text-right">
              Total
            </td>
            <td className="py-1 text-right">
              <Money minor={quotation.totalMinor} />
            </td>
          </tr>
        </tfoot>
      </table>
      {quotation.notes === '' ? null : (
        <p className="mt-2 text-sm text-muted-foreground">{quotation.notes}</p>
      )}
      {quotation.expiresAt === null ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          Valid until {formatWhen(quotation.expiresAt)} (Kenya time).
        </p>
      )}
      {quotation.decisionReason === null ? null : (
        <p className="mt-1 text-xs text-muted-foreground">
          Reason given: {quotation.decisionReason}
        </p>
      )}
      {children}
    </Card>
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
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">
          Order <Code>{order.number}</Code>
        </h2>
        <StatusBadge
          tone={
            order.status === 'CANCELLED'
              ? 'bad'
              : order.status === 'READY_FOR_ASSIGNMENT'
                ? 'good'
                : 'neutral'
          }
        >
          {ORDER_STATUS_LABELS[order.status]}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Total (incl. VAT)</dt>
          <dd>
            <Money minor={order.totalMinor} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Paid</dt>
          <dd>
            <Money minor={order.paidMinor} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Balance</dt>
          <dd>
            <Money minor={balance} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Terms</dt>
          <dd>
            {order.paymentTerms === 'POSTPAID'
              ? `Invoice, ${String(order.netDays)} days`
              : 'Pay before work'}
          </dd>
        </div>
      </dl>
      {order.payments.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm" aria-label="Payments">
          {order.payments.map((payment) => (
            <li key={payment.id}>
              {formatWhen(payment.recordedAt)} — <Money minor={payment.amountMinor} /> ·{' '}
              {payment.method === 'MPESA_PAYBILL' ? 'M-Pesa' : 'Bank transfer'} ·{' '}
              {payment.reference}
            </li>
          ))}
        </ul>
      ) : null}
      {order.refundDue ? (
        <p className="mt-2 text-sm text-danger">
          Refund due: OGS finance will contact the customer.
        </p>
      ) : null}
      {order.cancelReason === null ? null : (
        <p className="mt-2 text-sm text-muted-foreground">Cancelled: {order.cancelReason}</p>
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
      <h2 className="mb-3 font-medium">History</h2>
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
