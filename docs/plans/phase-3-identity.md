# Phase 3 Plan — Identity, Access and the First Usable Shell

**Status:** APPROVED by the owner on 2026-11-05, with all recommendations P3-1 … P3-7 accepted. 3A is delivered first; 3B follows after its own review.
**Based on:** [Architecture Review](../architecture/review.md) §7, §8, §11 and §13 (Phase 3 row), ADR-011 (sessions), ADR-015 (D-7 items 2 and 4), ADR-019/028 (files), ADR-025 (email), ADR-027 (API-level isolation suite).
**Starting point:** branch `phase-2/tenancy` @ `d729f3e`. That PR is not merged and its CI has not run yet, so Phase 3 work is stacked on top of it (branch `phase-3/identity`).

## 1. Goal

When Phase 3 ends, a person can register, verify their email, sign in (with MFA where required), choose a workspace and call the API in that workspace's context. The server, not the client, decides what that context grants. This is the first phase where tenant isolation is proven **through the HTTP API**, not only in the database.

Phase 3 carries more than any earlier phase, so I recommend splitting it into two gated halves (**P3-1**):

- **3A — Identity core:** accounts, passwords, email, sessions, roles and permissions, the workspace guard, and the API isolation suite.
- **3B — Hardening and shell:** MFA and step-up, platform-context elevation, FileService with MinIO, and the minimal web shell.

Each half is planned here, but each is delivered, reviewed and approved separately.

## 2. Phase 3A — Identity core

### 2.1 Accounts and passwords

- **Registration:** `POST /api/v1/auth/register` takes an email and a password and creates an `app_user` (PENDING_VERIFICATION) with a credential.
  - The response is identical whether or not the email is already registered, so it cannot be used to discover accounts. An already-registered address gets a "you already have an account" email instead.
- **Email verification:** a single-use token valid for 24 h. Until verified, a user can sign in but only sees a "verify your email" state. Every other endpoint returns 403 `email_unverified`.
- **Password rules (OWASP ASVS L2):**
  - 12–128 characters, any characters allowed, no composition rules.
  - Checked against a breached-password list (**P3-4**).
  - Hashed with **Argon2id** from Node 24's built-in `node:crypto` (`crypto.argon2`), so no native dependency is needed.
  - Parameters: 19 MiB memory, 2 iterations, 1 lane (the OWASP baseline). They are stored with each hash so they can be raised later; a hash with old parameters is upgraded at the next successful login.
- **Password reset:**
  - `forgot` always answers 202, whether or not the account exists.
  - The emailed token is single-use and valid for 30 minutes.
  - A successful reset revokes **all** of the user's sessions.
- **Tokens:** 256 bits of randomness. Only a SHA-256 hash is stored, and each token has a `purpose`, an expiry and a consumed timestamp. One `user_token` table serves verification, reset and (in 3B) MFA recovery.

### 2.2 Sessions (ADR-011)

- **Storage:**
  - A session is an opaque 256-bit id, kept in Redis as `sess:{sha256(id)}`.
  - It records: user id, created at, last seen, absolute expiry, IP, user agent, MFA level and the time of the last step-up.
  - A per-user index lets the user list and revoke their own sessions.
- **Cookie:** `__Host-ogs_session`, with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and no `Domain`.
  - Browsers do not treat `http://localhost` as secure for `Secure` cookies, so development uses an `ogs_session` cookie without the `__Host-` prefix. The production cookie name is fixed and checked at startup.
- **Lifetime:** 30 minutes idle and 12 hours absolute. The session id is rotated when the user signs in, completes MFA or changes their password.
- **CSRF:**
  - `GET /api/v1/auth/csrf` returns a token tied to the session.
  - Every unsafe method (POST, PUT, PATCH, DELETE) must send it in `X-CSRF-Token`, compared in constant time.
  - SameSite=Lax is defence in depth, not the only protection.
- **Endpoints:**
  - `POST /auth/login` and `POST /auth/logout`
  - `GET /auth/session` (who am I, plus the current workspace)
  - `GET /auth/sessions` and `DELETE /auth/sessions/:id`
  - `POST /auth/sessions/revoke-others`

### 2.3 Abuse controls

- **Rate limiting:** Redis fixed-window counters per IP and per account for login, register, forgot and verify.
  - Exceeding a limit returns 429 with `Retry-After`.
  - The limiter **fails closed** for authentication endpoints if Redis is down. The rest of the API is unaffected.
- **Lockout:**
  - After 5 consecutive failures, each further attempt is delayed progressively.
  - After 10, the account is locked for 15 minutes and the owner is emailed.
  - The lockout state is kept in the database (`credential.failed_attempts`, `locked_until`), not only in Redis.
  - Responses never reveal whether the email exists or the account is locked: "Invalid email or password".
- **Authentication events:** every attempt is written to an append-only `authentication_event` table with the outcome, reason code, IP, user agent and user id where known. Notable events (lockout, password change, session revocation, MFA changes) also go to the audit log.

### 2.4 Roles and permissions (review §8)

- **Permissions** are platform-defined codes such as `membership.invite` or `ticket.assign`. They live in a `permission` table, each scoped to the tenant kinds it may be used in.
- **System roles are seeded from code**, not hand-written SQL, so code and data cannot drift. The seeded set:
  - Organisation: admin, employee
  - Provider company: admin, technician
  - Platform: super admin, helpdesk, service manager, finance, compliance
  - The remaining platform roles from spec §4.6
- **Custom roles:** organisations may create their own from permissions allowed for their tenant kind. A database trigger enforces that an organisation role can never contain a platform permission.
- **Permission codes:** Phase 3 delivers the full code list with descriptions in `docs/architecture/permissions.md`, which closes review §8. Only the identity, membership and platform codes are wired to endpoints now. The rest exist as data for later phases.
- **Membership roles:** a `membership_role` table links memberships to roles. Effective permissions are the union of a membership's roles. They are loaded once per request and cached per session (invalidated by a version counter when roles change).
- **Guard:** a `@RequirePermission('code')` decorator plus a guard. **Default deny:** an endpoint without a permission declaration or an explicit `@Public()` fails a startup check.

### 2.5 Workspace guard (review §5)

- **Header:** each request selects a workspace with `X-OGS-Workspace: personal | <tenantId>`. If the header is absent, the request runs in the personal workspace.
- **Resolution:** the existing `WorkspaceContextService` resolves the header to a `DbContext`, and that context is the **only** way a controller reaches `TenantDb`. Controllers receive it through a `@Ctx()` parameter decorator.
- **Restricted contexts** (tenant pending, rejected or suspended) reach only endpoints marked `@AllowRestricted()`. In Phase 3 that is the application-status endpoint and reading one's own membership.
- **`GET /api/v1/me/workspaces`** serves the workspace switcher.
- **Platform context:** a `platform` `DbContext` is never produced by this guard. Elevation is part of 3B.

### 2.6 Email (ADR-015 item 2, ADR-025)

- **Sending:** an `EmailSender` interface. Development and CI use a **Mailpit** container (SMTP plus a web inbox at `http://localhost:8025`) through `nodemailer` (**P3-2**). The production provider is chosen later, behind the same interface.
- **Templates:** plain text plus simple HTML, in English only, with strings kept in one module so they are ready for translation later (ADR-024).
- **Delivery path:** emails are sent **through the outbox**. The business transaction publishes `identity.email_verification_requested`, and a worker handler renders and sends the email. A crash cannot lose an email, and a retry cannot send it twice: the handler is idempotent on the event id, with sent ids tracked in a `notification_delivery` table.

### 2.7 RLS for identity tables

Login and registration happen before any user context exists, so they need narrowly scoped database access:

- **New setting:** a GUC, `app.job`, set only for `system` contexts. It names the job, and the policies match on that name.
- **`credential`, `user_token` and `authentication_event`:** readable and writable only by the user themself, or by `system` context with a job of `identity.*`.
- **`app_user` inserts:** a new policy allows them only under `system` context with job `identity.register`.
- **Isolation:** all existing tenant isolation stays unchanged. The Phase 2 catalogue guard automatically covers the new tables.

### 2.8 API-level isolation suite (ADR-027)

A Supertest suite drives real sessions through the HTTP API. For every endpoint that exists in Phase 3 it checks:

- user A cannot read or change B's data by changing an id in the URL or body;
- a forged or foreign `X-OGS-Workspace` gets 403;
- an ended membership loses access on the **next** request;
- a suspended tenant drops to restricted on the next request;
- a session revoked in another tab stops working immediately.

## 3. Phase 3B — Hardening and shell

### 3.1 MFA and step-up

- **Factors:** TOTP (RFC 6238, SHA-1, 6 digits, 30-second period, ±1 step of tolerance) plus 10 single-use recovery codes, each stored hashed (**P3-5**). WebAuthn comes later. SMS is not offered as a factor because of SIM-swap risk.
- **Secrets:** the TOTP secret is encrypted at rest with AES-256-GCM, using a key from `MFA_ENCRYPTION_KEY`. Key rotation is supported through a key id stored with each secret.
- **Login:** when a factor is enrolled, login is two steps. The password creates a session at `mfa_level=0`, and `POST /auth/mfa/verify` raises it to 1. Until then, the session reaches only the MFA endpoints.
- **Mandatory MFA** (review §11) applies to PLATFORM memberships, organisation and provider-company admin roles, and finance. A user who needs MFA but has not enrolled gets only the enrolment endpoints.
- **Step-up:** `@RequireRecentMfa(minutes)` requires a TOTP check within the last N minutes. It protects platform workspaces, role changes, credential changes and the platform-context elevation below.

### 3.2 Platform-context elevation (review §6.3)

- **Endpoint:** `POST /api/v1/platform/elevate` takes `{ reason, tenantId? }`. It needs the `platform.cross_tenant_access` permission and a step-up.
- **Result:** a short-lived (15-minute) elevation recorded on the session. During it, requests carrying `X-OGS-Elevation: <id>` get a `platform` `DbContext`, and every unit of work is audited, which `TenantDb` already does.

### 3.3 FileService (ADR-019, ADR-028)

- **Storage:** a MinIO container in Compose and a private bucket, accessed through `@aws-sdk/client-s3`.
- **Metadata:** a `file_metadata` table records owner (tenant or user), purpose, size, sniffed MIME type, SHA-256 and status (`QUARANTINED → CLEAN | REJECTED`).
- **Upload:** a server-mediated multipart upload with size limits per purpose. The type is detected from magic bytes, not the file extension, and checked against an allow-list per purpose.
- **Scanning:** a `FileScanner` interface. Its Phase 3 implementation only checks type and size and marks files CLEAN. ClamAV plugs in later (Phase 15/16) without code changes.
- **Download:** only through an endpoint that checks RLS and permissions, then returns a 60-second presigned URL. Files are never public and never listed from the bucket.
- **First consumer:** none in Phase 3; provider documents arrive in Phase 5. The service is proven by tests only.

### 3.4 Minimal web shell (ADR-015 item 4)

- **Pages:** sign up, sign in, the MFA prompt, verify email, forgot and reset password, a session list with "sign out other devices", and a header **workspace switcher** that always shows the current workspace.
- **Placeholder dashboard:** a page per workspace kind ("Organisation workspace — features arrive in Phase 4").
- **Stack:** React Router and TanStack Query, with shadcn/ui forms validated by the same Zod schemas from `@ogs/contracts`.
- **Accent colour:** uses a neutral placeholder until ADR-022's accent colour is chosen.
- **Out of scope:** UI polish.

## 4. Out of scope

| Item                                                                  | When            |
| --------------------------------------------------------------------- | --------------- |
| Organisation registration and approval, invitations, departments      | Phase 4         |
| Provider applications and KYC documents                               | Phase 5         |
| Social or SSO login, WebAuthn/passkeys, SMS OTP                       | later (post-v1) |
| Production email/SMS vendors, ClamAV, NGINX, production cookie domain | Phases 15–16    |
| Swahili translations                                                  | after v1        |

## 5. Tests and acceptance

Review §13, Phase 3 row, plus the items carried in from earlier decisions.

| #    | Proves                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | Register, verify, login, logout, forgot and reset flows work end to end with Supertest, with emails captured from Mailpit                                             |
| A2   | Account enumeration is impossible: identical status, body and roughly equal timing for existing and unknown emails on register, login and forgot                      |
| A3   | Argon2id hash format and parameters are correct, and old parameters are rehashed on login                                                                             |
| A4   | Lockout after 10 failures, progressive delay after 5, 429 with `Retry-After` from the rate limits, and the limiter fails closed                                       |
| A5   | Session rotation on login; idle and absolute expiry; revoke one or all; a password reset kills every session                                                          |
| A6   | CSRF: unsafe requests without a valid token get 403; a token from another session is rejected                                                                         |
| A7   | Cookie flags are correct in production mode                                                                                                                           |
| A8   | Every endpoint declares a permission or `@Public()`, enforced by a startup check and a test                                                                           |
| A9   | An organisation custom role cannot contain a platform permission (trigger and API)                                                                                    |
| A10  | API isolation suite (§2.8)                                                                                                                                            |
| A11  | Authentication events and audit entries are written for every flow, and no secret ever appears in logs, audit metadata or responses                                   |
| A12  | Email via the outbox: a crash or retry never loses or duplicates an email                                                                                             |
| B1   | TOTP enrolment, verification, ±1-step drift, replay of a used code rejected, recovery codes single-use                                                                |
| B2   | Mandatory-MFA roles cannot reach anything except enrolment                                                                                                            |
| B3   | Step-up required and expires; elevation needs permission, step-up and a reason, expires after 15 minutes, and is fully audited                                        |
| B4   | FileService: a type mismatch is rejected, the size limit is enforced, files are quarantined until CLEAN, presigned URLs expire, and another tenant's file returns 404 |
| B5   | Web: component tests for the forms and switcher, plus one Playwright smoke test (sign up → verify via Mailpit → sign in → switch workspace)                           |
| ASVS | OWASP ASVS L2 V2 (authentication), V3 (sessions) and V4 (access control) checklist filled in at `docs/security/asvs-phase3.md`                                        |

**Acceptance for each half:**

- Every test listed for that half passes locally on Windows and in CI.
- `pnpm check` passes.
- The README PowerShell steps work from a clean clone.
- The docs and decision records are updated.

## 6. Delivery

| Half | Commits (approximately)                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3A   | 1. Identity schema and RLS. 2. Password and token services. 3. Sessions, CSRF and rate limits. 4. Registration, verification and reset endpoints plus email through the outbox and Mailpit. 5. Roles, permissions and seed. 6. Workspace guard and `/me`. 7. API isolation suite and docs. |
| 3B   | 1. MFA and step-up. 2. Platform elevation. 3. MinIO and FileService. 4. Web shell. 5. Playwright smoke test and the ASVS checklist.                                                                                                                                                        |

**New dependencies:**

| Package                                                  | Used for                                |
| -------------------------------------------------------- | --------------------------------------- |
| `nodemailer`                                             | email                                   |
| `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` | file storage (3B)                       |
| `file-type`                                              | MIME sniffing (3B)                      |
| `react-router` and `@tanstack/react-query`               | web shell (3B)                          |
| `@playwright/test`                                       | browser smoke test (dev dependency, 3B) |

No TOTP library is needed: the algorithm is about 30 lines on top of `node:crypto`, tested against the RFC 6238 test vectors. No Argon2 package is needed either, because `node:crypto` provides it.

## 7. Decisions needed before starting

| ID   | Question                                     | Recommendation                                                                                                                               | Why                                                                                                            |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| P3-1 | Deliver Phase 3 in one go, or as 3A then 3B? | **3A then 3B**, each with its own approval                                                                                                   | Each review stays manageable, and 3A unblocks Phase 4 sooner.                                                  |
| P3-2 | Development and CI email                     | **Mailpit** container plus `nodemailer` SMTP behind `EmailSender`                                                                            | Tests can read real emails, and no vendor account is needed yet (ADR-025).                                     |
| P3-3 | Who may register?                            | **Open self-registration** for individuals; organisations and providers apply after signing in (Phases 4–5)                                  | Matches the marketplace model, and every account starts as an individual (review §7).                          |
| P3-4 | Breached-password check                      | **Offline list** of the top 100k breached passwords, bundled and hashed, plus an optional HIBP k-anonymity lookup that is **off by default** | No external call on the login path. HIBP can be switched on once a data-protection review allows it (ADR-018). |
| P3-5 | MFA factors in v1                            | **TOTP plus recovery codes**; WebAuthn later; never SMS                                                                                      | Strong and free. SMS invites SIM-swap attacks.                                                                 |
| P3-6 | Session lifetime                             | **30 minutes idle, 12 hours absolute**; platform and finance workspaces also need step-up within 15 minutes for sensitive actions            | Balances usability with ASVS L2.                                                                               |
| P3-7 | Unverified accounts                          | **May sign in but can do nothing** except verify, resend and sign out                                                                        | Fewer support tickets than refusing sign-in, and still safe.                                                   |

## 8. Risks

- **The Phase 2 CI has not run yet.** Phase 3 is stacked on an unverified branch. Mitigation: open the Phase 2 PR (or push and let CI run) before Phase 3A is complete, and fix anything Linux-specific there first.
- **`node:crypto` Argon2 is newer than the npm packages.** Mitigation: tests use the RFC 9106 test vectors, and the `PasswordHasher` interface allows a swap to `@node-rs/argon2` if needed.
- **Timing-based enumeration.** Mitigation: unknown emails are hashed against a dummy hash, so the work done matches a real check, and A2 measures it.
- **Cookies on localhost vs production.** Mitigation: the cookie settings are configured explicitly and A7 tests production mode.
