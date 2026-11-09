# Phase 9 Plan — Technician and Assignment Management

**Status:** APPROVED by the owner on 2026-11-09, with all recommendations P9-1 … P9-12 accepted. Built on branch `phase-9/assignment` (from `main`); ships as one PR into `main`, then waits for green CI and the owner's merge.

**Starting point:** `main` @ `c7da423`. Phases 2–8 and 6b are merged (PR #11, #12 included).

**Based on:**

- [Architecture Review](../architecture/review.md): D6 Service Delivery, §4.2 (`ServiceOrder ─n ServiceAssignment ─n AssignmentHistory`, `Ticket ─n ServiceAssignment`), §6.3 (assignment grants), §8 matrix rows "Assign / reassign", "Accept/decline assignment", "Update progress / evidence", "Confirm completion", §9 (order lifecycle after "Ready for assignment"), §10 (internal vs external delivery), §11 (IDOR, internal-note leak, file malware) and §13 Phase 9 row.
- ADRs: ADR-009 (user-owned records), ADR-010 (provider grants come with assignments), ADR-013 (OGS assigns; manual dispatch with ranked suggestions), ADR-018 (data protection), ADR-019/032 (files), ADR-035 (eligibility is a dispatch tool), ADR-042 (delivery mode, channels, skills), ADR-046 (dispatch works on orders), ADR-052 (idempotency), ADR-053 (numbers), ADR-055 (Kitenge signal), ADR-056 (helpdesk owner ≠ field dispatch), ADR-057 (ticket reopen/accept), ADR-059 (internal notes).
- **The master specification is kept outside the repository** (see CLAUDE.md). This plan cites it through the review. The owner confirmed the phases for the postponed features (§3) on 2026-11-10 (ADR-074).

## 1. Goal

OGS dispatchers send work to the right people, and that work gets done and confirmed:

- **Dispatch:** a paid or postpaid order (`READY_FOR_ASSIGNMENT`), or a ticket that needs hands-on work, becomes a **job**. A dispatcher offers it to an **internal OGS technician**, an **approved individual provider** or an **approved provider company**. A company admin then names one of the company's own technicians.
- **Offers:** the offeree accepts, declines (with a reason) or lets the offer time out. A declined or timed-out job goes back to the queue to be offered again.
- **Field work:** the technician works the job from a phone: on the way, started, paused, completed. Along the way they keep work notes, upload photos and submit a completion report.
- **Confirmation:** the customer follows progress on a first live job tracker and confirms the work.

Review §13 sets the acceptance bar:

- no assignment to an unapproved or ineligible provider;
- accept, decline and timeout work;
- a provider sees only the rows assigned to it (RLS test);
- every change is in the audit trail.

The owner adds:

- eligibility is enforced **in the database**;
- access ends on reassignment, removal or closure;
- providers never see internal notes, billing details or other customers' data;
- the technician screens are mobile-first and work on slow connections;
- one full browser journey runs from order to confirmation.

## 2. Scope

### 2.1 Data model

Every job copies its customer owner (`customer_tenant_id` **or** `customer_user_id`, CHECK exactly one, ADR-009) from its order or ticket, so RLS never has to join back to commercial tables.

| Table            | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job`            | Number `JOB-2026-000123` (new `document_counter` kind). Source: `service_order_id` **or** `ticket_id` (CHECK exactly one). Customer owner. **Requirements copied at creation** (P9-11): `service_id` (optional for tickets), `required_skills` with minimum experience, allowed channels, `remote_allowed`, `region_code`. **Provider-facing brief** (P9-1): title, brief text, site address, site contact name and phone, scheduled window. Status, `version`, timestamps (`assigned_at`, `started_at`, `completed_at`, `confirmed_at`).                                          |
| `job_offer`      | Job, assignee (P9-3): `kind` INTERNAL / INDIVIDUAL / COMPANY, with `technician_user_id` (internal) **or** `provider_id`. Offered by, offered at, `expires_at`, status PENDING → ACCEPTED / DECLINED / EXPIRED / WITHDRAWN, decline reason code and text, responded by/at. A partial unique index allows **one PENDING offer per job** (P9-4).                                                                                                                                                                                                                                      |
| `job_assignment` | Who holds the job now: job, offer, copies of the job number and service name (for the "Done" tab), kind, `provider_id`, `provider_tenant_id` (company), `technician_user_id` (the person doing the work), status ACTIVE / ENDED, `end_reason` (REASSIGNED, REMOVED, TECHNICIAN_CHANGED, JOB_COMPLETED, JOB_CANCELLED, PROVIDER_SUSPENDED), started/ended at and by, reason. A partial unique index allows **one ACTIVE assignment per job**. A company changing its technician ends the row and opens a new one, so the old technician loses access exactly like any reassignment. |
| `job_event`      | Append-only activity: kind, from, to, actor, reason, at, plus two flags: `customer_visible` and `provider_visible`. **One row per command.** Staff see all rows. Customers see only `customer_visible` rows, providers only `provider_visible` rows of their own assignment (RLS, not DTO filtering).                                                                                                                                                                                                                                                                              |
| `job_work_note`  | Notes written by the assignee's side (technician, company admin) or staff. Belongs to an **assignment** (P9-9). Visible to staff and that assignment's holder. Never to customers. Append-only.                                                                                                                                                                                                                                                                                                                                                                                    |
| `job_evidence`   | Photo evidence: assignment, file, caption, taken at. Files use the new purpose `job.evidence` (§2.6). Append-only; a wrong photo is hidden by a `withdrawn` event row, never deleted.                                                                                                                                                                                                                                                                                                                                                                                              |
| `job_completion` | The completion report: assignment, summary of work done (customer-facing), time on site (minutes), parts or materials used (text), evidence ids, submitted at; then the outcome: CONFIRMED / ISSUE_RAISED / AUTO_CONFIRMED / STAFF_CONFIRMED, by whom, reason. One open report per job; a raised issue closes the report and sends the job back to work.                                                                                                                                                                                                                           |

`service_order.status` gains **IN_DELIVERY** (first accepted offer) and **COMPLETED** (job confirmed) (P9-10). One job per order in v1; repeat visits are later work (§3).

Existing orders already at `READY_FOR_ASSIGNMENT` get a QUEUED job from the migration, so nothing is stranded.

### 2.2 RLS and contexts (P9-1, P9-2, P9-3)

All new tables have RLS enabled and forced, explicit grants to `ogs_app`, and entries in `rls-catalogue.int.test.ts` and `isolation.int.test.ts`.

**Who reads what:**

| Context                                                                                | `job` / offers / assignments                                                                                                                                                                              | Events                                     | Work notes, evidence                                                    | Completion       |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ---------------- |
| Elevated staff (`app.is_platform()`)                                                   | all                                                                                                                                                                                                       | all                                        | all                                                                     | all              |
| **Internal technician** (non-elevated PLATFORM workspace)                              | `job`: rows with an ACTIVE assignment or PENDING offer where `technician_user_id = app.current_user_id()` and kind INTERNAL                                                                               | `provider_visible` rows of that assignment | own assignment's                                                        | own assignment's |
| **Individual provider** (new `provider` context, `app.provider_id`)                    | an ACTIVE assignment or PENDING offer for `app.provider_id()`, **and** that provider is still ACTIVE                                                                                                      | same                                       | same                                                                    | same             |
| **Provider company** (workspace context of the company tenant)                         | assignment or offer for `provider_tenant_id = app.current_tenant_id()`, company ACTIVE, **and** either the member is the named technician or `app.holds_permission('ticket.assign')` (company dispatcher) | same                                       | same                                                                    | same             |
| **Customer** (`app.owns_customer_row`, same rules as orders/tickets: ADR-054, ADR-060) | own jobs (the API returns the customer DTO only, §2.5)                                                                                                                                                    | `customer_visible` rows only               | **none** for notes; evidence only once a completion report is submitted | own              |
| Workers                                                                                | scoped `jobs.*` jobs                                                                                                                                                                                      |                                            |                                                                         |                  |

The rules enforced by these policies:

- **Providers get no policy on any customer table** (`service_order`, `service_request`, `quotation`, `payment`, `ticket`, `ticket_comment`, `ticket_attachment`, `ticket_event`, `ticket_internal_note`, `organisation_billing`, and so on) (P9-1). Everything a provider may know is copied onto the job when it is dispatched. This is narrower than ADR-010's branch on customer rows, and it removes the "which columns does the DTO leave out?" risk from the database layer.
- **Access ends automatically.** Every provider branch requires an **ACTIVE** assignment (or a **PENDING** offer, which shows only the offer card, §2.5) and an ACTIVE provider and tenant. Reassignment, removal, a technician change, completion, cancellation or suspension ends the assignment row in the same transaction, so the very next query returns nothing. Nothing is cached server-side.
- **Completed and ended jobs:** once an assignment ends (`JOB_COMPLETED` or any other reason), the provider can no longer read the job, its brief, notes or photos. `job_assignment` copies the job number and service name, holds no customer data, and stays readable by its own assignee after it ends. That is all the "Done" tab shows: number, service, dates, outcome (P9-9). Phase 11 payout statements build on it.
- **New context kind `provider`** (P9-3): today an individual provider's workspace runs in the same `user` context as their personal customer workspace. Phase 9 adds `DbContext { kind: 'provider', userId, providerId }`, which sets `app.provider_id` with transaction-local `set_config(…, true)`. Provider rows then match only in the provider workspace, and the person's own orders match only in their personal workspace.
- **`app.holds_permission(code)`** is a new `STABLE SECURITY DEFINER` helper with a fixed `search_path`. It answers whether the current user's ACTIVE membership in the current tenant holds a permission. It returns only a boolean, never rows, and is unit-tested against suspended memberships and roles of other tenants.
- **Internal notes:** `ticket_internal_note` keeps its platform-only policy (ADR-059). It gains one narrow branch: an **internal OGS technician** (a PLATFORM member) with an ACTIVE assignment on a job whose ticket is that note's ticket. **No provider branch is ever added** (P9-2).

### 2.3 Eligibility in the database (P9-11)

One SQL function, `app.can_take_job(job_id, assignee kind, provider_id | technician_user_id)`, is `SECURITY DEFINER`, returns a boolean and is owned by `ogs_owner`. It is the **only** definition of "who may take this job":

- **Providers:**
  - the provider is `status = 'ACTIVE'`, its application is APPROVED and it has `accepting_work`;
  - a company's tenant is ACTIVE and not deleted;
  - the provider's kind is allowed by the job's channels;
  - it has every required skill at or above the minimum experience;
  - it covers the job's county, or both the job and the provider allow remote work.
- **Internal technicians:**
  - the user has an ACTIVE PLATFORM membership whose roles hold `assignment.respond` and `ticket.update_progress`;
  - the job's channels allow OGS technicians.

The function is used in three places:

1. **A trigger on `job_offer` INSERT** refuses an offer to anyone who fails it (SQLSTATE `P0001`, mapped to 422 "not eligible").
2. **A trigger on accepting an offer** checks it again: a provider suspended between offer and acceptance cannot accept.
3. **`EligibilityService`** keeps its scoring and reasons, but its hard filters call the same function (one definition, tested once).

On top of the function:

- **A trigger on `provider`** (status → SUSPENDED or REJECTED, or `accepting_work` → false for new offers only), plus one on `tenant` (company suspended), withdraws PENDING offers. On suspension it also ends ACTIVE assignments with `PROVIDER_SUSPENDED` and puts their jobs back in the queue with an event for the dispatcher.
- **A trigger on `membership`** (ended or suspended) ends that technician's assignments, internal or company, the same way.
- Availability (working hours, time off) is **shown and scored, not enforced** (P9-11), because jobs are often scheduled for later.

### 2.4 Lifecycle (one transition table, `src/jobs/transitions.ts`)

```text
Job:
  QUEUED ─staff:offer─▶ OFFERED
  OFFERED ─offeree:accept─▶ ASSIGNED            (company: accept names the technician, P9-5)
  OFFERED ─offeree:decline (reason) | system:expire | staff:withdraw─▶ QUEUED
  ASSIGNED ─tech:on the way─▶ ON_THE_WAY ─tech:start─▶ IN_PROGRESS   (remote jobs: ASSIGNED ─start─▶ IN_PROGRESS)
  IN_PROGRESS ─tech:pause (reason)─▶ PAUSED ─tech:resume─▶ IN_PROGRESS
  IN_PROGRESS ─tech:submit completion report─▶ AWAITING_CONFIRMATION
  AWAITING_CONFIRMATION ─customer:confirm | system:auto-confirm after 7 days | staff:override (reason, audited)─▶ COMPLETED
  AWAITING_CONFIRMATION ─customer:report a problem (reason)─▶ IN_PROGRESS   (same assignee)
  ASSIGNED | ON_THE_WAY | IN_PROGRESS | PAUSED ─staff:reassign (reason)─▶ QUEUED    (assignment ends: REASSIGNED)
  ASSIGNED | ON_THE_WAY | IN_PROGRESS | PAUSED ─company:change technician (reason)─▶ same state, new assignment row
  any state before COMPLETED ─staff:cancel (reason)─▶ CANCELLED
  COMPLETED and CANCELLED are final.
Order: READY_FOR_ASSIGNMENT ─first accept─▶ IN_DELIVERY ─job COMPLETED─▶ COMPLETED   (P9-10)
       IN_DELIVERY ─staff cancel (refund due, Phase 11)─▶ CANCELLED
```

- **Commands:** the same shape as `src/orders/transitions.ts` and `src/tickets/transitions.ts`. Each command lists its from-states, actor and permission. Every command:
  - runs in one `TenantDb.run` transaction;
  - checks actor, permission, state and `version`;
  - writes exactly one `job_event`, one audit row and one outbox event (review §13 "audit trail").
- **Assignment changes:** offer, accept, decline, expire, withdraw, reassign, technician change, removal by suspension, cancellation and override are **all** audited. Each audit row names the before and after assignee and the reason.
- **Offer timeout:** sending an offer schedules a delayed `jobs.offer_expire` outbox event at `expires_at`, plus a sweep every 5 minutes. Both are idempotent and copy `QuotationExpiryService`. Acceptance checks `expires_at` in its own transaction, so a late accept fails even if the job has not run yet. An accept racing the expiry is decided by `version`.
- **Auto-confirm:** submitting a report schedules `jobs.auto_confirm` at +7 days, plus an hourly sweep (the ADR-057 pattern).
- **Second guard:** a `protect_job` trigger lets provider and technician contexts change only progress columns, through the allowed moves, on their own ACTIVE assignment. Customers may change only the confirmation outcome. Nobody can edit requirements, the customer owner or another assignee's rows.
- **Ticket jobs** (P9-7): the dispatcher opens a job from a ticket that needs work and writes the brief (prefilled from the subject and description, editable). When that job's report is submitted:
  - it is attached to the ticket as a public activity row;
  - the ticket's OGS owner resolves the ticket with it;
  - the customer's existing "Accept resolution" (ADR-057) confirms both the ticket and the job. The customer is never asked twice.

### 2.5 Exactly what each party sees

**A provider (individual, company dispatcher or technician) sees, for an offer (before accepting):**

- job number, service name, title and brief written by OGS, required skills, delivery mode;
- **county and area** (the first part of the address up to the first comma, never the full address), scheduled window;
- offer expiry time.

**After accepting, while the assignment is ACTIVE, it also sees:**

- the **full site address**;
- the **site contact's first name and phone number** (the order's contact phone; for tickets, the contact OGS enters);
- **customer display name:** the organisation's name, or the individual's first name only;
- the files OGS chose to share on the brief;
- its own work notes, photos and completion report;
- the job's `provider_visible` events.

**A provider never sees** (the response schemas have no such fields, and T5 checks it):

- prices, totals, VAT, payments, payment terms, quotations, invoices, or any money field;
- customer emails, account ids, department, other members;
- the ticket conversation, ticket attachments not shared on the brief, ticket and request history;
- **internal notes** and internal activity;
- other providers' offers or assignments, previous assignees' notes and photos;
- the customer's other orders, tickets and jobs;
- audit rows.

**The customer sees** (P9-8):

- the job status (simplified labels below);
- the assignee as **first name + "OGS technician"** for internal staff and individual providers, or **first name + "OGS partner technician"** for company technicians;
- initials in an `Avatar`; no phone number and no company name, because OGS owns the relationship (review §1);
- the `customer_visible` events (Timeline);
- the completion report summary, time on site and photos once submitted.

Customers never see the brief, work notes, offers, declines and their reasons, or reassignment reasons. A reassignment shows only as "We're arranging a new technician".

**Customer labels:**

| Job status            | Label                |
| --------------------- | -------------------- |
| QUEUED, OFFERED       | Finding a technician |
| ASSIGNED              | Technician assigned  |
| ON_THE_WAY            | On the way           |
| IN_PROGRESS, PAUSED   | Work in progress     |
| AWAITING_CONFIRMATION | Check and confirm    |
| COMPLETED             | Completed            |
| CANCELLED             | Cancelled            |

### 2.6 API

- **Staff** (elevated; `ticket.assign` unless noted):
  - `GET /platform/jobs` (queue with filters: status, source, county, assignee kind, overdue offers);
  - `GET /platform/jobs/:id`, with suggestions from `EligibilityService` plus eligible internal technicians;
  - `POST /platform/tickets/:id/jobs` (dispatch a ticket);
  - `PATCH /platform/jobs/:id/brief` (brief, site, contact, window, shared files);
  - `POST …/offers` (assignee, window), `…/offers/:offerId/withdraw`, `…/reassign`, `…/cancel`;
  - `POST …/confirm` (`ticket.confirm_completion`, reason, audited);
  - `GET …/history` (full events plus the audit trail).
- **Assignee side** (individual provider workspace; company workspace with `assignment.respond` for offers and `ticket.assign` to name or change the technician; PLATFORM workspace with `assignment.respond` for internal technicians; `ticket.update_progress` for work):
  - `GET /jobs?view=offers|active|done` (small summary rows, 20 per page);
  - `GET /jobs/:id`;
  - `POST /jobs/offers/:id/accept` (company: `technicianUserId`), `…/decline` (reason code + text);
  - `POST /jobs/:id/technician` (company changes technician, reason);
  - `POST /jobs/:id/on-the-way`, `…/start`, `…/pause` (reason), `…/resume`;
  - `POST /jobs/:id/notes`, `POST /jobs/:id/evidence` (file id + caption);
  - `POST /jobs/:id/completion`.
- **Customers:**
  - `GET /orders/:id/progress` and `GET /tickets/:id/progress` (small payload for polling: status label, assignee display, customer events, report);
  - `POST /orders/:id/job/confirm`;
  - `POST /orders/:id/job/report-problem` (reason).
  - Who may confirm: the order's requester, holders of `request.read_all` or `ticket.confirm_completion` in the organisation, and individuals for their own orders.
- **Idempotency and retries:** every assignee command and customer confirmation takes an `Idempotency-Key` (ADR-052), so a technician on a weak signal can retry safely and a double tap does nothing twice.
- **Rate limits:** 120 assignee commands per user per hour; 60 evidence uploads per job.
- **Files:** a new purpose `job.evidence`:
  - JPEG, PNG or WebP only (content sniffing), 10 MB server limit, 30 per assignment;
  - the file is **owned by the customer** (as Phase 8 reply files are). Access comes through `job_evidence` rows: staff, the uploading assignment while ACTIVE, and the customer after a report is submitted;
  - shown as "Scanning…" until clean (existing quarantine flow);
  - download links are short-lived, behind the authorised endpoint.

### 2.7 Permissions (catalogue change)

`apps/api/src/authz/catalogue.json`, then regenerate `docs/architecture/permissions.md`:

| Change                                                                                                                        | Why                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ticket.internal_note`: remove `PROVIDER_COMPANY` from its kinds; remove it from `provider_technician`                        | P9-2: providers never see internal notes. This overrides the review §8 matrix ("◐ assigned" for providers).      |
| `ticket.comment`: remove `PROVIDER_COMPANY`; remove it from `provider_technician`                                             | Providers don't post in the customer conversation; their notes go to OGS (review §1: OGS owns the relationship). |
| `provider_technician` keeps `workspace.read`, `ticket.read`, `ticket.update_progress`                                         | They see their own jobs and do the work. Companies may add `assignment.respond` to a custom role.                |
| `provider_admin` (`*`) covers `assignment.respond` and `ticket.assign` within the company                                     | Matrix: company admin accepts and assigns within the company.                                                    |
| Internal `technician` and `field_engineer` unchanged (`assignment.respond`, `ticket.update_progress`, `ticket.internal_note`) | P9-6.                                                                                                            |

Role sync at start-up already removes dropped permissions from system roles. A migration removes the two codes from any custom PROVIDER_COMPANY role, so the `check_role_permission` trigger stays consistent; none exist outside test data.

### 2.8 Notifications (outbox → email; SMS waits for Phase 12)

- **Assignee side:**
  - new offer (individual; company members with `assignment.respond`; internal technician), with the expiry time;
  - offer withdrawn or expired;
  - you've been assigned (the company's technician);
  - removed from a job;
  - the customer reported a problem.
- **Customer:**
  - technician assigned (first name only);
  - on the way;
  - work complete, please check and confirm (with the auto-confirm date);
  - completed.
- **Staff:**
  - offer declined or expired (to the dispatcher who sent it);
  - job back in the queue after a suspension;
  - the customer reported a problem.
- **Content rules:** emails carry no brief text, address, phone, notes or money; they link to the app. A canary test covers this (T5).

### 2.9 Web (Kitenge signal, ADR-055)

All screens are lazy routes in `App.tsx`, built only from `apps/web/src/components/ui`, colours from tokens, strings through `t()`, controls `min-h-11` on phones, one `highlight` button per screen, and no new colour pairs. `StatusPill` gets job statuses; "live" (saffron) marks only the job that is currently in progress.

**Nav labels:**

- assignee workspaces get **"Jobs"** (`/jobs`);
- staff get **"Dispatch"** (`/platform/dispatch`).

No button on these pages contains "Jobs", "Dispatch", "Tickets", "Requests" or "Support".

**Technician and provider screens (mobile-first, designed at 360 px first)**

| Screen                                     | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jobs** `/jobs`                           | `PageHeader` "Jobs", then `Tabs`: Offers (count `Badge`), Active, Done. Each job is a stacked `Card` (not a table, on every width): `<Code>` number, service, county/area, window, `StatusPill`; offers show "Expires in 1 h 42 min" in mono with a `warning` `Badge` under 15 minutes. Cards are links ("View offer" / "Open job"); no actions on the list, so there is no highlight competition. `EmptyState` (the page's one motif) per tab.                                                                                                                                         |
| **Offer** `/jobs/offers/:id`               | `Breadcrumbs`. One `Card` with the pre-accept fields only (§2.5). "Accept job" is the `highlight` button. A company dispatcher picks a technician first in a `Select` (active members with `ticket.update_progress`). "Decline" (secondary) opens a `DialogContent` with a `RadioGroup` of reasons (not available, too far, lacks skills or tools, too much work, other) and a `Textarea` required for "other".                                                                                                                                                                         |
| **Job** `/jobs/:id`                        | Header: number, service, `StatusPill`. A sticky bottom bar on phones holds **the one next step** as the `highlight` button: "I'm on my way" → "Start work" → "Submit completion report"; "Pause" / "Resume" are secondary. `Card`s in order: Site (address, "Copy address", contact first name, `tel:` link "Call site contact"), Brief, Work notes (list + `Textarea` "Add note"), Photos (thumbnail grid + `FileUpload` with `accept="image/*" capture="environment"`), Timeline of provider-visible events. A company dispatcher also sees "Change technician" (dialog with reason). |
| **Completion report** `/jobs/:id/complete` | `FormField`s: "What did you do?" (`Textarea`, the customer will read it), time on site (`Input` minutes), parts/materials (`Textarea`, optional), photo picker (`Checkbox` grid of uploaded photos, at least one required for on-site jobs). "Submit report" is `highlight`.                                                                                                                                                                                                                                                                                                            |
| **No longer assigned**                     | If any job call returns 404 (reassigned, removed, closed), the page shows an `EmptyState` "This job is no longer assigned to you" with a link back to Jobs, and clears the cached job from TanStack Query.                                                                                                                                                                                                                                                                                                                                                                              |

**Slow connections (review: mid-range phones on mobile data; ADR-055 performance target):**

- **Small payloads:**
  - the jobs route chunk stays under a **60 KB gzip budget**, with no new libraries (a CI script reads the Vite manifest and fails over budget);
  - list rows are summaries; the detail is one request;
  - polling is off on technician screens (they refetch on focus and after each command).
- **Photos are shrunk on the phone before upload:**
  - canvas re-encode to at most 1600 px and JPEG quality 0.8, typically 200–400 KB;
  - this also strips EXIF data, including GPS location (ADR-018);
  - uploads run one at a time, each with its own progress bar and a "Retry" button.
- **Safe retries:** every command button shows a pending state. A failure shows an `Alert` "Not sent — check your connection" with "Try again", which resends with the **same** `Idempotency-Key`. Typed notes and report text are kept in `sessionStorage` until sent, so a reload on a bad connection loses nothing. This is not offline mode (§3).
- **Fonts** are already self-hosted with `font-display: swap`.

**Staff screens (elevated, `ElevationGate`)**

| Screen                              | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dispatch** `/platform/dispatch`   | `StatTile`s: Queued, Offers out, In progress, Waiting for customer. Filter bar (`Select` status, county, source). `DataTable`: number (`<Code>`), source (`ORD-…`/`TCK-…`), service, county, status, assignee (`Avatar` + name + kind `Badge`), age. Stacked cards below `sm`. `EmptyState` with motif when the queue is empty.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Job** `/platform/dispatch/:id`    | Two columns. Left: brief editor `Card` (title, brief, site, contact, window `DatePicker`, shared files), then **Suggestions**: a ranked list from eligibility with each reason as a `Badge` (skill, county, available, remote), split into Internal technicians / Individual providers / Provider companies. Each candidate has "Offer" (opens a dialog with an offer window `Select`: 30 min, 1 h, 2 h (default), 4 h, 24 h). The dialog's "Send offer" is the screen's one `highlight`. Right: status `Card` (current assignee, active offer with countdown and "Withdraw offer"), actions ("Reassign" and "Cancel job" with a reason dialog, `danger` for cancel; "Confirm on customer's behalf" with a reason, `ticket.confirm_completion` only), offer history `DataTable` (who, sent, outcome, reason), full `Timeline` (internal rows carry the "Internal" `Badge` as in Phase 8). |
| **Ticket detail** (Phase 8 page)    | A "Send a technician" button (secondary, `ticket.assign`) opens the brief form prefilled from the ticket and creates the job; the right column shows the job's status and links to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Staff order page** (Phase 7 page) | Shows the job number, status and assignee, with a link to the dispatch page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Customer screens: first live job tracker**

- The order detail and ticket detail pages gain a **"Progress" `Card`**:
  - the customer label as a `StatusPill` ("live" saffron dot while ASSIGNED … AWAITING_CONFIRMATION);
  - the assignee (`Avatar` initials, first name, "OGS technician" / "OGS partner technician");
  - a `Stepper` of the five customer steps (Finding a technician → Assigned → On the way → Work in progress → Check and confirm);
  - the **`Timeline`** of customer-visible events, newest highlighted.
- **Polling:** the tracker calls `GET …/progress` every 30 s while the tab is visible and the job is active (TanStack `refetchInterval`, paused when hidden), and stops when the job is completed or cancelled.
- **Confirming:** in AWAITING_CONFIRMATION, a confirmation `Card` shows the report summary, time on site and photo thumbnails (open in a `Dialog`), with the auto-confirm date. "Confirm work is complete" is the page's `highlight` button. "Report a problem" (secondary) opens a dialog asking for a reason.
- **Dashboard:** the dashboard gains an "In progress" `StatTile` for customers with active jobs.

**Motif:** only in the `EmptyState`s and the page loader, so at most once per page; the new routes go into `e2e/theme-motif.spec.ts`. New pages go into `e2e/visual.spec.ts` (Linux baselines from CI) and the axe suite.

## 3. Included now vs postponed (signature features and others)

| Feature                                                                | Phase 9                                                                                           | Postponed to                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Live job tracker**                                                   | **Included, first version:** status, assignee, `Stepper` + `Timeline`, 30 s polling               | Push updates (server-sent events or web push) and SMS milestones: **Phase 12** (Notifications)                        |
| **Offline mode** (queue actions and photos without signal, sync later) | **Not included.** Phase 9 gives safe retries, idempotent commands, kept drafts and small payloads | **Phase 12** (P9-12): it needs a service worker, which web push brings in that phase                                  |
| **Live map** (technician location, ETA)                                | **Not included.** "On the way" is a status only; no location is collected                         | **Phase 15** (P9-12): needs a map/tiles vendor, location consent and a DPIA (ADR-018), decided with hosting (ADR-023) |
| Command bar                                                            | Not included                                                                                      | Phase 14 (admin)                                                                                                      |
| M-Pesa UI                                                              | Not included                                                                                      | Phase 11                                                                                                              |
| SLA timers and escalation on jobs                                      | Timestamps recorded (`assigned_at`, `started_at`, `completed_at`) for later use                   | Phase 10                                                                                                              |
| Provider payouts, earnings, commission                                 | Not included                                                                                      | Phase 11                                                                                                              |
| Ratings of technicians, disputes after completion                      | Not included                                                                                      | Phases 12–13                                                                                                          |
| Decline-rate and performance reports                                   | Data recorded (reason codes)                                                                      | Phase 13                                                                                                              |
| Auto-dispatch, broadcast offers to several providers at once           | Not included (ADR-013: manual with ranked suggestions)                                            | After v1                                                                                                              |
| Skills and coverage for internal technicians                           | Not included: any eligible internal technician may be offered a job                               | Phase 14 (admin)                                                                                                      |
| Several visits or several technicians on one job; scheduling calendar  | Not included                                                                                      | After v1                                                                                                              |
| Provider QA review before customer confirmation (review §10, optional) | Staff can see every report; no separate QA gate                                                   | After v1                                                                                                              |

## 4. Tests and acceptance

| ID  | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Transition table.** Every command × state × actor (staff, internal technician, individual, company dispatcher, company technician, customer, system) is table-driven from `transitions.ts`: allowed moves succeed, others answer 409/403. Exactly one `job_event`, one audit row and one outbox event per command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T2  | **Eligibility in the database.** As `ogs_app` with raw SQL (no service code), an offer to a provider that is pending, rejected, suspended, not accepting work, of a disallowed kind, missing a skill, below the minimum experience, or outside the county without remote, is refused by the trigger. So is an offer to an ended/suspended membership or a non-technician platform member. Accepting after the provider was suspended is refused. Suspending a provider or company, or ending a membership, withdraws offers, ends assignments and re-queues jobs. `EligibilityService` and `app.can_take_job` agree on a fixture matrix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T3  | **Provider RLS isolation.** Provider A cannot read provider B's jobs, offers, assignments, notes, evidence or completion through any API (404) or raw SQL as `ogs_app` (zero rows). Company technician X sees only jobs naming X; the company dispatcher sees all of its company's. An individual provider's personal workspace sees no provider jobs, and the provider workspace sees none of their personal orders. **No provider context reads a single row** of `service_order`, `service_request`, `quotation`, `payment`, `organisation_billing`, `ticket`, `ticket_comment`, `ticket_attachment`, `ticket_event`, `ticket_internal_note` or another tenant's anything. All new tables are in the RLS catalogue and isolation suites; `app.holds_permission` has its own tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| T4  | **No access after reassignment.** For each way access ends (staff reassign, company technician change, suspension of provider, company or membership, job completed, job cancelled): the previous assignee's next call to every job route, evidence download and file link answers 404, raw SQL returns zero rows, and the web "no longer assigned" page appears. The new assignee sees none of the previous assignee's notes or photos.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T5  | **Nothing confidential reaches providers (contract test, owner's requirement).** Canary strings are planted in an internal note, an internal attachment name, a hold reason, a reassignment reason, the customer's email and the order total. Then **every provider route** (enumerated from the Nest router) is called as an individual, a company dispatcher, a company technician and an internal technician (internal technicians may see internal notes, P9-2, so for them only the billing canaries apply). No response, provider-bound email or event contains a canary or a money field, checked against the response schemas. **Web:** a Playwright suite visits every assignee page (enumerated from the route table) and searches the rendered page, every API response and Mailpit for the canaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T6  | **Offers.** Accept; decline requires a reason (code, and text for "other"); timeout fires exactly once at the boundary instant (delayed job plus sweep, pinned clock); a late accept is refused; accept versus expiry under concurrency is decided by `version`; decline, timeout and withdrawal return the job to QUEUED with no assignee and allow a new offer; only one PENDING offer per job; a company accept must name an eligible technician of that company.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T7  | **Work and completion.** Progress moves (remote jobs skip "on the way"); pause needs a reason; idempotent retries create one event; evidence limits, image-only types, clean-only downloads, customer access only after the report; report requires a summary (and a photo on site); customer confirm, report-a-problem (back to IN_PROGRESS with the same assignee) and auto-confirm after 7 days exactly once; staff override audited; order IN_DELIVERY → COMPLETED; ticket jobs complete through "Accept resolution".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| T8  | **Audit trail.** Every assignment change (offer, accept, decline, expire, withdraw, reassign, technician change, removal, cancel, override) writes one audit row with before/after assignee and reason; audit rows stay append-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T9  | **Customer view.** The progress DTO carries only the fields in §2.5 (schema test); customers see only `customer_visible` events; a reassignment shows as "arranging a new technician"; another customer's job answers 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| T10 | **Notifications.** Each email once per event, to the right people, with no brief, address, phone, note or money.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T11 | **Web.** Component tests (offer card and countdown, decline dialog, next-step bar, photo compression helper, retry with the same key, progress card). **Playwright journeys:** (a) **full journey:** an individual orders a fixed-price on-site service → staff accept → finance records payment → job queued → the dispatcher offers it to an individual provider, who declines with a reason → re-offered to a provider company → its admin accepts and names a technician → the technician (phone viewport) goes on the way, starts, pauses, resumes, adds a note, uploads a photo, submits the report → the customer watches the tracker and confirms → order Completed; (b) **timeout:** an offer expires (pinned clock / test sweep hook) → back in the queue → an internal technician accepts; (c) **reassignment:** the old technician's open job page turns into "no longer assigned"; (d) a ticket dispatched to an internal technician, completed through "Accept resolution". **Slow network:** journey (a)'s technician steps rerun under Chrome DevTools throttling (400 kbps, 400 ms RTT) and must finish within the test timeout; the photo upload stays under 500 KB. Visual, axe and motif suites gain the new pages; the jobs chunk budget runs in CI. |

## 5. Delivery

| Part         | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9A — backend | Contracts (`packages/contracts/src/jobs.ts`); schema, RLS, `provider` context and `app.provider_id`, `app.holds_permission`, `app.can_take_job`, triggers (eligibility, `protect_job`, suspension/membership hooks), counter kind, order statuses and migration backfill; permission catalogue; `src/jobs` module (transitions, staff, assignee and customer services/controllers, offer expiry and auto-confirm jobs); ticket-to-job dispatch; evidence purpose; emails; T1–T10. |
| 9B — web     | `apps/web/src/features/jobs` (assignee pages, staff dispatch pages, progress card, photo compression, retry helper), nav items, i18n, ticket and order page additions, chunk budget script; T11. Docs: overview §13 "Jobs (Phase 9)", ADRs for P9-1 … P9-12, plan delivery notes, CLAUDE.md status.                                                                                                                                                                               |

The same pattern as earlier phases: one approval, two halves with no gate between them, one PR into `main`, then green CI, which I report with the PR link, and the owner's merge before Phase 10. `pnpm check`, `pnpm test:integration` and `pnpm test:e2e` (after rebuilding the API) pass before each push, and never while the owner is running `pnpm dev`.

## 6. Decisions needed before starting

| ID    | Question                                          | Recommendation                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                       |
| ----- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P9-1  | Where does the provider grant live?               | **On the job tables only.** Providers get no RLS branch on orders, requests, tickets or any other customer table; what they need is copied onto the job's brief when it is dispatched. This narrows ADR-010.                                                                             | Row-level security can't hide columns. A branch on `service_order` would expose totals to any query that forgot a DTO. Copying a brief makes "what a provider sees" one explicit list.                                    |
| P9-2  | Who may read internal notes?                      | **OGS staff only, including internal technicians on their own ticket jobs. Providers never** (individual, company admin or technician). Remove `ticket.internal_note` and `ticket.comment` from provider roles. This overrides the review §8 matrix.                                     | The owner's rule. Internal technicians are OGS employees and often need the helpdesk's notes.                                                                                                                             |
| P9-3  | How do provider contexts reach the database?      | **A new `provider` DB context with `app.provider_id`** for individual providers; company members use their company workspace plus `app.holds_permission`; internal technicians use the **non-elevated** PLATFORM workspace and see only their own jobs.                                  | Today the provider and personal capacities share one `user` context. Separating them stops an individual's provider jobs and personal orders from mixing. Technicians don't need cross-tenant elevation to do field work. |
| P9-4  | How do offers work?                               | **One offer at a time per job**, sent by a dispatcher to one assignee, with a **2-hour default window** (30 min – 24 h). Decline needs a reason code (+ text for "other"). Decline, timeout or withdrawal returns the job to QUEUED.                                                     | Matches review §10 and ADR-013 (manual dispatch). Notifications are email-only until Phase 12, so very short windows would mostly expire unseen.                                                                          |
| P9-5  | How does a provider company take a job?           | **The company dispatcher (`assignment.respond` + `ticket.assign`) accepts and names a technician in one step**; no second acceptance by the technician. The company may later change the technician (reason, audited), which ends the old technician's access.                           | Matrix: "company-level, then technician-level"; one step is simpler and the company already controls its staff. A technician-level acknowledgement can be added if companies ask.                                         |
| P9-6  | How do internal OGS technicians get work?         | **Through the same offer flow** (accept/decline/timeout), eligible when they are active PLATFORM members holding `assignment.respond` and `ticket.update_progress`. No skills/coverage for staff yet (Phase 14).                                                                         | One flow, one set of tests, one audit trail. Staff skill profiles need an admin UI that doesn't exist yet.                                                                                                                |
| P9-7  | Who confirms completion?                          | **Order jobs:** the customer confirms or reports a problem; **auto-confirm after 7 days**; a service manager may confirm on the customer's behalf (reason, audited). **Ticket jobs:** the report goes into the ticket; the customer's "Accept resolution" (ADR-057) is the confirmation. | Matches review §9 and §8 ("◐ override (audited)"); 7 days mirrors ADR-057 so customers learn one rule; ticket customers are never asked twice.                                                                            |
| P9-8  | What does the customer see of the assignee?       | **First name and "OGS technician" / "OGS partner technician", with initials.** No phone number or company name; the tracker shows the status, a `Stepper` and a `Timeline`, polled every 30 s.                                                                                           | OGS owns the customer relationship (review §1); a first name is enough to recognise who arrives.                                                                                                                          |
| P9-9  | What happens to notes and photos on reassignment? | **They belong to the assignment.** A new assignee doesn't see the previous one's; staff copy anything useful into the brief. Completed jobs leave the provider only a minimal record (no customer data).                                                                                 | It is the strictest reading of "providers see only what's assigned to them" and is easy to test.                                                                                                                          |
| P9-10 | Do orders get new statuses?                       | **Yes: `IN_DELIVERY` and `COMPLETED`**, driven by the job. One job per order in v1.                                                                                                                                                                                                      | Customers, finance (Phase 11 invoicing on completion for postpaid) and reports need the order's own state without reading jobs.                                                                                           |
| P9-11 | What exactly does the database enforce?           | **Approval, status, accepting work, active company tenant, allowed channel, every required skill at the minimum experience, county or remote** (one `app.can_take_job` function, checked on offer and on accept). **Availability is scored and shown, not enforced.**                    | It turns "approved, eligible, non-suspended" into a database rule. Jobs are often scheduled for a later day, so availability "now" would wrongly block offers.                                                            |
| P9-12 | When do the postponed signature features come?    | **Offline mode in Phase 12** (with the service worker for web push); **live map in Phase 15** (with the hosting, vendor and data-protection choices). Confirmed by the owner on 2026-11-10 (ADR-074).                                                                                    | Both depend on infrastructure that doesn't exist yet; Phase 9 builds the tracker and the retry-safe commands they will extend.                                                                                            |

## 7. Risks

- **Leaking customer data to providers.** Mitigation: no provider RLS branch on customer tables (P9-1), separate response schemas with no money or contact fields, the T5 canary suite over every provider route, page and email, and a short pre-accept view.
- **Stale access after reassignment.** Mitigation: every provider branch requires an ACTIVE assignment and an ACTIVE provider/tenant, ended in the same transaction as the change; T4 covers every way access ends.
- **Eligibility drift between the service and the database.** Mitigation: one SQL function used by both; a fixture matrix checks they agree.
- **Timeout races.** Mitigation: delayed job plus sweep, `expires_at` checked inside the accept transaction, `version` decides ties (the Phase 7/8 pattern).
- **Weak mobile signal.** Mitigation: idempotent commands with client retries, kept drafts, compressed photos, a chunk budget and a throttled e2e run.
- **Location and photo privacy (ADR-018).** Mitigation: no location collected; EXIF stripped by re-encoding on the phone; evidence owned by the customer and visible only to staff, the active assignee and the customer.
- **Sharing a site contact's phone with a third party** needs a lawful basis and privacy-notice wording (ADR-018, pending legal confirmation). Mitigation: shown only after acceptance and only while assigned; the owner should confirm the privacy notice covers it before launch.
- **The master spec is kept outside the public repo.** Mitigation: the plan follows the review, which quotes the spec; the owner confirmed P9-12's phase numbers against spec §22 (ADR-074).

## 8. Verification (how to check the phase end to end)

1. `pnpm infra:up`; ask the owner to run `pnpm db:reset:test` if the test database needs resetting (never `migrate reset` from the agent).
2. `pnpm check`, `pnpm test:integration` (T1–T10, RLS catalogue, isolation), `pnpm --filter @ogs/api build`, then `pnpm test:e2e` (T11, visual, axe, motif, slow network).
3. Manual run on a phone-sized window: order a service as an individual, record payment as finance, offer it to a demo provider company, accept as its admin with a technician, work the job as the technician (photo from the camera), confirm as the customer. Then reassign a second job and check that the first technician's page says "no longer assigned".

## 9. Delivery notes (2026-11-10)

Delivered as planned, with these refinements:

- **Two migrations.** `20261109190000_order_delivery_statuses` adds the two order statuses on its own, because PostgreSQL cannot use a new enum value in the transaction that adds it; `20261109190100_jobs` holds everything else.
- **Jobs for existing orders.** Instead of a backfill in the migration, the worker's 5-minute sweep opens a job for every READY_FOR_ASSIGNMENT order without one (it also catches any missed `jobs.order_ready` event).
- **Accepting is ordered for RLS.** The job moves to ASSIGNED and the assignment is inserted while the offer is still PENDING (the provider sees the job through it); then the offer becomes ACCEPTED, which its trigger allows only once the assignment exists. A company's technician change ends the old assignment first and copies the new one from it.
- **Customer name for providers.** There is no personal name field yet, so providers see an organisation's name or "Private customer", plus the site contact name OGS enters on the brief.
- **Photos while uploading.** A `job.evidence` file is visible to its uploader only inside the uploading transaction (so the evidence trigger can check it), and afterwards only through a visible `job_evidence` row. The generic `/files` download refuses job photos.
- **Photo retries.** Each photo has its own "Try again"; photo uploads do not take an Idempotency-Key, so a retry after a lost response can add a duplicate photo (harmless; the report cites the photos chosen).
- **Releases outside RLS reach.** When a provider, company or company membership stops being active, its jobs are released in the same transaction. When a PLATFORM membership is ended from the non-elevated platform workspace, that context cannot see the technician's assignments; the technician loses the workspace anyway, and the dispatcher reassigns.
- **Dashboard tile.** The customer dashboard's "In progress" tile is postponed: it needs a count endpoint, and the tracker on the request and ticket pages covers the need.
- **Design baselines.** The staff ticket queue and staff ticket pages now show the "Dispatch" nav item and the job card, so their 8 Linux baselines were removed; CI writes new ones (plus 20 for the five Phase 9 pages) for review and commit.
