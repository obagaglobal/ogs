import type { ApplicationQueueResponse, PlatformApplicationResponse } from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import { api, ApiError, describeError } from '@/lib/api';
import { ElevationGate } from './elevation-gate';
import { ELEVATION_KEY, useElevated } from './elevation-state';

const TYPE_LABELS: Record<string, string> = {
  '': 'All types',
  organisation: 'Organisation',
  provider_company: 'Provider company',
  individual_provider: 'Individual provider',
};

/** /platform/applications — review queue (organisations and providers). */
export function ApplicationQueuePage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Applications</h1>
      <ElevationGate>
        <Queue />
      </ElevationGate>
    </div>
  );
}

function Queue() {
  const { options } = useElevated();
  const [status, setStatus] = useState('SUBMITTED');
  const [type, setType] = useState('');
  const queue = useQuery({
    queryKey: ['platform', 'applications', status, type],
    queryFn: async () =>
      (
        await api<ApplicationQueueResponse>(
          `/platform/applications?status=${status}${type === '' ? '' : `&type=${type}`}`,
          options,
        )
      ).applications,
    retry: false,
  });
  return (
    <Card>
      <label htmlFor="queue-status" className="mr-2 text-sm font-medium">
        Status
      </label>
      <select
        id="queue-status"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
        }}
        className="mb-4 min-h-11 md:min-h-9 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
      >
        {['SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'DRAFT'].map((value) => (
          <option key={value} value={value}>
            {value.toLowerCase().replace('_', ' ')}
          </option>
        ))}
      </select>
      <label htmlFor="queue-type" className="mr-2 ml-4 text-sm font-medium">
        Type
      </label>
      <select
        id="queue-type"
        value={type}
        onChange={(event) => {
          setType(event.target.value);
        }}
        className="mb-4 min-h-11 md:min-h-9 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
      >
        {Object.entries(TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {queue.isError ? <Notice tone="error">{describeError(queue.error)}</Notice> : null}
      <ul className="divide-y text-sm">
        {(queue.data ?? []).map((item) => (
          <li key={item.applicationId} className="flex items-center justify-between py-2">
            <span>
              <Link
                className="font-medium underline-offset-4 hover:underline"
                to={
                  item.type === 'organisation'
                    ? `/platform/applications/${item.applicationId}`
                    : `/platform/provider-applications/${item.applicationId}`
                }
              >
                {item.legalName}
              </Link>{' '}
              · {TYPE_LABELS[item.type]} · {item.applicantEmail}
            </span>
            <span className="text-muted-foreground">
              {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : '—'}
            </span>
          </li>
        ))}
        {queue.data?.length === 0 ? (
          <li className="py-2 text-muted-foreground">Nothing here.</li>
        ) : null}
      </ul>
    </Card>
  );
}

/** /platform/applications/:id — one application and the decision. */
export function ApplicationReviewPage() {
  return (
    <div className="space-y-6">
      <Link to="/platform/applications" className="text-sm underline-offset-4 hover:underline">
        ← All applications
      </Link>
      <ElevationGate>
        <Review />
      </ElevationGate>
    </div>
  );
}

function Review() {
  const { id = '' } = useParams();
  const { options } = useElevated();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const detail = useQuery({
    queryKey: ['platform', 'application', id],
    queryFn: async () => api<PlatformApplicationResponse>(`/platform/applications/${id}`, options),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: async (action: 'approve' | 'reject' | 'request-changes') =>
      api(`/platform/applications/${id}/${action}`, {
        method: 'POST',
        body: action === 'approve' ? {} : { reason },
        ...options,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform'] }),
  });

  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.code === 'elevation_required') {
      sessionStorage.removeItem(ELEVATION_KEY);
    }
    return <Notice tone="error">{describeError(detail.error)}</Notice>;
  }
  const data = detail.data;
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const p = data.profile;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {p.legalName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.status.toLowerCase().replace('_', ' ')} · applicant {data.applicantEmail}
        </p>
      </div>
      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {(
            [
              [
                'Registration number',
                p.registrationNumber ?? `none: ${p.registrationNumberAbsentWhy ?? ''}`,
              ],
              ['KRA PIN', p.kraPin ?? `none: ${p.kraPinAbsentWhy ?? ''}`],
              ['Country / region', `${p.country} / ${p.region ?? '—'}`],
              ['Address', p.address],
              ['Phone', p.phone],
              ['Contact email', p.contactEmail],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">Documents</h2>
        <ul className="space-y-1 text-sm">
          {data.documents.map((document) => (
            <li key={document.id}>
              {document.downloadUrl ? (
                <a className="underline" href={document.downloadUrl}>
                  {document.originalName}
                </a>
              ) : (
                <span>
                  {document.originalName} ({document.status.toLowerCase()})
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {decide.isSuccess ? <Notice tone="success">Decision recorded and emailed.</Notice> : null}
      {data.status === 'SUBMITTED' ? (
        <Card>
          <h2 className="mb-3 font-medium">Decision</h2>
          {decide.isError ? <Notice tone="error">{describeError(decide.error)}</Notice> : null}
          <Field
            label="Reason (required to reject or request changes; shown to the applicant)"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate('approve');
              }}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={decide.isPending || reason.trim().length < 10}
              onClick={() => {
                decide.mutate('request-changes');
              }}
            >
              Request changes
            </Button>
            <Button
              variant="destructive"
              disabled={decide.isPending || reason.trim().length < 10}
              onClick={() => {
                decide.mutate('reject');
              }}
            >
              Reject
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
