# Phase 4 Plan — Organisations, Approvals, Invitations and Members

**Status:** APPROVED by the owner on 2026-11-06, with all recommendations P4-1 … P4-8 accepted. Delivered as 4A (backend), then 4B (web), with no gate between them.
**Based on:** [Architecture Review](../architecture/review.md) §2 (D2), §4.2, §5, §7, §8 and §13 (Phase 4 row), ADR-009, ADR-015, review contradiction 4, and ASVS follow-ups F-1 and F-2 (`docs/security/asvs-phase3.md`).
**Starting point:** branch `phase-3/identity` @ `465223c`. That branch and Phase 2 are pushed but not yet merged, so Phase 4 is stacked on top (`phase-4/organisations`).

## 1. Goal

An organisation can go from "a person with an account" to an approved, working tenant:

1. The person applies to register the organisation.
2. OGS staff review the application and approve it, request changes or reject it. Every decision is audited and the applicant is notified.
3. The organisation's admins invite colleagues, give them roles (system or custom) and departments, and suspend or remove them.

Until approval, the organisation can see and edit its application and **nothing else**. Phase 5 reuses the same application and approval machinery for provider companies.

## 2. Scope

### 2.1 Organisation application

- **Create** (`POST /api/v1/organisations`): any verified user can apply. It creates, in one transaction:
  - a `tenant` (ORGANISATION, `PENDING_APPROVAL`);
  - an `organisation_profile`;
  - an `organisation_application` (`DRAFT`);
  - an ACTIVE membership for the applicant with the `org_admin` role.

  The applicant then works in the restricted workspace (Phase 2 status gates).

- **Profile fields** (Kenya first, international-ready):
  - legal name and trading name;
  - business registration number (BRS) and KRA PIN, each optional with a stated reason;
  - country (ISO 3166, default `KE`) and county or region;
  - physical address, phone (E.164) and contact email;
  - industry and employee-count band.
- **Documents:** the certificate of incorporation or business name, and the KRA PIN certificate. These are uploaded through `FileService` with a new purpose, `organisation.document` (PDF/JPEG/PNG, 10 MB). This is the **first file upload endpoint**: `POST /api/v1/files` (multipart, purpose + file) with `GET /api/v1/files/:id/download`.
- **Application lifecycle**, with every transition written to `organisation_application_event` (from, to, actor, reason, at) and audited:

  ```text
  DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED        (tenant → ACTIVE)
     ▲                  │  └──reject──────▶ REJECTED        (tenant → REJECTED, final)
     │                  └──request changes──▶ CHANGES_REQUESTED
     └──────────── edit and resubmit ◀────────┘
  ```

- **Editing:** the applicant can edit while the application is `DRAFT` or `CHANGES_REQUESTED`. Submitting requires the mandatory fields and at least one document.
- **Who can create a tenant:** tenant creation by a user goes through a `system` context with the job `organisations.register`. A new narrowly scoped RLS policy allows exactly that; staff creation needs no change.

### 2.2 Platform review (staff)

All review endpoints run under platform elevation (Phase 3B).

| Endpoint                                                                        | Permission                | Purpose                                                      |
| ------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/platform/applications?status=SUBMITTED`                            | `platform.tenant.review`  | Review queue                                                 |
| `GET /api/v1/platform/applications/:id`                                         | `platform.tenant.review`  | Application, profile and documents (presigned links)         |
| `POST /api/v1/platform/applications/:id/approve`, `/reject`, `/request-changes` | `platform.tenant.approve` | Decide; a reason is mandatory for reject and request-changes |
| `POST /api/v1/platform/tenants/:id/suspend`, `/reactivate`                      | `platform.tenant.approve` | Suspend or reactivate; a reason is mandatory                 |

Every decision is an outbox event. The worker emails the organisation's admins: approved, changes requested (with the reason), rejected (with the reason), suspended or reactivated. Staff cannot approve an application they submitted themselves (separation of duties).

### 2.3 Invitations

- **Invite** (`POST /api/v1/workspace/invitations`, permission `membership.invite`): takes an email, one or more role ids allowed for the tenant kind, and an optional department. Each invitation is single-use, expires after 7 days, is stored as a SHA-256 hash and is emailed through the outbox. Re-inviting the same email revokes the previous invitation.
- **List and revoke** pending invitations, with permission `membership.invite`.
- **Accept** (`POST /api/v1/invitations/accept`): the signed-in, verified user's email must equal the invited email (review §7: "accepting with a different logged-in email is rejected"). Accepting creates or reactivates the membership with the invited roles.
  - People without an account follow the link to sign-up, with the email prefilled. After verifying, they accept.
  - Accepting into a tenant that is not ACTIVE is refused.

### 2.4 Members, roles and departments

| Endpoint                                       | Permission                                       | Purpose                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /workspace/members/:id`                 | `membership.manage`                              | Suspend, reactivate or end a membership; change department                                                                                                                    |
| `PUT /workspace/members/:id/roles`             | `role.manage`                                    | Replace a member's roles                                                                                                                                                      |
| `GET/POST/PATCH/DELETE /workspace/roles`       | `role.read` / `role.manage`                      | Custom roles, from permissions allowed for the tenant kind (the Phase 3 trigger still applies). System roles are read-only. Deleting a role that is still granted is refused. |
| `GET/POST/PATCH/DELETE /workspace/departments` | `department.manage` (reading: `membership.read`) | Flat list of departments in v1; a department can be archived, not hard-deleted                                                                                                |

- **Last-admin protection** is enforced in the database. Removing, suspending or ending the **last ACTIVE `org_admin`** is refused, so an organisation can never lock itself out. This holds even under concurrent requests.
- **Self-protection:** an admin cannot end or suspend their own membership through these endpoints. Leaving the organisation is a separate `POST /workspace/leave`, which is refused for the last admin.
- Every change is audited with before and after values in the metadata (never secrets).

### 2.5 Security notifications (ASVS follow-up F-2)

New outbox events and emails tell the account owner about:

- a password change;
- a password reset;
- MFA turned on or off;
- recovery codes regenerated.

### 2.6 Web

- **Organisation application:** "Register an organisation" (form plus document upload) and an application status page that shows the state, the reviewer's reason and edit-and-resubmit.
- **Workspace pages:** members (invite, roles, suspend, end), roles (custom role editor with a permission checklist grouped by area), departments and the organisation profile.
- **Invitation accept page**, plus sign-up that prefills and locks the invited email.
- **Staff pages:** the application review queue and detail page (approve / request changes / reject with a reason). They prompt for step-up and elevation when needed.
- **Password strength meter** on sign-up, reset and change (ASVS follow-up F-1). It is guidance only; the server rules do not change. It uses a small, offline, dependency-light estimator.

## 3. Out of scope

| Item                                                              | When                              |
| ----------------------------------------------------------------- | --------------------------------- |
| Provider companies and individual providers (they reuse §2.1–2.2) | Phase 5                           |
| Organisation-specific SLAs, contracts, billing details            | Phases 10–11                      |
| Automatic BRS or KRA verification by API                          | Later; manual review in v1 (P4-2) |
| Department hierarchy, cost centres                                | Later (flat list now, P4-5)       |
| Bulk invitations (CSV), SSO and SCIM for organisations            | After v1                          |

## 4. Tests and acceptance

Review §13, Phase 4 row, plus the items listed above.

| #   | Proves                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Pending organisations are inert:** every org endpoint except application and profile reading or editing answers `workspace_restricted` for `DRAFT`, `SUBMITTED`, `CHANGES_REQUESTED` and `REJECTED` (a table-driven test over the route list, so new endpoints are covered automatically) |
| C2  | Application lifecycle: every allowed transition works, every other one is refused, and each writes an event, an audit row and (where relevant) an email                                                                                                                                     |
| C3  | Approval needs elevation, step-up and `platform.tenant.approve`. Reject and request-changes need a reason. A staff member cannot approve their own application.                                                                                                                             |
| C4  | Invitations are single-use, expire, are bound to the email (wrong account → refused), are revoked when re-sent, and can only be accepted into an ACTIVE tenant. The token never appears in logs, audit rows or responses.                                                                   |
| C5  | The last active `org_admin` cannot be removed, suspended, demoted or ended, including two concurrent attempts                                                                                                                                                                               |
| C6  | Custom roles never hold platform permissions (API and trigger); system roles are immutable through the API; a role still granted cannot be deleted                                                                                                                                          |
| C7  | Isolation: every new endpoint is added to the API isolation suite (foreign ids → 404, foreign workspace → 403, missing permission → 403)                                                                                                                                                    |
| C8  | Multi-membership: a user in two organisations, and in an organisation plus a provider company, switches between them, and data and permissions never cross                                                                                                                                  |
| C9  | File upload endpoint: purpose and owner rules, multipart size cap, quarantine, and download only after scan (the Phase 3 B4 rules, over HTTP)                                                                                                                                               |
| C10 | Security notification emails (F-2) are sent once per event                                                                                                                                                                                                                                  |
| C11 | Web: component tests for the application form, members page and invitation accept page. The Playwright journey extends to apply → staff approves → admin invites → invitee accepts.                                                                                                         |

**Acceptance:** the Phase 3 bar applies, plus `docs/security/asvs-phase3.md` follow-ups F-1 and F-2 closed.

## 5. Delivery

| Part         | Commits (approximately)                                                                                                                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4A — backend | 1. Schema and RLS (profile, application and events, invitation, department, membership department, last-admin trigger). 2. Application service and endpoints and the file upload endpoint. 3. Platform review and notifications. 4. Invitations. 5. Members, roles and departments. 6. Security notifications (F-2). 7. Tests C1–C10. |
| 4B — web     | 1. Application and status pages. 2. Members, roles and departments pages. 3. Invitation flow. 4. Staff review pages. 5. Strength meter (F-1). 6. Playwright journey (C11).                                                                                                                                                            |

I recommend one approval for all of Phase 4, delivered as two reviewable halves (4A backend first) without a second approval gate, because 4B is only the UI for 4A. Tell me if you want a gate between them.

**New dependency:** `@nestjs/platform-express` already includes multer for multipart uploads, so no upload library is added. For the strength meter, see P4-7.

## 6. Decisions needed before starting

| ID   | Question                                                                                         | Recommendation                                                                                                                                                    | Why                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-1 | When does MFA become mandatory for the applicant (who is `org_admin` of a pending organisation)? | **At approval.** While the organisation is pending, the restricted workspace grants nothing operational. Once it is ACTIVE, the admin must enrol before using it. | Applying stays quick, and security is unchanged because a pending organisation can do nothing. Today the rule triggers immediately, so this is a small change to `MfaService.isRequired` (ACTIVE tenants only). |
| P4-2 | How are Kenyan business details verified?                                                        | **Manual staff review** of the BRS number, KRA PIN and uploaded certificates. No BRS or KRA API in v1.                                                            | No dependable public API to integrate yet. Documents plus a human reviewer meet the spec, and automation can follow.                                                                                            |
| P4-3 | Can someone be invited before they have an account?                                              | **Yes.** The link leads to sign-up with the email fixed. After verification they accept. Invitations last 7 days.                                                 | This is the normal way organisations onboard staff, and it is still bound to the email.                                                                                                                         |
| P4-4 | Is the last-admin rule enforced in the database or only in the API?                              | **Database trigger plus API checks**                                                                                                                              | Concurrent demotions cannot race past an API-only check.                                                                                                                                                        |
| P4-5 | Departments: flat or hierarchical?                                                               | **Flat in v1**, with archive instead of delete                                                                                                                    | Nothing yet needs a hierarchy. Tickets and requests can link to departments in later phases.                                                                                                                    |
| P4-6 | What happens to a rejected application?                                                          | **Rejection is final.** "Request changes" is the route back. A rejected applicant can start a new application later.                                              | Keeps the audit trail clear, and staff have the softer option when it fits.                                                                                                                                     |
| P4-7 | Which password strength meter?                                                                   | **A small home-grown estimator** (length, character variety, common-pattern and breached-word penalties) with a unit-test corpus. Not zxcvbn.                     | zxcvbn is ~800 kB and unmaintained. The meter is advisory only, because the server enforces the rules.                                                                                                          |
| P4-8 | What is the default for organisation employees submitting tickets (review contradiction 4)?      | **Keep the Phase 3 default:** `org_employee` has `ticket.create`, and admins can build custom roles without it. Revisit in Phase 8.                               | Matches the accepted review answer; no change now.                                                                                                                                                              |

## 7. Risks

- **CI has never run on Phases 2–3.** The workflow only runs for PRs and pushes to `main`, and no PR has been opened yet. Phase 4 adds more on unverified ground. Mitigation: open the Phase 2 PR (GitHub CLI or the web UI) and let CI run before 4A is finished.
- **Stacked branches:** three unmerged branches build on each other. Review and merge them in order (2 → 3 → 4), or squash them into one release PR (your choice).
- **Multipart uploads add a new attack surface.** Mitigation: a hard request-size cap below the largest purpose limit, a single file per request, in-memory buffering (no temporary files), and the type re-sniffed from the bytes (unchanged from 3B).
