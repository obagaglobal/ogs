import {
  CUSTOMER_TICKET_LABEL,
  type CustomerTicket,
  type CustomerTicketList,
  type LinkableOrders,
  type StaffTicket,
  type StaffTicketQueue,
  type TicketCategory,
  type TicketStatus,
} from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Tone } from '@/components/ui/badge';
import { useElevated } from '@/features/platform/elevation-state';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { t, type MessageKey } from '@/i18n';
import { api, type RequestOptions } from '@/lib/api';

export { formatWhen, idempotent, useIdempotencyKey } from '@/features/requests/requests-data';

/** Downloads through the API's authorised endpoint (never a stored link). */
export function downloader(base: string, options: RequestOptions) {
  return async (attachmentId: string) =>
    api<{ url: string }>(`${base}/attachments/${attachmentId}/download`, options);
}

// ---------------------------------------------------------------- labels

/** The five customer labels (plan §2.2). */
export function customerLabel(status: TicketStatus): string {
  return t(`tickets.label.${CUSTOMER_TICKET_LABEL[status]}` as MessageKey);
}

export function staffLabel(status: TicketStatus): string {
  return t(`tickets.staffStatus.${status}` as MessageKey);
}

export function statusTone(status: TicketStatus): Tone {
  switch (status) {
    case 'AWAITING_CUSTOMER':
      return 'warning';
    case 'RESOLVED':
    case 'CLOSED':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Customers: "waiting for you" is the call to act. */
export function customerTone(status: TicketStatus): Tone {
  return status === 'AWAITING_CUSTOMER' ? 'warning' : statusTone(status);
}

export function priorityTone(priority: string | null): Tone {
  return priority === 'P1' ? 'danger' : priority === 'P2' ? 'warning' : 'neutral';
}

export function eventLabel(kind: string): string {
  const key = `tickets.event.${kind}` as MessageKey;
  const text = t(key);
  return text === key ? kind.replace(/_/g, ' ') : text;
}

/** "3 h", "2 d": age of a ticket for the queue. */
export function age(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} h`;
  return `${String(Math.floor(hours / 24))} d`;
}

// ---------------------------------------------------------------- customer

export function useTicketCategories() {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['ticket-categories'],
    queryFn: async () =>
      (await api<{ categories: TicketCategory[] }>('/tickets/categories', { workspace: selected }))
        .categories,
    staleTime: 60 * 60 * 1000,
  });
}

export function useMyTickets(show: 'open' | 'resolved' | 'all') {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['tickets', selected, show],
    queryFn: async () => api<CustomerTicketList>(`/tickets?show=${show}`, { workspace: selected }),
    retry: false,
  });
}

export function useMyTicket(id: string) {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['ticket', selected, id],
    queryFn: async () => api<CustomerTicket>(`/tickets/${id}`, { workspace: selected }),
    retry: false,
  });
}

export function useLinkableOrders() {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['ticket-orders', selected],
    queryFn: async () =>
      (await api<LinkableOrders>('/tickets/linkable-orders', { workspace: selected })).orders,
    retry: false,
  });
}

/** A write that returns the ticket; it refreshes lists and the ticket. */
export function useTicketWrite<V, R = CustomerTicket>(
  request: (value: V) => { path: string; body?: unknown; options?: RequestOptions },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: V) => {
      const { path, body, options } = request(value);
      return api<R>(path, { method: 'POST', body, ...options });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket'] });
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tickets'] });
      await queryClient.invalidateQueries({ queryKey: ['platform', 'ticket'] });
    },
  });
}

// ---------------------------------------------------------------- staff

export interface QueueFilters {
  status: string;
  priority: string;
  assignee: 'me' | 'unassigned' | 'anyone';
  q: string;
}

export function useTicketQueue(filters: QueueFilters, page: number) {
  const { options, elevation } = useElevated();
  const params = new URLSearchParams({ assignee: filters.assignee, page: String(page) });
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.priority !== '') params.set('priority', filters.priority);
  if (filters.q.trim() !== '') params.set('q', filters.q.trim());
  return useQuery({
    queryKey: ['platform', 'tickets', params.toString()],
    queryFn: async () => api<StaffTicketQueue>(`/platform/tickets?${params.toString()}`, options),
    enabled: elevation !== undefined,
    retry: false,
  });
}

export function useStaffTicket(id: string) {
  const { options, elevation } = useElevated();
  return useQuery({
    queryKey: ['platform', 'ticket', id],
    queryFn: async () => api<StaffTicket>(`/platform/tickets/${id}`, options),
    enabled: elevation !== undefined,
    retry: false,
  });
}

export function useAssignees() {
  const { options, elevation } = useElevated();
  return useQuery({
    queryKey: ['platform', 'ticket-assignees'],
    queryFn: async () =>
      (
        await api<{ assignees: { id: string; email: string }[] }>(
          '/platform/ticket-assignees',
          options,
        )
      ).assignees,
    enabled: elevation !== undefined,
    staleTime: 5 * 60 * 1000,
  });
}

export function useStaffLinkableOrders(id: string) {
  const { options, elevation } = useElevated();
  return useQuery({
    queryKey: ['platform', 'ticket-orders', id],
    queryFn: async () =>
      (await api<LinkableOrders>(`/platform/tickets/${id}/linkable-orders`, options)).orders,
    enabled: elevation !== undefined,
  });
}
