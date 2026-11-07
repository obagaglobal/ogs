import type { ProviderResponse } from '@ogs/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import { PROVIDER_WORKSPACE, useWorkspace } from '@/features/workspace/workspace-state';
import { api, describeError, uploadFile } from '@/lib/api';
import {
  formatNairobi,
  hoursValid,
  nairobiInputToIso,
  useProvider,
  useProviderWrite,
  useRegions,
  useSkills,
  type HoursEntry,
  type SkillChoice,
} from './provider-data';
import { AvailabilityEditor, RegionPicker, SkillPicker } from './provider-pickers';

const STATUS_TEXT: Record<ProviderResponse['application']['status'], string> = {
  DRAFT: 'Draft — complete your profile and submit it for review.',
  SUBMITTED: 'Submitted — OGS is verifying your application.',
  CHANGES_REQUESTED: 'Changes requested — update the application and submit again.',
  APPROVED: 'Approved — OGS can offer you work.',
  REJECTED: 'Not approved.',
};

const MISSING_LABELS: Record<string, string> = {
  phone: 'Phone number',
  homeRegion: 'Home county',
  skills: 'At least one skill',
  regions: 'At least one county covered (Coverage)',
  identityDocument: 'Government ID (national ID or passport)',
  skillEvidence: 'Evidence of your skills (certificate)',
  registrationNumber: 'Business registration number (or why you have none)',
  kraPin: 'KRA PIN (or why you have none)',
  companyDocuments: 'Registration or tax document',
};

const DOCUMENT_PURPOSES: Record<ProviderResponse['kind'], [string, string][]> = {
  INDIVIDUAL: [
    ['provider.identity', 'Government ID (national ID or passport)'],
    ['provider.certificate', 'Certificate or other skills evidence'],
  ],
  COMPANY: [
    ['provider.company_document', 'Registration or tax document'],
    ['provider.certificate', 'Certificate or other skills evidence'],
  ],
};

// ---------------------------------------------------------------- applying

/** /providers/new — an individual applies from their personal account. */
export function BecomeProviderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { select } = useWorkspace();
  const [displayName, setDisplayName] = useState('');
  const apply = useMutation({
    mutationFn: async () =>
      api('/providers/me', { method: 'POST', body: { displayName: displayName.trim() } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'workspaces'] });
      select(PROVIDER_WORKSPACE);
      await navigate('/provider');
    },
  });
  return (
    <StartForm
      title="Become a provider"
      intro="Offer your ICT skills through OGS. OGS verifies your identity and skills before offering you work. You keep using this same account."
      label="Your name as customers will see it"
      value={displayName}
      onChange={setDisplayName}
      pending={apply.isPending}
      error={apply.isError ? describeError(apply.error) : undefined}
      onSubmit={() => {
        apply.mutate();
      }}
    />
  );
}

/** /providers/companies/new — register a provider company (you become its admin). */
export function RegisterProviderCompanyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { select } = useWorkspace();
  const [legalName, setLegalName] = useState('');
  const register = useMutation({
    mutationFn: async () =>
      api<{ tenantId: string }>('/providers/companies', {
        method: 'POST',
        body: { legalName: legalName.trim() },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'workspaces'] });
      select(result.tenantId);
      await navigate('/provider');
    },
  });
  return (
    <StartForm
      title="Register a provider company"
      intro="Your company can receive work through OGS once OGS approves it. You will be its first administrator and can add technicians later."
      label="Legal name"
      value={legalName}
      onChange={setLegalName}
      pending={register.isPending}
      error={register.isError ? describeError(register.error) : undefined}
      onSubmit={() => {
        register.mutate();
      }}
    />
  );
}

function StartForm(props: {
  title: string;
  intro: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  pending: boolean;
  error: string | undefined;
  onSubmit: () => void;
}) {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{props.title}</h1>
      <p className="text-sm text-muted-foreground">{props.intro}</p>
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          {props.error === undefined ? null : <Notice tone="error">{props.error}</Notice>}
          <Field
            label={props.label}
            value={props.value}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
            required
          />
          <Button type="submit" disabled={props.pending || props.value.trim().length < 2}>
            Start application
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- shared frame

/** Loads the provider for the current workspace; explains what to do otherwise. */
function ProviderFrame({
  title,
  children,
}: {
  title: string;
  children: (provider: ProviderResponse, editable: boolean) => ReactNode;
}) {
  const provider = useProvider();
  if (provider.selected === 'personal') {
    return (
      <Notice>
        Choose your Provider or provider company workspace in the workspace menu, or{' '}
        <Link to="/providers/new" className="underline">
          become a provider
        </Link>
        .
      </Notice>
    );
  }
  if (provider.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (provider.isError || provider.data === undefined) {
    return <Notice tone="error">{describeError(provider.error)}</Notice>;
  }
  const data = provider.data;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {data.kind === 'COMPANY' ? 'Provider company' : 'Individual provider'} · {title}
        </p>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {data.displayName}
        </h1>
        <p className="text-sm">{STATUS_TEXT[data.application.status]}</p>
      </div>
      {data.status === 'SUSPENDED' ? (
        <Notice tone="error">
          OGS has suspended this provider. You will not be offered work, and the profile is
          read-only until it is reactivated.
        </Notice>
      ) : null}
      {data.application.status === 'SUBMITTED' ? (
        <Notice>While OGS reviews the application, its details cannot be changed.</Notice>
      ) : null}
      {provider.mayManage ? null : (
        <Notice>You can see this profile; only company administrators can change it.</Notice>
      )}
      {children(data, provider.editable)}
    </div>
  );
}

// ---------------------------------------------------------------- profile, skills, application

/** /provider — the application and the "Profile & skills" page. */
export function ProviderProfilePage() {
  return (
    <ProviderFrame title="Profile & skills">
      {(data, editable) => <ProfileSections data={data} editable={editable} />}
    </ProviderFrame>
  );
}

function ProfileSections({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const applying =
    data.application.status === 'DRAFT' || data.application.status === 'CHANGES_REQUESTED';
  const submit = useProviderWrite(() => ({
    path: '/provider/application/submit',
    method: 'POST',
  }));
  return (
    <>
      {data.application.decisionReason !== null && data.application.status !== 'APPROVED' ? (
        <Notice tone={data.application.status === 'REJECTED' ? 'error' : 'info'}>
          <strong>Reviewer note:</strong> {data.application.decisionReason}
        </Notice>
      ) : null}
      <ProfileForm data={data} editable={editable} />
      {data.business === null ? null : <BusinessForm data={data} editable={editable} />}
      <SkillsCard data={data} editable={editable} />
      <DocumentsCard data={data} editable={editable && data.status !== 'ACTIVE'} />
      {applying && editable ? (
        <Card>
          {data.application.missing.length > 0 ? (
            <div className="mb-4 text-sm">
              <p className="font-medium">Still needed before you can submit:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {data.application.missing.map((item) => (
                  <li key={item}>{MISSING_LABELS[item] ?? item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {submit.isError ? <Notice tone="error">{describeError(submit.error)}</Notice> : null}
          <Button
            disabled={data.application.missing.length > 0 || submit.isPending}
            onClick={() => {
              submit.mutate(undefined);
            }}
          >
            Submit for review
          </Button>
        </Card>
      ) : null}
      <Card>
        <h2 className="mb-2 font-medium">Application history</h2>
        <ol className="space-y-1 text-sm">
          {data.application.history.map((event) => (
            <li key={`${event.occurredAt}-${event.toStatus}`}>
              {new Date(event.occurredAt).toLocaleString()} —{' '}
              {event.toStatus.toLowerCase().replace('_', ' ')}
              {event.reason ? `: ${event.reason}` : ''}
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

function ProfileForm({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const regions = useRegions();
  const [displayName, setDisplayName] = useState(data.displayName);
  const [phone, setPhone] = useState(data.phone ?? '');
  const [homeRegion, setHomeRegion] = useState(data.homeRegion ?? '');
  const save = useProviderWrite(() => ({
    path: '/provider/profile',
    method: 'PATCH',
    body: {
      displayName: displayName.trim(),
      phone: phone.trim() === '' ? null : phone.trim(),
      homeRegion: homeRegion === '' ? null : homeRegion,
    },
  }));
  return (
    <Card>
      <h2 className="mb-3 font-medium">Profile</h2>
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        {save.isError ? (
          <div className="sm:col-span-2">
            <Notice tone="error">{describeError(save.error)}</Notice>
          </div>
        ) : null}
        {save.isSuccess ? (
          <div className="sm:col-span-2">
            <Notice tone="success">Profile saved.</Notice>
          </div>
        ) : null}
        <Field
          label="Display name"
          value={displayName}
          disabled={!editable}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
        />
        <Field
          label="Phone"
          hint="International format, e.g. +254712345678"
          value={phone}
          disabled={!editable}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
        <div className="space-y-1.5">
          <label htmlFor="home-region" className="text-sm font-medium">
            Home county
          </label>
          <select
            id="home-region"
            value={homeRegion}
            disabled={!editable}
            onChange={(event) => {
              setHomeRegion(event.target.value);
            }}
            className="min-h-11 md:min-h-10 w-full rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
          >
            <option value="">—</option>
            {(regions.data ?? []).map((region) => (
              <option key={region.code} value={region.code}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
        {editable ? (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              Save profile
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function BusinessForm({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const business = data.business;
  const [form, setForm] = useState({
    registrationNumber: business?.registrationNumber ?? '',
    registrationNumberAbsentWhy: business?.registrationNumberAbsentWhy ?? '',
    kraPin: business?.kraPin ?? '',
    kraPinAbsentWhy: business?.kraPinAbsentWhy ?? '',
  });
  const save = useProviderWrite(() => ({
    path: '/provider/business',
    method: 'PATCH',
    body: Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim() === '' ? null : value.trim()]),
    ),
  }));
  const field = (key: keyof typeof form, label: string, hint?: string) => (
    <Field
      label={label}
      hint={hint}
      value={form[key]}
      disabled={!editable}
      onChange={(event) => {
        setForm({ ...form, [key]: event.target.value });
      }}
    />
  );
  return (
    <Card>
      <h2 className="mb-1 font-medium">Business details</h2>
      <p className="mb-3 text-sm text-muted-foreground">{business?.legalName}</p>
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        {save.isError ? (
          <div className="sm:col-span-2">
            <Notice tone="error">{describeError(save.error)}</Notice>
          </div>
        ) : null}
        {save.isSuccess ? (
          <div className="sm:col-span-2">
            <Notice tone="success">Business details saved.</Notice>
          </div>
        ) : null}
        {field('registrationNumber', 'Business registration number')}
        {field('registrationNumberAbsentWhy', 'No registration number? Why')}
        {field('kraPin', 'KRA PIN', 'Like P051234567X')}
        {field('kraPinAbsentWhy', 'No KRA PIN? Why')}
        {editable ? (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              Save business details
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function SkillsCard({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const skills = useSkills();
  const [value, setValue] = useState<SkillChoice[]>(
    data.skills.map((skill) => ({ code: skill.code, experience: skill.experience })),
  );
  const save = useProviderWrite(() => ({
    path: '/provider/skills',
    method: 'PUT',
    body: { skills: value },
  }));
  return (
    <Card>
      <h2 className="mb-3 font-medium">Skills</h2>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">Skills saved.</Notice> : null}
      <SkillPicker
        skills={skills.data ?? []}
        value={value}
        onChange={setValue}
        disabled={!editable}
      />
      {editable ? (
        <Button
          className="mt-4"
          disabled={save.isPending}
          onClick={() => {
            save.mutate(undefined);
          }}
        >
          Save skills
        </Button>
      ) : null}
    </Card>
  );
}

function DocumentsCard({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const queryClient = useQueryClient();
  const { selected } = useWorkspace();
  const purposes = DOCUMENT_PURPOSES[data.kind];
  const [purpose, setPurpose] = useState(purposes[0]?.[0] ?? '');
  const [file, setFile] = useState<File>();
  const upload = useMutation({
    mutationFn: async () => {
      if (file === undefined) {
        return;
      }
      const form = new FormData();
      form.append('purpose', purpose);
      form.append('file', file);
      await uploadFile(form, selected);
    },
    onSuccess: async () => {
      setFile(undefined);
      await queryClient.invalidateQueries({ queryKey: ['provider'] });
    },
  });
  const label = (code: string) => purposes.find(([value]) => value === code)?.[1] ?? code;
  return (
    <Card>
      <h2 className="mb-1 font-medium">Documents</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        PDF, JPEG or PNG, up to 10 MB. Only you and the OGS staff who verify providers can see them.
      </p>
      <ul className="mb-4 space-y-1 text-sm">
        {data.documents.map((document) => (
          <li key={document.id}>
            {document.originalName} · {label(document.purpose)} ·{' '}
            <span className="text-muted-foreground">
              {document.status === 'QUARANTINED' ? 'checking…' : document.status.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="space-y-2">
          {upload.isError ? <Notice tone="error">{describeError(upload.error)}</Notice> : null}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="document-purpose" className="text-sm font-medium">
              Document type
            </label>
            <select
              id="document-purpose"
              value={purpose}
              onChange={(event) => {
                setPurpose(event.target.value);
              }}
              className="min-h-11 md:min-h-9 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
            >
              {purposes.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <label htmlFor="provider-document" className="text-sm font-medium">
            Add a document
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="provider-document"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => {
                setFile(event.target.files?.[0]);
              }}
              className="text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={file === undefined || upload.isPending}
              onClick={() => {
                upload.mutate();
              }}
            >
              Upload
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- coverage

/** /provider/coverage — counties covered and remote work. */
export function ProviderCoveragePage() {
  return (
    <ProviderFrame title="Coverage">
      {(data, editable) => <CoverageCard data={data} editable={editable} />}
    </ProviderFrame>
  );
}

function CoverageCard({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const regions = useRegions();
  const { selected } = useWorkspace();
  const queryClient = useQueryClient();
  const [codes, setCodes] = useState(data.regions.map((region) => region.code));
  const [remoteOk, setRemoteOk] = useState(data.remoteOk);
  const save = useMutation({
    mutationFn: async () => {
      await api('/provider/regions', {
        method: 'PUT',
        body: { regionCodes: codes },
        workspace: selected,
      });
      if (remoteOk !== data.remoteOk) {
        await api('/provider/profile', {
          method: 'PATCH',
          body: { remoteOk },
          workspace: selected,
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['provider'] }),
  });
  return (
    <Card>
      <h2 className="mb-3 font-medium">Counties you cover</h2>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">Coverage saved.</Notice> : null}
      <RegionPicker
        regions={regions.data ?? []}
        value={codes}
        onChange={setCodes}
        disabled={!editable}
      />
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={remoteOk}
          disabled={!editable}
          onChange={(event) => {
            setRemoteOk(event.target.checked);
          }}
        />
        I can also work remotely (for services that allow it)
      </label>
      {editable ? (
        <Button
          className="mt-4"
          disabled={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          Save coverage
        </Button>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- availability

/** /provider/availability — accepting work, weekly hours, time off (Nairobi time). */
export function ProviderAvailabilityPage() {
  return (
    <ProviderFrame title="Availability">
      {(data, editable) => (
        <>
          <AcceptingWorkCard data={data} />
          <HoursCard data={data} editable={editable} />
          <TimeOffCard data={data} editable={editable} />
        </>
      )}
    </ProviderFrame>
  );
}

function AcceptingWorkCard({ data }: { data: ProviderResponse }) {
  const provider = useProvider();
  const toggle = useProviderWrite((acceptingWork: boolean) => ({
    path: '/provider/profile',
    method: 'PATCH',
    body: { acceptingWork },
  }));
  // The pause switch stays usable while the application is under review.
  const usable = provider.mayManage && data.status !== 'SUSPENDED' && data.status !== 'REJECTED';
  return (
    <Card>
      <h2 className="mb-1 font-medium">Accepting work</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {data.acceptingWork
          ? 'OGS can offer you work when your skills, coverage and hours match.'
          : 'Paused: OGS will not offer you new work until you resume.'}
      </p>
      {toggle.isError ? <Notice tone="error">{describeError(toggle.error)}</Notice> : null}
      {usable ? (
        <Button
          variant={data.acceptingWork ? 'outline' : 'default'}
          disabled={toggle.isPending}
          onClick={() => {
            toggle.mutate(!data.acceptingWork);
          }}
        >
          {data.acceptingWork ? 'Pause new work' : 'Resume accepting work'}
        </Button>
      ) : null}
    </Card>
  );
}

function HoursCard({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const [hours, setHours] = useState<HoursEntry[]>(data.workingHours);
  const save = useProviderWrite(() => ({
    path: '/provider/working-hours',
    method: 'PUT',
    body: { hours },
  }));
  return (
    <Card>
      <h2 className="mb-1 font-medium">Weekly working hours</h2>
      <p className="mb-3 text-sm text-muted-foreground">Kenya time (Africa/Nairobi).</p>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">Working hours saved.</Notice> : null}
      <AvailabilityEditor value={hours} onChange={setHours} disabled={!editable} />
      {editable ? (
        <Button
          className="mt-4"
          disabled={save.isPending || !hoursValid(hours)}
          onClick={() => {
            save.mutate(undefined);
          }}
        >
          Save working hours
        </Button>
      ) : null}
    </Card>
  );
}

function TimeOffCard({ data, editable }: { data: ProviderResponse; editable: boolean }) {
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const add = useProviderWrite(() => ({
    path: '/provider/time-off',
    method: 'POST',
    body: { startsAt: nairobiInputToIso(startsAt), endsAt: nairobiInputToIso(endsAt) },
  }));
  const remove = useProviderWrite((id: string) => ({
    path: `/provider/time-off/${id}`,
    method: 'DELETE',
  }));
  return (
    <Card>
      <h2 className="mb-3 font-medium">Time off</h2>
      {add.isError ? <Notice tone="error">{describeError(add.error)}</Notice> : null}
      {remove.isError ? <Notice tone="error">{describeError(remove.error)}</Notice> : null}
      <ul className="mb-4 space-y-1 text-sm">
        {data.timeOff.map((period) => (
          <li key={period.id} className="flex flex-wrap items-center gap-2">
            {formatNairobi(period.startsAt)} – {formatNairobi(period.endsAt)}
            {editable ? (
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(period.id);
                }}
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
        {data.timeOff.length === 0 ? (
          <li className="text-muted-foreground">No upcoming time off.</li>
        ) : null}
      </ul>
      {editable ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            add.mutate(undefined, {
              onSuccess: () => {
                setStartsAt('');
                setEndsAt('');
              },
            });
          }}
        >
          <Field
            label="From (Kenya time)"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => {
              setStartsAt(event.target.value);
            }}
          />
          <Field
            label="Until (Kenya time)"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => {
              setEndsAt(event.target.value);
            }}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={add.isPending || startsAt === '' || endsAt === '' || endsAt <= startsAt}
          >
            Add time off
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
