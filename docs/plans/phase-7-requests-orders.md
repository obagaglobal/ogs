# Phase 7 Plan — Service Requests, Quotations and Orders

**Status:** APPROVED by the owner on 2026-11-06, with all recommendations P7-1 … P7-9 accepted. Built on branch `phase-7/requests-orders` (from `main`); ships as one PR into `main`, then waits for green CI and the owner's approval.

**Based on:**

- [Architecture Review](../architecture/review.md): §2 (D5 Commerce), §4.2 (`ServiceRequest`, `Quotation`, `ServiceOrder`, state machines), §8 (permission matrix), §9 (service request lifecycle), §11 (server-computed prices, idempotency) and §13 (Phase 7 row).
- ADRs:
  - ADR-009: individual customers' records are user-owned;
  - ADR-013: OGS assigns;
  - ADR-014: prepay vs postpay;
  - ADR-015 item 3: payments are recorded manually in Phase 7;
  - ADR-016: OGS is merchant of record;
  - ADR-017: 16% VAT;
  - ADR-039 … ADR-045: catalogue pricing, audience, VAT display.

**Starting point:** `main` @ `4248281`. Phases 2–6 are merged, PR #6 included.

## 1. Goal

A customer can **request a catalogue service**:

- an individual from the personal workspace;
- an organisation member with `request.create`.

OGS staff review the request. They either accept it at the catalogue price, or answer it with a **quotation**, which the customer accepts or rejects before it expires.

An agreed request becomes an **order**:

- prepaid customers reach "Ready for assignment" once finance records their payment;
- approved postpaid organisations reach it at once.

Review §13 sets the acceptance bar:

- every allowed transition is tested, and every disallowed one is rejected;
- there is one history row per transition;
- submission is idempotent;
- quotations expire.

Phase 7 stops at **Ready for assignment**. Assigning the work is Phase 9; tickets are Phase 8; invoices, M-Pesa and refunds are Phase 11.

## 2. Scope

### 2.1 Data model

All tables carry `customer_tenant_id` **or** `customer_user_id` (ADR-009); a CHECK requires exactly one.

| Table                          | Purpose                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_request`              | Number `REQ-2026-000123`. Service, **snapshot** of the catalogue price version at submission, quantity (`PER_UNIT`), county and address, preferred date window (Africa/Nairobi), description, contact phone, `created_by`, status, `version`.                                         |
| `service_request_event`        | Append-only history: from, to, actor, reason, at. One row per transition (review §9).                                                                                                                                                                                                 |
| `quotation` + `quotation_line` | Number `QUO-2026-000045`. Revision n of a request. Lines carry description, quantity, unit price in minor units, VAT in minor units, line total. Totals; `expires_at`; status DRAFT → ISSUED → ACCEPTED / REJECTED / EXPIRED / SUPERSEDED. Issued quotations are immutable (trigger). |
| `service_order`                | Number `ORD-2026-000067`. Created when the price is agreed. Totals copied from the accepted quotation or the catalogue snapshot; payment terms (PREPAY / POSTPAID); status AWAITING_PAYMENT → PAID → READY_FOR_ASSIGNMENT, or CANCELLED.                                              |
| `payment`                      | Manual payments recorded by finance (ADR-015): amount, method (BANK_TRANSFER, MPESA_PAYBILL), external reference (unique per method), recorded by, at. Append-only.                                                                                                                   |
| `organisation_billing`         | Payment terms per organisation (PREPAY by default; POSTPAID with net days), set by finance (P7-5).                                                                                                                                                                                    |
| `idempotency_key`              | The key, scope (user plus workspace), route, request hash, stored response and expiry (24 h) (P7-7).                                                                                                                                                                                  |
| `document_counter`             | Yearly counters per document type (REQ / QUO / ORD), taken with a row lock (P7-8).                                                                                                                                                                                                    |

**RLS:**

- Commercial rows are visible to the owning tenant (`customer_tenant_id = current tenant`) or the owning user (`customer_user_id = current user`), and to platform staff under an elevation.
- Workers get scoped `orders.*` jobs.
- Providers see nothing yet: assignment grants come in Phase 9 (ADR-010).
- `idempotency_key` is visible only to its own user context.

### 2.2 Lifecycle (review §9, transitions defined once in code)

```text
DRAFT ─submit─▶ SUBMITTED ─staff:review─▶ UNDER_REVIEW
  UNDER_REVIEW ─staff:accept (FIXED / PER_UNIT price)──────▶ ORDERED  (order created)
  UNDER_REVIEW ─staff:needs quotation (always for FROM / QUOTE)─▶ AWAITING_QUOTATION
  AWAITING_QUOTATION ─staff:issue──▶ QUOTATION_ISSUED
  QUOTATION_ISSUED ─customer:accept─▶ ORDERED (order created)
  QUOTATION_ISSUED ─customer:reject (reason) / expiry─▶ AWAITING_QUOTATION   (P7-3)
  any state before ORDERED ─customer or staff:cancel (reason)─▶ CANCELLED
Order:  AWAITING_PAYMENT ─finance:record payment (total reached)─▶ PAID ─▶ READY_FOR_ASSIGNMENT
        postpaid organisation: ORDERED → READY_FOR_ASSIGNMENT directly (ADR-014)
        AWAITING_PAYMENT ─customer or staff:cancel─▶ CANCELLED
        after PAID: staff-only cancel with reason, marked "refund due" (refunds are Phase 11)
```

- **One transition table,** `transitions.ts`, lists for each command the allowed from-states, the actor and the permission. Every command:
  - runs in one transaction;
  - checks the actor, permission, current state and `version`;
  - writes a history row, an audit row and an outbox event.
- **Customers see simplified labels:** Submitted, Being reviewed, Quotation ready, Awaiting payment, Confirmed, Cancelled.

### 2.3 Requesting (customers)

- `POST /requests`, using the `Idempotency-Key` header (P7-7). The server snapshots the current catalogue price, so the client never sends a price (review §11).
- **Refused cases:**
  - the service is not published;
  - the audience doesn't match (P6-4): e.g. organisations-only services from a personal workspace;
  - the workspace is provider, platform or restricted;
  - a `PER_UNIT` request is below the minimum quantity.
- **Who requests:**
  - individuals: the personal workspace, `user` context;
  - organisations: a workspace with `request.create`.
- **Who sees what (P7-9):**
  - organisation members with `request.read_all` (admins) see every request of the organisation;
  - other members see only their own;
  - individuals see their own.
- **Customer actions:** cancel before ordering; accept or reject a quotation (`quotation.accept` in organisations; the owner for individuals).

### 2.4 Staff

- **Request queue** `GET /platform/requests?status=…` under elevation. Actions: review, accept at catalogue price, route to quotation, cancel with reason. Needs `platform.quotation.issue` (service manager).
- **Quotations:**
  - draft lines, preview the totals, set validity (1–60 days, default 14), issue;
  - issuing a new revision supersedes the open one;
  - only the latest issued revision can be accepted.
- **Quotation expiry:**
  - a delayed job fires at `expires_at`, plus an hourly sweep as a safety net;
  - both are idempotent: expiry happens once, and a late acceptance is refused.
- **Payments (P7-4):** finance (`platform.finance.manage`, elevated) records payments against an order, behind a `PaymentRecorder` interface that Phase 11's M-Pesa will implement.
  - Partial payments are allowed, and overpayment is refused.
  - A duplicate reference is refused.
  - The order becomes PAID when the total is reached.
- **Billing terms (P7-5):** finance sets an organisation's terms.

### 2.5 Money and VAT (P7-6)

- All amounts are integer minor units, KES.
- VAT is 16% per line on the VAT-exclusive amount, rounded half up to the cent and stored per line. Totals are sums of stored values, never recomputed differently.
- Shared helpers live in `@ogs/contracts` (`lineTotals`, `documentTotals`), with property tests.
- ADR-017 is still pending advisor confirmation: the rate is one constant.

### 2.6 Notifications (outbox → email)

- **Customer:** request received; quotation issued (with expiry date); quotation expiring in 48 h; payment recorded; order confirmed (ready for assignment); cancelled.
- **Staff:** a daily digest of new requests is deferred. Phase 7 shows the queue in the web app.

### 2.7 Web

- **Customer:**
  - "Request this service" on the public service page: sign in, then a request form (quantity, county, address, preferred dates, description, phone) with a price preview;
  - "Requests" list and detail: status timeline, quotation with lines, totals and VAT, accept/reject, cancel, and payment instructions for prepaid orders.
- **Staff:**
  - "Requests" queue and detail (review, accept, route to quotation, cancel);
  - quotation editor with live totals;
  - "Payments" (finance): find an order, record a payment, see the balance;
  - organisation billing terms.

## 3. Out of scope

| Item                                                                       | When           |
| -------------------------------------------------------------------------- | -------------- |
| Assigning work, offers, technicians (`READY_FOR_ASSIGNMENT` onwards)       | Phase 9        |
| Tickets, attachments on requests, staff ordering "on behalf" of a customer | Phase 8        |
| Invoices, eTIMS, M-Pesa STK push and callbacks, refunds, credit limits     | Phase 11       |
| Contract-covered requests (managed contracts)                              | After Phase 11 |
| Several services in one request (cart)                                     | After v1       |
| Disputes, ratings                                                          | Phases 12–13   |

## 4. Tests and acceptance

| ID  | Proves                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | **Transition table.** Every command × every state × every actor is table-driven. Allowed transitions succeed; all others are refused with 409/403. Exactly one history row per transition, plus audit and outbox.                                                                                                                                                              |
| F2  | **Idempotent submission and acceptance.** The same key and body give the same response and one row. The same key with a different body gives 422. Keys are scoped per user and workspace. Two parallel submissions with one key create one request.                                                                                                                            |
| F3  | **Price integrity.** The request keeps its snapshot after a catalogue price change. Retired services, audience mismatches and quantities below the minimum are refused. `FROM` and `QUOTE` services always go to quotation. A client-sent price is ignored.                                                                                                                    |
| F4  | **Quotations.** Line and total arithmetic in integer minor units (property test). Issue, supersede, accept, reject. Expiry fires exactly once (job plus sweep, at the boundary instant). Accepting an expired or superseded quotation is refused. Issued quotations are immutable in the database.                                                                             |
| F5  | **Payments.** Finance only, under elevation. Partial payments, then PAID at the total. Overpayment and duplicate references are refused. Payments are append-only. Concurrent recordings never exceed the total.                                                                                                                                                               |
| F6  | **Payment terms.** Postpaid organisations skip "Awaiting payment". Individuals and prepaid organisations never do. Changing terms does not alter existing orders.                                                                                                                                                                                                              |
| F7  | **Isolation.** Another organisation's or person's requests, quotations, orders and payments answer 404 (and 403 for a foreign workspace). Employees see only their own unless they hold `request.read_all`. Providers and anonymous visitors see nothing. All new tables join the RLS catalogue and isolation suites.                                                          |
| F8  | **Concurrency.** Two staff deciding the same request: one wins and the other gets 409. A double acceptance creates one order.                                                                                                                                                                                                                                                  |
| F9  | **Notifications.** Each customer email is sent once per event, to the right people (requester, plus organisation admins for quotations).                                                                                                                                                                                                                                       |
| F10 | **Web.** Component tests for the request form, quotation view and totals, and the staff quotation editor. Playwright journeys: an individual requests a fixed-price service → staff accept → finance records the payment → "Confirmed"; and an organisation employee requests a quotation-only service → staff issue a quotation → the admin accepts → postpaid → "Confirmed". |

## 5. Delivery

| Part         | Content                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7A — backend | Schema, RLS, triggers, counters and idempotency; the transition table and commands; customer and staff endpoints; quotation expiry jobs; manual payments; billing terms; emails; tests F1–F9.            |
| 7B — web     | Customer request flow and pages; staff queue, quotation editor, payments, billing terms; Playwright journeys (F10). Docs: overview section, ADRs for P7-1 … P7-9, plan delivery notes, CLAUDE.md status. |

As in earlier phases: one approval, two halves with no gate between them, one PR into `main`, then green CI and your approval before Phase 8.

## 6. Decisions needed before starting

| ID   | Question                                              | Recommendation                                                                                                                                                                                                                     | Why                                                                                                                                                        |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P7-1 | Request and order: one record or two?                 | **Two:** `service_request` (intent, negotiation) and `service_order` (the commercial commitment, created when the price is agreed).                                                                                                | It matches review §4.2. Phase 9 assigns orders, Phase 11 invoices orders, and requests that never become orders stay out of finance.                       |
| P7-2 | Who can request in Phase 7?                           | **Individuals (personal workspace) and organisation members with `request.create`.** Staff ordering on behalf of a customer waits for the helpdesk in Phase 8.                                                                     | It covers both customer types without a staff impersonation path, which deserves its own audit design.                                                     |
| P7-3 | What happens when a quotation is rejected or expires? | **The request returns to "Awaiting quotation"** so staff can revise it, and the customer is told. Either side can cancel at any time before ordering. The review's diagram sends both to Cancelled; this keeps negotiations alive. | Most rejections in B2B ICT are "too expensive, can you adjust?". Auto-cancelling would force customers to start again.                                     |
| P7-4 | How are payments recorded before Phase 11?            | **Manually by finance** (bank transfer or M-Pesa paybill reference), behind a `PaymentRecorder` interface. Partial payments are allowed; overpayment is not; references are unique per method.                                     | ADR-015 item 3. The interface lets Phase 11 add M-Pesa without touching order logic.                                                                       |
| P7-5 | Who decides that an organisation is postpaid?         | **Finance, per organisation** (`organisation_billing`: PREPAY by default, or POSTPAID with net days), under elevation and audited. The terms are copied onto each order when it is created.                                        | ADR-014 allows postpay for approved organisations. Copying the terms keeps old orders stable when terms change.                                            |
| P7-6 | How is VAT computed?                                  | **Per line, 16% of the VAT-exclusive amount, rounded half up to the cent, stored per line.** Totals are sums of stored lines. One rate constant.                                                                                   | Invoices (Phase 11) need line-level VAT, and stored values avoid recomputation drift. ADR-017 still needs the tax advisor; only the constant would change. |
| P7-7 | How is idempotency done?                              | **An `Idempotency-Key` header** (UUID) on submit, quotation acceptance and payment recording. Stored for 24 h with the request hash and response. A replay returns the stored response; a mismatched body gets 422.                | Review §11 and §13 require idempotent submission. The same mechanism serves Phase 11 payment callbacks.                                                    |
| P7-8 | How are documents numbered?                           | **Yearly counters per type:** `REQ-2026-000123`, `QUO-…`, `ORD-…`, from a locked counter row in the same transaction.                                                                                                              | Customers and finance quote these numbers. Counters never skip on rollback within the transaction, and reset each year.                                    |
| P7-9 | Who in an organisation sees which requests?           | **Admins (`request.read_all`) see all of them; members see their own.** RLS enforces the tenant boundary; the service layer enforces the member/admin split, and F7 tests it.                                                      | It matches the permission catalogue and the review matrix ("own/dept"). Department-level visibility can be added with Phase 8 tickets if wanted.           |

## 7. Risks

- **State machine complexity.** Mitigation: one transition table drives both the code and the F1 tests, so the tests cannot drift from the rules.
- **Money errors.** Mitigation: integer minor units everywhere, values stored per line, property tests, and database CHECKs (totals equal the sum of lines, non-negative amounts).
- **Expiry timing.** Mitigation: a delayed job plus an idempotent sweep, and acceptance checks `expires_at` in the same transaction, so an accept a second late is refused even if the job hasn't run.
- **Tax treatment** is still pending the advisor (ADR-017). Mitigation: one constant and per-line storage, so a correction affects only new documents.

## 8. Delivery notes (2026-11-06)

Delivered as planned, with these refinements:

- **No DRAFT request state.** Submitting creates the request directly as SUBMITTED in one idempotent call, so there is no separate draft-then-submit step. Every transition in §2.2 from SUBMITTED onwards is as planned.
- **Payment completion.** The payment that reaches the total moves the order AWAITING_PAYMENT → PAID → READY_FOR_ASSIGNMENT in the same transaction, with two history rows.
- **Order creation by customers.** Accepting a quotation creates the order in the customer's own context. A database trigger refuses any customer-created order that does not match the accepted quotation and the organisation's billing terms, so the customer path cannot be used to forge a price.
- **Personal records stay personal.** A person's own requests are visible only from their personal workspace, never from an organisation workspace they belong to (`app.owns_customer_row`).
- **Cancellation.** Customers cancel requests before ordering, and orders only while unpaid. Finance can cancel any order that isn't already cancelled; a paid order is marked "refund due" (refunds are Phase 11).
- **Billing terms in the web app** are edited from an organisation's order page rather than a separate list, because finance has no organisation directory yet.
- **Found while testing.**
  - The Phase 6 web test expected the disabled "coming soon" button; it now checks the real "Request this service" link.
  - Late in the full integration run, the worker's email backlog can exceed `waitForMail`'s default 15 seconds; the Phase 7 email assertions allow 45.
