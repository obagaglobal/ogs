import {
  CATEGORY_ICONS,
  type StaffCategoryListResponse,
  type StaffService,
  type StaffServiceListResponse,
} from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import {
  AUDIENCE_LABELS,
  DELIVERY_LABELS,
  MODEL_LABELS,
  minorToInput,
  parseKesToMinor,
} from '@/features/catalogue/catalogue-data';
import {
  EXPERIENCE_LABELS,
  useSkills,
  type ExperienceBand,
} from '@/features/provider/provider-data';
import { api, ApiError, describeError } from '@/lib/api';
import { ElevationGate } from './elevation-gate';
import { ELEVATION_KEY, useElevated } from './elevation-state';

const MISSING_LABELS: Record<string, string> = {
  activeCategory: 'An active category',
  summary: 'A summary',
  description: 'A description',
  price: 'A price',
  skills: 'At least one required skill (or OGS-only delivery)',
};
const UNIT_LABELS: Record<string, string> = {
  HOUR: 'per hour',
  DEVICE: 'per device',
  USER: 'per user',
  VISIT: 'per visit',
  POINT: 'per cabling point',
};
const STATUS_TEXT: Record<StaffService['status'], string> = {
  DRAFT: 'Draft — not visible to the public',
  PUBLISHED: 'Published — visible to everyone',
  RETIRED: 'Retired — hidden from the public',
};

function forgetExpiredElevation(error: unknown) {
  if (error instanceof ApiError && error.code === 'elevation_required') {
    sessionStorage.removeItem(ELEVATION_KEY);
  }
}

function useStaffCategories() {
  const { options } = useElevated();
  return useQuery({
    queryKey: ['platform', 'catalogue', 'categories'],
    queryFn: async () =>
      (await api<StaffCategoryListResponse>('/platform/catalogue/categories', options)).categories,
    retry: false,
  });
}

function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-10 w-full rounded-md border bg-background px-2 text-sm"
      >
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextArea({
  label,
  hint,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- overview

/** /platform/catalogue — categories and services (platform.catalogue.manage). */
export function CatalogueAdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
      <ElevationGate>
        <CategoriesCard />
        <ServicesCard />
      </ElevationGate>
    </div>
  );
}

function CategoriesCard() {
  const { options } = useElevated();
  const queryClient = useQueryClient();
  const categories = useStaffCategories();
  const [form, setForm] = useState({ slug: '', name: '', parentSlug: '', icon: 'folder' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform', 'catalogue'] });
  const create = useMutation({
    mutationFn: async () =>
      api('/platform/catalogue/categories', {
        method: 'POST',
        body: {
          slug: form.slug.trim(),
          name: form.name.trim(),
          icon: form.icon,
          parentSlug: form.parentSlug === '' ? null : form.parentSlug,
        },
        ...options,
      }),
    onSuccess: async () => {
      setForm({ slug: '', name: '', parentSlug: '', icon: 'folder' });
      await refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: async (target: { id: string; version: number; status: 'ACTIVE' | 'ARCHIVED' }) =>
      api(`/platform/catalogue/categories/${target.id}`, {
        method: 'PATCH',
        body: { version: target.version, status: target.status },
        ...options,
      }),
    onSuccess: refresh,
  });
  if (categories.isError) {
    forgetExpiredElevation(categories.error);
    return <Notice tone="error">{describeError(categories.error)}</Notice>;
  }
  const rows = categories.data ?? [];
  const topLevel = rows.filter((row) => row.parentSlug === null);
  return (
    <Card>
      <h2 className="mb-3 font-medium">Categories</h2>
      {setStatus.isError ? <Notice tone="error">{describeError(setStatus.error)}</Notice> : null}
      <ul className="mb-4 divide-y text-sm">
        {topLevel
          .flatMap((parent) => [parent, ...rows.filter((row) => row.parentSlug === parent.slug)])
          .map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2">
              <span className={row.parentSlug === null ? '' : 'pl-6'}>
                <span
                  className={row.status === 'ARCHIVED' ? 'text-muted-foreground line-through' : ''}
                >
                  {row.name}
                </span>{' '}
                <span className="text-muted-foreground">
                  · <code>{row.slug}</code> · {row.serviceCount} service
                  {row.serviceCount === 1 ? '' : 's'}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={setStatus.isPending}
                onClick={() => {
                  setStatus.mutate({
                    id: row.id,
                    version: row.version,
                    status: row.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
                  });
                }}
              >
                {row.status === 'ACTIVE' ? 'Archive' : 'Restore'}
              </Button>
            </li>
          ))}
      </ul>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-4"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        {create.isError ? (
          <div className="sm:col-span-4">
            <Notice tone="error">{describeError(create.error)}</Notice>
          </div>
        ) : null}
        <Field
          label="Category name"
          value={form.name}
          onChange={(event) => {
            setForm({ ...form, name: event.target.value });
          }}
        />
        <Field
          label="Category slug"
          hint="e.g. smart-homes"
          value={form.slug}
          onChange={(event) => {
            setForm({ ...form, slug: event.target.value });
          }}
        />
        <Select
          label="Parent"
          value={form.parentSlug}
          options={{
            '': '— top level —',
            ...Object.fromEntries(topLevel.map((row) => [row.slug, row.name])),
          }}
          onChange={(value) => {
            setForm({ ...form, parentSlug: value });
          }}
        />
        <Select
          label="Icon"
          value={form.icon}
          options={Object.fromEntries(CATEGORY_ICONS.map((icon) => [icon, icon]))}
          onChange={(value) => {
            setForm({ ...form, icon: value });
          }}
        />
        <div className="sm:col-span-4">
          <Button type="submit" variant="outline" disabled={create.isPending}>
            Add category
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ServicesCard() {
  const { options } = useElevated();
  const navigate = useNavigate();
  const categories = useStaffCategories();
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({ name: '', slug: '', categorySlug: '' });
  const services = useQuery({
    queryKey: ['platform', 'catalogue', 'services', status],
    queryFn: async () =>
      (
        await api<StaffServiceListResponse>(
          `/platform/catalogue/services${status === '' ? '' : `?status=${status}`}`,
          options,
        )
      ).services,
    retry: false,
  });
  const create = useMutation({
    mutationFn: async () =>
      api<StaffService>('/platform/catalogue/services', {
        method: 'POST',
        body: { name: form.name.trim(), slug: form.slug.trim(), categorySlug: form.categorySlug },
        ...options,
      }),
    onSuccess: async (service) => {
      await navigate(`/platform/catalogue/services/${service.id}`);
    },
  });
  const activeCategories = (categories.data ?? []).filter((row) => row.status === 'ACTIVE');
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-medium">Services</h2>
        <div className="w-48">
          <Select
            label="Status"
            value={status}
            options={{ '': 'All', DRAFT: 'Draft', PUBLISHED: 'Published', RETIRED: 'Retired' }}
            onChange={setStatus}
          />
        </div>
      </div>
      {services.isError ? <Notice tone="error">{describeError(services.error)}</Notice> : null}
      <ul className="mb-4 divide-y text-sm" aria-label="Catalogue services">
        {(services.data ?? []).map((service) => (
          <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <Link
                to={`/platform/catalogue/services/${service.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {service.name}
              </Link>{' '}
              <span className="text-muted-foreground">· {service.category.name}</span>
            </span>
            <span className="text-muted-foreground">
              {service.price?.label ?? 'No price'} · {service.status.toLowerCase()}
            </span>
          </li>
        ))}
        {services.data?.length === 0 ? (
          <li className="py-2 text-muted-foreground">Nothing here.</li>
        ) : null}
      </ul>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
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
          label="Service name"
          value={form.name}
          onChange={(event) => {
            setForm({ ...form, name: event.target.value });
          }}
        />
        <Field
          label="Service slug"
          hint="Part of the public web address; fixed once published"
          value={form.slug}
          onChange={(event) => {
            setForm({ ...form, slug: event.target.value });
          }}
        />
        <Select
          label="Category"
          value={form.categorySlug}
          options={{
            '': '— choose —',
            ...Object.fromEntries(activeCategories.map((row) => [row.slug, row.name])),
          }}
          onChange={(value) => {
            setForm({ ...form, categorySlug: value });
          }}
        />
        <div className="sm:col-span-3">
          <Button type="submit" disabled={create.isPending || form.categorySlug === ''}>
            Create draft
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- editor

/** /platform/catalogue/services/:id — content, price, skills and publishing. */
export function ServiceEditorPage() {
  return (
    <div className="space-y-6">
      <Link to="/platform/catalogue" className="text-sm underline-offset-4 hover:underline">
        ← Catalogue
      </Link>
      <ElevationGate>
        <ServiceEditor />
      </ElevationGate>
    </div>
  );
}

function useServiceWrite<V>(
  id: string,
  request: (value: V) => { path: string; method: 'POST' | 'PATCH' | 'PUT'; body: unknown },
) {
  const { options } = useElevated();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: V) => {
      const { path, method, body } = request(value);
      return api<StaffService>(`/platform/catalogue/services/${id}${path}`, {
        method,
        body,
        ...options,
      });
    },
    onSuccess: (service) => {
      queryClient.setQueryData(['platform', 'catalogue', 'service', id], service);
      void queryClient.invalidateQueries({ queryKey: ['platform', 'catalogue', 'services'] });
    },
  });
}

function ServiceEditor() {
  const { id = '' } = useParams();
  const { options } = useElevated();
  const service = useQuery({
    queryKey: ['platform', 'catalogue', 'service', id],
    queryFn: async () => api<StaffService>(`/platform/catalogue/services/${id}`, options),
    retry: false,
  });
  if (service.isError) {
    forgetExpiredElevation(service.error);
    return <Notice tone="error">{describeError(service.error)}</Notice>;
  }
  const data = service.data;
  if (data === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
        <p className="text-sm text-muted-foreground">
          {STATUS_TEXT[data.status]} · {data.category.name} · <code>/services/{data.slug}</code>
          {data.status === 'PUBLISHED' ? (
            <>
              {' · '}
              <Link to={`/services/${data.slug}`} className="underline">
                View public page
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <PublishCard data={data} />
      {/* Remount when the server version changes, so forms show the saved values. */}
      <ContentCard key={`content-${String(data.version)}`} data={data} />
      <PriceCard data={data} />
      <SkillsCard
        key={`skills-${data.skills.map((s) => s.code + s.minExperience).join()}`}
        data={data}
      />
    </div>
  );
}

function PublishCard({ data }: { data: StaffService }) {
  const transition = useServiceWrite(data.id, (action: 'publish' | 'retire' | 'restore') => ({
    path: `/${action}`,
    method: 'POST',
    body: { version: data.version },
  }));
  return (
    <Card>
      <h2 className="mb-2 font-medium">Publishing</h2>
      {transition.isError ? <Notice tone="error">{describeError(transition.error)}</Notice> : null}
      {data.status === 'DRAFT' && data.missing.length > 0 ? (
        <div className="mb-3 text-sm">
          <p className="font-medium">Before publishing, add:</p>
          <ul
            className="list-inside list-disc text-muted-foreground"
            aria-label="Missing before publishing"
          >
            {data.missing.map((item) => (
              <li key={item}>{MISSING_LABELS[item] ?? item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {data.status === 'DRAFT' ? (
          <Button
            disabled={transition.isPending || data.missing.length > 0}
            onClick={() => {
              transition.mutate('publish');
            }}
          >
            Publish
          </Button>
        ) : null}
        {data.status === 'PUBLISHED' ? (
          <Button
            variant="destructive"
            disabled={transition.isPending}
            onClick={() => {
              transition.mutate('retire');
            }}
          >
            Retire
          </Button>
        ) : null}
        {data.status === 'RETIRED' ? (
          <Button
            variant="outline"
            disabled={transition.isPending}
            onClick={() => {
              transition.mutate('restore');
            }}
          >
            Restore to draft
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

function ContentCard({ data }: { data: StaffService }) {
  const [form, setForm] = useState({
    name: data.name,
    slug: data.slug,
    summary: data.summary,
    description: data.description,
    inclusions: data.inclusions.join('\n'),
    exclusions: data.exclusions.join('\n'),
    customerRequirements: data.customerRequirements.join('\n'),
    typicalDuration: data.typicalDuration ?? '',
    audience: data.audience,
    deliveryMode: data.deliveryMode,
    channelOgs: data.channelOgs,
    channelIndividual: data.channelIndividual,
    channelCompany: data.channelCompany,
  });
  const save = useServiceWrite(data.id, () => ({
    path: '',
    method: 'PATCH',
    body: {
      version: data.version,
      name: form.name.trim(),
      ...(data.publishedAt === null ? { slug: form.slug.trim() } : {}),
      summary: form.summary.trim(),
      description: form.description.trim(),
      inclusions: lines(form.inclusions),
      exclusions: lines(form.exclusions),
      customerRequirements: lines(form.customerRequirements),
      typicalDuration: form.typicalDuration.trim() === '' ? null : form.typicalDuration.trim(),
      audience: form.audience,
      deliveryMode: form.deliveryMode,
      channelOgs: form.channelOgs,
      channelIndividual: form.channelIndividual,
      channelCompany: form.channelCompany,
    },
  }));
  const text = (
    key: 'name' | 'slug' | 'summary' | 'typicalDuration',
    label: string,
    hint?: string,
  ) => (
    <Field
      label={label}
      hint={hint}
      value={form[key]}
      disabled={key === 'slug' && data.publishedAt !== null}
      onChange={(event) => {
        setForm({ ...form, [key]: event.target.value });
      }}
    />
  );
  return (
    <Card>
      <h2 className="mb-3 font-medium">Content</h2>
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
        {text('name', 'Name')}
        {text(
          'slug',
          'Slug',
          data.publishedAt === null
            ? 'Fixed once published'
            : 'Fixed: the service has been published',
        )}
        <div className="sm:col-span-2">
          {text('summary', 'Summary', 'One sentence, shown in search results')}
        </div>
        <div className="sm:col-span-2">
          <TextArea
            label="Description"
            hint="Plain text. Leave a blank line between paragraphs."
            rows={6}
            value={form.description}
            onChange={(value) => {
              setForm({ ...form, description: value });
            }}
          />
        </div>
        <TextArea
          label="What's included"
          hint="One item per line"
          value={form.inclusions}
          onChange={(value) => {
            setForm({ ...form, inclusions: value });
          }}
        />
        <TextArea
          label="Not included"
          hint="One item per line"
          value={form.exclusions}
          onChange={(value) => {
            setForm({ ...form, exclusions: value });
          }}
        />
        <TextArea
          label="What we need from the customer"
          hint="One item per line"
          value={form.customerRequirements}
          onChange={(value) => {
            setForm({ ...form, customerRequirements: value });
          }}
        />
        {text('typicalDuration', 'Typical duration', 'e.g. Half a day')}
        <Select
          label="Audience"
          value={form.audience}
          options={AUDIENCE_LABELS}
          onChange={(value) => {
            setForm({ ...form, audience: value as StaffService['audience'] });
          }}
        />
        <Select
          label="Delivery"
          value={form.deliveryMode}
          options={DELIVERY_LABELS}
          onChange={(value) => {
            setForm({ ...form, deliveryMode: value as StaffService['deliveryMode'] });
          }}
        />
        <fieldset className="space-y-1 text-sm sm:col-span-2">
          <legend className="font-medium">Who may deliver it</legend>
          {(
            [
              ['channelOgs', 'OGS technicians'],
              ['channelIndividual', 'Individual providers'],
              ['channelCompany', 'Provider companies'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form[key]}
                onChange={(event) => {
                  setForm({ ...form, [key]: event.target.checked });
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            Save content
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PriceCard({ data }: { data: StaffService }) {
  const current = data.price;
  const [model, setModel] = useState<string>(current?.model ?? 'FIXED');
  const [amount, setAmount] = useState(minorToInput(current?.amountMinor ?? null));
  const [unit, setUnit] = useState<string>(current?.unit ?? 'HOUR');
  const [minQuantity, setMinQuantity] = useState(String(current?.minQuantity ?? 1));
  const amountMinor = parseKesToMinor(amount);
  const minimum = Number.parseInt(minQuantity, 10);
  const valid =
    model === 'QUOTE' ||
    (amountMinor !== null && (model !== 'PER_UNIT' || (Number.isInteger(minimum) && minimum >= 1)));
  const save = useServiceWrite(data.id, () => ({
    path: '/prices',
    method: 'POST',
    body:
      model === 'QUOTE'
        ? { model }
        : model === 'PER_UNIT'
          ? { model, amountMinor, unit, minQuantity: minimum }
          : { model, amountMinor },
  }));
  return (
    <Card>
      <h2 className="mb-1 font-medium">Price</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Excluding VAT. Saving adds a new price version; earlier versions are kept.
      </p>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-4"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Select label="Pricing model" value={model} options={MODEL_LABELS} onChange={setModel} />
        {model === 'QUOTE' ? null : (
          <Field
            label="Amount (KES)"
            inputMode="decimal"
            value={amount}
            error={
              amount !== '' && amountMinor === null
                ? 'Use a number like 3500 or 3500.50'
                : undefined
            }
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        )}
        {model === 'PER_UNIT' ? (
          <>
            <Select label="Unit" value={unit} options={UNIT_LABELS} onChange={setUnit} />
            <Field
              label="Minimum quantity"
              inputMode="numeric"
              value={minQuantity}
              onChange={(event) => {
                setMinQuantity(event.target.value);
              }}
            />
          </>
        ) : null}
        <div className="sm:col-span-4">
          <Button type="submit" disabled={save.isPending || !valid}>
            Save price
          </Button>
        </div>
      </form>
      {data.priceHistory.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium">Price history</h3>
          <ol className="space-y-1 text-sm text-muted-foreground" aria-label="Price history">
            {data.priceHistory.map((price, index) => (
              <li key={price.id}>
                {new Date(price.effectiveFrom).toLocaleString()} — {price.label}
                {index === 0 ? ' (current)' : ''}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

function SkillsCard({ data }: { data: StaffService }) {
  const skills = useSkills();
  const [chosen, setChosen] = useState<Map<string, ExperienceBand>>(
    () => new Map(data.skills.map((skill) => [skill.code, skill.minExperience])),
  );
  const save = useServiceWrite(data.id, () => ({
    path: '/skills',
    method: 'PUT',
    body: { skills: [...chosen].map(([code, minExperience]) => ({ code, minExperience })) },
  }));
  const update = (code: string, value: ExperienceBand | undefined) => {
    const next = new Map(chosen);
    if (value === undefined) next.delete(code);
    else next.set(code, value);
    setChosen(next);
  };
  return (
    <Card>
      <h2 className="mb-1 font-medium">Required skills</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Internal: used to find eligible providers. Never shown to customers.
      </p>
      {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {(skills.data ?? []).map((skill) => {
          const value = chosen.get(skill.code);
          return (
            <li key={skill.code} className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value !== undefined}
                  onChange={(event) => {
                    update(skill.code, event.target.checked ? 'UNDER_1_YEAR' : undefined);
                  }}
                />
                {skill.name}
              </label>
              {value === undefined ? null : (
                <select
                  aria-label={`Minimum experience for ${skill.name}`}
                  value={value}
                  onChange={(event) => {
                    update(skill.code, event.target.value as ExperienceBand);
                  }}
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                >
                  {Object.entries(EXPERIENCE_LABELS).map(([band, text]) => (
                    <option key={band} value={band}>
                      at least {text.toLowerCase()}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        className="mt-4"
        variant="outline"
        disabled={save.isPending}
        onClick={() => {
          save.mutate(undefined);
        }}
      >
        Save skills
      </Button>
    </Card>
  );
}
