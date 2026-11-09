# Architecture Decision Records

ADR-001 … ADR-008 were made during Phase 1 and are listed in [`architecture/overview.md` §14](architecture/overview.md#14-architecture-decisions).

ADR-063 … ADR-074 record the Phase 9 decisions P9-1 … P9-12, approved with the [Phase 9 plan](plans/phase-9-assignment.md) on 2026-11-09. The owner required that providers never see internal notes, customer billing details or other customers' data (ADR-063, ADR-064).

ADR-027 … ADR-031 record the Phase 2 implementation decisions P2-1 … P2-5, approved with the [Phase 2 plan](plans/phase-2-tenancy.md) on 2026-11-05.

ADR-056 … ADR-062 record the Phase 8 decisions P8-1 … P8-7, approved with the [Phase 8 plan](plans/phase-8-ticketing.md) on 2026-11-07. The owner added that internal notes must never reach customers, tested on every customer page and API (ADR-059).

ADR-055 records the Phase 6b visual direction, approved with the [Phase 6b plan](plans/phase-6b-design-system.md) on 2026-11-06.

ADR-046 … ADR-054 record the Phase 7 decisions P7-1 … P7-9, approved with the [Phase 7 plan](plans/phase-7-requests-orders.md) on 2026-11-06. The Phase 7 delivery refinements ([Phase 7 plan](plans/phase-7-requests-orders.md#8-delivery-notes-2026-11-06) §8: no DRAFT request state, payment completion in one transaction, customer-created orders checked by a trigger, personal records only in the personal workspace, cancellation rules, billing terms edited from the order page) were approved by the owner on 2026-11-07 after PR #8 was merged.

ADR-038 … ADR-045 record the Phase 6 decisions P6-1 … P6-8, approved with the [Phase 6 plan](plans/phase-6-catalogue.md) on 2026-11-06.

ADR-033 … ADR-037 record the Phase 5 delivery refinements ([Phase 5 plan](plans/phase-5-providers.md) §8), approved by the owner on 2026-11-06 after PR #4 was merged.

ADR-009 … ADR-026 record the owner's answers to decisions D-1 … D-18 of the [Architecture Review](architecture/review.md). They were **accepted on 2026-11-05**, with every recommendation taken as written. The review holds the full reasoning. Each entry below gives the decision and the reason in short form.

| ADR | Review ID | Title                                                            | Status                                              |
| --- | --------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| 007 | —         | Multi-tenancy model (Phase 1 placeholder)                        | **Superseded** by ADR-009, ADR-010 and review §5–§6 |
| 009 | D-1       | Ownership of individual-customer records                         | Accepted                                            |
| 010 | D-2       | Cross-tenant access for assigned providers                       | Accepted                                            |
| 011 | D-3       | Session model                                                    | Accepted                                            |
| 012 | D-4       | `Service` vs `ServiceListing`                                    | Accepted                                            |
| 013 | D-5       | Who chooses the provider                                         | Accepted                                            |
| 014 | D-6       | Prepay vs postpay                                                | Accepted                                            |
| 015 | D-7       | Roadmap adjustments                                              | Accepted                                            |
| 016 | D-8       | Revenue model                                                    | Accepted                                            |
| 017 | D-9       | Tax                                                              | Accepted, **pending advisor confirmation**          |
| 018 | D-10      | Data protection                                                  | Accepted, **pending legal confirmation**            |
| 019 | D-11      | File storage                                                     | Accepted                                            |
| 020 | D-12      | Monorepo tooling                                                 | Accepted (confirms ADR-001)                         |
| 021 | D-13      | Public catalogue SEO                                             | Accepted                                            |
| 022 | D-14      | Accent colour & brand                                            | Accepted, **colour still to be chosen**             |
| 023 | D-15      | Hosting target                                                   | Accepted, **choice due by Phase 15**                |
| 024 | D-16      | Languages                                                        | Accepted                                            |
| 025 | D-17      | SMS / email providers                                            | Accepted, **vendors chosen at integration**         |
| 026 | D-18      | Prisma + RLS performance                                         | Accepted                                            |
| 027 | P2-1      | Phase 2 proves isolation at DB + service layers                  | Accepted                                            |
| 028 | P2-2      | FileService and MinIO move to Phase 3                            | Accepted                                            |
| 029 | P2-3      | URI versioning (`/api/v1`) from Phase 2                          | Accepted                                            |
| 030 | P2-4      | Minimal `app_user` table in Phase 2                              | Accepted                                            |
| 031 | P2-5      | UUIDv7 from PostgreSQL 18 `uuidv7()`                             | Accepted                                            |
| 032 | —         | Development object store: SeaweedFS instead of MinIO             | Accepted                                            |
| 033 | P5 §8     | Provider decisions: review route, approve per kind               | Accepted                                            |
| 034 | P5 §8     | Provider file purposes (identity, certificate, company document) | Accepted                                            |
| 035 | P5 §8     | Eligibility is a dispatch tool (`ticket.assign`, Kenya time)     | Accepted                                            |
| 036 | P5 §8     | One weekly range per day in the web editor                       | Accepted                                            |
| 037 | P5 §8     | Retention marker on rejected individual providers                | Accepted                                            |
| 038 | P6-1      | Anonymous catalogue access: a context with no identity           | Accepted                                            |
| 039 | P6-2      | Pricing models                                                   | Accepted                                            |
| 040 | P6-3      | Append-only price versions                                       | Accepted                                            |
| 041 | P6-4      | Service audience                                                 | Accepted                                            |
| 042 | P6-5      | Delivery mode, channels and required skills                      | Accepted                                            |
| 043 | P6-6      | Service lifecycle                                                | Accepted                                            |
| 044 | P6-7      | SEO in Phase 6                                                   | Accepted                                            |
| 045 | P6-8      | Prices exclude VAT                                               | Accepted                                            |
| 046 | P7-1      | Requests and orders are separate records                         | Accepted                                            |
| 047 | P7-2      | Who can request in Phase 7                                       | Accepted                                            |
| 048 | P7-3      | Rejected or expired quotations return to "Awaiting quotation"    | Accepted                                            |
| 049 | P7-4      | Manual payments before Phase 11                                  | Accepted                                            |
| 050 | P7-5      | Organisation payment terms                                       | Accepted                                            |
| 051 | P7-6      | VAT per line                                                     | Accepted                                            |
| 052 | P7-7      | Idempotency keys                                                 | Accepted                                            |
| 053 | P7-8      | Document numbers                                                 | Accepted                                            |
| 054 | P7-9      | Who in an organisation sees which requests                       | Accepted                                            |
| 055 | 6b        | Visual direction: Kitenge signal                                 | Accepted                                            |
| 056 | P8-1      | One OGS staff owner per ticket                                   | Accepted                                            |
| 057 | P8-2      | Reopen within 7 days, then auto-close                            | Accepted                                            |
| 058 | P8-3      | Customers choose urgency, staff set priority                     | Accepted                                            |
| 059 | P8-5      | Internal notes in their own table, staff-only by RLS             | Accepted                                            |
| 060 | P8-4      | Who in an organisation sees which tickets                        | Accepted                                            |
| 061 | P8-6      | Tickets on behalf of a customer                                  | Accepted                                            |
| 062 | P8-7      | Service requests on behalf of a customer                         | Accepted                                            |
| 063 | P9-1      | Provider grants live on the job tables only                      | Accepted                                            |
| 064 | P9-2      | Internal notes: OGS staff only, never providers                  | Accepted                                            |
| 065 | P9-3      | A `provider` DB context; company and internal technician access  | Accepted                                            |
| 066 | P9-4      | One offer at a time, 2-hour default window, reasons for declines | Accepted                                            |
| 067 | P9-5      | A company accepts and names its technician in one step           | Accepted                                            |
| 068 | P9-6      | Internal technicians use the same offer flow                     | Accepted                                            |
| 069 | P9-7      | Who confirms completion; 7-day auto-confirm                      | Accepted                                            |
| 070 | P9-8      | The customer sees a first name and a label                       | Accepted                                            |
| 071 | P9-9      | Notes and photos belong to an assignment                         | Accepted                                            |
| 072 | P9-10     | Orders gain IN_DELIVERY and COMPLETED                            | Accepted                                            |
| 073 | P9-11     | Eligibility enforced in the database; availability scored        | Accepted                                            |
| 074 | P9-12     | Offline mode in Phase 12, live map in Phase 15                   | Accepted, **owner to confirm against spec §22**     |

---

## ADR-009 — Ownership of individual-customer records (D-1)

**Decision:** Commercial records of individual customers (requests, orders, tickets, invoices) are **user-owned**: `customer_user_id` is set and `customer_tenant_id` is NULL. A CHECK constraint requires exactly one of `customer_tenant_id` and `customer_user_id`. RLS allows access when the row belongs to the current user or to the current tenant. No "personal tenant" is created for individuals.
**Why:** Follows the spec's rule not to assign a tenant to every record, and avoids fake one-person tenants.

## ADR-010 — Cross-tenant access for assigned providers (D-2)

**Decision:** Tenant-owned rows have an RLS policy of `tenant_id = ctx.tenant` **OR** an active `ServiceAssignment` for that row whose `assignee_tenant_id = ctx.tenant`. Technicians must also match `assignee_user_id = ctx.user`. API DTOs further restrict what providers see: no customer billing data and no internal notes. OGS staff get a branch gated by `app.is_platform = true`. The server sets that flag only after a permission check, and every platform read of tenant data is audited.
**Why:** Providers need access to the work assigned to them while every other row stays strictly isolated.

## ADR-011 — Session model (D-3)

**Decision:** Sessions are stored server-side in Redis. The browser holds an httpOnly, Secure, SameSite=Lax cookie, and state-changing requests carry a CSRF token. JWTs are never stored in localStorage.
**Why:** Sessions can be revoked, and this is the simplest secure option for a first-party SPA.

## ADR-012 — `Service` vs `ServiceListing` (D-4)

**Decision:** A `Service` is an OGS catalogue item, which is what customers buy. A `ServiceListing` is one provider's offer and rate for a Service. Listings are used for eligibility and payouts and are not shown as separate products in v1.
**Why:** OGS controls the customer experience.

## ADR-013 — Who chooses the provider (D-5)

**Decision:** OGS assigns the provider. Customers cannot choose one in v1, though public provider profiles may come later. v1 dispatch is manual assignment helped by ranked suggestions, and auto-dispatch comes later.
**Why:** Spec §7 step 11, and OGS owns the customer relationship.

## ADR-014 — Prepay vs postpay (D-6)

**Decision:** Individuals prepay, or pay after accepting a quotation. Approved organisations may be postpaid on contract or credit terms, and their orders skip "Awaiting payment".
**Why:** This matches B2B norms in Kenya.

## ADR-015 — Roadmap adjustments (D-7)

**Decision:** All five adjustments are approved:

1. AuditService, the transactional outbox with a BullMQ worker skeleton, and FileService (private object storage plus metadata) move into Phases 2–3.
2. Minimal email notifications (verification, password reset) are part of Phase 3.
3. In Phase 7, finance records payments manually through the `Payment` interface. M-Pesa follows in Phase 11.
4. A minimal web shell (login, workspace switcher) is built from Phase 3.
5. CI runs from Phase 1, and isolation tests gate every merge from Phase 2.

**Why:** Without these changes, earlier phases would depend on capabilities scheduled for later ones.

## ADR-016 — Revenue model (D-8)

**Decision:** OGS is the merchant of record. It invoices the customer and pays providers net of a configurable commission, set per service or per provider. Provider rates are cost inputs, and OGS sets the customer price.
**Why:** The Phase 11 data model needs this settled, and it resolves contradiction 5 in the review.

## ADR-017 — Tax (D-9)

**Decision:** Invoices carry 16% VAT. Invoices integrate with KRA eTIMS e-invoicing. Withholding tax is applied to provider payouts where it applies.
**Follow-up:** A Kenyan tax advisor must confirm before Phase 11 is finalised.
**Why:** Kenyan B2B invoicing legally requires this, and the spec says nothing about it.

## ADR-018 — Data protection (D-10)

**Decision:** Register with the ODPC. Define a lawful basis for each processing activity, a retention schedule and a DSAR process. Carry out a DPIA for provider KYC data. Host data only where a lawyer confirms it is compliant.
**Follow-up:** Legal review before production (Phase 15–16).
**Why:** Kenya's Data Protection Act 2019.

## ADR-019 — File storage (D-11)

**Decision:** Files go in S3-compatible object storage, using MinIO in development. Buckets are private, downloads go through short-lived signed URLs from an authorised endpoint, and files stay quarantined until scanned. The production provider is chosen in Phase 16.
**Why:** Local disk is not safe in production.

## ADR-020 — Monorepo tooling (D-12)

**Decision:** pnpm workspaces, with Turborepo as an option later. This confirms ADR-001.
**Why:** Simple on Windows and works well with Docker.

## ADR-021 — Public catalogue SEO (D-13)

**Decision:** The frontend stays a Vite SPA. Phase 6 adds prerendering for public catalogue pages if SEO matters.
**Why:** The spec mandates Vite, and a marketplace needs SEO.

## ADR-022 — Accent colour & brand (D-14)

**Decision:** The UI uses one accent colour, chosen with the ObagaGlobal brand owner from options such as deep emerald, copper or saffron. Blue and purple must not dominate.
**Follow-up:** The colour has not been picked. It is needed before UI polish work starts.

## ADR-023 — Hosting target (D-15)

**Decision:** The hosting choice (a Kenyan or regional cloud, AWS af-south-1, etc.) is due by Phase 15.
**Why:** It affects data residency (ADR-018), latency and backups.

## ADR-024 — Languages (D-16)

**Decision:** v1 is in English, with all strings i18n-ready. Swahili comes next.

## ADR-025 — SMS / email providers (D-17)

**Decision:** SMS (e.g. Africa's Talking) and transactional email sit behind provider interfaces. Vendors are chosen when each integration is built.

## ADR-026 — Prisma + RLS performance (D-18)

**Decision:** Accept the overhead of one interactive transaction per unit of work, which is needed to set transaction-local context. Revisit only if metrics show a problem.
**Why:** Correctness comes first, and the spec mandates both Prisma and RLS.

## ADR-027 — Phase 2 proves isolation at the database and service layers (P2-1)

**Decision:** Phase 2 proves isolation with raw SQL as `ogs_app` and through `TenantDb` and services. The API-level isolation suite (review §13, Phase 2 row) moves to Phase 3, once real sessions exist.
**Why:** The only alternative was a test-only "fake auth" header in production code. Database-level tests are also the stronger guarantee.

## ADR-028 — FileService and MinIO move to Phase 3 (P2-2)

**Decision:** File storage (ADR-019) is built in Phase 3, not Phase 2.
**Why:** It keeps Phase 2 focused on isolation. The first upload (provider documents, Phase 5) is still well ahead.

## ADR-029 — URI versioning from Phase 2 (P2-3)

**Decision:** Every route is served under `/api/v1/` (Nest URI versioning, default version 1). `/api/health` became `/api/v1/health`.
**Why:** Free before any client depends on the API, breaking afterwards.

## ADR-030 — Minimal `app_user` in Phase 2 (P2-4)

**Decision:** Phase 2 adds `app_user` with id, email (citext, unique), status and timestamps only. Phase 3 adds credentials, profile and MFA.
**Why:** Memberships and user-owned RLS cannot be tested without users.

## ADR-031 — UUIDv7 from PostgreSQL 18 (P2-5)

**Decision:** Primary keys default to PostgreSQL 18's built-in `uuidv7()`. The application may still supply its own UUIDv7 when it needs an id before inserting.
**Why:** Time-ordered ids with no extra dependency. This is a small change from the review's "generated in app".

## ADR-032 — Development object store: SeaweedFS instead of MinIO

**Context:** ADR-019 chose S3-compatible object storage, with MinIO for development. In November 2026 MinIO's container images could not be pulled any more: Docker Hub reports the repository does not exist, and quay.io answers 401.
**Decision:** Local development and CI run the SeaweedFS S3 gateway (`chrislusf/seaweedfs`, pinned, Apache-2.0) as the `objectstore` Compose service. The application only uses the S3 API through `@aws-sdk/client-s3`.
**Consequences:** No code depends on the product. Any S3-compatible service can replace it, and the production provider is still chosen in Phase 16 (ADR-019). Phase 3 plan §3.3 says "MinIO"; read it as "the development S3 service".

## ADR-033 — Provider decisions: review permission on the route, approve permission per kind

**Decision:** Provider decision and suspension routes (`/platform/provider-applications/:id/*`, `/platform/providers/:id/suspend|reactivate`) require an elevation with `platform.tenant.review`. The service then requires the approve permission of the provider's kind: `platform.tenant.approve` for provider companies, `platform.provider.approve` for individuals.
**Why:** One route serves both kinds, and a compliance officer can review an application without being able to decide it.

## ADR-034 — Provider file purposes

**Decision:** Three purposes replace the Phase 3 placeholder `provider.document`:

- `provider.identity`: government ID; personal files only;
- `provider.certificate`: skills evidence; personal or company, needs `provider.profile.manage` in a company;
- `provider.company_document`: registration and tax documents; company only, needs `provider.profile.manage`.

A restricted (pending) workspace may upload application evidence only.
**Why:** Each purpose gets its own owner and permission rule, and identity documents can be gated to the owner and entitled, elevated staff (P5-5).

## ADR-035 — Eligibility is a dispatch tool

**Decision:** `GET /platform/providers/eligible` requires an elevation with `ticket.assign` (operations, service and ICT support managers). Availability reasons are written in Kenya time (Africa/Nairobi).
**Why:** Eligibility exists to choose who gets work (Phase 9 dispatch), so it belongs to the people who assign work. Staff and providers both think in local time.

## ADR-036 — One weekly range per day in the web editor

**Decision:** The web availability editor offers one working-hours range per weekday. The API and schema accept several ranges per day.
**Why:** It keeps the editor simple. Split shifts can be added to the UI later without a migration.

## ADR-037 — Retention marker on rejected individual providers

**Decision:** Rejecting an individual provider sets `provider.retain_until` to 24 months after the decision. The job that deletes expired applications and their documents stays in Phase 15/16, with the data-protection work (ADR-018).
**Why:** The marker is recorded from the first rejection, so the later deletion job has accurate dates to act on.

## ADR-038 — Anonymous catalogue access: a context with no identity (P6-1)

**Decision:** Signed-out visitors read through an `anonymous` database context that sets no identity at all (no user, tenant, platform flag, job or actor kind). Only the catalogue's SELECT policies are context-free ("published, in an active category"). No separate database role or connection pool.
**Why:** Every existing policy already fails closed without a context, and that is the most-tested state in the system. A new actor kind would have opened the four policies that accept "any actor".

## ADR-039 — Pricing models (P6-2)

**Decision:** v1 prices are `FIXED`, `PER_UNIT` (hour, device, user, visit, cabling point, with a minimum quantity), `FROM` (indicative, finalised by quotation) and `QUOTE` (no public price). Amounts are integer minor units in KES. Recurring pricing waits for managed contracts.
**Why:** It covers how ad-hoc ICT work is sold in Kenya and maps onto Phase 7's fixed-price and quotation paths.

## ADR-040 — Append-only price versions (P6-3)

**Decision:** A price change adds a `service_price` version; a database trigger rejects UPDATE and DELETE. The current price is the latest version. Phase 7 snapshots the price on each request.
**Why:** "What did this cost on a given date?" always has an answer, for audit and finance.

## ADR-041 — Service audience (P6-4)

**Decision:** A service's `audience` is all, organisations or individuals. Every published service is visible to everyone; the audience is a label now and is enforced when requesting (Phase 7).
**Why:** B2B-only offers stay discoverable and indexable.

## ADR-042 — Delivery mode, channels and required skills (P6-5)

**Decision:** Each service has a delivery mode (on site, remote, both), allowed channels (OGS technicians, individual providers, provider companies) and required skills with a minimum experience band. Eligibility accepts a service and applies all of them.
**Why:** It is exactly what dispatch needs (review §10), as plain columns rather than a separate eligibility table.

## ADR-043 — Service lifecycle (P6-6)

**Decision:** DRAFT → PUBLISHED → RETIRED, with restore to DRAFT. One permission (`platform.catalogue.manage`) under elevation; no second approver; every change audited. Service slugs are immutable once published, category slugs from creation.
**Why:** Simple and safe: staff are MFA-enforced and elevated, and stable slugs keep links and search rankings.

## ADR-044 — SEO in Phase 6 (P6-7)

**Decision:** The API serves `/api/v1/catalogue/sitemap.xml`; the web app ships `robots.txt` and sets per-page title, description, canonical link and JSON-LD. Prerendering is deferred to deployment (Phase 15), which also writes the absolute sitemap URL into `robots.txt`.
**Why:** Search engines render JavaScript pages; the deploy pipeline does not exist yet.

## ADR-045 — Prices exclude VAT (P6-8)

**Decision:** Prices are stored and shown excluding VAT ("KES 3,500 + VAT"), with an indicative VAT-inclusive figure at 16%. Real tax lines are computed in Phases 7 and 11.
**Why:** Most customers reclaim VAT (B2B), and one stored figure avoids rounding drift. The ADR-017 advisor review may change the display, not the data.

## ADR-046 — Requests and orders are separate records (P7-1)

**Decision:** `service_request` holds the customer's intent and the negotiation; `service_order` is the commercial commitment, created when the price is agreed (staff accept at the catalogue price, or the customer accepts a quotation).
**Why:** It matches review §4.2. Dispatch (Phase 9) and invoicing (Phase 11) work on orders, and requests that never become orders stay out of finance.

## ADR-047 — Who can request in Phase 7 (P7-2)

**Decision:** Individuals from their personal workspace, and organisation members with `request.create`. Staff ordering on behalf of a customer waits for the Phase 8 helpdesk.
**Why:** It covers both customer types without a staff impersonation path, which needs its own audit design.

## ADR-048 — Rejected or expired quotations return to "Awaiting quotation" (P7-3)

**Decision:** A rejected (with a reason) or expired quotation sends the request back to "Awaiting quotation" so staff can revise it. Either side can cancel before ordering. This departs from the review's diagram, which cancels the request.
**Why:** Most rejections are "too expensive, can you adjust?"; auto-cancelling would make customers start again.

## ADR-049 — Manual payments before Phase 11 (P7-4)

**Decision:** Finance records bank-transfer and M-Pesa paybill payments against an order. Partial payments are allowed; overpayment is refused; references are unique per method; payments are append-only.
**Why:** ADR-015 item 3. M-Pesa integration (Phase 11) adds another way to record a payment without changing order logic.

## ADR-050 — Organisation payment terms (P7-5)

**Decision:** Finance sets PREPAY (default) or POSTPAID with net days per organisation. Each order copies the terms when it is created; postpaid orders skip "Awaiting payment". Individuals always prepay.
**Why:** ADR-014. Copying the terms keeps existing orders stable when the terms change.

## ADR-051 — VAT per line (P7-6)

**Decision:** VAT is 16% of each line's VAT-exclusive amount, rounded half up to the cent and stored per line; totals are sums of stored values. One rate constant.
**Why:** Invoices need line-level VAT, and stored values avoid recomputation drift. ADR-017 still awaits the tax advisor; only the constant would change.

## ADR-052 — Idempotency keys (P7-7)

**Decision:** Submitting a request, accepting a quotation and recording a payment require an `Idempotency-Key` header (UUID). The key, a hash of the body and the response are stored for 24 hours in the same transaction as the change. A replay returns the stored response; the same key with a different body gets 422.
**Why:** Review §11 and §13. The same mechanism will serve Phase 11 payment callbacks.

## ADR-053 — Document numbers (P7-8)

**Decision:** Yearly counters per document type give `REQ-2026-000123`, `QUO-…` and `ORD-…`, taken from a counter row in the same transaction (Africa/Nairobi year).
**Why:** Customers and finance quote these numbers; a rolled-back transaction gives its number back.

## ADR-054 — Who in an organisation sees which requests (P7-9)

**Decision:** Members with `request.read_all` (administrators) see all of the organisation's requests; other members see their own. RLS enforces the tenant boundary, and the service layer enforces the member/admin split. A person's own requests are visible only from their personal workspace.
**Why:** It matches the permission catalogue and the review matrix.

## ADR-055 — Visual direction: Kitenge signal (Phase 6b)

**Decision:** OGS uses one token-driven design system, "Kitenge signal":

- **Colour:** ink on paper, with saffron as the single accent for the key action, focus and "live". Every colour is a CSS variable in `apps/web/src/styles/tokens.css`, in light and dark. Raw colours anywhere else fail lint (`ogs/no-raw-colours`) and a unit test, and a unit test checks the WCAG contrast of every pair in use.
- **Type:** Space Grotesk for headings, Inter for body text, and JetBrains Mono with tabular figures for money ("KES 84,500"), references and IDs. The fonts are self-hosted Latin woff2 files.
- **Shape:** 4 px radius, 1 px hairlines, and a shadow only on floating surfaces.
- **Focus:** a two-tone ring, an ink line inside saffron, because saffron alone is 2.07:1 on paper.
- **Themes:** light, dark and system, remembered per browser. `public/theme-init.js` applies the theme before first paint.
- **Signature:** an original geometric kitenge motif (`<KitengeMotif />`, decorative). It appears only in the public header strip and hero, empty states, the page loader, sign-in/sign-up and marketing dividers. It never goes behind text, in tables or in forms, and appears at most once per signed-in page; e2e tests enforce this.
- **Voice:** "Karibu" on first visit and sign-in, and "Habari {name}" on dashboards. All other text is plain sentence-case English through `t()`.

**Why:**

- It gives OGS a recognisably East African identity without decoration getting in the way of work screens.
- It meets WCAG 2.2 AA by construction (tokens, contrast tests, axe in CI).
- It stays fast on mid-range phones over mobile data: the Lighthouse CI target on `/services` is performance ≥ 85 and accessibility ≥ 95.

## ADR-056 — One OGS staff owner per ticket (P8-1)

**Decision:** A ticket has at most one assignee, an OGS staff member. Any agent who can work tickets (`ticket.comment`) may "Take" one; assigning someone else or unassigning needs `ticket.assign`, and only active PLATFORM members holding `ticket.comment` can be assignees. Dispatching work to technicians or providers stays a separate `ServiceAssignment` (Phase 9).
**Why:** Helpdesk agents lack `ticket.assign` but must pick up work, and keeping the helpdesk owner apart from field dispatch avoids a redesign in Phase 9.

## ADR-057 — Reopen within 7 days, then auto-close (P8-2)

**Decision:** The customer may reopen a resolved ticket for 7 days, with a reason; staff may reopen it until it is closed. After 7 days it closes automatically (a delayed event plus an hourly sweep, both idempotent). Accepting the resolution closes it at once. CLOSED is final; a follow-up is a new ticket that can point to the old one (`related_ticket_id`).
**Why:** A clear window meets review §13 ("reopen policy enforced"), keeps reopen counts meaningful for Phase 10 and 13, and stops old tickets reviving.

## ADR-058 — Customers choose urgency, staff set priority (P8-3)

**Decision:** Customers pick an urgency (low, normal, high, critical) with a plain description of each. Staff set the priority (P1–P4) at triage, starting from a suggestion based on urgency, and may change it later with a reason (an internal activity row). Both values are stored.
**Why:** Customers tend to over-rate urgency, and Phase 10 SLA targets key on the priority staff confirmed.

## ADR-059 — Internal notes in their own table, staff-only by RLS (P8-5)

**Decision:** Internal notes live in `ticket_internal_note`, whose only RLS policy is `app.is_platform()`. They are not a visibility flag on comments. Activity rows carry `PUBLIC` or `INTERNAL`, and customers' RLS returns `PUBLIC` rows only. Note files belong to the PLATFORM tenant. Audit rows of internal commands carry no tenant. Customer responses are parsed through schemas with no internal field, and ticket emails carry no message text. On the owner's instruction, tests cover every customer API route and every customer page, using a canary note.
**Why:** A visibility flag depends on every query filtering correctly. A separate table makes the leak impossible at the database layer (review §11, "internal notes leak").

## ADR-060 — Who in an organisation sees which tickets (P8-4)

**Decision:** Members see their own tickets. `ticket.read_department` (not granted by default; admins add it to custom roles) adds tickets from the member's department, snapshotted on the ticket when it is opened. `ticket.read_all` (org admins) shows all of them. Reopening, accepting and withdrawing are for the requester and `ticket.read_all` holders. A person's own tickets are visible only from their personal workspace.
**Why:** It delivers the review matrix's "own/dept" with the ADR-054 pattern. RLS keeps the tenant boundary and the service layer applies the member split.

## ADR-061 — Tickets on behalf of a customer (P8-6)

**Decision:** Elevated staff with `ticket.create` open tickets for an active organisation member or an active person, found by organisation name or exact email (`GET /platform/customers`). The ticket records `on_behalf`, `created_by` (the staff member) and the channel (phone, email, walk-in, WhatsApp). The customer is emailed and sees "OGS opened this ticket for you".
**Why:** Phone and walk-in support is common in Kenya. The flag, channel and audit row answer "who raised this?".

## ADR-062 — Service requests on behalf of a customer (P8-7)

**Decision:** Elevated staff with the new `platform.request.on_behalf` (helpdesk, customer support, service manager, super admin) submit a service request for a customer. The same Phase 7 rules apply: price snapshot, audience, minimum quantity and region. `created_by` is the customer's requester, so they see it as theirs, and `entered_by` records the staff member. A trigger lets only elevated staff, acting as themselves, insert an on-behalf request. Quotations are still accepted by the customer.
**Why:** ADR-047 deferred this until the helpdesk and a customer lookup existed. The customer keeps the commercial decision.

## ADR-063 — Provider grants live on the job tables only (P9-1)

**Decision:** Providers get no RLS policy on orders, requests, quotations, payments, tickets, comments, attachments or any other customer table. What they may know is copied onto the job when it is dispatched: the brief OGS writes, the site address and contact, the county and the requirements. Job tables grant access through an ACTIVE assignment (or a PENDING offer, which shows the area only). This narrows ADR-010.
**Why:** Row-level security cannot hide columns; a branch on `service_order` would expose totals to any query that forgot a DTO. A copied brief makes "what a provider sees" one explicit list (plan §2.5).

## ADR-064 — Internal notes: OGS staff only, never providers (P9-2)

**Decision:** `ticket.internal_note` and `ticket.comment` are removed from provider-company roles and from the PROVIDER_COMPANY kind. Internal OGS technicians may read the internal notes of the ticket behind their own ACTIVE job (a narrow RLS branch); no provider branch exists. This overrides the review §8 matrix.
**Why:** The owner's rule; internal technicians are OGS employees and often need the helpdesk's notes.

## ADR-065 — A `provider` DB context; company and internal technician access (P9-3)

**Decision:** The Provider workspace runs in `DbContext { kind: 'provider' }`, which sets `app.provider_id` (transaction-local); `app.owns_customer_row` matches personal rows only when it is unset. Company members use their workspace; `app.holds_permission(code)` lets a company dispatcher see all its jobs and a technician only those naming them. Internal technicians use the non-elevated PLATFORM workspace and see only their own jobs.
**Why:** The provider and personal capacities used to share one `user` context; separating them stops jobs and personal orders mixing. Field work needs no cross-tenant elevation.

## ADR-066 — One offer at a time, 2-hour default window, reasons for declines (P9-4)

**Decision:** A dispatcher offers a job to one eligible assignee at a time (partial unique index). Windows are 30 min, 1 h, 2 h (default), 4 h or 24 h. Declines need a reason code, plus text for "other". Decline, expiry (delayed event plus sweep) and withdrawal return the job to the queue.
**Why:** Review §10 and ADR-013 (manual dispatch). Notifications are email-only until Phase 12, so short windows would expire unseen.

## ADR-067 — A company accepts and names its technician in one step (P9-5)

**Decision:** A company member with `assignment.respond` accepts and picks an active member with `ticket.update_progress`; there is no second acceptance by the technician. A company dispatcher (`ticket.assign`) may change the technician with a reason (audited); the old technician's assignment ends and so does their access.
**Why:** Simpler, and the company already controls its staff.

## ADR-068 — Internal technicians use the same offer flow (P9-6)

**Decision:** OGS technicians accept or decline offers like providers. They are eligible as active PLATFORM members holding `assignment.respond` and `ticket.update_progress`; skills and coverage for staff come with Phase 14 admin.
**Why:** One flow, one set of tests, one audit trail.

## ADR-069 — Who confirms completion; 7-day auto-confirm (P9-7)

**Decision:** Order jobs: the customer (the requester, admins with `request.read_all`, holders of `ticket.confirm_completion`, individuals for their own) confirms or reports a problem (back to work with the same assignee). Reports confirm themselves after 7 days. A service manager may confirm on the customer's behalf with a reason. Ticket jobs: the customer's "Accept resolution" (ADR-057) also confirms the job.
**Why:** Review §9 and §8; 7 days mirrors ADR-057; ticket customers are never asked twice.

## ADR-070 — The customer sees a first name and a label (P9-8)

**Decision:** The tracker shows the technician's first name (copied onto the assignment when assigned: an individual provider's first word, otherwise the email-derived first name, as for "Habari") and "OGS technician" or "OGS partner technician". No phone or company name. It polls every 30 s while the job is active.
**Why:** OGS owns the customer relationship (review §1); there is no name field yet.

## ADR-071 — Notes and photos belong to an assignment (P9-9)

**Decision:** Work notes, photos and reports are tied to the assignment that made them. A new assignee does not see the previous one's; staff copy anything useful into the brief. After an assignment ends, the assignee keeps only a "Done" record (number, title, dates, outcome) copied onto the assignment row.
**Why:** The strictest reading of "providers see only what is assigned to them", and easy to test.

## ADR-072 — Orders gain IN_DELIVERY and COMPLETED (P9-10)

**Decision:** The jobs worker moves an order READY_FOR_ASSIGNMENT → IN_DELIVERY when its job is accepted and → COMPLETED when the job is confirmed (immediately after the command, with a `jobs.order_sync` event as the guarantee). Staff may still cancel an order in delivery; its job is cancelled with it. One job per order in v1.
**Why:** Customers, finance (Phase 11) and reports need the order's own state.

## ADR-073 — Eligibility enforced in the database; availability scored (P9-11)

**Decision:** `app.can_take_job` is the one definition (approved, ACTIVE, accepting work, active company tenant, allowed channel, every required skill at the minimum experience, county or remote). Triggers check it on offer, on assignment and on accept; suggestions are filtered through it. Availability is shown and scored, not enforced.
**Why:** "Approved, eligible, non-suspended" becomes a database rule; jobs are often scheduled for later.

## ADR-074 — Offline mode in Phase 12, live map in Phase 15 (P9-12)

**Decision:** Phase 9 delivers the first live tracker (polling) and retry-safe commands with kept drafts. Offline mode (queued actions and photos) follows in Phase 12 with the service worker for web push; the live map follows in Phase 15 with the hosting, map vendor and location-consent decisions (ADR-018, ADR-023).
**Why:** Both need infrastructure that does not exist yet. The master specification is not in the repository; the owner confirms these phase numbers against spec §22.

---

## Also accepted with the review

- The "API Gateway" in spec §15 is NGINX as a reverse proxy. There is no separate gateway service.
- Organisation employees get ticket-submission permission by default, and organisation admins may revoke it.
