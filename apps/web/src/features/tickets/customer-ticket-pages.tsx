import {
  ticketUrgencySchema,
  type CustomerTicket,
  type CustomerTicketSummary,
  type TicketUrgency,
} from '@ogs/contracts';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type ReactNode, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/choice-controls';
import { Code } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Notice } from '@/components/ui/form-controls';
import { FormField } from '@/components/ui/form-field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Breadcrumbs, Timeline } from '@/components/ui/navigation';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/overlays';
import { useCurrentWorkspace, useWorkspace } from '@/features/workspace/workspace-state';
import { t, type MessageKey } from '@/i18n';
import { api, describeError, uploadFile } from '@/lib/api';
import {
  AttachmentList,
  AttachmentPicker,
  Message,
  PriorityBadge,
  type Picked,
} from './ticket-parts';
import {
  customerLabel,
  customerTone,
  downloader,
  eventLabel,
  formatWhen,
  idempotent,
  useIdempotencyKey,
  useLinkableOrders,
  useMyTicket,
  useMyTickets,
  useTicketCategories,
  useTicketWrite,
} from './tickets-data';

/** Tickets are opened from the personal workspace or an active organisation workspace. */
function useCustomerWorkspace(): boolean {
  const { selected } = useWorkspace();
  const workspace = useCurrentWorkspace();
  if (selected === 'personal') {
    return true;
  }
  return workspace.data?.kind === 'ORGANISATION' && !workspace.data.restricted;
}

function WrongWorkspace() {
  return (
    <Notice>
      Support tickets are opened from your personal workspace or an active organisation workspace.
      Switch workspace in the menu above.
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

function StatusLabel({ status }: { status: CustomerTicket['status'] }) {
  return (
    <Badge dot tone={customerTone(status)} className="whitespace-nowrap">
      {customerLabel(status)}
    </Badge>
  );
}

// ---------------------------------------------------------------- list

type Show = 'open' | 'resolved' | 'all';

/** /support — the customer's tickets in the current workspace. */
export function SupportPage() {
  const ok = useCustomerWorkspace();
  const [show, setShow] = useState<Show>('open');
  const tickets = useMyTickets(show);
  const filterId = useId();
  if (!ok) {
    return <WrongWorkspace />;
  }
  const rows = tickets.data?.tickets;
  return (
    <div>
      <PageHeader
        title={t('tickets.customerTitle')}
        description={t('tickets.customerIntro')}
        actions={
          <Link to="/support/new" className={buttonVariants({ variant: 'highlight' })}>
            {t('tickets.new')}
          </Link>
        }
      />
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor={filterId} className="font-display text-sm font-medium">
          {t('tickets.show')}
        </label>
        <Select
          id={filterId}
          className="w-auto"
          value={show}
          onChange={(event) => {
            setShow(event.target.value as Show);
          }}
        >
          {(['open', 'resolved', 'all'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`tickets.show.${value}`)}
            </option>
          ))}
        </Select>
      </div>
      {tickets.isError ? <Notice tone="error">{describeError(tickets.error)}</Notice> : null}
      {rows?.length === 0 ? (
        <EmptyState title={t('tickets.emptyTitle')} body={t('tickets.emptyBody')} />
      ) : (
        <DataTable
          caption={t('tickets.myTickets')}
          columns={COLUMNS}
          rows={rows}
          rowKey={(ticket) => ticket.id}
          initialSort={{ key: 'updated', dir: 'desc' }}
          loading={tickets.isLoading}
          pageSize={25}
          card={(ticket) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <Link
                  to={`/support/${ticket.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  <Code>{ticket.number}</Code>
                </Link>
                <StatusLabel status={ticket.status} />
              </div>
              <p className="text-sm">{ticket.subject}</p>
              <p className="text-xs text-muted-foreground">{formatWhen(ticket.updatedAt)}</p>
            </div>
          )}
        />
      )}
    </div>
  );
}

const COLUMNS: Column<CustomerTicketSummary>[] = [
  {
    key: 'number',
    header: t('tickets.col.number'),
    cell: (ticket) => (
      <Link to={`/support/${ticket.id}`} className="font-medium underline-offset-4 hover:underline">
        <Code className="whitespace-nowrap">{ticket.number}</Code>
      </Link>
    ),
    sortValue: (ticket) => ticket.number,
  },
  {
    key: 'subject',
    header: t('tickets.col.subject'),
    cell: (ticket) => ticket.subject,
    sortValue: (ticket) => ticket.subject,
  },
  {
    key: 'openedBy',
    header: t('tickets.col.openedBy'),
    cell: (ticket) => ticket.requesterLabel,
  },
  {
    key: 'status',
    header: t('tickets.col.status'),
    cell: (ticket) => <StatusLabel status={ticket.status} />,
    sortValue: (ticket) => customerLabel(ticket.status),
  },
  {
    key: 'updated',
    header: t('tickets.col.updated'),
    cell: (ticket) => formatWhen(ticket.updatedAt),
    sortValue: (ticket) => ticket.updatedAt,
  },
];

// ---------------------------------------------------------------- new ticket

/** /support/new — open a ticket (Phase 8 plan §2.3). */
export function NewTicketPage() {
  const ok = useCustomerWorkspace();
  const navigate = useNavigate();
  const { selected } = useWorkspace();
  const categories = useTicketCategories();
  const orders = useLinkableOrders();
  const idempotency = useIdempotencyKey();
  const [files, setFiles] = useState<Picked[]>([]);
  const [form, setForm] = useState({
    subject: '',
    categoryCode: '',
    serviceOrderId: '',
    urgency: 'NORMAL' as TicketUrgency,
    description: '',
  });
  const submit = useMutation({
    mutationFn: async () =>
      api<CustomerTicket>('/tickets', {
        method: 'POST',
        workspace: selected,
        headers: idempotent(idempotency.key()),
        body: {
          subject: form.subject.trim(),
          categoryCode:
            form.categoryCode === '' ? (categories.data?.[0]?.code ?? '') : form.categoryCode,
          urgency: form.urgency,
          description: form.description.trim(),
          ...(form.serviceOrderId === '' ? {} : { serviceOrderId: form.serviceOrderId }),
          attachmentIds: files.map((file) => file.id),
        },
      }),
    onSuccess: async (ticket) => {
      idempotency.renew();
      await navigate(`/support/${ticket.id}`);
    },
  });
  if (!ok) {
    return <WrongWorkspace />;
  }
  const set = (key: keyof typeof form) => (value: string) => {
    setForm({ ...form, [key]: value });
  };
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Breadcrumbs
          items={[{ label: t('tickets.myTickets'), to: '/support' }, { label: t('tickets.new') }]}
        />
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {t('tickets.newTitle')}
        </h1>
      </div>
      <form
        className="max-w-3xl space-y-6"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        {submit.isError ? <Notice tone="error">{describeError(submit.error)}</Notice> : null}
        <Card>
          <CardHeader title={t('tickets.whatsWrong')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label={t('tickets.subject')}
              help={t('tickets.subjectHint')}
              className="sm:col-span-2"
            >
              {(ids) => (
                <Input
                  {...ids}
                  required
                  minLength={3}
                  maxLength={150}
                  value={form.subject}
                  onChange={(event) => {
                    set('subject')(event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField label={t('tickets.category')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={
                    form.categoryCode === ''
                      ? (categories.data?.[0]?.code ?? '')
                      : form.categoryCode
                  }
                  onChange={(event) => {
                    set('categoryCode')(event.target.value);
                  }}
                >
                  {(categories.data ?? []).map((category) => (
                    <option key={category.code} value={category.code}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('tickets.relatedOrder')} optional>
              {(ids) => (
                <Select
                  {...ids}
                  value={form.serviceOrderId}
                  onChange={(event) => {
                    set('serviceOrderId')(event.target.value);
                  }}
                >
                  <option value="">{t('tickets.noOrder')}</option>
                  {(orders.data ?? []).map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.number} · {order.serviceName}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <UrgencyField
              value={form.urgency}
              onChange={(value) => {
                setForm({ ...form, urgency: value });
              }}
            />
            <FormField
              label={t('tickets.description')}
              help={t('tickets.descriptionHint')}
              className="sm:col-span-2"
            >
              {(ids) => (
                <Textarea
                  {...ids}
                  required
                  rows={6}
                  minLength={10}
                  maxLength={5000}
                  value={form.description}
                  onChange={(event) => {
                    set('description')(event.target.value);
                  }}
                />
              )}
            </FormField>
            <div className="sm:col-span-2">
              <AttachmentPicker
                files={files}
                onChange={setFiles}
                upload={async (file) => {
                  const data = new FormData();
                  data.set('purpose', 'ticket.attachment');
                  data.set('file', file);
                  return uploadFile<{ id: string }>(data, selected);
                }}
              />
            </div>
          </div>
        </Card>
        <Button type="submit" variant="highlight" size="lg" disabled={submit.isPending}>
          {t('tickets.open')}
        </Button>
      </form>
    </div>
  );
}

export function UrgencyField({
  value,
  onChange,
}: {
  value: TicketUrgency;
  onChange: (value: TicketUrgency) => void;
}) {
  const legendId = useId();
  return (
    <fieldset className="space-y-2 sm:col-span-2" aria-labelledby={legendId}>
      <legend id={legendId} className="font-display text-sm font-medium">
        {t('tickets.urgency')}
      </legend>
      <RadioGroup
        aria-labelledby={legendId}
        value={value}
        onValueChange={(next) => {
          onChange(next as TicketUrgency);
        }}
        className="grid gap-2 sm:grid-cols-2"
      >
        {ticketUrgencySchema.options.map((option) => {
          const id = `${legendId}-${option}`;
          return (
            <label
              key={option}
              htmlFor={id}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[[data-state=checked]]:border-ink"
            >
              <RadioGroupItem id={id} value={option} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  {t(`tickets.urgency.${option}` as MessageKey)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`tickets.urgency.${option}.hint` as MessageKey)}
                </span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

// ---------------------------------------------------------------- detail

/** /support/:id — the public conversation, reply, reopen / accept / withdraw. */
export function TicketDetailPage() {
  const { id = '' } = useParams();
  const ok = useCustomerWorkspace();
  const ticket = useMyTicket(id);
  if (!ok) {
    return <WrongWorkspace />;
  }
  if (ticket.isLoading) {
    return <PageSkeleton />;
  }
  if (ticket.isError || ticket.data === undefined) {
    return <Notice tone="error">{describeError(ticket.error)}</Notice>;
  }
  return <TicketDetail ticket={ticket.data} />;
}

function TicketDetail({ ticket }: { ticket: CustomerTicket }) {
  const { selected } = useWorkspace();
  const download = downloader(`/tickets/${ticket.id}`, { workspace: selected });
  // The page's notion of "now", fixed when it renders first (rendering stays pure).
  const [now] = useState(() => Date.now());
  const closesSoon =
    ticket.reopenUntil !== null && new Date(ticket.reopenUntil).getTime() - now < 48 * 3_600_000;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Breadcrumbs
          items={[{ label: t('tickets.myTickets'), to: '/support' }, { label: ticket.number }]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            <Code>{ticket.number}</Code>
          </h1>
          <StatusLabel status={ticket.status} />
        </div>
        <p className="text-lg">{ticket.subject}</p>
      </div>
      {ticket.onBehalf ? (
        <Alert>
          {t('tickets.onBehalfNote', { channel: t(`tickets.channel.${ticket.channel}`) })}
        </Alert>
      ) : null}
      {ticket.status === 'AWAITING_CUSTOMER' ? (
        <Alert tone="warning">{t('tickets.waitingNote')}</Alert>
      ) : null}
      {ticket.status === 'RESOLVED' && ticket.reopenUntil !== null ? (
        <Alert tone="success">
          <span className="flex flex-wrap items-center gap-2">
            {t('tickets.resolvedAlert', { when: formatWhen(ticket.reopenUntil) })}
            {closesSoon ? (
              <Badge tone="warning">
                {t('tickets.closesSoon', { when: formatWhen(ticket.reopenUntil) })}
              </Badge>
            ) : null}
          </span>
        </Alert>
      ) : null}
      {ticket.status === 'CLOSED' ? <Notice>{t('tickets.closedNote')}</Notice> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <h2 className="font-display text-lg font-medium">{t('tickets.conversation')}</h2>
          <Message author={ticket.requesterLabel} side="CUSTOMER" when={ticket.createdAt}>
            {ticket.description}
          </Message>
          {ticket.attachments.length > 0 ? (
            <AttachmentList attachments={ticket.attachments} download={download} />
          ) : null}
          {ticket.messages.map((message) => (
            <Message
              key={message.id}
              author={message.side === 'STAFF' ? t('tickets.ogsLabel') : message.authorLabel}
              side={message.side}
              when={message.createdAt}
              footer={<AttachmentList attachments={message.attachments} download={download} />}
            >
              {message.body}
            </Message>
          ))}
          {ticket.resolution === null ? null : (
            <Card emphasis>
              <CardHeader title={t('tickets.resolution')} />
              <p className="whitespace-pre-wrap text-sm">{ticket.resolution}</p>
            </Card>
          )}
          {ticket.can.comment ? <ReplyBox ticket={ticket} /> : null}
        </div>
        <div className="min-w-0 space-y-4">
          <CustomerActions ticket={ticket} />
          <Card>
            <CardHeader title={t('tickets.details')} />
            <dl className="space-y-2 text-sm">
              <Fact label={t('tickets.category')}>{ticket.category.name}</Fact>
              <Fact label={t('tickets.urgency')}>
                {t(`tickets.urgency.${ticket.urgency}` as MessageKey)}
              </Fact>
              <Fact label={t('tickets.col.priority')}>
                <PriorityBadge priority={ticket.priority} />
              </Fact>
              {ticket.serviceOrder === null ? null : (
                <Fact label={t('tickets.relatedOrder')}>
                  <Code>{ticket.serviceOrder.number}</Code>
                </Fact>
              )}
              <Fact label={t('tickets.col.openedBy')}>{ticket.requesterLabel}</Fact>
              {ticket.departmentName === null ? null : (
                <Fact label={t('tickets.department')}>{ticket.departmentName}</Fact>
              )}
              <Fact label={t('tickets.col.updated')}>{formatWhen(ticket.updatedAt)}</Fact>
            </dl>
          </Card>
          <Card>
            <CardHeader title={t('tickets.activity')} />
            <Timeline
              label={t('tickets.activity')}
              entries={ticket.activity.map((entry, index) => ({
                key: `${entry.occurredAt}-${String(index)}`,
                title: eventLabel(entry.kind),
                meta: formatWhen(entry.occurredAt),
                ...(entry.reason === null ? {} : { body: entry.reason }),
              }))}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function ReplyBox({ ticket }: { ticket: CustomerTicket }) {
  const { selected } = useWorkspace();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const reply = useTicketWrite(() => ({
    path: `/tickets/${ticket.id}/comments`,
    body: { body: body.trim(), attachmentIds: files.map((file) => file.id) },
    options: { workspace: selected },
  }));
  return (
    <Card>
      <form
        className="space-y-4"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          reply.mutate(undefined, {
            onSuccess: () => {
              setBody('');
              setFiles([]);
            },
          });
        }}
      >
        <CardHeader title={t('tickets.reply')} />
        {reply.isError ? <Notice tone="error">{describeError(reply.error)}</Notice> : null}
        <FormField label={t('tickets.yourReply')}>
          {(ids) => (
            <Textarea
              {...ids}
              required
              rows={4}
              maxLength={5000}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
            />
          )}
        </FormField>
        <AttachmentPicker
          files={files}
          onChange={setFiles}
          upload={async (file) => {
            const data = new FormData();
            data.set('purpose', 'ticket.attachment');
            data.set('file', file);
            return uploadFile<{ id: string }>(data, selected);
          }}
        />
        <Button type="submit" variant="secondary" disabled={reply.isPending || body.trim() === ''}>
          {t('tickets.sendReply')}
        </Button>
      </form>
    </Card>
  );
}

function CustomerActions({ ticket }: { ticket: CustomerTicket }) {
  const { selected } = useWorkspace();
  const options = { workspace: selected };
  const accept = useTicketWrite(() => ({
    path: `/tickets/${ticket.id}/accept-resolution`,
    body: { version: ticket.version },
    options,
  }));
  if (!ticket.can.reopen && !ticket.can.acceptResolution && !ticket.can.withdraw) {
    return null;
  }
  return (
    <Card emphasis={ticket.status === 'RESOLVED'}>
      {accept.isError ? <Notice tone="error">{describeError(accept.error)}</Notice> : null}
      <div className="flex flex-col gap-2">
        {ticket.can.acceptResolution ? (
          <Button
            variant="highlight"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate(undefined);
            }}
          >
            {t('tickets.acceptResolution')}
          </Button>
        ) : null}
        {ticket.can.reopen ? (
          <ReasonDialog
            trigger={t('tickets.reopen')}
            title={t('tickets.reopenTitle')}
            label={t('tickets.reopenReason')}
            path={`/tickets/${ticket.id}/reopen`}
            version={ticket.version}
            variant="secondary"
          />
        ) : null}
        {ticket.can.withdraw ? (
          <ReasonDialog
            trigger={t('tickets.withdraw')}
            title={t('tickets.withdrawTitle')}
            label={t('tickets.withdrawReason')}
            path={`/tickets/${ticket.id}/withdraw`}
            version={ticket.version}
            variant="danger"
          />
        ) : null}
      </div>
    </Card>
  );
}

function ReasonDialog({
  trigger,
  title,
  label,
  path,
  version,
  variant,
}: {
  trigger: string;
  title: string;
  label: string;
  path: string;
  version: number;
  variant: 'secondary' | 'danger';
}) {
  const { selected } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const write = useTicketWrite(() => ({
    path,
    body: { version, reason: reason.trim() },
    options: { workspace: selected },
  }));
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>{trigger}</Button>
      </DialogTrigger>
      <DialogContent title={title}>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            write.mutate(undefined, {
              onSuccess: () => {
                setOpen(false);
                setReason('');
              },
            });
          }}
        >
          {write.isError ? <Notice tone="error">{describeError(write.error)}</Notice> : null}
          <FormField label={label}>
            {(ids) => (
              <Textarea
                {...ids}
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </FormField>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('tickets.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" variant={variant} disabled={write.isPending}>
              {t('tickets.confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
