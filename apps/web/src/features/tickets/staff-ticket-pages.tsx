import {
  ticketChannelSchema,
  ticketPrioritySchema,
  ticketStatusSchema,
  type CustomerLookup,
  type OrganisationMembers,
  type PublicServiceListResponse,
  type ServiceRequest,
  type StaffTicket,
  type StaffTicketSummary,
  type TicketPriority,
  type TicketUrgency,
} from '@ogs/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Avatar, Code, Money, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Notice } from '@/components/ui/form-controls';
import { FormField } from '@/components/ui/form-field';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  Breadcrumbs,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Timeline,
} from '@/components/ui/navigation';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/overlays';
import { Combobox } from '@/components/ui/pickers';
import { ElevationGate } from '@/features/platform/elevation-gate';
import { ELEVATION_KEY, useElevated } from '@/features/platform/elevation-state';
import { useRegions } from '@/features/provider/provider-data';
import { t, type MessageKey } from '@/i18n';
import { api, ApiError, describeError, uploadFile } from '@/lib/api';
import { UrgencyField } from './customer-ticket-pages';
import {
  AttachmentList,
  AttachmentPicker,
  Message,
  PriorityBadge,
  type Picked,
} from './ticket-parts';
import {
  age,
  downloader,
  eventLabel,
  formatWhen,
  idempotent,
  staffLabel,
  statusTone,
  useAssignees,
  useIdempotencyKey,
  useStaffLinkableOrders,
  useStaffTicket,
  useTicketCategories,
  useTicketQueue,
  useTicketWrite,
  type QueueFilters,
} from './tickets-data';

function forgetExpiredElevation(error: unknown) {
  if (error instanceof ApiError && error.code === 'elevation_required') {
    sessionStorage.removeItem(ELEVATION_KEY);
  }
}

function StatusLabel({ status }: { status: StaffTicket['status'] }) {
  return (
    <Badge dot tone={statusTone(status)} className="whitespace-nowrap">
      {staffLabel(status)}
    </Badge>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-display text-sm font-medium">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------- queue

/** /platform/tickets — the helpdesk queue (Phase 8 plan §2.4). */
export function StaffTicketsPage() {
  return (
    <div>
      <PageHeader
        title={t('tickets.staffTitle')}
        actions={
          <Link to="/platform/tickets/new" className={buttonVariants({ variant: 'highlight' })}>
            {t('tickets.new')}
          </Link>
        }
      />
      <ElevationGate>
        <Queue />
      </ElevationGate>
    </div>
  );
}

function Queue() {
  const [filters, setFilters] = useState<QueueFilters>({
    status: '',
    priority: '',
    assignee: 'anyone',
    q: '',
  });
  const [page, setPage] = useState(1);
  const queue = useTicketQueue(filters, page);
  const searchId = useId();
  if (queue.isError) {
    forgetExpiredElevation(queue.error);
  }
  const set = (key: keyof QueueFilters) => (value: string) => {
    setPage(1);
    setFilters({ ...filters, [key]: value });
  };
  const data = queue.data;
  const pages = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('tickets.unassigned')} value={data?.counts.unassigned ?? '—'} emphasis />
        <StatTile label={t('tickets.mine')} value={data?.counts.mine ?? '—'} />
        <StatTile
          label={t('tickets.awaitingCustomer')}
          value={data?.counts.awaitingCustomer ?? '—'}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="font-display text-sm font-medium">
            {t('tickets.search')}
          </label>
          <Input
            id={searchId}
            type="search"
            value={filters.q}
            onChange={(event) => {
              set('q')(event.target.value);
            }}
          />
        </div>
        <Filter
          label={t('tickets.col.status')}
          value={filters.status}
          onChange={set('status')}
          options={[
            ['', t('tickets.status.all')],
            ...ticketStatusSchema.options.map((status): [string, string] => [
              status,
              staffLabel(status),
            ]),
          ]}
        />
        <Filter
          label={t('tickets.col.priority')}
          value={filters.priority}
          onChange={set('priority')}
          options={[
            ['', t('tickets.show.all')],
            ...ticketPrioritySchema.options.map((p): [string, string] => [p, p]),
          ]}
        />
        <Filter
          label={t('tickets.col.assignee')}
          value={filters.assignee}
          onChange={set('assignee')}
          options={(['anyone', 'me', 'unassigned'] as const).map((value): [string, string] => [
            value,
            t(`tickets.assignee.${value}`),
          ])}
        />
      </div>
      {queue.isError ? <Notice tone="error">{describeError(queue.error)}</Notice> : null}
      {data?.tickets.length === 0 ? (
        <EmptyState title={t('tickets.emptyTitle')} body={t('common.noData')} />
      ) : (
        <DataTable
          caption={t('tickets.queue')}
          columns={QUEUE_COLUMNS}
          rows={data?.tickets}
          rowKey={(ticket) => ticket.id}
          loading={queue.isLoading}
          pageSize={25}
          card={(ticket) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <Link
                  to={`/platform/tickets/${ticket.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  <Code>{ticket.number}</Code>
                </Link>
                <PriorityBadge priority={ticket.priority} />
              </div>
              <p className="text-sm">{ticket.subject}</p>
              <p className="text-xs text-muted-foreground">
                {ticket.customerName} · <StatusLabel status={ticket.status} />
              </p>
            </div>
          )}
        />
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            {t('common.previous')}
          </Button>
          <span className="tabular text-sm">{t('common.page', { page, pages })}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            {t('common.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const QUEUE_COLUMNS: Column<StaffTicketSummary>[] = [
  {
    key: 'number',
    header: t('tickets.col.number'),
    cell: (ticket) => (
      <Link
        to={`/platform/tickets/${ticket.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        <Code className="whitespace-nowrap">{ticket.number}</Code>
      </Link>
    ),
  },
  { key: 'subject', header: t('tickets.col.subject'), cell: (ticket) => ticket.subject },
  { key: 'customer', header: t('tickets.col.customer'), cell: (ticket) => ticket.customerName },
  {
    key: 'priority',
    header: t('tickets.col.priority'),
    cell: (ticket) => <PriorityBadge priority={ticket.priority} />,
  },
  {
    key: 'status',
    header: t('tickets.col.status'),
    cell: (ticket) => <StatusLabel status={ticket.status} />,
  },
  {
    key: 'assignee',
    header: t('tickets.col.assignee'),
    cell: (ticket) =>
      ticket.assignee === null ? (
        <span className="text-muted-foreground">{t('tickets.nobody')}</span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Avatar name={ticket.assignee.email} size={24} />
          <span className="[overflow-wrap:anywhere]">{ticket.assignee.email}</span>
        </span>
      ),
  },
  {
    key: 'age',
    header: t('tickets.col.age'),
    numeric: true,
    cell: (ticket) => <span className="tabular whitespace-nowrap">{age(ticket.createdAt)}</span>,
  },
];

// ---------------------------------------------------------------- detail

/** /platform/tickets/:id — the ticket workspace. */
export function StaffTicketPage() {
  const { id = '' } = useParams();
  return (
    <div>
      <Breadcrumbs
        items={[
          { label: t('tickets.queue'), to: '/platform/tickets' },
          { label: t('tickets.details') },
        ]}
      />
      <ElevationGate>
        <StaffTicketLoader id={id} />
      </ElevationGate>
    </div>
  );
}

function StaffTicketLoader({ id }: { id: string }) {
  const ticket = useStaffTicket(id);
  if (ticket.isError) {
    forgetExpiredElevation(ticket.error);
    return <Notice tone="error">{describeError(ticket.error)}</Notice>;
  }
  if (ticket.data === undefined) {
    return <Skeleton className="mt-4 h-64 w-full" />;
  }
  return <StaffTicketView ticket={ticket.data} />;
}

function StaffTicketView({ ticket }: { ticket: StaffTicket }) {
  const { options } = useElevated();
  const download = downloader(`/platform/tickets/${ticket.id}`, options);
  const closed = ticket.status === 'CLOSED';
  return (
    <div className="mt-2 space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            <Code>{ticket.number}</Code>
          </h1>
          <StatusLabel status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
        </div>
        <p className="text-lg">{ticket.subject}</p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <h2 className="font-display text-lg font-medium">{t('tickets.conversation')}</h2>
          <Message author={ticket.requester.email} side="CUSTOMER" when={ticket.createdAt}>
            {ticket.description}
          </Message>
          <AttachmentList attachments={ticket.attachments} download={download} />
          {ticket.thread.map((item) => (
            <Message
              key={item.id}
              author={item.author?.email ?? t('tickets.ogsLabel')}
              side={item.side}
              internal={item.kind === 'note'}
              when={item.createdAt}
              footer={<AttachmentList attachments={item.attachments} download={download} />}
            >
              {item.body}
            </Message>
          ))}
          {ticket.resolution === null ? null : (
            <Card emphasis>
              <CardHeader title={t('tickets.resolution')} />
              <p className="whitespace-pre-wrap text-sm">{ticket.resolution}</p>
            </Card>
          )}
          {closed ? null : <Composer ticket={ticket} />}
        </div>
        <div className="min-w-0 space-y-4">
          {closed ? null : <StatusActions ticket={ticket} />}
          <Properties ticket={ticket} />
          <Card>
            <CardHeader title={t('tickets.customer')} />
            <dl className="space-y-2 text-sm">
              <Fact label={t('tickets.customer')}>{ticket.customer.name}</Fact>
              <Fact label={t('tickets.requester')}>{ticket.requester.email}</Fact>
              {ticket.departmentName === null ? null : (
                <Fact label={t('tickets.department')}>{ticket.departmentName}</Fact>
              )}
              <Fact label={t('tickets.urgency')}>
                {t(`tickets.urgency.${ticket.urgency}` as MessageKey)}
              </Fact>
              {ticket.onBehalf ? (
                <Fact label={t('tickets.col.openedBy')}>
                  {t('tickets.createdOnBehalf', {
                    channel: t(`tickets.channel.${ticket.channel}`),
                  })}
                </Fact>
              ) : null}
              {ticket.serviceOrder === null ? null : (
                <Fact label={t('tickets.linkedOrder')}>
                  <span className="flex flex-col items-end">
                    <Code>{ticket.serviceOrder.number}</Code>
                    <Money minor={ticket.serviceOrder.totalMinor} className="text-xs" />
                  </span>
                </Fact>
              )}
            </dl>
          </Card>
          <Card>
            <CardHeader title={t('tickets.activity')} />
            <Timeline
              label={t('tickets.activity')}
              entries={ticket.activity.map((entry, index) => ({
                key: `${entry.occurredAt}-${String(index)}`,
                title: (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {eventLabel(entry.kind)}
                    {entry.visibility === 'INTERNAL' ? (
                      <Badge tone="warning">{t('tickets.internal')}</Badge>
                    ) : null}
                  </span>
                ),
                meta: `${formatWhen(entry.occurredAt)}${entry.actor === null ? '' : ` · ${entry.actor.email}`}`,
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
      <dd className="text-right [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * Reply or internal note. The tab decides the endpoint, and the submit button
 * says which one it is ("Send reply" / "Add internal note"). After each send it
 * returns to "Reply to customer".
 */
function Composer({ ticket }: { ticket: StaffTicket }) {
  const { options } = useElevated();
  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const internal = tab === 'note';
  const send = useTicketWrite<undefined, StaffTicket>(() => ({
    path: `/platform/tickets/${ticket.id}/${internal ? 'notes' : 'comments'}`,
    body: { body: body.trim(), attachmentIds: files.map((file) => file.id) },
    options,
  }));
  const upload = async (file: File) => {
    const data = new FormData();
    data.set('internal', internal ? 'true' : 'false');
    data.set('file', file);
    return uploadFile<{ id: string }>(data, options.workspace, {
      path: `/platform/tickets/${ticket.id}/files`,
      headers: options.headers,
    });
  };
  return (
    <Card className={internal ? 'border-dashed border-control-border bg-surface-muted' : undefined}>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as 'reply' | 'note');
          // Files belong to one side: a reply's files are the customer's, a note's are OGS's.
          setFiles([]);
        }}
      >
        <TabsList>
          <TabsTrigger value="reply">{t('tickets.replyTab')}</TabsTrigger>
          <TabsTrigger value="note">{t('tickets.noteTab')}</TabsTrigger>
        </TabsList>
        {(['reply', 'note'] as const).map((value) => (
          <TabsContent key={value} value={value}>
            <form
              className="space-y-4"
              onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
                event.preventDefault();
                send.mutate(undefined, {
                  onSuccess: () => {
                    setBody('');
                    setFiles([]);
                    setTab('reply');
                  },
                  onError: forgetExpiredElevation,
                });
              }}
            >
              <p className="text-sm text-muted-foreground">
                {value === 'note' ? t('tickets.internalHelp') : t('tickets.replyVisible')}
              </p>
              {send.isError ? <Notice tone="error">{describeError(send.error)}</Notice> : null}
              <FormField label={value === 'note' ? t('tickets.noteTab') : t('tickets.yourReply')}>
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
              <AttachmentPicker files={files} onChange={setFiles} upload={upload} />
              <Button
                type="submit"
                variant={value === 'note' ? 'secondary' : 'primary'}
                disabled={send.isPending || body.trim() === ''}
              >
                {value === 'note' ? t('tickets.addNote') : t('tickets.sendReply')}
              </Button>
            </form>
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

const STATUS_ACTIONS: Record<
  StaffTicket['status'],
  readonly ('triage' | 'start' | 'awaitCustomer' | 'hold' | 'resume' | 'resolve' | 'staffReopen')[]
> = {
  NEW: ['triage', 'start', 'resolve'],
  OPEN: ['start', 'awaitCustomer', 'resolve'],
  IN_PROGRESS: ['awaitCustomer', 'hold', 'resolve'],
  AWAITING_CUSTOMER: ['resolve'],
  ON_HOLD: ['resume', 'resolve'],
  RESOLVED: ['staffReopen'],
  CLOSED: [],
};

const ACTION_PATHS = {
  triage: 'triage',
  start: 'start',
  awaitCustomer: 'await-customer',
  hold: 'hold',
  resume: 'resume',
  resolve: 'resolve',
  staffReopen: 'reopen',
} as const;

/** Status buttons offered by the transition table; "Resolve" is the screen's highlight. */
function StatusActions({ ticket }: { ticket: StaffTicket }) {
  const { options } = useElevated();
  const simple = useTicketWrite<keyof typeof ACTION_PATHS, StaffTicket>((action) => ({
    path: `/platform/tickets/${ticket.id}/${ACTION_PATHS[action]}`,
    body: { version: ticket.version },
    options,
  }));
  const actions = STATUS_ACTIONS[ticket.status];
  return (
    <Card emphasis>
      <CardHeader title={t('tickets.col.status')} />
      {simple.isError ? <Notice tone="error">{describeError(simple.error)}</Notice> : null}
      <div className="flex flex-col gap-2">
        {actions.map((action) => {
          if (action === 'triage') {
            return <TriageDialog key={action} ticket={ticket} />;
          }
          if (action === 'hold') {
            return (
              <TextDialog
                key={action}
                ticket={ticket}
                trigger={t('tickets.action.hold')}
                label={t('tickets.holdReason')}
                path="hold"
                field="reason"
              />
            );
          }
          if (action === 'resolve') {
            return (
              <TextDialog
                key={action}
                ticket={ticket}
                trigger={t('tickets.action.resolve')}
                label={t('tickets.resolution')}
                help={t('tickets.resolutionHelp')}
                path="resolve"
                field="resolution"
                highlight
              />
            );
          }
          return (
            <Button
              key={action}
              variant="secondary"
              disabled={simple.isPending}
              onClick={() => {
                simple.mutate(action, { onError: forgetExpiredElevation });
              }}
            >
              {t(`tickets.action.${action}`)}
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

function TextDialog({
  ticket,
  trigger,
  label,
  help,
  path,
  field,
  highlight = false,
}: {
  ticket: StaffTicket;
  trigger: string;
  label: string;
  help?: string;
  path: string;
  field: 'reason' | 'resolution';
  highlight?: boolean;
}) {
  const { options } = useElevated();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const write = useTicketWrite<undefined, StaffTicket>(() => ({
    path: `/platform/tickets/${ticket.id}/${path}`,
    body: { version: ticket.version, [field]: text.trim() },
    options,
  }));
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={highlight ? 'highlight' : 'secondary'}>{trigger}</Button>
      </DialogTrigger>
      <DialogContent title={trigger}>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            write.mutate(undefined, {
              onSuccess: () => {
                setOpen(false);
                setText('');
              },
              onError: forgetExpiredElevation,
            });
          }}
        >
          {write.isError ? <Notice tone="error">{describeError(write.error)}</Notice> : null}
          <FormField label={label} help={help}>
            {(ids) => (
              <Textarea
                {...ids}
                required
                minLength={5}
                maxLength={field === 'resolution' ? 2000 : 500}
                rows={4}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
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
            <Button type="submit" disabled={write.isPending}>
              {t('tickets.confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function TriageDialog({ ticket }: { ticket: StaffTicket }) {
  const { options } = useElevated();
  const categories = useTicketCategories();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<TicketPriority>(SUGGESTED[ticket.urgency]);
  const [category, setCategory] = useState(ticket.category.code);
  const write = useTicketWrite<undefined, StaffTicket>(() => ({
    path: `/platform/tickets/${ticket.id}/triage`,
    body: { version: ticket.version, priority, categoryCode: category },
    options,
  }));
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('tickets.action.triage')}</Button>
      </DialogTrigger>
      <DialogContent title={t('tickets.action.triage')}>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            write.mutate(undefined, {
              onSuccess: () => {
                setOpen(false);
              },
              onError: forgetExpiredElevation,
            });
          }}
        >
          {write.isError ? <Notice tone="error">{describeError(write.error)}</Notice> : null}
          <FormField label={t('tickets.col.priority')}>
            {(ids) => (
              <Select
                {...ids}
                value={priority}
                onChange={(event) => {
                  setPriority(event.target.value as TicketPriority);
                }}
              >
                {ticketPrioritySchema.options.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('tickets.category')}>
            {(ids) => (
              <Select
                {...ids}
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                }}
              >
                {(categories.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('tickets.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={write.isPending}>
              {t('tickets.confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

const SUGGESTED: Record<TicketUrgency, TicketPriority> = {
  CRITICAL: 'P1',
  HIGH: 'P2',
  NORMAL: 'P3',
  LOW: 'P4',
};

/** Ownership, priority, category and linked order. */
function Properties({ ticket }: { ticket: StaffTicket }) {
  const { options } = useElevated();
  const assignees = useAssignees();
  const orders = useStaffLinkableOrders(ticket.id);
  const categories = useTicketCategories();
  const closed = ticket.status === 'CLOSED';
  const take = useTicketWrite<undefined, StaffTicket>(() => ({
    path: `/platform/tickets/${ticket.id}/take`,
    body: { version: ticket.version },
    options,
  }));
  const assign = useTicketWrite<string | null, StaffTicket>((assigneeUserId) => ({
    path: `/platform/tickets/${ticket.id}/assign`,
    body: { version: ticket.version, assigneeUserId },
    options,
  }));
  const category = useTicketWrite<string, StaffTicket>((categoryCode) => ({
    path: `/platform/tickets/${ticket.id}/category`,
    body: { version: ticket.version, categoryCode },
    options,
  }));
  const link = useTicketWrite<string | null, StaffTicket>((serviceOrderId) => ({
    path: `/platform/tickets/${ticket.id}/link-order`,
    body: { version: ticket.version, serviceOrderId },
    options,
  }));
  const error = take.error ?? assign.error ?? category.error ?? link.error;
  return (
    <Card>
      <CardHeader title={t('tickets.properties')} />
      {error === null ? null : <Notice tone="error">{describeError(error)}</Notice>}
      <div className="space-y-4">
        <FormField label={t('tickets.assignTo')}>
          {(ids) => (
            <div className="flex flex-wrap gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  {...ids}
                  options={[
                    { value: '', label: t('tickets.nobody') },
                    ...(assignees.data ?? []).map((a) => ({ value: a.id, label: a.email })),
                  ]}
                  value={ticket.assignee?.id ?? ''}
                  placeholder={t('tickets.chooseAssignee')}
                  searchLabel={t('tickets.searchPeople')}
                  onChange={(value) => {
                    if (!closed) assign.mutate(value === '' ? null : value);
                  }}
                />
              </div>
              <Button
                variant="secondary"
                disabled={closed || take.isPending}
                onClick={() => {
                  take.mutate(undefined);
                }}
              >
                {t('tickets.take')}
              </Button>
            </div>
          )}
        </FormField>
        <PriorityControl ticket={ticket} />
        <FormField label={t('tickets.category')}>
          {(ids) => (
            <Select
              {...ids}
              disabled={closed}
              value={ticket.category.code}
              onChange={(event) => {
                category.mutate(event.target.value);
              }}
            >
              {(categories.data ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('tickets.linkedOrder')} optional>
          {(ids) => (
            <Select
              {...ids}
              disabled={closed}
              value={ticket.serviceOrder?.id ?? ''}
              onChange={(event) => {
                link.mutate(event.target.value === '' ? null : event.target.value);
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
      </div>
    </Card>
  );
}

function PriorityControl({ ticket }: { ticket: StaffTicket }) {
  const { options } = useElevated();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority ?? 'P3');
  const [reason, setReason] = useState('');
  const write = useTicketWrite<undefined, StaffTicket>(() => ({
    path: `/platform/tickets/${ticket.id}/priority`,
    body: { version: ticket.version, priority, reason: reason.trim() },
    options,
  }));
  return (
    <div className="flex items-end justify-between gap-2">
      <div>
        <p className="font-display text-sm font-medium">{t('tickets.col.priority')}</p>
        <PriorityBadge priority={ticket.priority} />
      </div>
      {ticket.status === 'CLOSED' ? null : (
        <DialogRoot open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              {t('tickets.changePriority')}
            </Button>
          </DialogTrigger>
          <DialogContent title={t('tickets.changePriority')}>
            <form
              className="space-y-4"
              onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
                event.preventDefault();
                write.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    setReason('');
                  },
                  onError: forgetExpiredElevation,
                });
              }}
            >
              {write.isError ? <Notice tone="error">{describeError(write.error)}</Notice> : null}
              <FormField label={t('tickets.col.priority')}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={priority}
                    onChange={(event) => {
                      setPriority(event.target.value as TicketPriority);
                    }}
                  >
                    {ticketPrioritySchema.options.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField label={t('tickets.priorityReason')}>
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
                <Button type="submit" disabled={write.isPending}>
                  {t('tickets.confirm')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </DialogRoot>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- on behalf

type Chosen =
  | { kind: 'ORGANISATION'; tenantId: string; name: string }
  | { kind: 'PERSON'; userId: string; name: string };

/** Pick an organisation (by name) or a person (by exact email), then the requester. */
function CustomerPicker({
  value,
  requester,
  onChange,
  onRequester,
}: {
  value: Chosen | null;
  requester: string;
  onChange: (value: Chosen | null) => void;
  onRequester: (userId: string) => void;
}) {
  const { options } = useElevated();
  const [query, setQuery] = useState('');
  const lookup = useQuery({
    queryKey: ['platform', 'customers', query],
    queryFn: async () =>
      api<CustomerLookup>(`/platform/customers?q=${encodeURIComponent(query)}`, options),
    enabled: query.trim().length >= 2,
  });
  const members = useQuery({
    queryKey: [
      'platform',
      'customer-members',
      value?.kind === 'ORGANISATION' ? value.tenantId : '',
    ],
    queryFn: async () =>
      api<OrganisationMembers>(
        `/platform/customers/${value?.kind === 'ORGANISATION' ? value.tenantId : ''}/members`,
        options,
      ),
    enabled: value?.kind === 'ORGANISATION',
  });
  const choices: Chosen[] = [
    ...(lookup.data?.organisations ?? []).map((o): Chosen => ({
      kind: 'ORGANISATION',
      tenantId: o.tenantId,
      name: o.name,
    })),
    ...(lookup.data?.people ?? []).map((p): Chosen => ({
      kind: 'PERSON',
      userId: p.id,
      name: p.email,
    })),
  ];
  const keyOf = (c: Chosen) => (c.kind === 'ORGANISATION' ? `o:${c.tenantId}` : `p:${c.userId}`);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label={t('tickets.findCustomer')} help={t('tickets.findCustomerHelp')}>
        {(ids) => (
          <Input
            {...ids}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label={t('tickets.chooseCustomer')}>
        {(ids) => (
          <Select
            {...ids}
            required
            value={value === null ? '' : keyOf(value)}
            onChange={(event) => {
              onChange(choices.find((c) => keyOf(c) === event.target.value) ?? null);
            }}
          >
            <option value="">—</option>
            {value !== null && !choices.some((c) => keyOf(c) === keyOf(value)) ? (
              <option value={keyOf(value)}>{value.name}</option>
            ) : null}
            {choices.map((c) => (
              <option key={keyOf(c)} value={keyOf(c)}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {value?.kind === 'ORGANISATION' ? (
        <FormField
          label={t('tickets.requester')}
          help={t('tickets.requesterHelp')}
          className="sm:col-span-2"
        >
          {(ids) => (
            <Select
              {...ids}
              required
              value={requester}
              onChange={(event) => {
                onRequester(event.target.value);
              }}
            >
              <option value="">—</option>
              {(members.data?.members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                  {m.departmentName === null ? '' : ` · ${m.departmentName}`}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}
    </div>
  );
}

function customerBody(chosen: Chosen | null, requester: string) {
  if (chosen === null) return null;
  return chosen.kind === 'ORGANISATION'
    ? { kind: 'ORGANISATION', tenantId: chosen.tenantId, requesterUserId: requester }
    : { kind: 'PERSON', userId: chosen.userId };
}

/** /platform/tickets/new — a ticket for a customer who phoned, emailed or walked in. */
export function StaffNewTicketPage() {
  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: t('tickets.queue'), to: '/platform/tickets' },
          { label: t('tickets.new') },
        ]}
      />
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {t('tickets.onBehalfTitle')}
      </h1>
      <ElevationGate>
        <StaffNewTicketForm />
      </ElevationGate>
    </div>
  );
}

function StaffNewTicketForm() {
  const navigate = useNavigate();
  const { options } = useElevated();
  const categories = useTicketCategories();
  const idempotency = useIdempotencyKey();
  const [customer, setCustomer] = useState<Chosen | null>(null);
  const [requester, setRequester] = useState('');
  const [form, setForm] = useState({
    channel: 'PHONE',
    subject: '',
    categoryCode: '',
    urgency: 'NORMAL' as TicketUrgency,
    description: '',
  });
  const submit = useMutation({
    mutationFn: async () =>
      api<StaffTicket>('/platform/tickets', {
        method: 'POST',
        ...options,
        headers: { ...options.headers, ...idempotent(idempotency.key()) },
        body: {
          customer: customerBody(customer, requester),
          channel: form.channel,
          subject: form.subject.trim(),
          categoryCode:
            form.categoryCode === '' ? (categories.data?.[0]?.code ?? '') : form.categoryCode,
          urgency: form.urgency,
          description: form.description.trim(),
        },
      }),
    onSuccess: async (ticket) => {
      idempotency.renew();
      await navigate(`/platform/tickets/${ticket.id}`);
    },
    onError: forgetExpiredElevation,
  });
  return (
    <form
      className="max-w-3xl space-y-6"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      {submit.isError ? <Notice tone="error">{describeError(submit.error)}</Notice> : null}
      <Card>
        <CardHeader title={t('tickets.customer')} />
        <CustomerPicker
          value={customer}
          requester={requester}
          onChange={setCustomer}
          onRequester={setRequester}
        />
      </Card>
      <Card>
        <CardHeader title={t('tickets.whatsWrong')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('tickets.channel')}>
            {(ids) => (
              <Select
                {...ids}
                value={form.channel}
                onChange={(event) => {
                  setForm({ ...form, channel: event.target.value });
                }}
              >
                {ticketChannelSchema.options
                  .filter((c) => c !== 'WEB')
                  .map((c) => (
                    <option key={c} value={c}>
                      {t(`tickets.channel.${c}`)}
                    </option>
                  ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('tickets.category')}>
            {(ids) => (
              <Select
                {...ids}
                value={
                  form.categoryCode === '' ? (categories.data?.[0]?.code ?? '') : form.categoryCode
                }
                onChange={(event) => {
                  setForm({ ...form, categoryCode: event.target.value });
                }}
              >
                {(categories.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('tickets.subject')} className="sm:col-span-2">
            {(ids) => (
              <Input
                {...ids}
                required
                minLength={3}
                maxLength={150}
                value={form.subject}
                onChange={(event) => {
                  setForm({ ...form, subject: event.target.value });
                }}
              />
            )}
          </FormField>
          <UrgencyField
            value={form.urgency}
            onChange={(urgency) => {
              setForm({ ...form, urgency });
            }}
          />
          <FormField label={t('tickets.description')} className="sm:col-span-2">
            {(ids) => (
              <Textarea
                {...ids}
                required
                minLength={10}
                maxLength={5000}
                rows={6}
                value={form.description}
                onChange={(event) => {
                  setForm({ ...form, description: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
      </Card>
      <Button
        type="submit"
        variant="highlight"
        size="lg"
        disabled={submit.isPending || customer === null}
      >
        {t('tickets.open')}
      </Button>
    </form>
  );
}

/** /platform/requests/new — a service request for a customer (P8-7, ADR-047). */
export function StaffNewRequestPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {t('tickets.requestOnBehalf')}
      </h1>
      <p className="max-w-2xl text-muted-foreground">{t('tickets.requestOnBehalfHelp')}</p>
      <ElevationGate>
        <StaffNewRequestForm />
      </ElevationGate>
    </div>
  );
}

function StaffNewRequestForm() {
  const { options } = useElevated();
  const regions = useRegions();
  const idempotency = useIdempotencyKey();
  const services = useQuery({
    queryKey: ['catalogue', 'services', 'on-behalf'],
    queryFn: async () =>
      (await api<PublicServiceListResponse>('/catalogue/services?limit=50')).services,
  });
  const [customer, setCustomer] = useState<Chosen | null>(null);
  const [requester, setRequester] = useState('');
  const [form, setForm] = useState({
    serviceSlug: '',
    quantity: '1',
    county: 'KE-30',
    address: '',
    description: '',
    contactPhone: '',
  });
  const service = services.data?.find((s) => s.slug === form.serviceSlug);
  const submit = useMutation({
    mutationFn: async () =>
      api<ServiceRequest>('/platform/requests', {
        method: 'POST',
        ...options,
        headers: { ...options.headers, ...idempotent(idempotency.key()) },
        body: {
          customer: customerBody(customer, requester),
          request: {
            serviceSlug: form.serviceSlug,
            ...(service?.price?.model === 'PER_UNIT'
              ? { quantity: Number.parseInt(form.quantity, 10) }
              : {}),
            county: form.county,
            address: form.address.trim(),
            description: form.description.trim(),
            contactPhone: form.contactPhone.trim(),
          },
        },
      }),
    // Helpdesk staff may not open the quotation desk, so stay here and confirm.
    onSuccess: () => {
      idempotency.renew();
    },
    onError: forgetExpiredElevation,
  });
  const set = (key: keyof typeof form) => (value: string) => {
    setForm({ ...form, [key]: value });
  };
  return (
    <form
      className="max-w-3xl space-y-6"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      {submit.isError ? <Notice tone="error">{describeError(submit.error)}</Notice> : null}
      {submit.data === undefined ? null : (
        <Alert tone="success">{t('tickets.requestSent', { number: submit.data.number })}</Alert>
      )}
      <Card>
        <CardHeader title={t('tickets.customer')} />
        <CustomerPicker
          value={customer}
          requester={requester}
          onChange={setCustomer}
          onRequester={setRequester}
        />
      </Card>
      <Card>
        <CardHeader title={t('requests.aboutJob')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('tickets.serviceSlug')} className="sm:col-span-2">
            {(ids) => (
              <Combobox
                {...ids}
                options={(services.data ?? []).map((s) => ({ value: s.slug, label: s.name }))}
                value={form.serviceSlug === '' ? null : form.serviceSlug}
                placeholder="—"
                searchLabel={t('tickets.serviceSlug')}
                onChange={set('serviceSlug')}
              />
            )}
          </FormField>
          {service?.price?.model === 'PER_UNIT' ? (
            <FormField label={t('tickets.quantity', { min: service.price.minQuantity })}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(event) => {
                    set('quantity')(event.target.value);
                  }}
                />
              )}
            </FormField>
          ) : null}
          <FormField label={t('tickets.county')}>
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
          <FormField label={t('tickets.address')} className="sm:col-span-2">
            {(ids) => (
              <Input
                {...ids}
                required
                minLength={5}
                value={form.address}
                onChange={(event) => {
                  set('address')(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t('tickets.contactPhone')} help={t('tickets.contactPhoneHint')}>
            {(ids) => (
              <Input
                {...ids}
                required
                inputMode="tel"
                value={form.contactPhone}
                onChange={(event) => {
                  set('contactPhone')(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t('tickets.whatTheyNeed')} className="sm:col-span-2">
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
        </div>
      </Card>
      <Button
        type="submit"
        variant="highlight"
        size="lg"
        disabled={submit.isPending || customer === null}
      >
        {t('tickets.sendRequest')}
      </Button>
    </form>
  );
}
