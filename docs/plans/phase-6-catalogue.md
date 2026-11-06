# Phase 6 Plan — Service Catalogue

**Status:** APPROVED by the owner on 2026-11-06, with all recommendations P6-1 … P6-8 accepted. Built on branch `phase-6/catalogue` (from `main`); ships as one PR into `main`, then waits for green CI and the owner's approval.

**Based on:**

- [Architecture Review](../architecture/review.md): §2 (D4 Catalogue), §4.1 (platform-owned rows), §4.2 (`ServiceCategory`, `Service`, `ServicePricing`, `ServiceRequirement`), §11 (server-computed prices) and §13 (Phase 6 row);
- ADRs: ADR-012 (`Service` vs `ServiceListing`), ADR-013 (OGS assigns), ADR-014 (prepay/postpay), ADR-016 (OGS sets the customer price), ADR-017 (16% VAT), ADR-021 (SEO), ADR-024 (English, i18n-ready).

**Starting point:** `main` @ `48d81aa` (Phases 2–5 merged). PR #6 (pg query serialisation, CI speed-up) is open. Phase 6 does not depend on it, and I'll merge `main` into the branch if #6 lands first.

## 1. Goal

Anyone, signed in or not, can browse what OGS sells: **categories, services, what each includes and what it costs**. They can find a service by search and filters.

OGS staff own the catalogue. They draft services, set prices, say which skills a service needs, and publish or retire services. Every change is audited.

Review §13 sets the acceptance bar:

- anonymous visitors see only active, published services;
- every pricing model is stored in integer minor units;
- search, filters and pagination are tested;
- inactive services never appear publicly.

Phase 6 does not take requests, quote or charge anything. Those come in Phases 7 and 11.

## 2. Scope

### 2.1 Data model (platform-owned, no tenant column; review §4.1)

| Table              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `service_category` | Tree (`parent_id`, at most 2 levels: e.g. Networks › Wi-Fi). Fields: slug (unique, immutable once published), name, summary, icon (a name from a fixed icon set; no uploads), position, status `ACTIVE`/`ARCHIVED`.                                                                                                                                                                                                |
| `service`          | Fields: slug (unique, immutable once published), category, name, summary, structured content (description paragraphs, "what's included", "not included", "what we need from you", typical duration), audience (P6-4), delivery (on-site / remote / both, P6-5), status `DRAFT` → `PUBLISHED` → `RETIRED` (P6-6), `published_at`, `version`. A generated `search_vector` (`tsvector`) column has a GIN index.       |
| `service_price`    | **Append-only price versions** (P6-3): `model` (`FIXED`, `PER_UNIT`, `FROM`, `QUOTE`; P6-2), `amount_minor` (`bigint`, ≥ 0, null only for `QUOTE`), `currency` (`KES` only in v1, enforced by CHECK), `unit` (`HOUR`, `DEVICE`, `USER`, `VISIT`, `POINT`; `PER_UNIT` only), `min_quantity`, `effective_from`, `created_by`. The current price is the latest version. A database trigger rejects UPDATE and DELETE. |
| `service_skill`    | The skills a service requires (Phase 5 `skill` codes) and the minimum experience band. Phase 9 eligibility reads them.                                                                                                                                                                                                                                                                                             |

`ServiceListing` (provider-specific offers and rates, ADR-012) is **not** built in Phase 6: see §3.

### 2.2 Public catalogue (anonymous, P6-1)

- **Endpoints:**
  - `GET /catalogue/categories` (tree);
  - `GET /catalogue/services` (search and filters, cursor pagination);
  - `GET /catalogue/services/:slug`;
  - `GET /catalogue/categories/:slug`.

  All are `@Public()`, rate-limited per IP (the existing `RateLimiter`), and sent with `Cache-Control: public, max-age=60`.

- **Visibility.** Only `PUBLISHED` services in `ACTIVE` categories (and active parents). A draft, retired or hidden service answers 404, never 403, so its existence doesn't leak.
- **Public DTOs are separate** from the staff DTOs. They never carry internal fields: created-by, versions, required skills, or audit data.
- **Search.**
  - PostgreSQL full-text search (`websearch_to_tsquery('english')`) over name, summary, content and category, ranked by `ts_rank`; an empty query ranks by category position and then name.
  - Filters: category (including its sub-categories), pricing model, audience, delivery mode, and a price range (fixed and per-unit prices only).
  - **Keyset (cursor) pagination:** an opaque, signed cursor with a stable order (rank, id) and a page size of 20, at most 50. There are no offset pages, which drift when the catalogue changes.
- **SEO (P6-7).**
  - The API serves `GET /sitemap.xml` and `GET /robots.txt`, built from published services and categories.
  - The SPA sets `<title>`, the meta description, canonical links and Product/Service JSON-LD per page.
  - Server-side prerendering is deferred to deployment (Phase 15).

### 2.3 Prices are computed on the server (review §11)

- Shared contracts define `moneyMinorSchema` (a safe non-negative integer, never a float) and a single `formatKes(minor)` helper.
- The API returns the price model, `amountMinor`, the unit, and a display label it builds itself ("KES 3,500", "KES 1,200 per device (min. 5)", "From KES 15,000", "Price on quotation").
- **VAT (P6-8).** Prices are stored **excluding VAT**. The public page shows "+ VAT", and an indicative VAT-inclusive figure at the ADR-017 rate. Tax lines are computed for real on quotations and invoices in Phases 7 and 11.

### 2.4 Catalogue management (staff)

- **Endpoints** under `/platform/catalogue/*`, with `@RequireElevation('platform.catalogue.manage')` (service manager and super admin):
  - categories: create, edit, move, reorder, archive;
  - services: create a draft, edit, set the price (writes a new price version), set the required skills, publish, retire, restore to draft;
  - lists include drafts and retired services, with the price history.
- **Publish checks.** Publishing needs:
  - an active category;
  - a summary and a description;
  - a current price;
  - for `PER_UNIT`, a unit;
  - at least one required skill unless the service is internal-only delivery (P6-5).

  Failures name the missing fields, like Phase 4/5's `missing` lists.

- **Audit and concurrency.** Every change is audited (`catalogue.*` actions with before/after field names, never full content dumps) and uses optimistic concurrency (`version`).
- **Retire, don't delete.** Retiring a service hides it from the public at once, but it stays readable to staff, and Phase 7 requests keep their snapshot. Nothing is hard-deleted.

### 2.5 Eligibility uses services (ties into Phase 5)

`GET /platform/providers/eligible` accepts `service=<id>` as an alternative to `skills=`. It uses the service's required skills and minimum experience, and its delivery mode (a remote-capable service allows remote providers). This is the hand-off Phase 9 dispatch needs.

### 2.6 Web

- **Public pages,** outside the signed-in shell, in a light public layout with a "Sign in" link:
  - `/services`: categories and search;
  - `/services/c/:category`: category page with filters;
  - `/services/:slug`: service detail with the price label, inclusions and requirements.

  The "Request this service" button says "Coming soon": requests arrive in Phase 7.

- **Staff pages** in the PLATFORM workspace, behind the existing elevation gate:
  - "Catalogue": a category tree editor and a service list with status filters;
  - the service editor: content, audience, delivery, price with history, required skills (the Phase 5 skill picker), publish/retire, and a public-view preview.
- Navigation: the signed-in dashboard links to "Browse services"; the PLATFORM nav gains "Catalogue" for `platform.catalogue.manage`.
- All strings are kept i18n-ready (ADR-024). No new colour work (ADR-022 accent still open).

### 2.7 Seed

`pnpm db:seed` adds about 6 categories and about 15 published Kenyan ICT services, covering all four price models with realistic KES prices, plus one draft and one retired service (to show they stay hidden). The e2e and integration tests create their own uniquely named services.

## 3. Out of scope

| Item                                                                           | When                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| Service requests, quotations, orders, price snapshots on orders                | Phase 7                                         |
| `ServiceListing`: provider-specific offers and rates (cost inputs for payouts) | Phase 9 (dispatch) / Phase 11 (payouts)         |
| Recurring and subscription pricing (managed contracts), discounts, promotions  | With managed contracts, after Phase 11          |
| Real VAT computation, invoices, eTIMS                                          | Phase 11                                        |
| Service images and uploads (needs a public, CDN-backed file path)              | Later; Phase 6 uses icons from a fixed set      |
| Server-side prerendering                                                       | Phase 15 (deployment), if analytics show a need |
| Ratings, reviews, public provider profiles (ADR-013)                           | After v1                                        |
| Swahili content                                                                | After v1 (ADR-024)                              |

## 4. Tests and acceptance

| ID  | Proves                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Anonymous visitors see only published services in active categories.** A table-driven test covers every combination of service status × category status × parent status, through HTTP (list, detail, category, sitemap) **and** through raw SQL in the anonymous database context. Hidden items answer 404.                                                   |
| E2  | **The anonymous context sees nothing else.** The no-context isolation suite (T2) asserts zero rows in every non-catalogue table, every insert or update is rejected, and the catalogue tables expose published rows only. Public DTOs contain no internal fields (checked against the contract schema).                                                         |
| E3  | **Money.** Every pricing model round-trips in integer minor units. Database CHECKs reject negative amounts, non-KES currencies, a unit missing for `PER_UNIT`, and an amount on `QUOTE`. Contracts reject floats and unsafe integers. A property test covers `formatKes` and the price labels. Price versions are append-only (UPDATE and DELETE are rejected). |
| E4  | **Search, filters, pagination.** Ranking puts name matches above description matches. Each filter is tested alone and combined. Paging covers a seeded set with no duplicates and no gaps, including when services are published or retired between pages. A tampered cursor is refused. The page-size limit holds.                                             |
| E5  | **Management.** Only `platform.catalogue.manage` under elevation can write; every other role, workspace and anonymous caller is refused, checked by an automatic route walk. Publish checks list what's missing. Optimistic concurrency produces 409 on a stale `version`. Every change writes an audit row.                                                    |
| E6  | **Retiring and archiving** hide a service at once, publicly and in search. Staff still see it, and the slug can't be reused or changed after publishing.                                                                                                                                                                                                        |
| E7  | **Eligibility by service** gives the same results as the equivalent `skills=` query, and respects minimum experience and remote delivery.                                                                                                                                                                                                                       |
| E8  | **Abuse resistance.** Public endpoints are rate-limited per IP with `429` and a retry time. Search input is length-limited and parameterised, with no raw SQL built from strings.                                                                                                                                                                               |
| E9  | **Web.** Component tests for the price label, filters, pagination ("Load more") and the service editor's publish checklist. The Playwright journey: staff create, price and publish a service → a signed-out visitor finds it by search and opens it → staff retire it → it disappears for the visitor.                                                         |

## 5. Delivery

| Part         | Content                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6A — backend | Schema, RLS, triggers and seed; the anonymous context; public and staff endpoints; search and pagination; eligibility by service; sitemap and robots; tests E1–E8.       |
| 6B — web     | Public layout and pages, SEO tags, staff catalogue editor, Playwright journey (E9). Docs: overview §10 "Catalogue", getting-started seed accounts, ADRs for P6-1 … P6-8. |

As in Phases 4–5: one approval, delivered as two halves with no gate between them. Then one PR into `main`, and I wait for green CI and your approval before Phase 7.

## 6. Decisions needed before starting

| ID   | Question                                                  | Recommendation                                                                                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                                          |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P6-1 | How do anonymous visitors read the catalogue under RLS?   | **A new `anonymous` database context that sets no identity at all.** Every existing policy then fails closed, exactly as the T2 "no context" tests prove today. Only the catalogue tables get a context-free policy: "published, in an active category". There is no new database role and no new pool. | The review's "anon role" (§4.1) costs a second connection pool. A new actor kind is riskier: four existing policies (`skill`, `region`, `permission`, system roles) treat "any actor kind" as readable, and a new kind would quietly open them. "No context" is already the most-tested state in the system. |
| P6-2 | Which pricing models in v1?                               | **`FIXED`**, **`PER_UNIT`** (hour, device, user, visit, cabling point; with a minimum quantity), **`FROM`** (indicative, finalised by quotation) and **`QUOTE`** (no public price).                                                                                                                     | These cover how Kenyan ICT services are sold ad hoc today. They map directly onto Phase 7's two paths (fixed price vs quotation, review §9). Recurring pricing belongs with managed contracts.                                                                                                               |
| P6-3 | Can prices be edited in place?                            | **No: append-only price versions.** Changing a price adds a version, and staff see the history. Phase 7 orders snapshot the price at request time.                                                                                                                                                      | It answers "what did this cost on 3 March?", and it's a natural fit for the audit trail and future finance reconciliation.                                                                                                                                                                                   |
| P6-4 | Can a service be limited to organisations or individuals? | **Yes: `audience` = all / organisations / individuals.** Everyone can still _see_ every published service; the audience shows as a label, and Phase 7 enforces it when requesting.                                                                                                                      | Some offers are B2B only (e.g. Microsoft 365 tenant management). Hiding them would hurt discovery and SEO.                                                                                                                                                                                                   |
| P6-5 | How does a service say who can deliver it?                | **A delivery mode** (on-site / remote / both) plus **allowed channels** (OGS staff, individual providers, provider companies), plus required skills with a minimum experience band.                                                                                                                     | Phase 9 eligibility needs exactly this (review §10). It replaces the review's sketched `ServiceProviderEligibility` table with plain columns.                                                                                                                                                                |
| P6-6 | What is the service lifecycle?                            | **DRAFT → PUBLISHED → RETIRED** (with restore to DRAFT). One permission (`platform.catalogue.manage`), no second approver, every change audited. Slugs are immutable once published.                                                                                                                    | Simple, and safe enough: staff are MFA-enforced and elevated, and every change is recorded. Stable slugs keep links and search rankings intact.                                                                                                                                                              |
| P6-7 | How much SEO in Phase 6 (ADR-021)?                        | **Sitemap, robots, per-page meta and JSON-LD now; prerendering deferred** to deployment (Phase 15).                                                                                                                                                                                                     | Search engines render JavaScript pages. Prerendering needs a deploy-time pipeline that doesn't exist yet. The cheap 80% comes first.                                                                                                                                                                         |
| P6-8 | Are stored prices VAT-inclusive?                          | **No: stored excluding VAT, shown as "KES 3,500 + VAT" with an indicative inclusive figure.** Real tax lines are computed in Phases 7 and 11.                                                                                                                                                           | Most customers are businesses that reclaim VAT (B2B norm, ADR-014). One stored figure avoids rounding drift. ADR-017's advisor review may still change the display, not the data.                                                                                                                            |

## 7. Risks

- **Opening anonymous access** is the first time unauthenticated callers reach the database. Mitigation:
  - P6-1 (no identity at all) and E1/E2 (exhaustive visibility tables plus the T2 suite);
  - rate limits and length limits (E8);
  - public DTOs separate from staff DTOs.
- **Full-text search quality** with English stemming on Kenyan terms ("M-Pesa", "Safaricom", "CCTV"). Mitigation: the search vector includes the name unstemmed (`simple`) as well as stemmed (`english`), and E4 ranking tests use such terms.
- **The PR #6 overlap** in `prisma.factory.ts` and `ci.yml` is small. If #6 merges first, I merge `main` into the phase branch before opening the Phase 6 PR.
