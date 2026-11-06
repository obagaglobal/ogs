import { formatKes, type PublicPrice, type PublicServiceSummary } from '@ogs/contracts';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { Link, Outlet, useParams, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Notice } from '@/components/ui/form-controls';
import { useSession } from '@/features/auth/session';
import { ApiError, describeError } from '@/lib/api';
import {
  AUDIENCE_LABELS,
  DELIVERY_LABELS,
  MODEL_LABELS,
  useCategoryTree,
  usePublicCategory,
  usePublicService,
  useServiceSearch,
  type CatalogueFilters,
} from './catalogue-data';

const SITE_NAME = 'OGS · ObagaGlobal Services';

/**
 * Per-page SEO tags (P6-7). React 19 hoists <title>, <meta> and <link> into
 * <head>; JSON-LD stays in the body, which search engines accept.
 */
function PageMeta({
  title,
  description,
  path,
  jsonLd,
}: {
  title: string;
  description: string;
  path: string;
  jsonLd?: object;
}) {
  const canonical = `${window.location.origin}${path}`;
  return (
    <>
      <title>{`${title} | ${SITE_NAME}`}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      {jsonLd === undefined ? null : (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </>
  );
}

/** Light layout for signed-out visitors (and signed-in people browsing). */
export function PublicLayout() {
  const session = useSession();
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/services" className="font-semibold tracking-tight">
            OGS services
          </Link>
          <nav aria-label="Site" className="flex items-center gap-4 text-sm">
            <Link to="/services" className="underline-offset-4 hover:underline">
              All services
            </Link>
            {session.data ? (
              <Link to="/" className="underline-offset-4 hover:underline">
                Open OGS
              </Link>
            ) : (
              <Link to="/sign-in" className="underline-offset-4 hover:underline">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function PriceTag({ price }: { price: PublicPrice | null }) {
  if (price === null) {
    return <span className="text-sm text-muted-foreground">Price on request</span>;
  }
  return (
    <span className="text-sm">
      <span className="font-medium">{price.label}</span>
      {price.vatInclusiveMinor === null ? null : (
        <span className="text-muted-foreground"> + VAT</span>
      )}
    </span>
  );
}

function ServiceCard({ service }: { service: PublicServiceSummary }) {
  return (
    <li className="rounded-lg border p-4">
      <Link
        to={`/services/${service.slug}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {service.name}
      </Link>
      <p className="mt-1 text-sm text-muted-foreground">{service.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <PriceTag price={service.price} />
        <span className="text-xs text-muted-foreground">
          {service.category.name} · {DELIVERY_LABELS[service.deliveryMode]}
          {service.audience === 'ALL' ? '' : ` · ${AUDIENCE_LABELS[service.audience] ?? ''} only`}
        </span>
      </div>
    </li>
  );
}

/** Search results with filters and "Load more" (keyset pages). */
function ServiceResults({ filters }: { filters: CatalogueFilters }) {
  const search = useServiceSearch(filters);
  if (search.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading services…</p>;
  }
  if (search.isError) {
    return <Notice tone="error">{describeError(search.error)}</Notice>;
  }
  const services = search.data?.pages.flatMap((page) => page.services) ?? [];
  return (
    <div className="space-y-4">
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">No services match. Try other words.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Services">
          {services.map((service) => (
            <ServiceCard key={service.slug} service={service} />
          ))}
        </ul>
      )}
      {search.hasNextPage ? (
        <Button
          variant="outline"
          disabled={search.isFetchingNextPage}
          onClick={() => {
            void search.fetchNextPage();
          }}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Any</option>
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Search box + filters, kept in the URL so results can be shared and bookmarked. */
function SearchAndFilters({ category }: { category?: string }) {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const filters: CatalogueFilters = {
    q: params.get('q') ?? '',
    model: params.get('model') ?? '',
    audience: params.get('audience') ?? '',
    delivery: params.get('delivery') ?? '',
    ...(category === undefined ? {} : { category }),
  };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-6">
      <form
        role="search"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          set('q', text.trim());
        }}
      >
        <div className="min-w-64 flex-1 space-y-1">
          <label htmlFor="catalogue-search" className="text-xs font-medium text-muted-foreground">
            Search services
          </label>
          <input
            id="catalogue-search"
            type="search"
            maxLength={100}
            value={text}
            placeholder="e.g. Wi-Fi, CCTV, laptop repair"
            onChange={(event) => {
              setText(event.target.value);
            }}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>
        <Button type="submit">Search</Button>
        <FilterSelect
          label="Pricing"
          value={filters.model ?? ''}
          options={MODEL_LABELS}
          onChange={(value) => {
            set('model', value);
          }}
        />
        <FilterSelect
          label="For"
          value={filters.audience ?? ''}
          options={{ ORGANISATIONS: 'Organisations', INDIVIDUALS: 'Individuals' }}
          onChange={(value) => {
            set('audience', value);
          }}
        />
        <FilterSelect
          label="Delivery"
          value={filters.delivery ?? ''}
          options={DELIVERY_LABELS}
          onChange={(value) => {
            set('delivery', value);
          }}
        />
      </form>
      <ServiceResults filters={filters} />
    </div>
  );
}

/** /services — the catalogue home: categories, search and results. */
export function CataloguePage() {
  const tree = useCategoryTree();
  return (
    <div className="space-y-8">
      <PageMeta
        title="ICT services in Kenya"
        description="Wi-Fi, networking, CCTV, computer repair, cloud and more, delivered by vetted OGS technicians. Clear prices in KES."
        path="/services"
      />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">ICT services</h1>
        <p className="text-sm text-muted-foreground">
          Delivered by OGS and vetted providers. Prices are in KES and exclude VAT.
        </p>
      </div>
      {tree.isError ? <Notice tone="error">{describeError(tree.error)}</Notice> : null}
      <nav aria-label="Categories">
        <ul className="flex flex-wrap gap-2">
          {(tree.data ?? []).map((category) => (
            <li key={category.slug}>
              <Link
                to={`/services/c/${category.slug}`}
                className="inline-block rounded-full border px-3 py-1 text-sm hover:bg-accent"
              >
                {category.name}{' '}
                <span className="text-muted-foreground">({category.serviceCount})</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <SearchAndFilters />
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return (
    <Card>
      <h1 className="mb-2 text-xl font-semibold">{what} not found</h1>
      <p className="text-sm text-muted-foreground">
        It may have been withdrawn.{' '}
        <Link to="/services" className="underline">
          Browse all services
        </Link>
        .
      </p>
    </Card>
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** /services/c/:category — one category, its sub-categories and services. */
export function CategoryPage() {
  const { category: slug = '' } = useParams();
  const category = usePublicCategory(slug);
  if (category.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (category.isError || category.data === undefined) {
    return isNotFound(category.error) ? (
      <NotFound what="Category" />
    ) : (
      <Notice tone="error">{describeError(category.error)}</Notice>
    );
  }
  const { category: data, parent } = category.data;
  return (
    <div className="space-y-6">
      <PageMeta
        title={data.name}
        description={data.summary ?? `${data.name} services from OGS, with clear prices in KES.`}
        path={`/services/c/${data.slug}`}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link to="/services" className="underline-offset-4 hover:underline">
          Services
        </Link>
        {parent === null ? null : (
          <>
            {' › '}
            <Link to={`/services/c/${parent.slug}`} className="underline-offset-4 hover:underline">
              {parent.name}
            </Link>
          </>
        )}
      </nav>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
        {data.summary === null ? null : (
          <p className="text-sm text-muted-foreground">{data.summary}</p>
        )}
      </div>
      {data.children.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Sub-categories">
          {data.children.map((child) => (
            <li key={child.slug}>
              <Link
                to={`/services/c/${child.slug}`}
                className="inline-block rounded-full border px-3 py-1 text-sm hover:bg-accent"
              >
                {child.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <SearchAndFilters key={data.slug} category={data.slug} />
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className="mb-1 font-medium">{title}</h2>
      <ul className="list-inside list-disc text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** /services/:slug — one service. Plain text only: content is never rendered as HTML. */
export function ServicePage() {
  const { slug = '' } = useParams();
  const service = usePublicService(slug);
  if (service.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (service.isError || service.data === undefined) {
    return isNotFound(service.error) ? (
      <NotFound what="Service" />
    ) : (
      <Notice tone="error">{describeError(service.error)}</Notice>
    );
  }
  const data = service.data;
  const price = data.price;
  const amountMinor = price?.amountMinor ?? null;
  const vatInclusiveMinor = price?.vatInclusiveMinor ?? null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: data.name,
    description: data.summary,
    serviceType: data.category.name,
    areaServed: 'KE',
    provider: { '@type': 'Organization', name: 'ObagaGlobal Services' },
    ...(amountMinor === null
      ? {}
      : {
          offers: {
            '@type': 'Offer',
            priceCurrency: 'KES',
            price: (amountMinor / 100).toFixed(2),
          },
        }),
  };
  const breadcrumb: ReactNode[] = [
    <Link key="all" to="/services" className="underline-offset-4 hover:underline">
      Services
    </Link>,
  ];
  if (data.parentCategory !== null) {
    breadcrumb.push(
      ' › ',
      <Link
        key="parent"
        to={`/services/c/${data.parentCategory.slug}`}
        className="underline-offset-4 hover:underline"
      >
        {data.parentCategory.name}
      </Link>,
    );
  }
  breadcrumb.push(
    ' › ',
    <Link
      key="cat"
      to={`/services/c/${data.category.slug}`}
      className="underline-offset-4 hover:underline"
    >
      {data.category.name}
    </Link>,
  );
  return (
    <article className="space-y-6">
      <PageMeta
        title={data.name}
        description={data.summary}
        path={`/services/${data.slug}`}
        jsonLd={jsonLd}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        {breadcrumb}
      </nav>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
        <p className="text-muted-foreground">{data.summary}</p>
        <p className="text-xs text-muted-foreground">
          {DELIVERY_LABELS[data.deliveryMode]}
          {data.audience === 'ALL' ? '' : ` · for ${AUDIENCE_LABELS[data.audience] ?? ''}`}
          {data.typicalDuration === null ? '' : ` · typically ${data.typicalDuration}`}
        </p>
      </header>
      <Card>
        <p className="text-lg">
          <PriceTag price={price} />
        </p>
        {vatInclusiveMinor === null ? null : (
          <p className="text-xs text-muted-foreground">
            About {formatKes(vatInclusiveMinor)} including 16% VAT (indicative).
          </p>
        )}
        {price?.model === 'FROM' || price?.model === 'QUOTE' ? (
          <p className="mt-1 text-xs text-muted-foreground">
            The final price is set in a quotation after we understand your needs.
          </p>
        ) : null}
        <Button className="mt-4" disabled>
          Request this service — coming soon
        </Button>
      </Card>
      <section className="space-y-3">
        {data.description
          .split(/\n\s*\n/)
          .filter((paragraph) => paragraph.trim() !== '')
          .map((paragraph) => (
            <p key={paragraph} className="text-sm">
              {paragraph}
            </p>
          ))}
      </section>
      <ListSection title="What's included" items={data.inclusions} />
      <ListSection title="Not included" items={data.exclusions} />
      <ListSection title="What we need from you" items={data.customerRequirements} />
    </article>
  );
}
