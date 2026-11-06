# OGS — Architecture Review (Phase 0 deliverable)

**Status:** APPROVED by the owner on 2026-11-05. All recommendations for D-1 … D-18 were accepted as written. They are recorded as ADR-009 … ADR-026 in [`docs/DECISIONS.md`](../DECISIONS.md).
**Responds to:** OGS Master Specification v1.0, Section 26 ("First task")

> **Notes added on approval (2026-11-05)**
>
> - ADR numbers 001–008 were already used by Phase 1 (see `overview.md` §7). The review's planned "ADR-001 … ADR-018" are therefore recorded as **ADR-009 … ADR-026**, with D-_n_ → ADR-(008 + _n_).
> - Phase 1 is already merged (commit `b01cf24`). Two items in §13's Phase 1 criteria differ from what was built: the endpoint is `GET /api/health`, not `/api/v1/health`, and it is liveness-only (ADR-006), with DB and Redis readiness planned as `/api/health/ready`. Both are carried into the Phase 2 plan. The Phase 1 acceptance record is not rewritten.
> - D-12 (pnpm workspaces) confirms the existing ADR-001.
> - ADR-007 ("Multi-tenancy model", Proposed) is superseded by ADR-009 and ADR-010 together with §5–§6 of this review.

---

## 1. Understanding of OGS

OGS is ObagaGlobal's long-term ICT services platform for Kenya first, then international markets. It combines an ITSM helpdesk, a public service catalogue/marketplace, managed ICT contracts, and a dispatch system that can route work to three delivery channels:

1. **OGS internal teams** (employees and contractors of ObagaGlobal),
2. **Individual external providers** (approved freelancers),
3. **Provider companies** (approved ICT firms with their own technicians).

Whoever delivers, **OGS owns the customer relationship**: the customer orders from OGS, talks to OGS-controlled channels, is invoiced by OGS and complains to OGS. Customers are individuals or organisations; organisations are isolated tenants with their own employees, departments, roles and SLAs. One person has **one identity** and can act in many capacities (e.g., an organisation employee who is also a freelance provider) by switching workspace.

It is a multi-tenant modular monolith (NestJS + PostgreSQL + Prisma), built backend-first in gated phases, with tenant isolation enforced in the application _and_ the database (RLS).

## 2. Major business domains

| #   | Domain                | Owns                                                                | Key modules (spec §15)                                     |
| --- | --------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| D1  | Identity & Access     | users, credentials, sessions, MFA, roles, permissions               | Identity, Authentication, Authorization, Users             |
| D2  | Workspaces & Tenancy  | tenants, memberships, invitations, departments                      | Organisations, Memberships, Organisation approvals         |
| D3  | Provider Network      | provider applications, verification, skills, coverage, availability | Providers, Provider verification, Technicians              |
| D4  | Catalogue             | categories, services, pricing, eligibility                          | Service catalogue                                          |
| D5  | Commerce              | requests, quotations, orders                                        | Service requests, Orders, Quotations                       |
| D6  | Service Delivery      | assignments, dispatch, work logs, evidence                          | Assignments, Technicians                                   |
| D7  | ITSM                  | tickets, comments, activity, SLA, escalation, contracts             | Ticketing, SLA management                                  |
| D8  | Finance               | invoices, payments, refunds, payouts, ledger                        | Invoicing, Payments, Payouts                               |
| D9  | Engagement            | notifications, preferences, reviews, disputes, complaints           | Notifications, Reviews, Disputes                           |
| D10 | Platform & Governance | settings, audit, security events, files, reporting, admin           | File management, Audit, Reporting, Platform administration |

Dependency direction (allowed imports): D1 ← D2 ← D3/D4 ← D5 ← D6/D7 ← D8 ← D9; D10 (audit, files) is a shared kernel any module may call through its public service interface. **No module reads another module's tables directly** — it calls that module's service.

## 3. System architecture

```text
 Browser (React 19 SPA: public site + authenticated workspaces)
        │ HTTPS
   ┌────▼─────┐   NGINX: TLS termination, static assets, /api → api, rate limits, security headers
   │  NGINX   │   ("API gateway" in spec §15 = NGINX reverse proxy; no separate gateway service)
   └────┬─────┘
   ┌────▼──────────────────────── NestJS API (modular monolith) ─────────────────────────┐
   │ Global pipeline: request-id → auth (session) → workspace context resolver →          │
   │   permission guard → validation pipe → controller → module service → TenantDb        │
   │ Modules: identity · orgs · memberships · providers · catalogue · requests · orders · │
   │   assignments · tickets · sla · quotations · invoices · payments · payouts ·         │
   │   notifications · files · reviews · disputes · reporting · audit · admin             │
   │ Cross-cutting: AuditService, FileService, OutboxService, Clock, IdempotencyService   │
   └──────┬───────────────────────────────┬──────────────────────────┬────────────────────┘
          │ Prisma (app role, RLS on)     │ BullMQ                   │ object storage (S3-compatible;
   ┌──────▼───────┐                ┌──────▼──────┐                   │  MinIO locally)
   │ PostgreSQL   │◄──outbox poll──│   Workers   │── email/SMS/M-Pesa/SLA timers/scans
   │ RLS + roles  │                │ (same repo, │
   └──────────────┘                │ separate    │
          ▲                        │ process)    │
          └──── Redis (sessions, rate limits, BullMQ queues, cache) ─┘
```

Design notes:

- **Same codebase, two processes:** `api` (HTTP) and `worker` (BullMQ consumers + schedulers). Both use the same modules; the worker sets tenant context per job exactly like a request.
- **Transactional outbox:** domain events (e.g., `ticket.assigned`) are written to an `OutboxEvent` table in the same transaction as the business change, then dispatched to BullMQ. This gives "no duplicate processing" and "no lost notifications" (spec §12, §21).
- **Object storage**, not the local disk, for files (MinIO in Docker for dev). Spec lists no storage choice — see §14.
- Frontend is one SPA with route-level code-splitting per workspace; public catalogue pages may later need SSR/prerendering for SEO — see §14.

## 4. Proposed database entity relationships

### 4.1 Ownership classes → concrete columns

| Ownership class (spec §13)  | Representation                                                                             | RLS rule                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Platform-owned              | no tenant column; e.g. `ServiceCategory`, `Service`, `Role`, `Permission`, `SystemSetting` | readable per table rules (public catalogue rows readable by anon role); writable only by platform staff |
| Customer-organisation-owned | `tenant_id` → `Tenant(kind=ORGANISATION)`                                                  | `tenant_id = current tenant` OR assignment-based grant (see 6.3)                                        |
| Provider-company-owned      | `tenant_id` → `Tenant(kind=PROVIDER_COMPANY)`                                              | `tenant_id = current tenant`                                                                            |
| User-owned personal         | `owner_user_id` → `User` (no tenant)                                                       | `owner_user_id = current user`                                                                          |

**[DECISION D-1]** How are _individual customers' commercial records_ (requests, orders, tickets, invoices) owned? **Recommendation:** treat them as **user-owned personal** (`customer_user_id`, `tenant_id = NULL`), with a CHECK constraint that exactly one of (`customer_tenant_id`, `customer_user_id`) is set. Reason: matches the spec's "do not assign a tenant to every record", avoids fake one-person tenants, and RLS can still express "owner user OR owning tenant". The alternative ("personal workspace tenant" per individual) is simpler for RLS but contradicts the spec's wording.

### 4.2 Core relationships (summary)

```text
User 1─1 UserProfile, 1─n Credential, 1─n Session, 1─n AuthenticationEvent, 0─1 MfaFactor
Tenant (kind: ORGANISATION | PROVIDER_COMPANY | PLATFORM)
   ├─1 OrganisationProfile / ProviderCompany profile
   ├─n Membership (user_id, tenant_id, status, joined_at, ended_at) ──n MembershipRole ──1 Role
   ├─n Department (org only)  ── Membership.department_id (nullable)
   ├─n Invitation (email, role_ids, token_hash, expires_at, status)
   └─n TenantApproval / OrganisationRegistration (application → decision history)
Role (scope: PLATFORM | ORGANISATION | PROVIDER_COMPANY | PERSONAL, system|custom, tenant_id nullable for custom roles)
   └─n RolePermission ──1 Permission (code e.g. "ticket.assign", platform-defined)
ProviderProfile (user-level: the individual provider identity, 1─1 User)
   ├─n ProviderApplication ─n ProviderDocument ─1 FileMetadata
   ├─n ProviderSkill, ProviderCoverage, ProviderAvailability, ProviderVerification
ProviderCompany (= Tenant kind PROVIDER_COMPANY) same child tables, keyed by tenant_id
Technician = a Membership (in PLATFORM or PROVIDER_COMPANY tenant) with a technician role,
   or an approved ProviderProfile; employment_type: EMPLOYEE | CONTRACTOR
ServiceCategory (tree: parent_id) 1─n Service 1─n ServicePricing (model, amount_minor, currency, unit)
   Service 1─n ServiceRequirement, 1─n ServiceProviderEligibility (provider profile/company/internal)
   ServiceListing = optional provider-specific offer of a Service (see D-4)
ServiceRequest (customer intent) 0─n Quotation ─n QuotationItem
   └─0..1 ServiceOrder (commercial commitment) ─n ServiceAssignment ─n AssignmentHistory
Ticket (support incident) ─n TicketComment(visibility: PUBLIC|INTERNAL) ─n TicketAttachment ─n TicketActivity
   Ticket 0..1 → ServiceOrder / ServiceContract; Ticket ─n ServiceAssignment; Ticket 0..1 Resolution
SlaPolicy (scope: service | contract | organisation) ─n SlaTarget(priority, response_mins, resolution_mins)
   BusinessCalendar ─n Holiday;  Ticket ─n SlaEvent (started, paused, warned, breached, met)
ServiceContract (org, period, SLA policy, recurring billing)
Invoice ─n InvoiceItem; Payment ─n PaymentTransaction (gateway events); Refund; ProviderPayout
FinancialLedgerEntry (double-entry: account, debit_minor, credit_minor, currency, journal_id) — append-only
Notification, NotificationPreference, OutboxEvent, AuditLog, SecurityEvent, FileMetadata,
Review (order/ticket, rating), Dispute, SupportCase/Complaint, SystemSetting, IdempotencyKey
```

**State machines** (`ServiceRequest/Order`, `Ticket`, `ServiceAssignment`, `Payment`, `ProviderApplication`, `OrganisationApproval`) are defined in code as explicit transition tables; every transition writes a history row (`from_status, to_status, actor, reason, at`) in the same transaction.

### 4.3 Database standards applied

UUID v7 primary keys (time-ordered, index-friendly; generated in app) · `timestamptz` in UTC · explicit FKs with `ON DELETE RESTRICT` by default · composite indexes leading with `tenant_id` · unique constraints scoped per tenant (e.g. `(tenant_id, ticket_number)`) · human-readable numbers from per-tenant sequences (`TCK-2026-000123`) · soft delete only on Users, Memberships, Services, Tenants (status + `deleted_at`), never on financial/audit rows · optimistic concurrency `version` column on mutable workflow rows.

## 5. Multi-tenant architecture

- **Shared database, shared schema**, tenant rows separated by explicit ownership columns (approved).
- A **Tenant** row exists for every organisation, provider company and one singleton **PLATFORM** tenant (OGS internal staff live as memberships of the PLATFORM tenant). This gives internal staff the same membership/role model as everyone else.
- **Active context** for each request = `{ userId, workspace: { kind, tenantId | 'personal' }, membershipId, permissions[] }`. The client sends the desired workspace in a header (`X-OGS-Workspace: <tenantId>` or `personal`); the server **validates** an active membership with active tenant status and loads permissions. Invalid → 403. The client value is a _request_, never a fact.
- **Status gates:** a tenant in `PENDING_APPROVAL`, `REJECTED` or `SUSPENDED` resolves to a restricted context (can see its application status only). This enforces "unapproved organisation must not gain operational privileges" in one place.
- **Cross-tenant work** (an organisation's ticket handled by a provider company) is the hardest case — see 6.3.

## 6. PostgreSQL RLS and connection-pooling safety

### 6.1 Roles

| DB role        | Used by                                             | Rights                                                                                         |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ogs_owner`    | migrations only (CI / developer)                    | owns schema; never used at runtime                                                             |
| `ogs_app`      | API + worker                                        | DML on business tables; **NOBYPASSRLS**; not owner; INSERT-only on `audit_log`, `ledger_entry` |
| `ogs_readonly` | reporting/BI later                                  | SELECT through RLS                                                                             |
| `ogs_maint`    | rare, break-glass jobs (e.g. reconciliation sweeps) | BYPASSRLS, separate credentials, every use audited                                             |

All tenant tables: `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`. Default-deny: no policy = no rows.

### 6.2 Setting context transaction-safely

- Context lives in custom GUCs: `app.user_id`, `app.tenant_id`, `app.is_platform`, `app.provider_scope`.
- They are set **only** with `select set_config('app.tenant_id', $1, true)` — the `true` makes it **transaction-local**; it disappears on COMMIT/ROLLBACK, so a pooled connection cannot carry it to the next request.
- Implementation: a `TenantDb` service wraps every unit of work in a Prisma interactive transaction (`prisma.$transaction(async tx => { await tx.$executeRaw\`select set_config(...)\`; ... })`), exposed via a Prisma Client extension. Business code never receives the raw `PrismaClient`— a lint rule bans importing it outside`TenantDb`.
- Policies read context with `current_setting('app.tenant_id', true)::uuid`; if unset, the comparison is NULL → no rows (fail closed).
- **Poolers:** works with Prisma's own pool and with PgBouncer in _transaction_ mode, because nothing is session-scoped. Session-level `SET`, advisory session locks and prepared-statement assumptions are banned.
- **Tests prove it:** (a) run request A for tenant X, then request B with no context on the same pooled connection (pool size 1) → B sees zero rows; (b) concurrent mixed-tenant load test never returns foreign rows; (c) `ogs_app` cannot `SET ROLE`, cannot disable RLS, cannot read with context unset.
- Prisma migrations do not generate RLS; policies are written as raw SQL inside Prisma migration files (`prisma migrate dev --create-only`, then edit), so they are versioned with the schema. A CI check fails if any table with a `tenant_id` column lacks RLS + FORCE.

### 6.3 Cross-tenant access (assignment grants)

A ticket owned by Organisation A, assigned to Provider Company B, must be visible to B's assigned technician — and only that ticket, only while the assignment is active, and **never** A's internal notes or unrelated records. **Recommendation [DECISION D-2]:** policy = `tenant_id = ctx.tenant` **OR** `exists (active ServiceAssignment for this row where assignee_tenant_id = ctx.tenant [and assignee_user_id = ctx.user for technicians])`. Provider-visible fields are further restricted by API DTOs (no customer billing data, no internal notes). Internal OGS staff use the PLATFORM context and a policy branch gated by `app.is_platform = true`, which the server sets only after a permission check, and every such read of tenant data is audited.

## 7. Universal identity and multi-membership model

- **One `User`** per human (unique verified email; phone optional, unique when verified). Credentials, MFA and sessions belong to the user, not to a workspace.
- **Capacities** come from: (a) personal workspace (always present: individual customer), (b) `ProviderProfile` (if approved as individual provider), (c) any number of `Membership`s in organisation, provider-company or PLATFORM tenants.
- Each **Membership** has its own roles, department, status (`INVITED → ACTIVE → SUSPENDED → ENDED`), employment type (for technicians) and history. Ending a membership never deletes the user.
- **Workspace switcher** lists: Personal · Provider (if approved) · each active membership. The selected workspace is shown permanently in the header (spec §5: "context must be explicit"). Switching does not re-authenticate, but **elevated workspaces (PLATFORM admin, finance) require recent MFA** (step-up within N minutes).
- Invitations bind to an email; accepting with a different logged-in email is rejected.

## 8. User-role and permission matrix

Permissions are data (`resource.action`), roles are seeded bundles; organisations may create custom roles from the allowed permission set for their tenant kind. Legend: ● full · ◐ own/assigned/limited · ○ none.

| Capability                 | Visitor | Indiv. customer   | Org admin       | Org employee           | Indiv. provider         | Provider co. admin      | Provider technician   | OGS helpdesk | OGS technician | OGS service mgr      | OGS finance | Compliance   | Super admin                     |
| -------------------------- | ------- | ----------------- | --------------- | ---------------------- | ----------------------- | ----------------------- | --------------------- | ------------ | -------------- | -------------------- | ----------- | ------------ | ------------------------------- |
| Browse public catalogue    | ●       | ●                 | ●               | ●                      | ●                       | ●                       | ●                     | ●            | ●              | ●                    | ●           | ●            | ●                               |
| Place order / request      | ○       | ●                 | ●               | ◐ (if permitted)       | ○                       | ○                       | ○                     | ◐ on behalf  | ○              | ◐ on behalf          | ○           | ○            | ●                               |
| Create ticket              | ○       | ●                 | ●               | ●                      | ○                       | ○                       | ○                     | ● on behalf  | ○              | ●                    | ○           | ○            | ●                               |
| View tickets               | ○       | ◐ own             | ● org           | ◐ own/dept             | ◐ assigned              | ● company-assigned      | ◐ assigned            | ●            | ◐ assigned     | ●                    | ○           | ◐ read       | ●                               |
| Internal notes             | ○       | ○                 | ○               | ○                      | ◐ assigned              | ◐ assigned              | ◐ assigned            | ●            | ●              | ●                    | ○           | ◐ read       | ●                               |
| Assign / reassign          | ○       | ○                 | ○               | ○                      | ○                       | ◐ within company        | ○                     | ◐            | ○              | ●                    | ○           | ○            | ●                               |
| Accept/decline assignment  | ○       | ○                 | ○               | ○                      | ●                       | ●                       | ◐ (if company allows) | ○            | ●              | ○                    | ○           | ○            | ○                               |
| Update progress / evidence | ○       | ○                 | ○               | ○                      | ◐ assigned              | ◐ assigned              | ◐ assigned            | ○            | ◐ assigned     | ●                    | ○           | ○            | ●                               |
| Confirm completion         | ○       | ◐ own             | ●               | ◐ own                  | ○                       | ○                       | ○                     | ○            | ○              | ◐ override (audited) | ○           | ○            | ●                               |
| Manage members/roles/depts | ○       | ○                 | ● org           | ○                      | ○                       | ● company               | ○                     | ○            | ○              | ○                    | ○           | ○            | ●                               |
| Quotations                 | ○       | ◐ view/accept own | ● view/accept   | ◐ view (if permitted)  | ◐ submit (if permitted) | ◐ submit (if permitted) | ○                     | ◐ draft      | ○              | ● issue              | ●           | ○            | ●                               |
| Invoices & payments        | ○       | ◐ own             | ● org           | ○                      | ○                       | ○                       | ○                     | ○            | ○              | ◐ view               | ●           | ◐ read       | ●                               |
| Payouts & earnings         | ○       | ○                 | ○               | ○                      | ◐ own                   | ● company               | ○                     | ○            | ○              | ○                    | ●           | ◐ read       | ●                               |
| Approve orgs/providers     | ○       | ○                 | ○               | ○                      | ○                       | ○                       | ○                     | ○            | ○              | ○                    | ○           | ◐ review     | ● (+ provider relationship mgr) |
| Catalogue management       | ○       | ○                 | ○               | ○                      | ○                       | ○                       | ○                     | ○            | ○              | ●                    | ○           | ○            | ●                               |
| SLA / contracts            | ○       | ○                 | ◐ view          | ○                      | ○                       | ○                       | ○                     | ◐ view       | ○              | ●                    | ◐ billing   | ○            | ●                               |
| Reports                    | ○       | ◐ own             | ● org           | ○                      | ◐ own                   | ● company               | ○                     | ◐ ops        | ○              | ● ops                | ● finance   | ● compliance | ●                               |
| Disputes                   | ○       | ◐ raise           | ◐ raise         | ◐ raise (if permitted) | ◐ respond               | ◐ respond               | ○                     | ◐ triage     | ○              | ●                    | ◐ refunds   | ●            | ●                               |
| Audit & security events    | ○       | ○                 | ◐ own-org audit | ○                      | ○                       | ◐ own-company audit     | ○                     | ○            | ○              | ○                    | ◐ financial | ●            | ●                               |
| Platform settings          | ○       | ○                 | ○               | ○                      | ○                       | ○                       | ○                     | ○            | ○              | ○                    | ○           | ○            | ● (MFA + audited)               |

Remaining OGS roles from spec §4.6 (platform operations manager, ICT support manager, field engineer, customer support officer, provider relationship manager) are seeded as variations of the columns above; the full permission-code list is produced in Phase 3.

## 9. Service request lifecycle

```text
Draft → Submitted → Under review ─┬─(fixed price)──────────────→ Awaiting payment* → Paid → Ready for assignment
                                  ├─(needs quote) Awaiting quotation → Quotation issued → Awaiting customer approval
                                  │                                      ├─ approved → Awaiting payment* / Ready for assignment
                                  │                                      └─ rejected/expired → Cancelled
                                  └─(contract-covered) ───────────────────────────────→ Ready for assignment
Ready for assignment → Assigned → Accepted → In progress ⇄ On hold
In progress → Escalated → In progress
In progress → Awaiting customer confirmation ─┬─ confirmed / auto-confirm after N days → Completed → Closed
                                              └─ issue raised → In progress | Disputed
Any pre-work state → Cancelled (rules + refunds)   ·   Completed/Closed → Disputed (within window)
* "Awaiting payment" applies to prepay services; postpaid/contract customers skip it (D-6)
```

Rules: transitions only through domain commands (`submitRequest`, `issueQuotation`, `acceptAssignment`, …), each checking actor permission + current state; every transition writes history and an audit event and emits an outbox event; the customer sees a simplified status label set.

## 10. Internal vs external delivery lifecycle

| Step        | Internal OGS                              | Individual provider                                        | Provider company                                                   |
| ----------- | ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Eligibility | technician skills/coverage                | approved + skill + coverage + availability + not suspended | approved company + eligibility for service                         |
| Dispatch    | service manager assigns or auto-suggest   | offer sent; provider accepts/declines within window        | offer to company; company admin accepts and assigns its technician |
| Acceptance  | technician acknowledges                   | required; timeout → re-offer                               | company-level, then technician-level                               |
| Work        | work logs, notes, evidence                | same                                                       | same, under company context                                        |
| Completion  | completion report → customer confirmation | same + OGS QA review optional                              | same                                                               |
| Money       | internal cost centre                      | payout to provider after confirmation + holding period     | payout to company; company pays its technicians                    |
| Performance | internal KPIs                             | rating, SLA adherence, decline rate                        | same, company-level and technician-level                           |

Assignment selection (spec §9) is a **scored suggestion**, never auto-assignment to unapproved providers; v1 recommendation: manual assignment with ranked suggestions, auto-dispatch later.

## 11. Security threat model (STRIDE summary)

| Threat                 | Example in OGS                                                                 | Controls                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | credential stuffing; stolen session; fake provider identity                    | Argon2id hashing, rate limits + lockout, breached-password check, MFA (mandatory for platform staff/finance/org admins), httpOnly SameSite cookies, session rotation, KYC document verification for providers |
| Tampering              | client sets `tenantId`/`price`/`status`                                        | server-side context resolution, server-computed prices, state machine commands only, DTO whitelisting, optimistic concurrency                                                                                 |
| Repudiation            | "I never approved that quote/refund"                                           | append-only audit log with actor, context, IP, user agent; financial ledger immutable                                                                                                                         |
| Information disclosure | cross-tenant leak (IDOR); internal notes leak; file URL guessing               | RLS + scoped queries + isolation tests; separate DTOs for customer vs staff; private bucket + short-lived signed URLs; no PII in logs                                                                         |
| Denial of service      | ticket/attachment spam; expensive search                                       | rate limits per IP/user/tenant, upload size limits, pagination caps, queue backpressure                                                                                                                       |
| Elevation of privilege | org admin grants platform permission; provider tech escalates to company admin | permission scopes per tenant kind (org roles cannot contain platform permissions), step-up MFA, admin actions dual-logged, `ogs_app` without BYPASSRLS                                                        |
| Payment fraud          | fake M-Pesa callback; redirect spoofing; replay                                | callback IP allow-list + signature/secret verification where supported, query-status confirmation against gateway, idempotency keys, amount/currency/reference match, reconciliation job                      |
| Supply chain           | malicious dependency                                                           | lockfile, pinned versions, `pnpm audit`/Dependabot, CI secret scanning                                                                                                                                        |
| File malware           | infected attachment forwarded to customer                                      | type sniffing (not extension), size limits, quarantine status until scanned (ClamAV-ready), download via authorised endpoint only                                                                             |
| Insider                | OGS staff browsing org data                                                    | least privilege, audited platform-context reads, compliance reports                                                                                                                                           |

## 12. Implementation roadmap (with recommended adjustments)

The spec's 18 phases are kept. Recommended adjustments, each needing approval **[DECISION D-7]** (approved):

1. **Move cross-cutting foundations earlier:** AuditService, transactional outbox + BullMQ worker skeleton, and FileService (private storage + metadata) into Phase 2/3 — Phases 4–5 need audit, notification emails and document upload long before Phases 12–14.
2. **Minimal email notifications in Phase 3** (verification, password reset) — impossible otherwise.
3. **Phase 7 payments:** orders need "Awaiting payment/Paid" before Phase 11 → in Phase 7, payments are recorded manually by finance (bank transfer reference) through the same `Payment` interface; M-Pesa arrives in Phase 11.
4. **Minimal web shell from Phase 3** (login, workspace switcher) so each backend phase can be demoed; full UI polish per workspace follows.
5. **CI from Phase 1** (lint, typecheck, unit tests); isolation tests gate every merge from Phase 2.

## 13. Testing and acceptance criteria per phase

| Phase             | Must be true to accept                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Foundation      | `docker compose up` starts Postgres + Redis on Windows; `pnpm install && pnpm dev` runs api + web; `GET /api/v1/health` returns DB+Redis status; lint, typecheck, unit tests pass in CI; `.env.example` has no secrets; README PowerShell steps work on a clean machine; no auth/business code exists |
| 2 Tenancy         | migrations create roles + RLS; CI check: every tenant table has RLS+FORCE; isolation suite: tenant A cannot read/update/delete B's rows via API **and** via direct `ogs_app` SQL; context-leak test on pool size 1 passes; unset context returns zero rows; `ogs_app` cannot bypass RLS               |
| 3 Identity        | register/verify/login/logout/reset flows with Supertest; Argon2id; lockout + rate limit tests; MFA enrolment + step-up; session revocation; auth events audited; OWASP ASVS L2 checklist items for auth reviewed                                                                                      |
| 4 Organisations   | pending org cannot perform operational actions (tested per endpoint); approval/rejection audited + notified; invitation token single-use, expiring, email-bound; custom roles cannot include platform permissions; multi-membership switch tests                                                      |
| 5 Providers       | unapproved provider never appears in eligibility queries; document uploads private + scanned status; company technician only acts under company context                                                                                                                                               |
| 6 Catalogue       | anonymous read of active/approved services only; all pricing models persisted with integer minor units; search/filter/pagination tests; inactive services hidden publicly                                                                                                                             |
| 7 Requests/orders | every allowed transition tested; every disallowed transition rejected; history row per transition; idempotent submission; quotation expiry                                                                                                                                                            |
| 8 Ticketing       | internal notes absent from every customer endpoint (contract test); activity log complete; reopen policy enforced                                                                                                                                                                                     |
| 9 Assignment      | no assignment to unapproved/ineligible provider; accept/decline/timeout; provider sees only assigned rows (RLS test); audit trail                                                                                                                                                                     |
| 10 SLA            | business-hours + holiday calculations unit-tested (incl. EAT timezone); warning and breach jobs fire once (idempotent); reports match fixtures                                                                                                                                                        |
| 11 Finance        | money only in minor units (lint rule); ledger balances (debits = credits) property test; M-Pesa sandbox STK + callback verification; duplicate callback no double credit; redirect never marks paid; reconciliation report                                                                            |
| 12 Notifications  | preferences respected; duplicate event → one notification; retries with backoff; dead-letter queue visible                                                                                                                                                                                            |
| 13 Reporting      | tenant reports scoped by RLS; figures reconcile with source tables                                                                                                                                                                                                                                    |
| 14 Admin          | every admin action audited; super admin requires MFA; suspensions take effect on next request                                                                                                                                                                                                         |
| 15–17             | per-integration contract tests; pen test findings closed; restore-from-backup drill succeeds; load test against agreed targets                                                                                                                                                                        |

## 14. Unresolved decisions and contradictions

All decisions below were accepted as recommended on 2026-11-05. See [`docs/DECISIONS.md`](../DECISIONS.md).

| ID   | Issue                                      | Recommendation                                                                                                                                                               | Why                                                            |
| ---- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D-1  | Ownership of individual-customer records   | user-owned with `customer_user_id`; CHECK one-of owner                                                                                                                       | matches spec "don't tenant everything"                         |
| D-2  | Cross-tenant access for assigned providers | assignment-grant RLS branch + restricted DTOs                                                                                                                                | spec needs provider access but strict isolation                |
| D-3  | Session model                              | server-side sessions in Redis, httpOnly SameSite=Lax cookie, CSRF token; no JWT in localStorage                                                                              | revocable, simplest secure option for a first-party SPA        |
| D-4  | `Service` vs `ServiceListing`              | `Service` = OGS catalogue item (what customers buy); `ServiceListing` = provider-specific offering/rate used for eligibility & payouts, not shown as separate products in v1 | OGS controls the customer experience                           |
| D-5  | Who chooses the provider?                  | OGS assigns; customers cannot pick providers in v1 (public provider profiles optional later)                                                                                 | spec §7 step 11 and "OGS controls experience"                  |
| D-6  | Prepay vs postpay                          | individuals prepay or pay after quote; approved orgs may be postpaid on contract/credit terms                                                                                | reflects B2B norms in Kenya                                    |
| D-7  | Roadmap adjustments in §12                 | approve all five                                                                                                                                                             | dependencies otherwise break                                   |
| D-8  | Revenue model                              | OGS is merchant of record; invoices customer; pays providers net of a configurable commission per service/provider                                                           | needed before Phase 11 data model is final                     |
| D-9  | Tax                                        | VAT (16%) on invoices, KRA eTIMS e-invoicing integration, withholding tax on provider payouts — confirm with a Kenyan tax advisor                                            | legally required for Kenyan B2B invoicing; spec is silent      |
| D-10 | Data protection                            | register with the ODPC, define lawful bases, retention schedule, DSAR process, DPIA for provider KYC data; host data where a lawyer confirms is compliant                    | Data Protection Act 2019; spec says "in mind" only             |
| D-11 | File storage                               | S3-compatible object storage (MinIO in dev); provider chosen in Phase 16                                                                                                     | spec lists none; local disk is unsafe for prod                 |
| D-12 | Monorepo tooling                           | pnpm workspaces (+ Turborepo optional later)                                                                                                                                 | simple on Windows, good with Docker                            |
| D-13 | Public catalogue SEO                       | Vite SPA for now; add prerendering for public pages in Phase 6 if SEO matters                                                                                                | spec mandates Vite (no Next.js), SEO matters for a marketplace |
| D-14 | Accent colour & brand                      | pick one accent (e.g. deep emerald, copper or saffron) with ObagaGlobal brand owner                                                                                          | spec forbids blue/purple dominance; no brand palette given     |
| D-15 | Hosting target                             | decide by Phase 15 (Kenyan/regional cloud vs AWS af-south-1 etc.)                                                                                                            | affects data residency, latency, backups                       |
| D-16 | Languages                                  | English v1; i18n-ready strings (Swahili next)                                                                                                                                | international expansion                                        |
| D-17 | SMS / email providers                      | e.g. Africa's Talking for SMS, a transactional email provider; behind interfaces                                                                                             | spec needs SMS; none named                                     |
| D-18 | Prisma + RLS performance                   | accept per-request interactive transaction overhead; revisit if metrics show issues                                                                                          | correctness first; spec mandates both                          |

**Contradictions found**

1. Spec §22 puts Notifications (Phase 12), Files (no phase), Audit (Phase 14) after phases that depend on them → resolved by D-7.
2. Order statuses include payment states before the Financial phase → resolved by D-7 item 3.
3. Spec §15 shows an "API Gateway"; the stack has no gateway product → interpreted as NGINX (accepted with the review).
4. "Organisation employees can submit tickets" vs "organisation permissions must be configurable" → defaults granted, admins may revoke (accepted with the review).
5. Spec §4.4 lets providers "submit pricing where permitted" while OGS controls pricing → provider rates are cost inputs (payout), customer price set by OGS (ties to D-8).

## 15. What happens next

1. ~~Owner answers D-1 … D-18.~~ Done 2026-11-05: all recommendations accepted.
2. ~~Answers are recorded in `docs/DECISIONS.md`.~~ Done as ADR-009 … ADR-026.
3. Phase 1 is already implemented (commit `b01cf24`). Next step: owner asks for the **Phase 2 (Tenancy) plan**, which includes the D-7 foundation items moved into Phase 2. The plan waits for "Phase 2 approved."
