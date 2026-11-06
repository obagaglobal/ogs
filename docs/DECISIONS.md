# Architecture Decision Records

ADR-001 … ADR-008 were made during Phase 1 and are listed in [`architecture/overview.md` §7](architecture/overview.md#7-architecture-decisions).

ADR-027 … ADR-031 record the Phase 2 implementation decisions P2-1 … P2-5, approved with the [Phase 2 plan](plans/phase-2-tenancy.md) on 2026-11-05.

ADR-009 … ADR-026 record the owner's answers to decisions D-1 … D-18 of the [Architecture Review](architecture/review.md). They were **accepted on 2026-11-05**, with every recommendation taken as written. The review holds the full reasoning. Each entry below gives the decision and the reason in short form.

| ADR | Review ID | Title                                           | Status                                              |
| --- | --------- | ----------------------------------------------- | --------------------------------------------------- |
| 007 | —         | Multi-tenancy model (Phase 1 placeholder)       | **Superseded** by ADR-009, ADR-010 and review §5–§6 |
| 009 | D-1       | Ownership of individual-customer records        | Accepted                                            |
| 010 | D-2       | Cross-tenant access for assigned providers      | Accepted                                            |
| 011 | D-3       | Session model                                   | Accepted                                            |
| 012 | D-4       | `Service` vs `ServiceListing`                   | Accepted                                            |
| 013 | D-5       | Who chooses the provider                        | Accepted                                            |
| 014 | D-6       | Prepay vs postpay                               | Accepted                                            |
| 015 | D-7       | Roadmap adjustments                             | Accepted                                            |
| 016 | D-8       | Revenue model                                   | Accepted                                            |
| 017 | D-9       | Tax                                             | Accepted, **pending advisor confirmation**          |
| 018 | D-10      | Data protection                                 | Accepted, **pending legal confirmation**            |
| 019 | D-11      | File storage                                    | Accepted                                            |
| 020 | D-12      | Monorepo tooling                                | Accepted (confirms ADR-001)                         |
| 021 | D-13      | Public catalogue SEO                            | Accepted                                            |
| 022 | D-14      | Accent colour & brand                           | Accepted, **colour still to be chosen**             |
| 023 | D-15      | Hosting target                                  | Accepted, **choice due by Phase 15**                |
| 024 | D-16      | Languages                                       | Accepted                                            |
| 025 | D-17      | SMS / email providers                           | Accepted, **vendors chosen at integration**         |
| 026 | D-18      | Prisma + RLS performance                        | Accepted                                            |
| 027 | P2-1      | Phase 2 proves isolation at DB + service layers | Accepted                                            |
| 028 | P2-2      | FileService and MinIO move to Phase 3           | Accepted                                            |
| 029 | P2-3      | URI versioning (`/api/v1`) from Phase 2         | Accepted                                            |
| 030 | P2-4      | Minimal `app_user` table in Phase 2             | Accepted                                            |
| 031 | P2-5      | UUIDv7 from PostgreSQL 18 `uuidv7()`            | Accepted                                            |

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

---

## Also accepted with the review

- The "API Gateway" in spec §15 is NGINX as a reverse proxy. There is no separate gateway service.
- Organisation employees get ticket-submission permission by default, and organisation admins may revoke it.
