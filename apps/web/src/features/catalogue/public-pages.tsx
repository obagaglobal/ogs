import {
  formatKes,
  type PublicCategory,
  type PublicPrice,
  type PublicServiceSummary,
} from '@ogs/contracts';
import {
  ArrowRight,
  Camera,
  Cloud,
  Folder,
  HardDrive,
  Laptop,
  Network,
  Phone,
  Printer,
  Search,
  Server,
  ShieldCheck,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useEffect, useState, type SubmitEvent } from 'react';
import { Link, Outlet, useParams, useSearchParams } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, RouteFallback, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/input';
import { KitengeMotif } from '@/components/ui/kitenge-motif';
import { Breadcrumbs, type Crumb } from '@/components/ui/navigation';
import { useSession } from '@/features/auth/session';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
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

/**
 * Public layout (Phase 6b): the motif header strip, a light top bar, and a
 * footer. Pages render inside their own Suspense boundary.
 */
export function PublicLayout() {
  const session = useSession();
  return (
    <div className="flex min-h-svh flex-col bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-saffron px-4 py-2 font-display font-medium text-on-saffron focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('shell.skipToContent')}
      </a>
      <KitengeMotif variant="band" height={6} />
      <header className="border-b border-border bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <Link
            to="/services"
            className="flex min-h-11 items-center gap-2 rounded-md font-display text-lg font-bold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-7 items-center justify-center rounded-sm bg-ink text-sm text-saffron"
            >
              O
            </span>
            OGS services
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1 text-sm sm:gap-3">
            <Link
              to="/services"
              className="hidden min-h-11 items-center rounded-md px-2 underline-offset-4 hover:underline sm:inline-flex"
            >
              {t('public.allServices')}
            </Link>
            {session.data ? (
              <Link to="/" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                {t('public.openOgs')}
              </Link>
            ) : (
              <Link to="/sign-in" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                {t('public.signIn')}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>{t('shell.brandLong')}</span>
          <span>{t('public.pricesNote')}</span>
        </div>
      </footer>
    </div>
  );
}

/** Prices are always mono with tabular figures: "KES 84,500". */
function PriceTag({ price, large = false }: { price: PublicPrice | null; large?: boolean }) {
  if (price === null) {
    return <span className="text-sm text-muted-foreground">Price on request</span>;
  }
  return (
    <span className={large ? 'text-2xl' : 'text-sm'}>
      <span className="tabular font-medium">{price.label}</span>
      {price.vatInclusiveMinor === null ? null : (
        <span className="text-sm text-muted-foreground"> + VAT</span>
      )}
    </span>
  );
}

function ServiceCard({ service }: { service: PublicServiceSummary }) {
  return (
    <li className="group relative flex flex-col rounded-md border border-border bg-surface p-5 motion-fast transition-colors hover:border-ink">
      <p className="mb-2 font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {service.category.name}
      </p>
      <h2 className="font-display text-lg font-medium leading-snug">
        <Link
          to={`/services/${service.slug}`}
          className="underline-offset-4 after:absolute after:inset-0 after:rounded-md group-hover:underline"
        >
          {service.name}
        </Link>
      </h2>
      <p className="mt-1 flex-1 text-sm text-muted-foreground">{service.summary}</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-t border-border pt-3">
        <PriceTag price={service.price} />
        <span className="text-xs text-muted-foreground">
          {DELIVERY_LABELS[service.deliveryMode]}
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
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
    );
  }
  if (search.isError) {
    return <ErrorState body={describeError(search.error)} />;
  }
  const services = search.data?.pages.flatMap((page) => page.services) ?? [];
  const count = services.length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {search.isFetching && !search.isFetchingNextPage
          ? t('public.searching')
          : count === 1
            ? t('public.resultsOne')
            : t('public.resultsCount', {
                count: search.hasNextPage ? `${String(count)}+` : count,
              })}
      </p>
      {count === 0 ? (
        <EmptyState title={t('public.noResults')} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Services">
          {services.map((service) => (
            <ServiceCard key={service.slug} service={service} />
          ))}
        </ul>
      )}
      {search.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={search.isFetchingNextPage}
          onClick={() => {
            void search.fetchNextPage();
          }}
        >
          {t('public.loadMore')}
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
    <div className="space-y-1.5">
      <label htmlFor={id} className="block font-display text-sm font-medium">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-auto min-w-36"
      >
        <option value="">Any</option>
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * Instant search: results follow the text box after a short pause (300 ms);
 * Enter or the Search button applies it at once. Filters live in the URL so
 * results can be shared and bookmarked.
 */
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
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === '') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };
  const applied = params.get('q') ?? '';
  useEffect(() => {
    const query = text.trim();
    if (query === applied) return;
    const timer = window.setTimeout(() => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (query === '') next.delete('q');
          else next.set('q', query);
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, applied, setParams]);
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
        <div className="min-w-64 flex-1 space-y-1.5">
          <label htmlFor="catalogue-search" className="block font-display text-sm font-medium">
            {t('public.searchLabel')}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="catalogue-search"
              type="search"
              maxLength={100}
              value={text}
              placeholder={t('public.searchPlaceholder')}
              onChange={(event) => {
                setText(event.target.value);
              }}
              className="pl-9"
            />
          </div>
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

/** Category icons are free-text slugs set by staff; unknown ones get a folder. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  wifi: Wifi,
  network: Network,
  networks: Network,
  cctv: Camera,
  camera: Camera,
  security: ShieldCheck,
  laptop: Laptop,
  computer: Laptop,
  repair: Laptop,
  cloud: Cloud,
  server: Server,
  storage: HardDrive,
  printer: Printer,
  phone: Phone,
  telephony: Phone,
};

function CategoryCard({ category }: { category: PublicCategory }) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Folder;
  return (
    <li>
      <Link
        to={`/services/c/${category.slug}`}
        className="group flex h-full items-start gap-3 rounded-md border border-border bg-surface p-4 motion-fast transition-colors hover:border-ink"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-muted group-hover:bg-saffron group-hover:text-on-saffron"
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2 font-display font-medium">
            {category.name}
            <ArrowRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground motion-fast transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
            />
          </span>
          <span className="tabular block text-xs text-muted-foreground">
            ({category.serviceCount})
          </span>
        </span>
      </Link>
    </li>
  );
}

/** /services — the catalogue home: Karibu hero, categories, search and results. */
export function CataloguePage() {
  const tree = useCategoryTree();
  return (
    <div className="space-y-10">
      <PageMeta
        title="ICT services in Kenya"
        description="Wi-Fi, networking, CCTV, computer repair, cloud and more, delivered by vetted OGS technicians. Clear prices in KES."
        path="/services"
      />
      <section className="overflow-hidden rounded-md border border-ink bg-surface">
        <div className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-2xl space-y-3">
            <p className="font-display text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t('greeting.karibuTo')}
            </p>
            <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              ICT services
            </h1>
            <p className="font-display text-xl">{t('public.heroTitle')}</p>
            <p className="text-muted-foreground">{t('public.heroBody')}</p>
          </div>
          <KitengeMotif variant="corner" height={20} className="hidden lg:block" />
        </div>
        <KitengeMotif variant="band" height={14} />
      </section>
      {tree.isError ? <ErrorState body={describeError(tree.error)} /> : null}
      <nav aria-labelledby="categories-heading" className="space-y-3">
        <h2 id="categories-heading" className="font-display text-xl font-medium">
          {t('public.categories')}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tree.isLoading
            ? Array.from({ length: 4 }, (_, index) => (
                <li key={index}>
                  <Skeleton className="h-20" />
                </li>
              ))
            : (tree.data ?? []).map((category) => (
                <CategoryCard key={category.slug} category={category} />
              ))}
        </ul>
      </nav>
      <KitengeMotif variant="divider" tone="muted" height={8} />
      <section aria-labelledby="find-heading" className="space-y-4">
        <h2 id="find-heading" className="font-display text-xl font-medium">
          {t('nav.services')}
        </h2>
        <SearchAndFilters />
      </section>
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return (
    <EmptyState
      as="h1"
      title={t('public.notFound', { what })}
      body={t('public.notFoundBody')}
      action={
        <Link to="/services" className={buttonVariants({ variant: 'secondary' })}>
          {t('public.browseAll')}
        </Link>
      }
    />
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-10 w-80 max-w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** /services/c/:category — one category, its sub-categories and services. */
export function CategoryPage() {
  const { category: slug = '' } = useParams();
  const category = usePublicCategory(slug);
  if (category.isLoading) {
    return <PageSkeleton />;
  }
  if (category.isError || category.data === undefined) {
    return isNotFound(category.error) ? (
      <NotFound what="Category" />
    ) : (
      <ErrorState body={describeError(category.error)} />
    );
  }
  const { category: data, parent } = category.data;
  const crumbs: Crumb[] = [{ label: 'Services', to: '/services' }];
  if (parent !== null) crumbs.push({ label: parent.name, to: `/services/c/${parent.slug}` });
  crumbs.push({ label: data.name });
  return (
    <div className="space-y-6">
      <PageMeta
        title={data.name}
        description={data.summary ?? `${data.name} services from OGS, with clear prices in KES.`}
        path={`/services/c/${data.slug}`}
      />
      <Breadcrumbs items={crumbs} />
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{data.name}</h1>
        {data.summary === null ? null : (
          <p className="max-w-2xl text-muted-foreground">{data.summary}</p>
        )}
      </div>
      {data.children.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Sub-categories">
          {data.children.map((child) => (
            <li key={child.slug}>
              <Link
                to={`/services/c/${child.slug}`}
                className="inline-flex min-h-11 items-center rounded-sm border border-control-border bg-surface px-3 text-sm hover:border-ink md:min-h-9"
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
      <h2 className="mb-2 font-display text-lg font-medium">{title}</h2>
      <ul className="list-inside list-disc space-y-1 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Signed in: straight to the request form ("Request this service"); signed
 * out: "Sign in to request", then back to the form.
 */
function RequestButton({ slug }: { slug: string }) {
  const session = useSession();
  const target = `/requests/new?service=${encodeURIComponent(slug)}`;
  return session.data ? (
    <Link
      to={target}
      className={cn(buttonVariants({ variant: 'highlight', size: 'lg' }), 'w-full')}
    >
      {t('public.requestService')}
    </Link>
  ) : (
    <Link
      to={`/sign-in?next=${encodeURIComponent(target)}`}
      className={cn(buttonVariants({ variant: 'highlight', size: 'lg' }), 'w-full')}
    >
      {t('public.signInToRequest')}
    </Link>
  );
}

/** /services/:slug — one service. Plain text only: content is never rendered as HTML. */
export function ServicePage() {
  const { slug = '' } = useParams();
  const service = usePublicService(slug);
  if (service.isLoading) {
    return <PageSkeleton />;
  }
  if (service.isError || service.data === undefined) {
    return isNotFound(service.error) ? (
      <NotFound what="Service" />
    ) : (
      <ErrorState body={describeError(service.error)} />
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
  const crumbs: Crumb[] = [{ label: 'Services', to: '/services' }];
  if (data.parentCategory !== null) {
    crumbs.push({
      label: data.parentCategory.name,
      to: `/services/c/${data.parentCategory.slug}`,
    });
  }
  crumbs.push({ label: data.category.name, to: `/services/c/${data.category.slug}` });
  crumbs.push({ label: data.name });
  return (
    <article className="space-y-6">
      <PageMeta
        title={data.name}
        description={data.summary}
        path={`/services/${data.slug}`}
        jsonLd={jsonLd}
      />
      <Breadcrumbs items={crumbs} />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {data.name}
            </h1>
            <p className="text-lg text-muted-foreground">{data.summary}</p>
            <p className="text-sm text-muted-foreground">
              {DELIVERY_LABELS[data.deliveryMode]}
              {data.audience === 'ALL' ? '' : ` · for ${AUDIENCE_LABELS[data.audience] ?? ''}`}
              {data.typicalDuration === null ? '' : ` · typically ${data.typicalDuration}`}
            </p>
          </header>
          <section className="max-w-prose space-y-3">
            {data.description
              .split(/\n\s*\n/)
              .filter((paragraph) => paragraph.trim() !== '')
              .map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
          </section>
          <ListSection title="What's included" items={data.inclusions} />
          <ListSection title="Not included" items={data.exclusions} />
          <ListSection title="What we need from you" items={data.customerRequirements} />
        </div>
        <Card emphasis className="space-y-3 lg:sticky lg:top-6">
          <p className="font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Price
          </p>
          <p>
            <PriceTag price={price} large />
          </p>
          {vatInclusiveMinor === null ? null : (
            <p className="text-sm text-muted-foreground">
              {`About ${formatKes(vatInclusiveMinor)} including 16% VAT (indicative).`}
            </p>
          )}
          {price?.model === 'FROM' || price?.model === 'QUOTE' ? (
            <p className="text-sm text-muted-foreground">
              The final price is set in a quotation after we understand your needs.
            </p>
          ) : null}
          <RequestButton slug={data.slug} />
        </Card>
      </div>
    </article>
  );
}
