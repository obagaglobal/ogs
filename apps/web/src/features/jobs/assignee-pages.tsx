import {
  declineReasonSchema,
  type AssigneeJob,
  type AssigneeJobCard,
  type DeclineReason,
} from '@ogs/contracts';
import { useId, useState, type ReactNode, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Checkbox, RadioGroup, RadioGroupItem } from '@/components/ui/choice-controls';
import { Code } from '@/components/ui/data-display';
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
import { useWorkspace } from '@/features/workspace/workspace-state';
import { t, type MessageKey } from '@/i18n';
import { describeError } from '@/lib/api';
import { PhotoGrid } from './job-parts';
import {
  formatDay,
  idempotent,
  isGone,
  jobEventLabel,
  jobPill,
  jobStatusLabel,
  timeLeft,
  useAssigneeJob,
  useAssigneeJobs,
  useDraft,
  useIdempotencyKey,
  useJobWrite,
  useNow,
  useOffer,
  usePhotoUpload,
} from './jobs-data';

/**
 * Field work (Phase 9 plan §2.9): designed at 360 px first. One `highlight`
 * button per screen (the next step), every command retried with the same
 * Idempotency-Key after a network failure, typed text kept until sent.
 */

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** Shown when any job call answers 404: the job is no longer the caller's (T4). */
function NoLongerAssigned() {
  return (
    <EmptyState
      as="h1"
      title={t('jobs.noLongerAssigned')}
      body={t('jobs.noLongerAssignedBody')}
      action={
        <Link to="/jobs" className={buttonVariants({ variant: 'secondary' })}>
          {t('jobs.backToJobs')}
        </Link>
      }
    />
  );
}

/** A failed command: a plain message and a retry that resends the SAME key. */
function RetryNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const network = !(error instanceof Error && 'status' in error);
  return (
    <Alert tone="error" title={network ? t('jobs.notSent') : describeError(error)}>
      {onRetry === undefined ? null : (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('jobs.tryAgain')}
        </Button>
      )}
    </Alert>
  );
}

function windowText(from: string | null, to: string | null): string {
  if (from === null && to === null) {
    return t('jobs.anyTime');
  }
  return t('jobs.windowRange', { from: formatDay(from ?? to), to: formatDay(to ?? from) });
}

/** Under 15 minutes left ("12 min"), or expired: the offer card warns. */
function urgent(left: string | null): boolean {
  return !(left?.includes('h') ?? false) && (left === null || Number.parseInt(left, 10) < 15);
}

// ---------------------------------------------------------------- list

export function JobsPage() {
  const [tab, setTab] = useState<'offers' | 'active' | 'done'>('active');
  const counts = useAssigneeJobs('active').data?.counts;
  return (
    <div className="space-y-6">
      <PageHeader title={t('jobs.title')} />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as typeof tab);
        }}
      >
        <TabsList>
          <TabsTrigger value="offers">
            {t('jobs.tab.offers')}
            {counts !== undefined && counts.offers > 0 ? (
              <Badge tone="warning" className="ml-2">
                {counts.offers}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="active">{t('jobs.tab.active')}</TabsTrigger>
          <TabsTrigger value="done">{t('jobs.tab.done')}</TabsTrigger>
        </TabsList>
        <TabsContent value="offers" className="pt-4">
          <JobCards view="offers" />
        </TabsContent>
        <TabsContent value="active" className="pt-4">
          <JobCards view="active" />
        </TabsContent>
        <TabsContent value="done" className="pt-4">
          <DoneList />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function JobCards({ view }: { view: 'offers' | 'active' }) {
  const list = useAssigneeJobs(view);
  const now = useNow();
  if (list.isLoading) {
    return <PageSkeleton />;
  }
  if (list.isError || list.data === undefined) {
    return <Notice tone="error">{describeError(list.error)}</Notice>;
  }
  if (list.data.items.length === 0) {
    return view === 'offers' ? (
      <EmptyState title={t('jobs.noOffers')} body={t('jobs.noOffersBody')} />
    ) : (
      <EmptyState title={t('jobs.noActive')} body={t('jobs.noActiveBody')} />
    );
  }
  return (
    <ul className="space-y-3">
      {list.data.items.map((job) => (
        <li key={job.offer?.id ?? job.id}>
          <JobCard job={job} now={now} />
        </li>
      ))}
    </ul>
  );
}

function JobCard({ job, now }: { job: AssigneeJobCard; now: number }) {
  const left = job.offer === null ? null : timeLeft(job.offer.expiresAt, now);
  const to = job.offer === null ? `/jobs/${job.id}` : `/jobs/offers/${job.offer.id}`;
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Code>{job.number}</Code>
        {job.offer === null ? (
          <StatusPill status={jobPill(job.status)} label={jobStatusLabel(job.status)} />
        ) : (
          <Badge tone={urgent(left) ? 'warning' : 'neutral'}>
            {left === null ? t('jobs.expired') : t('jobs.expiresIn', { time: left })}
          </Badge>
        )}
      </div>
      <p className="font-display text-base font-medium">{job.title}</p>
      <p className="text-sm text-muted-foreground">
        {job.area} · {job.regionCode}
      </p>
      <p className="text-sm text-muted-foreground">{windowText(job.windowFrom, job.windowTo)}</p>
      <Link
        to={to}
        className={buttonVariants({ variant: 'secondary', className: 'w-full sm:w-auto' })}
      >
        {job.offer === null
          ? t('jobs.openJob', { number: job.number })
          : t('jobs.viewOffer', { number: job.number })}
      </Link>
    </Card>
  );
}

function DoneList() {
  const list = useAssigneeJobs('done');
  if (list.isLoading) {
    return <PageSkeleton />;
  }
  if (list.isError || list.data === undefined) {
    return <Notice tone="error">{describeError(list.error)}</Notice>;
  }
  if (list.data.done.length === 0) {
    return <EmptyState title={t('jobs.noDone')} />;
  }
  return (
    <ul className="space-y-2">
      {list.data.done.map((item) => (
        <li key={item.assignmentId}>
          <Card className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Code>{item.number}</Code> <span className="ml-2">{item.title}</span>
            </span>
            <span className="text-sm text-muted-foreground">
              {item.endedAt === null ? '' : formatDay(item.endedAt.slice(0, 10))}
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- offer

export function OfferPage() {
  const { offerId = '' } = useParams();
  const { selected } = useWorkspace();
  const navigate = useNavigate();
  const offer = useOffer(offerId);
  const now = useNow();
  const [technician, setTechnician] = useState('');
  const idempotency = useIdempotencyKey();
  const accept = useJobWrite(() => ({
    path: `/jobs/offers/${offerId}/accept`,
    body: technician === '' ? {} : { technicianUserId: technician },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  if (offer.isLoading) {
    return <PageSkeleton />;
  }
  if (isGone(offer.error)) {
    return <NoLongerAssigned />;
  }
  if (offer.isError || offer.data === undefined) {
    return <Notice tone="error">{describeError(offer.error)}</Notice>;
  }
  const data = offer.data;
  const left = timeLeft(data.expiresAt, now);
  const company = data.kind === 'COMPANY';
  const submit = () => {
    accept.mutate(undefined, {
      onSuccess: (job) => {
        idempotency.renew();
        void navigate(`/jobs/${job.id}`);
      },
    });
  };
  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <div className="space-y-2">
        <Breadcrumbs items={[{ label: t('jobs.title'), to: '/jobs' }, { label: data.number }]} />
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold">
          <span>{t('jobs.offerTitle')}</span> <Code>{data.number}</Code>
        </h1>
        <Badge tone={left === null ? 'danger' : 'warning'}>
          {left === null ? t('jobs.expired') : t('jobs.expiresIn', { time: left })}
        </Badge>
      </div>
      {accept.isError ? <RetryNotice error={accept.error} onRetry={submit} /> : null}
      <Card className="space-y-4">
        <CardHeader title={data.title} />
        <Fact label={t('jobs.where')}>
          {data.area} · {data.regionCode} · {data.onSite ? t('jobs.onSite') : t('jobs.remote')}
        </Fact>
        <Fact label={t('jobs.when')}>{windowText(data.windowFrom, data.windowTo)}</Fact>
        <Fact label={t('jobs.skills')}>
          {data.skills.length === 0 ? '—' : data.skills.map((s) => s.name).join(', ')}
        </Fact>
        <Fact label={t('jobs.brief')}>
          <span className="whitespace-pre-line">
            {data.brief === '' ? t('jobs.noBrief') : data.brief}
          </span>
        </Fact>
        <p className="text-sm text-muted-foreground">{t('jobs.addressAfterAccept')}</p>
        {company ? (
          <FormField label={t('jobs.chooseTechnician')}>
            {(ids) => (
              <Select
                {...ids}
                value={technician}
                onChange={(event) => {
                  setTechnician(event.target.value);
                }}
              >
                <option value="">{t('jobs.chooseTechnicianPlaceholder')}</option>
                {data.technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ) : null}
      </Card>
      <StickyActions>
        <DeclineDialog offerId={offerId} />
        <Button
          variant="highlight"
          size="lg"
          disabled={accept.isPending || left === null || (company && technician === '')}
          onClick={submit}
        >
          {t('jobs.acceptJob')}
        </Button>
      </StickyActions>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** Phones: the actions stay at the bottom of the screen, above the keyboard line. */
function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap justify-end gap-2 border-t border-border bg-paper p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
      {children}
    </div>
  );
}

function DeclineDialog({ offerId }: { offerId: string }) {
  const { selected } = useWorkspace();
  const navigate = useNavigate();
  const legendId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeclineReason>('NOT_AVAILABLE');
  const [note, setNote] = useState('');
  const idempotency = useIdempotencyKey();
  const decline = useJobWrite<undefined, { declined: true }>(() => ({
    path: `/jobs/offers/${offerId}/decline`,
    body: { reason, ...(note.trim() === '' ? {} : { note: note.trim() }) },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="lg">
          {t('jobs.decline')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('jobs.declineTitle')} description={t('jobs.declineBody')}>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            decline.mutate(undefined, {
              onSuccess: () => {
                idempotency.renew();
                setOpen(false);
                void navigate('/jobs');
              },
            });
          }}
        >
          {decline.isError ? <RetryNotice error={decline.error} /> : null}
          <fieldset className="space-y-2">
            <legend id={legendId} className="font-display text-sm font-medium">
              {t('jobs.declineReason')}
            </legend>
            <RadioGroup
              aria-labelledby={legendId}
              value={reason}
              onValueChange={(next) => {
                setReason(next as DeclineReason);
              }}
              className="grid gap-2"
            >
              {declineReasonSchema.options.map((option) => {
                const id = `${legendId}-${option}`;
                return (
                  <label
                    key={option}
                    htmlFor={id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border p-3 has-[[data-state=checked]]:border-ink"
                  >
                    <RadioGroupItem id={id} value={option} />
                    <span className="text-sm">{t(`jobs.reason.${option}` as MessageKey)}</span>
                  </label>
                );
              })}
            </RadioGroup>
          </fieldset>
          <FormField label={t('jobs.declineNote')} optional={reason !== 'OTHER'}>
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                maxLength={500}
                required={reason === 'OTHER'}
                minLength={reason === 'OTHER' ? 3 : undefined}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
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
            <Button type="submit" variant="secondary" disabled={decline.isPending}>
              {t('jobs.declineSend')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

// ---------------------------------------------------------------- job

export function JobPage() {
  const { id = '' } = useParams();
  const job = useAssigneeJob(id);
  if (job.isLoading) {
    return <PageSkeleton />;
  }
  if (isGone(job.error)) {
    return <NoLongerAssigned />;
  }
  if (job.isError || job.data === undefined) {
    return <Notice tone="error">{describeError(job.error)}</Notice>;
  }
  return <JobView job={job.data} />;
}

function JobView({ job }: { job: AssigneeJob }) {
  const { selected } = useWorkspace();
  const navigate = useNavigate();
  const idempotency = useIdempotencyKey();
  const next: { path: string; label: string } | null = job.can.onTheWay
    ? { path: 'on-the-way', label: t('jobs.next.onTheWay') }
    : job.can.start
      ? { path: 'start', label: t('jobs.next.start') }
      : null;
  const step = useJobWrite((path: string) => ({
    path: `/jobs/${job.id}/${path}`,
    body: { version: job.version },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  const run = (path: string) => {
    step.mutate(path, { onSuccess: idempotency.renew });
  };
  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <div className="space-y-2">
        <Breadcrumbs items={[{ label: t('jobs.title'), to: '/jobs' }, { label: job.number }]} />
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold">
          <Code>{job.number}</Code>
          <StatusPill status={jobPill(job.status)} label={jobStatusLabel(job.status)} />
        </h1>
        <p className="text-muted-foreground">{job.title}</p>
      </div>
      {step.isError ? (
        <RetryNotice
          error={step.error}
          onRetry={() => {
            run(step.variables);
          }}
        />
      ) : null}
      <SiteCard job={job} />
      <Card className="space-y-3">
        <CardHeader title={t('jobs.brief')} />
        <p className="whitespace-pre-line text-sm">
          {job.brief === '' ? t('jobs.noBrief') : job.brief}
        </p>
        {job.skills.length === 0 ? null : (
          <p className="text-sm text-muted-foreground">
            {t('jobs.skills')}: {job.skills.map((s) => s.name).join(', ')}
          </p>
        )}
      </Card>
      {job.internalNotes.length === 0 ? null : (
        <Card className="space-y-3 border-dashed">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {t('jobs.internalNotes')}{' '}
                <Badge tone="warning">{t('dispatch.internalBadge')}</Badge>
              </span>
            }
          />
          <ul className="space-y-2 text-sm">
            {job.internalNotes.map((note) => (
              <li key={note.id} className="whitespace-pre-line rounded-md bg-surface-muted p-3">
                {note.body}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <NotesCard job={job} />
      <PhotosCard job={job} />
      {job.activity.length === 0 ? null : (
        <Card>
          <CardHeader title={t('jobs.activity')} />
          <Timeline
            label={t('jobs.activity')}
            entries={job.activity.map((entry) => ({
              key: entry.id,
              title: jobEventLabel(entry.kind),
              meta: new Date(entry.at).toLocaleString('en-KE'),
              body: entry.reason ?? undefined,
            }))}
          />
        </Card>
      )}
      {job.can.changeTechnician ? <ChangeTechnicianCard job={job} /> : null}
      <StickyActions>
        {job.can.pause ? <PauseDialog job={job} /> : null}
        {job.can.resume ? (
          <Button
            variant="secondary"
            size="lg"
            disabled={step.isPending}
            onClick={() => {
              run('resume');
            }}
          >
            {t('jobs.resume')}
          </Button>
        ) : null}
        {next === null ? null : (
          <Button
            variant="highlight"
            size="lg"
            disabled={step.isPending}
            onClick={() => {
              run(next.path);
            }}
          >
            {next.label}
          </Button>
        )}
        {job.can.complete ? (
          <Button
            variant="highlight"
            size="lg"
            onClick={() => {
              void navigate(`/jobs/${job.id}/complete`);
            }}
          >
            {t('jobs.next.complete')}
          </Button>
        ) : null}
      </StickyActions>
    </div>
  );
}

function SiteCard({ job }: { job: AssigneeJob }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="space-y-3">
      <CardHeader title={t('jobs.site')} />
      <p className="text-sm">{job.siteAddress}</p>
      <p className="text-sm text-muted-foreground">
        {job.regionCode} · {windowText(job.windowFrom, job.windowTo)}
      </p>
      <p className="text-sm">
        {t('jobs.customer')}: {job.customerDisplay}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(job.siteAddress).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? t('jobs.addressCopied') : t('jobs.copyAddress')}
        </Button>
        {job.siteContactPhone === null ? null : (
          <a
            href={`tel:${job.siteContactPhone}`}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {job.siteContactName === null
              ? t('jobs.callContactPlain')
              : t('jobs.callContact', { name: job.siteContactName })}
          </a>
        )}
      </div>
    </Card>
  );
}

function NotesCard({ job }: { job: AssigneeJob }) {
  const { selected } = useWorkspace();
  const [body, setBody, clear] = useDraft(`job-note-${job.id}`);
  const idempotency = useIdempotencyKey();
  const add = useJobWrite(() => ({
    path: `/jobs/${job.id}/notes`,
    body: { body: body.trim() },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  const send = () => {
    add.mutate(undefined, {
      onSuccess: () => {
        idempotency.renew();
        clear();
      },
    });
  };
  return (
    <Card className="space-y-3">
      <CardHeader title={t('jobs.workNotes')} />
      {job.workNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('jobs.noNotes')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {job.workNotes.map((note) => (
            <li key={note.id} className="rounded-md border border-border p-3">
              <p className="whitespace-pre-line">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {note.author} · {new Date(note.createdAt).toLocaleString('en-KE')}
              </p>
            </li>
          ))}
        </ul>
      )}
      {job.can.addWork ? (
        <form
          className="space-y-2"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            send();
          }}
        >
          {add.isError ? <RetryNotice error={add.error} onRetry={send} /> : null}
          <FormField label={t('jobs.addNote')} help={t('jobs.draftKept')}>
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                maxLength={4000}
                placeholder={t('jobs.notePlaceholder')}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
              />
            )}
          </FormField>
          <Button type="submit" variant="secondary" disabled={add.isPending || body.trim() === ''}>
            {t('jobs.addNote')}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

interface Sending {
  readonly file: File;
  readonly state: 'sending' | 'failed';
}

function PhotosCard({ job }: { job: AssigneeJob }) {
  const upload = usePhotoUpload(job.id);
  const inputId = useId();
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState<Sending[]>([]);

  /** One at a time, each with its own state and a retry (plan §2.9). */
  const send = async (files: File[]) => {
    for (const file of files) {
      setSending((list) => [...list.filter((s) => s.file !== file), { file, state: 'sending' }]);
      try {
        await upload(file, caption.trim());
        setSending((list) => list.filter((s) => s.file !== file));
      } catch {
        setSending((list) => list.map((s) => (s.file === file ? { file, state: 'failed' } : s)));
      }
    }
    setCaption('');
  };

  return (
    <Card className="space-y-3">
      <CardHeader title={t('jobs.photos')} />
      {job.photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('jobs.noPhotos')}</p>
      ) : (
        <PhotoGrid photos={job.photos} base={`/jobs/${job.id}`} />
      )}
      {sending.length === 0 ? null : (
        <ul className="space-y-1 text-sm" aria-live="polite">
          {sending.map((item) => (
            <li
              key={item.file.name + String(item.file.lastModified)}
              className="flex items-center gap-2"
            >
              <span className="truncate">
                {item.state === 'sending'
                  ? t('jobs.uploading', { name: item.file.name })
                  : t('jobs.notSent')}
              </span>
              {item.state === 'failed' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void send([item.file]);
                  }}
                >
                  {t('jobs.tryAgain')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {job.can.addWork ? (
        <div className="space-y-2">
          <FormField label={t('jobs.photoCaption')} optional>
            {(ids) => (
              <Input
                {...ids}
                maxLength={200}
                value={caption}
                onChange={(event) => {
                  setCaption(event.target.value);
                }}
              />
            )}
          </FormField>
          <label
            htmlFor={inputId}
            className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-control-border bg-surface px-4 py-4 text-center text-sm hover:border-ink has-[:focus-visible]:border-ink"
          >
            <span className="font-medium underline underline-offset-4">{t('jobs.takePhoto')}</span>
            <span className="text-xs text-muted-foreground">{t('jobs.photoHelp')}</span>
            <input
              id={inputId}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                void send(files);
              }}
            />
          </label>
        </div>
      ) : null}
    </Card>
  );
}

function PauseDialog({ job }: { job: AssigneeJob }) {
  const { selected } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const idempotency = useIdempotencyKey();
  const pause = useJobWrite(() => ({
    path: `/jobs/${job.id}/pause`,
    body: { version: job.version, reason: reason.trim() },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="lg">
          {t('jobs.pause')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('jobs.pauseTitle')}>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            pause.mutate(undefined, {
              onSuccess: () => {
                idempotency.renew();
                setOpen(false);
                setReason('');
              },
            });
          }}
        >
          {pause.isError ? <RetryNotice error={pause.error} /> : null}
          <FormField label={t('jobs.pauseReason')} help={t('jobs.reasonHint')}>
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
            <Button type="submit" variant="secondary" disabled={pause.isPending}>
              {t('jobs.pauseSend')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function ChangeTechnicianCard({ job }: { job: AssigneeJob }) {
  const { selected } = useWorkspace();
  const [technician, setTechnician] = useState('');
  const [reason, setReason] = useState('');
  const idempotency = useIdempotencyKey();
  const change = useJobWrite(() => ({
    path: `/jobs/${job.id}/technician`,
    body: { version: job.version, technicianUserId: technician, reason: reason.trim() },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  return (
    <Card className="space-y-3">
      <CardHeader title={t('jobs.changeTechnicianTitle')} />
      <p className="text-sm text-muted-foreground">{job.assignment.technician}</p>
      {change.isError ? <RetryNotice error={change.error} /> : null}
      <FormField label={t('jobs.chooseTechnician')}>
        {(ids) => (
          <Select
            {...ids}
            value={technician}
            onChange={(event) => {
              setTechnician(event.target.value);
            }}
          >
            <option value="">{t('jobs.chooseTechnicianPlaceholder')}</option>
            {job.technicians.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label={t('jobs.reasonField')} help={t('jobs.reasonHint')}>
        {(ids) => (
          <Input
            {...ids}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </FormField>
      <Button
        variant="secondary"
        disabled={change.isPending || technician === '' || reason.trim().length < 5}
        onClick={() => {
          change.mutate(undefined, { onSuccess: idempotency.renew });
        }}
      >
        {t('jobs.changeTechnicianSend')}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------- completion report

export function CompletionPage() {
  const { id = '' } = useParams();
  const job = useAssigneeJob(id);
  if (job.isLoading) {
    return <PageSkeleton />;
  }
  if (isGone(job.error)) {
    return <NoLongerAssigned />;
  }
  if (job.isError || job.data === undefined) {
    return <Notice tone="error">{describeError(job.error)}</Notice>;
  }
  return <CompletionForm job={job.data} />;
}

function CompletionForm({ job }: { job: AssigneeJob }) {
  const { selected } = useWorkspace();
  const navigate = useNavigate();
  const [summary, setSummary, clearSummary] = useDraft(`job-report-${job.id}`);
  const [materials, setMaterials, clearMaterials] = useDraft(`job-materials-${job.id}`);
  const [minutes, setMinutes] = useState('');
  const [chosen, setChosen] = useState<string[]>(job.photos.map((p) => p.id));
  const idempotency = useIdempotencyKey();
  const submit = useJobWrite(() => ({
    path: `/jobs/${job.id}/completion`,
    body: {
      version: job.version,
      summary: summary.trim(),
      minutesOnSite: minutes === '' ? null : Number(minutes),
      materials: materials.trim(),
      evidenceIds: chosen,
    },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  const send = () => {
    submit.mutate(undefined, {
      onSuccess: () => {
        idempotency.renew();
        clearSummary();
        clearMaterials();
        void navigate(`/jobs/${job.id}`);
      },
    });
  };
  const photosNeeded = job.onSite && chosen.length === 0;
  return (
    <form
      className="space-y-6 pb-24 sm:pb-0"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        send();
      }}
    >
      <div className="space-y-2">
        <Breadcrumbs
          items={[
            { label: t('jobs.title'), to: '/jobs' },
            { label: job.number, to: `/jobs/${job.id}` },
            { label: t('jobs.reportTitle') },
          ]}
        />
        <h1 className="font-display text-2xl font-bold">{t('jobs.reportTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('jobs.draftKept')}</p>
      </div>
      {!job.can.complete ? <Notice>{jobStatusLabel(job.status)}</Notice> : null}
      {submit.isError ? <RetryNotice error={submit.error} onRetry={send} /> : null}
      <Card className="space-y-4">
        <FormField label={t('jobs.reportSummary')} help={t('jobs.reportSummaryHelp')}>
          {(ids) => (
            <Textarea
              {...ids}
              required
              minLength={10}
              maxLength={2000}
              rows={5}
              value={summary}
              onChange={(event) => {
                setSummary(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t('jobs.reportMinutes')} optional>
          {(ids) => (
            <Input
              {...ids}
              type="number"
              inputMode="numeric"
              min={0}
              max={10080}
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t('jobs.reportMaterials')} optional>
          {(ids) => (
            <Textarea
              {...ids}
              rows={2}
              maxLength={1000}
              value={materials}
              onChange={(event) => {
                setMaterials(event.target.value);
              }}
            />
          )}
        </FormField>
        <fieldset className="space-y-2">
          <legend className="font-display text-sm font-medium">{t('jobs.reportPhotos')}</legend>
          <p className="text-xs text-muted-foreground">{t('jobs.reportPhotosHelp')}</p>
          {job.photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('jobs.noPhotos')}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {job.photos.map((photo, index) => (
                <li key={photo.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border p-3">
                    <Checkbox
                      checked={chosen.includes(photo.id)}
                      onCheckedChange={(checked) => {
                        setChosen((list) =>
                          checked === true
                            ? [...list, photo.id]
                            : list.filter((value) => value !== photo.id),
                        );
                      }}
                    />
                    <span className="text-sm">
                      {t('tracker.viewPhoto', { n: index + 1 })}
                      {photo.caption === '' ? '' : ` · ${photo.caption}`}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </Card>
      <StickyActions>
        <Button
          type="submit"
          variant="highlight"
          size="lg"
          disabled={
            submit.isPending || !job.can.complete || summary.trim().length < 10 || photosNeeded
          }
        >
          {t('jobs.submitReport')}
        </Button>
      </StickyActions>
    </form>
  );
}
