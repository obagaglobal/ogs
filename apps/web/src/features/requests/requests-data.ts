import {
  CUSTOMER_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  type ServiceRequest,
  type ServiceRequestListResponse,
} from '@ogs/contracts';
import { IDEMPOTENCY_HEADER } from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { t } from '@/i18n';
import { api, type RequestOptions } from '@/lib/api';

/**
 * One idempotency key per user intention (P7-7): it is created when the form
 * or button first renders and reused on retries, so a double click or a
 * retried network call never creates a second request, order or payment.
 * After a success the key is replaced, ready for the next intention.
 */
export function useIdempotencyKey(): { key: () => string; renew: () => void } {
  const ref = useRef<string | null>(null);
  return {
    key: () => {
      ref.current ??= crypto.randomUUID();
      return ref.current;
    },
    renew: () => {
      ref.current = null;
    },
  };
}

export const idempotent = (key: string): Record<string, string> => ({ [IDEMPOTENCY_HEADER]: key });

/** Customer requests in the current workspace (personal or organisation). */
export function useMyRequests() {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['requests', selected],
    queryFn: async () =>
      (await api<ServiceRequestListResponse>('/requests', { workspace: selected })).requests,
    retry: false,
  });
}

export function useMyRequest(id: string) {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['request', selected, id],
    queryFn: async () => api<ServiceRequest>(`/requests/${id}`, { workspace: selected }),
    retry: false,
  });
}

/** A write that returns the updated request; it refreshes the lists and the request. */
export function useRequestWrite<V>(
  request: (value: V) => { path: string; body?: unknown; options?: RequestOptions },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: V) => {
      const { path, body, options } = request(value);
      return api<ServiceRequest>(path, { method: 'POST', body, ...options });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['request'] });
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });
}

const nairobi = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  dateStyle: 'medium',
  timeStyle: 'short',
});
export const formatWhen = (iso: string | null): string =>
  iso === null ? '—' : nairobi.format(new Date(iso));

/** The label customers see (review §9: a simplified set); staff see the exact status. */
export function requestLabel(
  request: Pick<ServiceRequest, 'status'> & {
    order?: ServiceRequest['order'] | null;
    orderStatus?: string | null;
  },
  staff = false,
): string {
  const orderStatus = request.order?.status ?? request.orderStatus ?? null;
  if (orderStatus !== null) {
    return ORDER_STATUS_LABELS[orderStatus as keyof typeof ORDER_STATUS_LABELS];
  }
  return staff
    ? request.status.toLowerCase().replace(/_/g, ' ')
    : CUSTOMER_STATUS_LABELS[request.status];
}

/** Badge tone for an order status (Phase 6b). */
export function orderTone(
  status: NonNullable<ServiceRequest['order']>['status'],
): 'neutral' | 'good' | 'bad' | 'pending' {
  return status === 'CANCELLED'
    ? 'bad'
    : status === 'READY_FOR_ASSIGNMENT' || status === 'PAID' || status === 'COMPLETED'
      ? 'good'
      : 'pending';
}

export function termsLabel(
  order: Pick<NonNullable<ServiceRequest['order']>, 'paymentTerms' | 'netDays'>,
): string {
  return order.paymentTerms === 'POSTPAID'
    ? t('orders.terms.postpaid', { days: String(order.netDays) })
    : t('orders.terms.prepay');
}
