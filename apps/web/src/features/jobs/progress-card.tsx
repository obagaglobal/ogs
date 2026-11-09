import { CUSTOMER_JOB_STEPS, type CustomerJobProgress } from '@ogs/contracts';
import { useState, type SubmitEvent } from 'react';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Avatar } from '@/components/ui/data-display';
import { Notice } from '@/components/ui/form-controls';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import { Stepper, Timeline } from '@/components/ui/navigation';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/overlays';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { t, type MessageKey } from '@/i18n';
import { describeError } from '@/lib/api';
import { PhotoGrid } from './job-parts';
import {
  idempotent,
  jobEventLabel,
  jobPill,
  useIdempotencyKey,
  useJobProgress,
  useJobWrite,
} from './jobs-data';

type Job = NonNullable<CustomerJobProgress['job']>;

const dateFormat = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The first live job tracker (Phase 9 plan §2.9): status, who is coming (a
 * first name and "OGS technician" / "OGS partner technician"), a Stepper of
 * the five customer steps and a Timeline of what happened. Polls every 30 s
 * while the tab is visible and the job is active.
 */
export function JobProgressCard({ source, id }: { source: 'requests' | 'tickets'; id: string }) {
  const progress = useJobProgress(source, id);
  const job = progress.data?.job;
  if (job === undefined || job === null) {
    return null;
  }
  return <ProgressView job={job} source={source} id={id} />;
}

function ProgressView({
  job,
  source,
  id,
}: {
  job: Job;
  source: 'requests' | 'tickets';
  id: string;
}) {
  const step = (CUSTOMER_JOB_STEPS as readonly string[]).indexOf(job.label);
  const current = job.label === 'completed' ? CUSTOMER_JOB_STEPS.length : Math.max(0, step);
  return (
    <Card className="space-y-4">
      <CardHeader
        title={t('tracker.title')}
        action={
          <StatusPill
            status={jobPill(job.status)}
            label={t(`tracker.label.${job.label}` as MessageKey)}
          />
        }
      />
      {job.assignee === null ? null : (
        <div className="flex items-center gap-3">
          <Avatar name={job.assignee.initials} size={36} />
          <div>
            <p className="font-medium">{job.assignee.firstName ?? t('tracker.ogsTechnician')}</p>
            <p className="text-sm text-muted-foreground">
              {job.assignee.partner ? t('tracker.partnerTechnician') : t('tracker.ogsTechnician')}
            </p>
          </div>
        </div>
      )}
      {job.label === 'cancelled' ? null : (
        <Stepper
          label={t('tracker.title')}
          steps={CUSTOMER_JOB_STEPS.map((s) => t(`tracker.step.${s}` as MessageKey))}
          current={current}
        />
      )}
      {job.report === null ? null : (
        <div className="space-y-3 rounded-md border border-border p-4">
          <h3 className="font-display text-base font-medium">{t('tracker.reportTitle')}</h3>
          <p className="whitespace-pre-line text-sm">{job.report.summary}</p>
          {job.report.minutesOnSite === null ? null : (
            <p className="text-sm text-muted-foreground">
              {t('tracker.timeOnSite', { minutes: job.report.minutesOnSite })}
            </p>
          )}
          {job.report.photos.length === 0 ? null : (
            <PhotoGrid photos={job.report.photos} base={`/${source}/${id}/job`} />
          )}
          {job.status === 'AWAITING_CONFIRMATION' && source === 'requests' ? (
            <p className="text-sm text-muted-foreground">
              {t('tracker.autoConfirm', {
                date: dateFormat.format(new Date(job.report.autoConfirmAt)),
              })}
            </p>
          ) : null}
          {job.status === 'AWAITING_CONFIRMATION' && source === 'tickets' ? (
            <p className="text-sm text-muted-foreground">{t('tracker.ticketConfirm')}</p>
          ) : null}
          {job.can.confirm ? <Decide job={job} id={id} /> : null}
        </div>
      )}
      {job.activity.length === 0 ? null : (
        <Timeline
          label={t('tracker.title')}
          entries={job.activity.map((entry) => ({
            key: entry.id,
            title: jobEventLabel(entry.kind, 'customer'),
            meta: dateFormat.format(new Date(entry.at)),
          }))}
        />
      )}
    </Card>
  );
}

function Decide({ job, id }: { job: Job; id: string }) {
  const { selected } = useWorkspace();
  const idempotency = useIdempotencyKey();
  const confirm = useJobWrite<undefined, CustomerJobProgress>(() => ({
    path: `/requests/${id}/job/confirm`,
    body: { version: job.version },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  return (
    <div className="space-y-2 border-t border-border pt-3">
      {confirm.isError ? <Notice tone="error">{describeError(confirm.error)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="highlight"
          disabled={confirm.isPending}
          onClick={() => {
            confirm.mutate(undefined, { onSuccess: idempotency.renew });
          }}
        >
          {t('tracker.confirm')}
        </Button>
        {job.can.reportProblem ? <ProblemDialog job={job} id={id} /> : null}
      </div>
    </div>
  );
}

function ProblemDialog({ job, id }: { job: Job; id: string }) {
  const { selected } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const idempotency = useIdempotencyKey();
  const report = useJobWrite<undefined, CustomerJobProgress>(() => ({
    path: `/requests/${id}/job/report-problem`,
    body: { version: job.version, reason: reason.trim() },
    options: { workspace: selected, headers: idempotent(idempotency.key()) },
  }));
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('tracker.reportProblem')}</Button>
      </DialogTrigger>
      <DialogContent title={t('tracker.problemTitle')}>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            report.mutate(undefined, {
              onSuccess: () => {
                idempotency.renew();
                setOpen(false);
                setReason('');
              },
            });
          }}
        >
          {report.isError ? <Notice tone="error">{describeError(report.error)}</Notice> : null}
          <FormField label={t('tracker.problemTitle')} help={t('jobs.reasonHint')}>
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
            <Button type="submit" variant="secondary" disabled={report.isPending}>
              {t('tracker.problemSend')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
