import {
  formatKes,
  ORDER_STATUS_LABELS,
  type Quotation,
  type ServiceRequest,
} from '@ogs/contracts';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/form-controls';
import { cn } from '@/lib/utils';
import { formatWhen } from './requests-data';

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'good' && 'border-success bg-success/10 text-foreground',
        tone === 'bad' && 'border-destructive bg-destructive/10 text-foreground',
      )}
    >
      {children}
    </span>
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
          Quotation {quotation.number}{' '}
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
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Item</th>
            <th className="py-1 text-right font-normal">Qty</th>
            <th className="py-1 text-right font-normal">Unit</th>
            <th className="py-1 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quotation.lines.map((line) => (
            <tr key={line.position} className="border-t">
              <td className="py-1">{line.description}</td>
              <td className="py-1 text-right">{line.quantity}</td>
              <td className="py-1 text-right">{formatKes(line.unitAmountMinor)}</td>
              <td className="py-1 text-right">{formatKes(line.netMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t">
            <td colSpan={3} className="py-1 text-right text-muted-foreground">
              Subtotal
            </td>
            <td className="py-1 text-right">{formatKes(quotation.subtotalMinor)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 text-right text-muted-foreground">
              VAT 16%
            </td>
            <td className="py-1 text-right">{formatKes(quotation.vatMinor)}</td>
          </tr>
          <tr className="font-medium">
            <td colSpan={3} className="py-1 text-right">
              Total
            </td>
            <td className="py-1 text-right">{formatKes(quotation.totalMinor)}</td>
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
        <h2 className="font-medium">Order {order.number}</h2>
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
          <dd>{formatKes(order.totalMinor)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Paid</dt>
          <dd>{formatKes(order.paidMinor)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Balance</dt>
          <dd>{formatKes(balance)}</dd>
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
              {formatWhen(payment.recordedAt)} — {formatKes(payment.amountMinor)} ·{' '}
              {payment.method === 'MPESA_PAYBILL' ? 'M-Pesa' : 'Bank transfer'} ·{' '}
              {payment.reference}
            </li>
          ))}
        </ul>
      ) : null}
      {order.refundDue ? (
        <p className="mt-2 text-sm text-destructive">
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
      <h2 className="mb-2 font-medium">History</h2>
      <ol className="space-y-1 text-sm" aria-label="History">
        {items.map((item, index) => (
          <li key={`${item.occurredAt}-${String(index)}`}>
            {formatWhen(item.occurredAt)} — {item.what}:{' '}
            {item.toStatus.toLowerCase().replace(/_/g, ' ')}
            {item.reason === null ? '' : ` (${item.reason})`}
          </li>
        ))}
      </ol>
    </Card>
  );
}
