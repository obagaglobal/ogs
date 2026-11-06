import {
  EMPLOYEE_BANDS,
  type OrganisationApplicationResponse,
  type RegisterOrganisationResponse,
} from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { api, describeError, uploadFile } from '@/lib/api';

const STATUS_TEXT: Record<OrganisationApplicationResponse['status'], string> = {
  DRAFT: 'Draft — complete the details and submit for review.',
  SUBMITTED: 'Submitted — OGS is reviewing your application.',
  CHANGES_REQUESTED: 'Changes requested — update the application and submit again.',
  APPROVED: 'Approved — your organisation is active.',
  REJECTED: 'Not approved.',
};

const FIELD_LABELS: Record<string, string> = {
  legalName: 'Legal name',
  registrationNumber: 'Business registration number (or why you have none)',
  kraPin: 'KRA PIN (or why you have none)',
  region: 'County or region',
  address: 'Physical address',
  phone: 'Phone',
  contactEmail: 'Contact email',
  documents: 'At least one supporting document',
};

/** /organisations/new — start an application (any verified user). */
export function RegisterOrganisationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { select } = useWorkspace();
  const [legalName, setLegalName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const register = useMutation({
    mutationFn: async () =>
      api<RegisterOrganisationResponse>('/organisations', {
        method: 'POST',
        body: { legalName, ...(tradingName.trim() === '' ? {} : { tradingName }) },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'workspaces'] });
      select(result.tenantId);
      await navigate('/organisation/application');
    },
  });

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Register an organisation</h1>
      <p className="text-sm text-muted-foreground">
        Your organisation can order services and manage its team once OGS approves it. You will be
        its first administrator.
      </p>
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            register.mutate();
          }}
        >
          {register.isError ? <Notice tone="error">{describeError(register.error)}</Notice> : null}
          <Field
            label="Legal name"
            value={legalName}
            onChange={(event) => {
              setLegalName(event.target.value);
            }}
            required
          />
          <Field
            label="Trading name (optional)"
            value={tradingName}
            onChange={(event) => {
              setTradingName(event.target.value);
            }}
          />
          <Button type="submit" disabled={register.isPending || legalName.trim().length < 2}>
            Start application
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** /organisation/application — the applicant's view (works in a restricted workspace). */
export function ApplicationPage() {
  const { selected } = useWorkspace();
  const queryClient = useQueryClient();
  const queryKey = ['organisation', 'application', selected];
  const application = useQuery({
    queryKey,
    queryFn: async () =>
      api<OrganisationApplicationResponse>('/organisation/application', { workspace: selected }),
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const submit = useMutation({
    mutationFn: async () =>
      api('/organisation/application/submit', { method: 'POST', workspace: selected }),
    onSuccess: refresh,
  });

  if (selected === 'personal') {
    return (
      <Notice>
        Choose your organisation in the workspace menu, or{' '}
        <Link to="/organisations/new" className="underline">
          register a new one
        </Link>
        .
      </Notice>
    );
  }
  if (application.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading application…</p>;
  }
  if (application.isError || !application.data) {
    return <Notice tone="error">{describeError(application.error)}</Notice>;
  }
  const data = application.data;
  const editable = data.status === 'DRAFT' || data.status === 'CHANGES_REQUESTED';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{data.profile.legalName}</h1>
        <p className="text-sm">{STATUS_TEXT[data.status]}</p>
      </div>
      {data.decisionReason !== null && data.status !== 'APPROVED' ? (
        <Notice tone={data.status === 'REJECTED' ? 'error' : 'info'}>
          <strong>Reviewer note:</strong> {data.decisionReason}
        </Notice>
      ) : null}

      {editable ? (
        <ProfileForm data={data} workspace={selected} onSaved={refresh} />
      ) : (
        <Card>
          <ProfileSummary data={data} />
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-medium">Supporting documents</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Certificate of incorporation or business name, and KRA PIN certificate. PDF, JPEG or PNG,
          up to 10 MB.
        </p>
        <ul className="mb-4 space-y-1 text-sm">
          {data.documents.map((document) => (
            <li key={document.id}>
              {document.originalName} ·{' '}
              <span className="text-muted-foreground">
                {document.status === 'QUARANTINED' ? 'checking…' : document.status.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
        {editable ? <DocumentUpload workspace={selected} onUploaded={refresh} /> : null}
      </Card>

      {editable ? (
        <Card>
          {data.missing.length > 0 ? (
            <div className="mb-4 text-sm">
              <p className="font-medium">Still needed before you can submit:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {data.missing.map((field) => (
                  <li key={field}>{FIELD_LABELS[field] ?? field}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {submit.isError ? <Notice tone="error">{describeError(submit.error)}</Notice> : null}
          <Button
            disabled={data.missing.length > 0 || submit.isPending}
            onClick={() => {
              submit.mutate();
            }}
          >
            Submit for review
          </Button>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-2 font-medium">History</h2>
        <ol className="space-y-1 text-sm">
          {data.history.map((event) => (
            <li key={`${event.occurredAt}-${event.toStatus}`}>
              {new Date(event.occurredAt).toLocaleString()} —{' '}
              {event.toStatus.toLowerCase().replace('_', ' ')}
              {event.reason ? `: ${event.reason}` : ''}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function ProfileSummary({ data }: { data: OrganisationApplicationResponse }) {
  const p = data.profile;
  const rows: [string, string | null][] = [
    ['Trading name', p.tradingName],
    ['Registration number', p.registrationNumber ?? p.registrationNumberAbsentWhy],
    ['KRA PIN', p.kraPin ?? p.kraPinAbsentWhy],
    ['Region', p.region],
    ['Address', p.address],
    ['Phone', p.phone],
    ['Contact email', p.contactEmail],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

type ProfileKey =
  | 'tradingName'
  | 'registrationNumber'
  | 'registrationNumberAbsentWhy'
  | 'kraPin'
  | 'kraPinAbsentWhy'
  | 'region'
  | 'address'
  | 'phone'
  | 'contactEmail'
  | 'industry'
  | 'employeeBand';

function ProfileForm({
  data,
  workspace,
  onSaved,
}: {
  data: OrganisationApplicationResponse;
  workspace: string;
  onSaved: () => Promise<void>;
}) {
  const p = data.profile;
  const [form, setForm] = useState<Record<ProfileKey, string>>({
    tradingName: p.tradingName ?? '',
    registrationNumber: p.registrationNumber ?? '',
    registrationNumberAbsentWhy: p.registrationNumberAbsentWhy ?? '',
    kraPin: p.kraPin ?? '',
    kraPinAbsentWhy: p.kraPinAbsentWhy ?? '',
    region: p.region ?? '',
    address: p.address ?? '',
    phone: p.phone ?? '',
    contactEmail: p.contactEmail ?? '',
    industry: p.industry ?? '',
    employeeBand: p.employeeBand ?? '',
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [
          key,
          value.trim() === '' ? null : value.trim(),
        ]),
      );
      return api('/organisation/profile', { method: 'PATCH', body, workspace });
    },
    onSuccess: onSaved,
  });
  const field = (key: ProfileKey, label: string, hint?: string) => (
    <Field
      label={label}
      hint={hint}
      value={form[key]}
      onChange={(event) => {
        setForm({ ...form, [key]: event.target.value });
      }}
    />
  );

  return (
    <Card>
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {save.isError ? (
          <div className="sm:col-span-2">
            <Notice tone="error">{describeError(save.error)}</Notice>
          </div>
        ) : null}
        {save.isSuccess ? (
          <div className="sm:col-span-2">
            <Notice tone="success">Saved.</Notice>
          </div>
        ) : null}
        {field('tradingName', 'Trading name')}
        {field(
          'registrationNumber',
          'Business registration number',
          'From the Business Registration Service',
        )}
        {field(
          'registrationNumberAbsentWhy',
          'No registration number? Why',
          'Only if the field above is empty',
        )}
        {field('kraPin', 'KRA PIN', 'Like P051234567X')}
        {field('kraPinAbsentWhy', 'No KRA PIN? Why', 'Only if the field above is empty')}
        {field('region', 'County or region')}
        {field('address', 'Physical address')}
        {field('phone', 'Phone', 'International format, e.g. +254712345678')}
        {field('contactEmail', 'Contact email')}
        {field('industry', 'Industry')}
        <div className="space-y-1.5">
          <label htmlFor="employee-band" className="text-sm font-medium">
            Employees
          </label>
          <select
            id="employee-band"
            value={form.employeeBand}
            onChange={(event) => {
              setForm({ ...form, employeeBand: event.target.value });
            }}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">—</option>
            {EMPLOYEE_BANDS.map((band) => (
              <option key={band} value={band}>
                {band}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            Save details
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DocumentUpload({
  workspace,
  onUploaded,
}: {
  workspace: string;
  onUploaded: () => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const upload = useMutation({
    mutationFn: async () => {
      if (file === undefined) {
        return;
      }
      const form = new FormData();
      form.append('purpose', 'organisation.document');
      form.append('file', file);
      await uploadFile(form, workspace);
    },
    onSuccess: async () => {
      setFile(undefined);
      await onUploaded();
    },
  });
  return (
    <div className="space-y-2">
      {upload.isError ? <Notice tone="error">{describeError(upload.error)}</Notice> : null}
      <label htmlFor="document" className="text-sm font-medium">
        Add a document
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="document"
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
  );
}
