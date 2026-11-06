import type {
  EligibilityResponse,
  PlatformProviderApplicationResponse,
  SkillListResponse,
  VerificationChecklist,
} from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import {
  EXPERIENCE_LABELS,
  nairobiInputToIso,
  useRegions,
  useSkills,
} from '@/features/provider/provider-data';
import { api, ApiError, describeError } from '@/lib/api';
import { ElevationGate } from './elevation-gate';
import { ELEVATION_KEY, useElevated } from './elevation-state';

const CHECKS: [keyof Omit<VerificationChecklist, 'notes'>, string][] = [
  ['identityChecked', 'Identity checked against the ID document'],
  ['registrationChecked', 'Business registration checked'],
  ['taxChecked', 'KRA PIN checked'],
  ['skillsChecked', 'Skills evidence checked'],
];

function forgetExpiredElevation(error: unknown) {
  if (error instanceof ApiError && error.code === 'elevation_required') {
    sessionStorage.removeItem(ELEVATION_KEY);
  }
}

// ---------------------------------------------------------------- review

/** /platform/provider-applications/:id — verify and decide a provider application. */
export function ProviderApplicationReviewPage() {
  return (
    <div className="space-y-6">
      <Link to="/platform/applications" className="text-sm underline-offset-4 hover:underline">
        ← All applications
      </Link>
      <ElevationGate>
        <ProviderReview />
      </ElevationGate>
    </div>
  );
}

function ProviderReview() {
  const { id = '' } = useParams();
  const { options } = useElevated();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [checklist, setChecklist] = useState<VerificationChecklist>({
    identityChecked: false,
    registrationChecked: false,
    taxChecked: false,
    skillsChecked: false,
    notes: '',
  });
  const detail = useQuery({
    queryKey: ['platform', 'provider-application', id],
    queryFn: async () =>
      api<PlatformProviderApplicationResponse>(`/platform/provider-applications/${id}`, options),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: async (action: 'approve' | 'reject' | 'request-changes') =>
      api(`/platform/provider-applications/${id}/${action}`, {
        method: 'POST',
        body:
          action === 'approve'
            ? {
                checklist: {
                  ...checklist,
                  notes: checklist.notes?.trim() === '' ? undefined : checklist.notes?.trim(),
                },
              }
            : { reason },
        ...options,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform'] }),
  });
  const lifecycle = useMutation({
    mutationFn: async (action: 'suspend' | 'reactivate') =>
      api(`/platform/providers/${detail.data?.providerId ?? ''}/${action}`, {
        method: 'POST',
        body: { reason },
        ...options,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform'] }),
  });

  if (detail.isError) {
    forgetExpiredElevation(detail.error);
    return <Notice tone="error">{describeError(detail.error)}</Notice>;
  }
  const data = detail.data;
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const company = data.kind === 'COMPANY';
  const rows: [string, string | null][] = [
    ['Phone', data.phone],
    ['Home county', data.homeRegion],
    ['Remote work', data.remoteOk ? 'yes' : 'no'],
    ['Counties covered', data.regions.map((region) => region.name).join(', ') || null],
    ...(company && data.business !== null
      ? ([
          ['Legal name', data.business.legalName],
          [
            'Registration number',
            data.business.registrationNumber ??
              `none: ${data.business.registrationNumberAbsentWhy ?? ''}`,
          ],
          ['KRA PIN', data.business.kraPin ?? `none: ${data.business.kraPinAbsentWhy ?? ''}`],
        ] as [string, string | null][])
      : []),
  ];
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          {company ? 'Provider company' : 'Individual provider'}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{data.displayName}</h1>
        <p className="text-sm text-muted-foreground">
          application {data.application.status.toLowerCase().replace('_', ' ')} · provider{' '}
          {data.status.toLowerCase().replace('_', ' ')} · applicant {data.applicantEmail}
        </p>
      </div>
      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">Skills</h2>
        <ul className="space-y-1 text-sm">
          {data.skills.map((skill) => (
            <li key={skill.code}>
              {skill.name} · {EXPERIENCE_LABELS[skill.experience]}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">Documents</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Opening an identity document is recorded with your elevation reason.
        </p>
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
              )}{' '}
              <span className="text-muted-foreground">· {document.purpose}</span>
            </li>
          ))}
        </ul>
      </Card>
      {data.verification === null ? null : (
        <Card>
          <h2 className="mb-2 font-medium">Recorded verification</h2>
          <ul className="space-y-1 text-sm">
            {CHECKS.map(([key, label]) => (
              <li key={key}>
                {data.verification?.[key] ? '✓' : '✗'} {label}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {decide.isSuccess ? <Notice tone="success">Decision recorded and emailed.</Notice> : null}
      {lifecycle.isSuccess ? <Notice tone="success">Status changed and emailed.</Notice> : null}
      {data.application.status === 'SUBMITTED' ? (
        <Card>
          <h2 className="mb-3 font-medium">Verification and decision</h2>
          {decide.isError ? <Notice tone="error">{describeError(decide.error)}</Notice> : null}
          <fieldset className="mb-4 space-y-2 text-sm">
            <legend className="mb-1 font-medium">Checklist (recorded with the approval)</legend>
            {CHECKS.filter(([key]) =>
              company
                ? key !== 'identityChecked'
                : key !== 'registrationChecked' && key !== 'taxChecked',
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist[key]}
                  onChange={(event) => {
                    setChecklist({ ...checklist, [key]: event.target.checked });
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Field
            label="Verification notes (optional)"
            value={checklist.notes ?? ''}
            onChange={(event) => {
              setChecklist({ ...checklist, notes: event.target.value });
            }}
          />
          <Field
            className="mt-4"
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
      {data.status === 'ACTIVE' || data.status === 'SUSPENDED' ? (
        <Card>
          <h2 className="mb-3 font-medium">
            {data.status === 'ACTIVE' ? 'Suspend this provider' : 'Reactivate this provider'}
          </h2>
          {lifecycle.isError ? (
            <Notice tone="error">{describeError(lifecycle.error)}</Notice>
          ) : null}
          <Field
            label="Reason (shown in the audit log)"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <Button
            className="mt-4"
            variant={data.status === 'ACTIVE' ? 'destructive' : 'default'}
            disabled={lifecycle.isPending || reason.trim().length < 10}
            onClick={() => {
              lifecycle.mutate(data.status === 'ACTIVE' ? 'suspend' : 'reactivate');
            }}
          >
            {data.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- eligibility

/** /platform/eligibility — who could take a job, with the reasons for each score. */
export function EligibilityPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Find eligible providers</h1>
      <ElevationGate>
        <EligibilitySearch />
      </ElevationGate>
    </div>
  );
}

function EligibilitySearch() {
  const { options } = useElevated();
  const skills = useSkills();
  const regions = useRegions();
  const [chosen, setChosen] = useState<string[]>([]);
  const [region, setRegion] = useState('KE-30');
  const [at, setAt] = useState('');
  const [remote, setRemote] = useState(false);
  const search = useMutation({
    mutationFn: async () => {
      const query = new URLSearchParams({ skills: chosen.join(','), region });
      if (at !== '') query.set('at', nairobiInputToIso(at));
      if (remote) query.set('remote', 'true');
      return (
        await api<EligibilityResponse>(`/platform/providers/eligible?${query.toString()}`, options)
      ).candidates;
    },
    onError: forgetExpiredElevation,
  });
  return (
    <>
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            search.mutate();
          }}
        >
          <fieldset className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <legend className="mb-1 font-medium">Required skills</legend>
            {(skills.data ?? []).map((skill) => (
              <label key={skill.code} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(skill.code)}
                  onChange={(event) => {
                    setChosen(
                      event.target.checked
                        ? [...chosen, skill.code]
                        : chosen.filter((code) => code !== skill.code),
                    );
                  }}
                />
                {skill.name}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label htmlFor="eligibility-region" className="text-sm font-medium">
                County
              </label>
              <select
                id="eligibility-region"
                value={region}
                onChange={(event) => {
                  setRegion(event.target.value);
                }}
                className="h-10 rounded-md border bg-background px-2 text-sm"
              >
                {(regions.data ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Available at (Kenya time, optional)"
              type="datetime-local"
              value={at}
              onChange={(event) => {
                setAt(event.target.value);
              }}
            />
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={remote}
                onChange={(event) => {
                  setRemote(event.target.checked);
                }}
              />
              Can be done remotely
            </label>
          </div>
          <Button type="submit" disabled={search.isPending || chosen.length === 0}>
            Search
          </Button>
        </form>
      </Card>
      {search.isError ? <Notice tone="error">{describeError(search.error)}</Notice> : null}
      {search.data === undefined ? null : (
        <Card>
          <h2 className="mb-1 font-medium">
            {search.data.length} eligible provider{search.data.length === 1 ? '' : 's'}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            A suggestion only: OGS staff choose who is assigned. Unapproved, suspended, paused or
            unavailable providers are never listed.
          </p>
          <ol className="space-y-3 text-sm">
            {search.data.map((candidate) => (
              <li key={candidate.providerId}>
                <p className="font-medium">
                  {candidate.displayName}{' '}
                  <span className="text-muted-foreground">
                    · {candidate.kind === 'COMPANY' ? 'company' : 'individual'} · score{' '}
                    {candidate.score}
                  </span>
                </p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {candidate.reasons.map((reason) => (
                    <li key={reason.factor}>
                      +{reason.points} {reason.detail}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- skills taxonomy

/** /platform/skills — the skills providers can declare (platform.catalogue.manage). */
export function SkillsCataloguePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
      <ElevationGate>
        <SkillsCatalogue />
      </ElevationGate>
    </div>
  );
}

function SkillsCatalogue() {
  const { options } = useElevated();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '', category: '' });
  const list = useQuery({
    queryKey: ['platform', 'skills'],
    queryFn: async () => (await api<SkillListResponse>('/platform/skills', options)).skills,
    retry: false,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['platform', 'skills'] });
    await queryClient.invalidateQueries({ queryKey: ['reference', 'skills'] });
  };
  const create = useMutation({
    mutationFn: async () =>
      api('/platform/skills', {
        method: 'POST',
        body: { code: form.code.trim(), name: form.name.trim(), category: form.category.trim() },
        ...options,
      }),
    onSuccess: async () => {
      setForm({ code: '', name: '', category: '' });
      await refresh();
    },
  });
  const setActive = useMutation({
    mutationFn: async ({ code, active }: { code: string; active: boolean }) =>
      api(`/platform/skills/${code}`, { method: 'PATCH', body: { active }, ...options }),
    onSuccess: refresh,
  });
  if (list.isError) {
    forgetExpiredElevation(list.error);
    return <Notice tone="error">{describeError(list.error)}</Notice>;
  }
  return (
    <>
      <Card>
        <h2 className="mb-3 font-medium">Add a skill</h2>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          {create.isError ? (
            <div className="sm:col-span-3">
              <Notice tone="error">{describeError(create.error)}</Notice>
            </div>
          ) : null}
          <Field
            label="Code"
            hint="Lower-case letters, digits and _, e.g. solar_power"
            value={form.code}
            onChange={(event) => {
              setForm({ ...form, code: event.target.value });
            }}
          />
          <Field
            label="Name"
            value={form.name}
            onChange={(event) => {
              setForm({ ...form, name: event.target.value });
            }}
          />
          <Field
            label="Category"
            value={form.category}
            onChange={(event) => {
              setForm({ ...form, category: event.target.value });
            }}
          />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={create.isPending}>
              Add skill
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <p className="mb-3 text-xs text-muted-foreground">
          Retiring a skill hides it from pickers. Providers who already declared it keep it.
        </p>
        {setActive.isError ? <Notice tone="error">{describeError(setActive.error)}</Notice> : null}
        <ul className="divide-y text-sm">
          {(list.data ?? []).map((skill) => (
            <li key={skill.code} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className={skill.active ? '' : 'text-muted-foreground line-through'}>
                  {skill.name}
                </span>{' '}
                <span className="text-muted-foreground">
                  · {skill.category} · <code>{skill.code}</code>
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={setActive.isPending}
                onClick={() => {
                  setActive.mutate({ code: skill.code, active: !skill.active });
                }}
              >
                {skill.active ? 'Retire' : 'Restore'}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
