import {
  DEFAULT_OFFER_WINDOW_MINUTES,
  jobStatusSchema,
  OFFER_WINDOW_MINUTES,
  type OfferAssignee,
  type StaffJob,
  type StaffJobSummary,
} from '@ogs/contracts';
import { useId, useState, type ReactNode, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/choice-controls';
import { Avatar, Code, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Notice } from '@/components/ui/form-controls';
import { FormField } from '@/components/ui/form-field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Breadcrumbs, Timeline } from '@/components/ui/navigation';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/overlays';
import { ElevationGate } from '@/features/platform/elevation-gate';
import { ELEVATION_KEY, useElevated } from '@/features/platform/elevation-state';
import { useRegions } from '@/features/provider/provider-data';
import { t, type MessageKey } from '@/i18n';
import { ApiError, describeError } from '@/lib/api';
import { PhotoGrid } from './job-parts';
import {
  jobEventLabel,
  jobPill,
  jobStatusLabel,
  timeLeft,
  useCandidates,
  useDispatchQueue,
  useNow,
  useSourceJob,
  useStaffJob,
  useStaffJobWrite,
  type DispatchFilters,
} from './jobs-data';

/**
 * The dispatch desk (Phase 9 plan §2.9), behind an elevation. The one
 * `highlight` button is "Send offer" in the offer dialog.
 */

function forgetExpiredElevation(error: unknown) {
  if (error instanceof ApiError && error.code === 'elevation_required') {
    sessionStorage.removeItem(ELEVATION_KEY);
  }
}

function age(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} h`;
  return `${String(Math.floor(hours / 24))} d`;
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

function AssigneeCell({ job }: { job: StaffJobSummary }) {
  if (job.assignee !== null) {
    return (
      <span className="flex items-center gap-2">
        <Avatar name={job.assignee.technician} size={24} />
        <span className="min-w-0">
          <span className="block truncate text-sm">{job.assignee.technician}</span>
          <Badge tone="neutral">{job.assignee.label}</Badge>
        </span>
      </span>
    );
  }
  if (job.pendingOffer !== null) {
    return <span className="text-sm text-muted-foreground">{job.pendingOffer.label}</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

// ---------------------------------------------------------------- queue

export function DispatchPage() {
  return (
    <div className="space-y-6">
      <PageHeader title={t('dispatch.title')} description={t('dispatch.description')} />
      <ElevationGate>
        <Queue />
      </ElevationGate>
    </div>
  );
}

const COLUMNS: Column<StaffJobSummary>[] = [
  {
    key: 'number',
    header: '#',
    cell: (job) => (
      <Link
        to={`/platform/dispatch/${job.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        <Code className="whitespace-nowrap">{job.number}</Code>
      </Link>
    ),
  },
  {
    key: 'source',
    header: t('dispatch.source'),
    cell: (job) => <Code className="whitespace-nowrap">{job.source.number}</Code>,
  },
  { key: 'title', header: t('dispatch.title.field'), cell: (job) => job.title },
  { key: 'county', header: t('dispatch.county'), cell: (job) => job.regionCode },
  {
    key: 'status',
    header: t('tickets.col.status'),
    cell: (job) => <StatusPill status={jobPill(job.status)} label={jobStatusLabel(job.status)} />,
  },
  { key: 'assignee', header: t('dispatch.assignee'), cell: (job) => <AssigneeCell job={job} /> },
  {
    key: 'age',
    header: t('dispatch.age'),
    numeric: true,
    cell: (job) => <span className="tabular">{age(job.createdAt)}</span>,
  },
];

function Queue() {
  const [filters, setFilters] = useState<DispatchFilters>({ status: '', source: '' });
  const [page, setPage] = useState(1);
  const queue = useDispatchQueue(filters, page);
  if (queue.isError) {
    forgetExpiredElevation(queue.error);
  }
  const set = (key: keyof DispatchFilters) => (value: string) => {
    setPage(1);
    setFilters({ ...filters, [key]: value });
  };
  const data = queue.data;
  const pages = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('dispatch.queued')} value={data?.counts.queued ?? '—'} emphasis />
        <StatTile label={t('dispatch.offered')} value={data?.counts.offered ?? '—'} />
        <StatTile label={t('dispatch.inProgress')} value={data?.counts.inProgress ?? '—'} />
        <StatTile label={t('dispatch.awaiting')} value={data?.counts.awaitingConfirmation ?? '—'} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Filter
          label={t('tickets.col.status')}
          value={filters.status}
          onChange={set('status')}
          options={[
            ['', t('dispatch.allStatuses')],
            ...jobStatusSchema.options.map((s): [string, string] => [s, jobStatusLabel(s)]),
          ]}
        />
        <Filter
          label={t('dispatch.source')}
          value={filters.source}
          onChange={set('source')}
          options={[
            ['', t('dispatch.allSources')],
            ['ORDER', t('dispatch.orders')],
            ['TICKET', t('dispatch.tickets')],
          ]}
        />
      </div>
      {queue.isError ? <Notice tone="error">{describeError(queue.error)}</Notice> : null}
      {data?.jobs.length === 0 ? (
        <EmptyState title={t('dispatch.empty')} body={t('dispatch.emptyBody')} />
      ) : (
        <DataTable
          caption={t('dispatch.title')}
          columns={COLUMNS}
          rows={data?.jobs}
          rowKey={(job) => job.id}
          loading={queue.isLoading}
          pageSize={25}
          card={(job) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <Link
                  to={`/platform/dispatch/${job.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  <Code>{job.number}</Code>
                </Link>
                <StatusPill status={jobPill(job.status)} label={jobStatusLabel(job.status)} />
              </div>
              <p className="text-sm">{job.title}</p>
              <p className="text-xs text-muted-foreground">
                {job.source.number} · {job.regionCode} · {age(job.createdAt)}
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

// ---------------------------------------------------------------- job

export function DispatchJobPage() {
  const { id = '' } = useParams();
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: t('dispatch.title'), to: '/platform/dispatch' },
          { label: t('dispatch.job') },
        ]}
      />
      <ElevationGate>
        <JobLoader id={id} />
      </ElevationGate>
    </div>
  );
}

function JobLoader({ id }: { id: string }) {
  const job = useStaffJob(id);
  if (job.isError) {
    forgetExpiredElevation(job.error);
    return <Notice tone="error">{describeError(job.error)}</Notice>;
  }
  if (job.isLoading || job.data === undefined) {
    return <Skeleton className="h-64 w-full" />;
  }
  return <StaffJobView job={job.data} />;
}

function StaffJobView({ job }: { job: StaffJob }) {
  const { options } = useElevated();
  const now = useNow();
  const pending = job.offers.find((offer) => offer.status === 'PENDING');
  const withdraw = useStaffJobWrite(() => ({
    path: `/platform/jobs/${job.id}/offers/${pending?.id ?? ''}/withdraw`,
    body: { version: job.version },
  }));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold">
          <Code>{job.number}</Code>
          <StatusPill status={jobPill(job.status)} label={jobStatusLabel(job.status)} />
        </h1>
        <p className="text-muted-foreground">
          {job.title} · {job.customerDisplay} ·{' '}
          <Link
            to={
              job.source.kind === 'ORDER'
                ? `/platform/orders/${job.source.id}`
                : `/platform/tickets/${job.source.id}`
            }
            className="underline underline-offset-4"
          >
            {job.source.number}
          </Link>
        </p>
        {job.cancelReason === null ? null : (
          <p className="text-sm text-muted-foreground">{job.cancelReason}</p>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <BriefEditor job={job} />
          {job.can.offer ? <Suggestions job={job} /> : null}
          {job.report === null ? null : (
            <Card className="space-y-3">
              <CardHeader title={t('jobs.reportTitle')} />
              <p className="whitespace-pre-line text-sm">{job.report.summary}</p>
              {job.report.minutesOnSite === null ? null : (
                <p className="text-sm text-muted-foreground">
                  {t('tracker.timeOnSite', { minutes: job.report.minutesOnSite })}
                </p>
              )}
            </Card>
          )}
          {job.photos.length === 0 ? null : (
            <Card className="space-y-3">
              <CardHeader title={t('jobs.photos')} />
              <PhotoGrid
                photos={job.photos}
                base={`/platform/jobs/${job.id}`}
                workspace={options.workspace}
                headers={options.headers}
              />
            </Card>
          )}
          {job.workNotes.length === 0 ? null : (
            <Card className="space-y-3">
              <CardHeader title={t('jobs.workNotes')} />
              <ul className="space-y-2 text-sm">
                {job.workNotes.map((note) => (
                  <li key={note.id} className="rounded-md border border-border p-3">
                    <p className="whitespace-pre-line">{note.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{note.author}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-20">
          <Card className="space-y-3">
            <CardHeader title={t('dispatch.assignee')} />
            {job.assignee === null ? (
              <p className="text-sm text-muted-foreground">{t('tickets.nobody')}</p>
            ) : (
              <AssigneeCell job={job} />
            )}
            {pending === undefined ? null : (
              <>
                <p className="text-sm">
                  {t('dispatch.currentOffer', {
                    name: pending.label,
                    when: timeLeft(pending.expiresAt, now) ?? t('jobs.expired'),
                  })}
                </p>
                {job.can.withdrawOffer ? (
                  <Button
                    variant="secondary"
                    disabled={withdraw.isPending}
                    onClick={() => {
                      withdraw.mutate(undefined);
                    }}
                  >
                    {t('dispatch.withdrawOffer')}
                  </Button>
                ) : null}
              </>
            )}
            {withdraw.isError ? (
              <Notice tone="error">{describeError(withdraw.error)}</Notice>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {job.can.reassign ? (
                <ReasonAction
                  job={job}
                  path="reassign"
                  trigger={t('dispatch.reassign')}
                  title={t('dispatch.reassignTitle')}
                  variant="secondary"
                />
              ) : null}
              {job.can.confirm ? (
                <ReasonAction
                  job={job}
                  path="confirm"
                  trigger={t('dispatch.confirmForCustomer')}
                  title={t('dispatch.confirmForCustomer')}
                  variant="secondary"
                />
              ) : null}
              {job.can.cancel ? (
                <ReasonAction
                  job={job}
                  path="cancel"
                  trigger={t('dispatch.cancelJob')}
                  title={t('dispatch.cancelTitle')}
                  variant="danger"
                />
              ) : null}
            </div>
          </Card>
          {job.offers.length === 0 ? null : (
            <Card>
              <CardHeader title={t('dispatch.offers')} />
              <ul className="space-y-2 text-sm">
                {job.offers.map((offer) => (
                  <li key={offer.id} className="rounded-md border border-border p-2">
                    <span className="font-medium">{offer.label}</span> ·{' '}
                    {offer.status.toLowerCase()}
                    {offer.declineReason === null ? null : (
                      <span className="block text-xs text-muted-foreground">
                        {t(`jobs.reason.${offer.declineReason}` as MessageKey)}
                        {offer.declineNote === null ? '' : `: ${offer.declineNote}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title={t('jobs.activity')} />
            <Timeline
              label={t('jobs.activity')}
              entries={job.activity.map((entry) => ({
                key: entry.id,
                title: (
                  <span className="flex flex-wrap items-center gap-2">
                    {jobEventLabel(entry.kind)}
                    {entry.customerVisible || entry.providerVisible ? null : (
                      <Badge tone="warning">{t('dispatch.internalBadge')}</Badge>
                    )}
                  </span>
                ),
                meta: `${new Date(entry.at).toLocaleString('en-KE')}${entry.actor === null ? '' : ` · ${entry.actor}`}`,
                body: entry.reason ?? undefined,
              }))}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function BriefEditor({ job }: { job: StaffJob }) {
  const [form, setForm] = useState({
    title: job.title,
    brief: job.brief,
    siteAddress: job.siteAddress,
    siteContactName: job.siteContactName ?? '',
    siteContactPhone: job.siteContactPhone ?? '',
    windowFrom: job.windowFrom ?? '',
    windowTo: job.windowTo ?? '',
  });
  const save = useStaffJobWrite(() => ({
    method: 'PATCH',
    path: `/platform/jobs/${job.id}/brief`,
    body: {
      version: job.version,
      title: form.title.trim(),
      brief: form.brief.trim(),
      siteAddress: form.siteAddress.trim(),
      siteContactName: form.siteContactName.trim() === '' ? null : form.siteContactName.trim(),
      siteContactPhone: form.siteContactPhone.trim() === '' ? null : form.siteContactPhone.trim(),
      windowFrom: form.windowFrom === '' ? null : form.windowFrom,
      windowTo: form.windowTo === '' ? null : form.windowTo,
    },
  }));
  const field = (key: keyof typeof form) => (value: string) => {
    setForm({ ...form, [key]: value });
  };
  return (
    <Card className="space-y-4">
      <CardHeader title={t('dispatch.brief')} description={t('dispatch.briefHelp')} />
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      <fieldset disabled={!job.can.editBrief} className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('dispatch.title.field')}
          value={form.title}
          onChange={field('title')}
          wide
        />
        <FormField label={t('dispatch.brief')} className="sm:col-span-2">
          {(ids) => (
            <Textarea
              {...ids}
              rows={5}
              maxLength={4000}
              value={form.brief}
              onChange={(event) => {
                field('brief')(event.target.value);
              }}
            />
          )}
        </FormField>
        <TextField
          label={t('dispatch.siteAddress')}
          value={form.siteAddress}
          onChange={field('siteAddress')}
          wide
        />
        <TextField
          label={t('dispatch.siteContactName')}
          value={form.siteContactName}
          onChange={field('siteContactName')}
        />
        <TextField
          label={t('dispatch.siteContactPhone')}
          value={form.siteContactPhone}
          onChange={field('siteContactPhone')}
        />
        <TextField
          label={t('dispatch.windowFrom')}
          type="date"
          value={form.windowFrom}
          onChange={field('windowFrom')}
        />
        <TextField
          label={t('dispatch.windowTo')}
          type="date"
          value={form.windowTo}
          onChange={field('windowTo')}
        />
      </fieldset>
      {job.can.editBrief ? (
        <Button
          variant="secondary"
          disabled={save.isPending}
          onClick={() => {
            save.mutate(undefined);
          }}
        >
          {t('dispatch.saveBrief')}
        </Button>
      ) : null}
    </Card>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
  wide?: boolean;
}) {
  return (
    <FormField label={label} className={wide ? 'sm:col-span-2' : undefined}>
      {(ids) => (
        <Input
          {...ids}
          type={type}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </FormField>
  );
}

function Suggestions({ job }: { job: StaffJob }) {
  const candidates = useCandidates(job.id, job.can.offer);
  if (candidates.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (candidates.isError || candidates.data === undefined) {
    return <Notice tone="error">{describeError(candidates.error)}</Notice>;
  }
  const { internal, providers } = candidates.data;
  const groups: [string, { assignee: OfferAssignee; name: string; reasons?: string[] }[]][] = [
    [
      t('dispatch.internal'),
      internal.map((person) => ({
        assignee: { kind: 'INTERNAL', technicianUserId: person.id },
        name: person.label,
      })),
    ],
    [
      t('dispatch.individuals'),
      providers
        .filter((p) => p.kind === 'INDIVIDUAL')
        .map((p) => ({
          assignee: { kind: 'INDIVIDUAL', providerId: p.providerId },
          name: p.displayName,
          reasons: p.reasons.filter((r) => r.points > 0).map((r) => r.factor),
        })),
    ],
    [
      t('dispatch.companies'),
      providers
        .filter((p) => p.kind === 'COMPANY')
        .map((p) => ({
          assignee: { kind: 'COMPANY', providerId: p.providerId },
          name: p.displayName,
          reasons: p.reasons.filter((r) => r.points > 0).map((r) => r.factor),
        })),
    ],
  ];
  return (
    <Card className="space-y-4">
      <CardHeader title={t('dispatch.suggestions')} />
      {groups.map(([title, people]) => (
        <section key={title} className="space-y-2">
          <h3 className="font-display text-sm font-medium">{title}</h3>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dispatch.noCandidates')}</p>
          ) : (
            <ul className="space-y-2">
              {people.map((person) => (
                <li
                  key={
                    'providerId' in person.assignee
                      ? person.assignee.providerId
                      : person.assignee.technicianUserId
                  }
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{person.name}</span>
                    <span className="flex flex-wrap gap-1">
                      {(person.reasons ?? []).map((reason) => (
                        <Badge key={reason} tone="neutral">
                          {reason}
                        </Badge>
                      ))}
                    </span>
                  </span>
                  <OfferDialog job={job} assignee={person.assignee} name={person.name} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </Card>
  );
}

function OfferDialog({
  job,
  assignee,
  name,
}: {
  job: StaffJob;
  assignee: OfferAssignee;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(DEFAULT_OFFER_WINDOW_MINUTES));
  const send = useStaffJobWrite(() => ({
    path: `/platform/jobs/${job.id}/offers`,
    body: { version: job.version, assignee, windowMinutes: Number(minutes) },
  }));
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('dispatch.offerTo', { name })}</Button>
      </DialogTrigger>
      <DialogContent title={t('dispatch.offerTitle', { name })}>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            send.mutate(undefined, {
              onSuccess: () => {
                setOpen(false);
              },
            });
          }}
        >
          {send.isError ? <Notice tone="error">{describeError(send.error)}</Notice> : null}
          <FormField label={t('dispatch.offerWindow')}>
            {(ids) => (
              <Select
                {...ids}
                value={minutes}
                onChange={(event) => {
                  setMinutes(event.target.value);
                }}
              >
                {OFFER_WINDOW_MINUTES.map((value) => (
                  <option key={value} value={value}>
                    {value < 60
                      ? t('dispatch.minutes', { n: value })
                      : t('dispatch.hours', { n: value / 60 })}
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
            <Button type="submit" variant="highlight" disabled={send.isPending}>
              {t('dispatch.sendOffer')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function ReasonAction({
  job,
  path,
  trigger,
  title,
  variant,
}: {
  job: StaffJob;
  path: 'reassign' | 'cancel' | 'confirm';
  trigger: string;
  title: string;
  variant: 'secondary' | 'danger';
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const write = useStaffJobWrite(() => ({
    path: `/platform/jobs/${job.id}/${path}`,
    body: { version: job.version, reason: reason.trim() },
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
          <FormField label={t('jobs.reasonField')} help={t('jobs.reasonHint')}>
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

// ---------------------------------------------------------------- parts for other staff pages

/** The job of an order or a ticket, on the staff order and ticket pages. */
export function StaffJobCard({
  kind,
  id,
  children,
}: {
  kind: 'orders' | 'tickets';
  id: string;
  children?: ReactNode;
}) {
  const job = useSourceJob(kind, id);
  return (
    <Card className="space-y-3">
      <CardHeader title={t('dispatch.job')} />
      {job.data === undefined || job.data === null ? (
        <p className="text-sm text-muted-foreground">{t('dispatch.noJob')}</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Code>{job.data.number}</Code>
            <StatusPill status={jobPill(job.data.status)} label={jobStatusLabel(job.data.status)} />
          </div>
          {job.data.assignee === null ? null : <AssigneeCell job={job.data} />}
          <Link
            to={`/platform/dispatch/${job.data.id}`}
            className="text-sm underline underline-offset-4"
          >
            {t('dispatch.openJob', { number: job.data.number })}
          </Link>
        </div>
      )}
      {children}
    </Card>
  );
}

/** "Send a technician" on a staff ticket page (plan §2.9): creates a job with a brief. */
export function SendTechnicianDialog({
  ticketId,
  subject,
  description,
}: {
  ticketId: string;
  subject: string;
  description: string;
}) {
  const navigate = useNavigate();
  const regions = useRegions();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: subject,
    brief: description,
    regionCode: 'KE-30',
    siteAddress: '',
    siteContactName: '',
    siteContactPhone: '',
    onSite: true,
    remoteAllowed: false,
  });
  const create = useStaffJobWrite(() => ({
    path: `/platform/tickets/${ticketId}/jobs`,
    body: {
      title: form.title.trim(),
      brief: form.brief.trim(),
      regionCode: form.regionCode,
      siteAddress: form.siteAddress.trim(),
      siteContactName: form.siteContactName.trim() === '' ? null : form.siteContactName.trim(),
      siteContactPhone: form.siteContactPhone.trim() === '' ? null : form.siteContactPhone.trim(),
      onSite: form.onSite,
      remoteAllowed: form.remoteAllowed,
    },
  }));
  const set =
    (
      key:
        'title' | 'brief' | 'regionCode' | 'siteAddress' | 'siteContactName' | 'siteContactPhone',
    ) =>
    (value: string) => {
      setForm({ ...form, [key]: value });
    };
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('dispatch.sendTechnician')}</Button>
      </DialogTrigger>
      <DialogContent
        title={t('dispatch.sendTechnicianTitle')}
        description={t('dispatch.briefHelp')}
      >
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            create.mutate(undefined, {
              onSuccess: (job) => {
                setOpen(false);
                void navigate(`/platform/dispatch/${job.id}`);
              },
            });
          }}
        >
          {create.isError ? <Notice tone="error">{describeError(create.error)}</Notice> : null}
          <TextField label={t('dispatch.title.field')} value={form.title} onChange={set('title')} />
          <FormField label={t('dispatch.brief')}>
            {(ids) => (
              <Textarea
                {...ids}
                rows={4}
                maxLength={4000}
                value={form.brief}
                onChange={(event) => {
                  set('brief')(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t('dispatch.region')}>
            {(ids) => (
              <Select
                {...ids}
                value={form.regionCode}
                onChange={(event) => {
                  set('regionCode')(event.target.value);
                }}
              >
                {(regions.data ?? [{ code: 'KE-30', name: 'Nairobi' }]).map((region) => (
                  <option key={region.code} value={region.code}>
                    {region.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <TextField
            label={t('dispatch.siteAddress')}
            value={form.siteAddress}
            onChange={set('siteAddress')}
          />
          <TextField
            label={t('dispatch.siteContactName')}
            value={form.siteContactName}
            onChange={set('siteContactName')}
          />
          <TextField
            label={t('dispatch.siteContactPhone')}
            value={form.siteContactPhone}
            onChange={set('siteContactPhone')}
          />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox
              checked={form.remoteAllowed}
              onCheckedChange={(checked) => {
                setForm({ ...form, remoteAllowed: checked === true });
              }}
            />
            {t('dispatch.remoteAllowed')}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('tickets.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="secondary"
              disabled={create.isPending || form.siteAddress.trim().length < 3}
            >
              {t('dispatch.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
