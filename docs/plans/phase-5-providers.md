# Phase 5 Plan — Providers (Companies and Individuals)

**Status:** APPROVED by the owner on 2026-11-06, with all recommendations P5-1 … P5-7 accepted. Delivered as 5A (backend) then 5B (web), with no gate between them, merged to `main` in PR #4 on 2026-11-06. The §8 refinements were approved by the owner on 2026-11-06 and recorded as ADR-033 … ADR-037.
**Based on:** [Architecture Review](../architecture/review.md) §1, §2 (D3), §4.2, §7, §10 and §13 (Phase 5 row), ADR-010 (assignment grants), ADR-012 (`Service` vs `ServiceListing`), ADR-013 (OGS assigns), ADR-016 (merchant of record) and ADR-018 (data protection).
**Starting point:** branch `phase-4/organisations` @ `96ec53b`, pushed and unmerged. Phase 5 is stacked on top of it (`phase-5/providers`).

## 1. Goal

OGS can grow a vetted supply side. Two kinds of provider can apply, prove who they are and what they can do, and be approved or suspended by OGS staff:

- **Provider companies:** ICT firms with their own technicians.
- **Individual providers:** freelancers.

Each approved provider declares its **skills**, the **regions it covers** and **when it is available**. OGS gets one eligibility query for later dispatch (Phase 9). That query **never** returns a provider that is unapproved, suspended or unavailable.

Phase 5 does not dispatch work, price services or pay anyone. Those come in Phases 6, 9 and 11.

## 2. Scope

### 2.1 Two kinds of provider (decision P5-1)

|                  | Provider company                                                                                                        | Individual provider                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | A `tenant` of kind `PROVIDER_COMPANY` (exists since Phase 2)                                                            | A `provider_profile` owned by one user, with **no tenant** (review §4.2, §7)                                                                                    |
| People           | Members with `provider_admin` / `provider_technician` roles (Phase 3/4 machinery: invitations, roles, last-admin guard) | Just the person                                                                                                                                                 |
| Workspace        | The company workspace (`X-OGS-Workspace: <tenantId>`)                                                                   | A new **Provider** workspace (`X-OGS-Workspace: provider`) that appears once the person has a provider profile (review §7: "Personal · Provider · memberships") |
| Database context | `workspace` (tenant rows)                                                                                               | `user` plus a provider flag, over user-owned rows (ADR-009 style)                                                                                               |

### 2.2 Applications and review (shared with organisations)

- **One application machine for every kind.** Phase 4's organisation application and its review generalise into a shared workflow (DRAFT → SUBMITTED → CHANGES_REQUESTED / APPROVED / REJECTED) with the same events, audit, emails and separation of duties.
  - Organisation applications keep their table.
  - A new `provider_application` table belongs to either a provider company (tenant) or an individual (user). A CHECK constraint requires exactly one owner.
- **Provider companies** register like organisations (`POST /providers/companies`). They create a pending tenant whose applicant is `provider_admin`, and their workspace stays restricted until approval.
- **Individuals** apply from their personal account (`POST /providers/me`). That creates a `provider_profile` (status `PENDING_APPROVAL`) and a DRAFT application. Until approval, the Provider workspace only shows the application.
- **Submission requires:**
  - legal or display name, country and region, phone;
  - at least one skill and at least one covered region;
  - documents: company registration and KRA PIN certificates for companies; for individuals, a government ID and at least one skill evidence document (certificate, reference letter or portfolio).
- **Staff review** extends the Phase 4 review queue with a **type filter** (organisation / provider company / individual provider). It uses the same elevation, the same `platform.tenant.review` / `platform.tenant.approve` permissions for companies, and `platform.provider.approve` for individuals.
- **Verification checklist:** staff record a structured verdict when approving — identity checked, registration checked, KRA checked, skills evidence checked, with notes. It is stored in `provider_verification` and audited.

### 2.3 Skills, coverage and availability

- **Skills** (P5-3): a platform-owned taxonomy, `skill`, with a code, name, category and an active flag. It is seeded with an initial ICT list:
  - networking, structured cabling, Wi-Fi;
  - CCTV and access control;
  - desktop and laptop repair, printer repair;
  - Microsoft 365 / Google Workspace, Windows Server, Linux administration, cloud;
  - cybersecurity basics, telephony/VoIP, POS systems, software installation, data recovery;
  - …

  Staff manage it with `platform.catalogue.manage`. Providers pick skills, each with an experience band. Phase 6 services will name the skills they require.

- **Coverage:** a platform-owned `region` reference table, seeded with Kenya's **47 counties** (ISO 3166-2:KE codes), ready for other countries later. Providers pick counties and can mark "remote work possible".
- **Availability:** weekly working hours (day, start and end, Africa/Nairobi), dated **time-off** periods, and an **accepting work** switch the provider can turn off at any time.
- All three are editable by an approved provider at any time:
  - provider companies with `provider.profile.manage`;
  - individuals in their Provider workspace.

  Before approval they are edited as part of the application.

### 2.4 Eligibility (review §10, §13)

- **`ProviderEligibilityService.find({ skillCodes[], regionCode, at? })`** returns candidates (company or individual) with a simple score: skills matched, region exact or remote, availability now or at `at`.
- **Hard filters, enforced in SQL:**
  - the provider is APPROVED;
  - the provider company tenant is ACTIVE, or the individual profile is ACTIVE;
  - the provider is not suspended;
  - accepting work is on;
  - it has every required skill;
  - it covers the region (or works remotely when the service allows it);
  - when `at` is given, it is available then (working hours and not on time off).
- **Phase 5 exposes it to staff only:** `GET /platform/providers/eligible?skills=…&region=…&at=…` under elevation. Dispatch uses it in Phase 9.
- **Ranking is a plain, explainable sum.** The weights are documented, and each result returns a reason per factor. There is no machine learning (review §10: "scored suggestion, never auto-assignment").

### 2.5 Provider lifecycle after approval

- **Staff actions** (elevation, with a reason), notified by email:
  - suspend or reactivate a provider company (reuses the Phase 4 tenant suspension);
  - suspend or reactivate an individual profile.
- **Suspended providers** disappear from eligibility immediately and keep read-only access to their workspace.
- **The provider's own controls:** the accepting-work switch, and editing skills, coverage and availability. Changes to skills or regions that affect eligibility are audited.

### 2.6 Technicians of provider companies

- **Technicians stay company members** (`provider_technician`), invited and managed with the Phase 4 Team pages. They act **only** inside the company workspace. Review §13 requires this, and it is already true by construction: their roles exist only in that tenant. Phase 5 adds a test proving it.
- **Technician-level skills are deferred.** Per-technician skills, coverage and availability matter only when a company assigns its technician to a job, which is Phase 9 (P5-4). Phase 5 eligibility works at company level.

### 2.7 KYC documents and data protection (ADR-018, P5-5)

- **New file purposes:**
  - `provider.identity`: government ID; individuals only; PDF/JPEG/PNG, 10 MB;
  - `provider.certificate`: skills evidence;
  - `provider.company_document`: registration and tax.
- **Who can see identity documents:**
  - the provider who uploaded them;
  - staff under an elevation with `platform.provider.approve` or `platform.compliance.review`.

  Every staff download is audited with the elevation's reason. Identity documents are never shown in any other view.

- **Data minimisation:** OGS stores **no national ID number or date of birth** in structured fields. Only the document is kept, plus the reviewer's verdict ("identity checked: yes/no").
- **Retention:** rejected individual applications and their documents become eligible for deletion **24 months** after the decision. A dated retention marker is recorded on each one. The deletion job itself comes with the data-protection work in Phase 15/16. The DPIA (ADR-018) is still pending legal review; that is a follow-up, not a Phase 5 blocker.

### 2.8 Web

- **Personal dashboard:** "Become a provider" (individual) and "Register a provider company".
- **Provider application** for both kinds: profile, skill picker, county picker plus remote, and documents. Same status, history and reviewer-note pattern as Phase 4.
- **Provider workspace** (individual) and **company workspace pages:** "Profile & skills", "Coverage", "Availability" (weekly hours, time off, accepting-work switch).
- **Staff:**
  - the review queue gains a type filter and a provider verification checklist;
  - a "Find eligible providers" page (skills + county) shows the explained scores;
  - a skills taxonomy editor.

## 3. Out of scope

| Item                                                                                                     | When                         |
| -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Services, pricing and provider-specific listings and rates (ADR-012 `ServiceListing`)                    | Phase 6                      |
| Dispatch, offers, accept/decline, per-technician skills and availability, assignment-grant RLS (ADR-010) | Phase 9                      |
| Ratings and performance metrics                                                                          | Phases 9–13                  |
| Payout details (M-Pesa / bank), withholding tax, contracts with providers                                | Phase 11                     |
| Automated ID verification (IPRS), background checks, insurance                                           | After v1 (manual review now) |
| Retention deletion job, DPIA sign-off                                                                    | Phases 15–16 (legal)         |

## 4. Tests and acceptance

Review §13 Phase 5 row, plus everything above.

| #   | Proves                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Eligibility never returns a provider that is unapproved, suspended, not accepting work, missing a required skill, outside the region or (with `at`) unavailable.** This is a table-driven test over every combination, plus the reasons and score order for the eligible ones. |
| D2  | Application lifecycle for both kinds; separation of duties; the right approval permission per kind; the verification checklist is stored and audited; emails are sent                                                                                                            |
| D3  | A pending provider company is inert (the Phase 4 route walk now also runs for PROVIDER_COMPANY). A pending individual's Provider workspace reaches only its application.                                                                                                         |
| D4  | KYC documents are private and scanned before any download. Identity documents are invisible to other providers, organisations and staff without elevation and the right permission. Every staff download is audited with the reason.                                             |
| D5  | A company technician can act only in the company workspace: personal and Provider workspaces never grant company permissions; a technician who leaves loses access on the next request; roles cannot be granted across kinds                                                     |
| D6  | Isolation: every new endpoint is in the isolation suite (foreign ids → 404, foreign workspace → 403); one individual can never see another's profile, skills, availability or documents                                                                                          |
| D7  | Multi-capacity: one person who is an organisation employee, an individual provider and a provider-company technician switches between all three, and data never crosses                                                                                                          |
| D8  | Availability and time zones: weekly hours and time off are evaluated in Africa/Nairobi, including the midnight edge and dates around the end of the year                                                                                                                         |
| D9  | Skills and region taxonomies: only staff with `platform.catalogue.manage` can change them; deactivating a skill hides it from pickers without breaking existing profiles                                                                                                         |
| D10 | Web: component tests for the skill and region pickers and the availability editor. The Playwright journey: an individual applies → staff verify and approve → the provider sets availability → staff find them through eligibility.                                              |

**Acceptance:** the Phase 4 bar applies (all tests green locally and in CI once PRs run, `pnpm check`, docs and decisions updated).

## 5. Delivery

| Part         | Content                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5A — backend | Schema and RLS (provider profile, provider application and events, verification, skill, region, provider skills, coverage, working hours, time off) and seeds. The generalised application workflow, with the Phase 4 review refactored onto it (organisation behaviour unchanged, proven by the existing C-tests). Company and individual endpoints, the Provider workspace, eligibility, staff endpoints and notifications. Tests D1–D9. |
| 5B — web     | Application flows, provider profile, coverage and availability pages, staff review additions, eligibility search, taxonomy editor, Playwright journey (D10).                                                                                                                                                                                                                                                                               |

As in Phase 4: one approval, delivered as two halves with no gate between them, unless you want one.

## 6. Decisions needed before starting

| ID   | Question                                                                    | Recommendation                                                                                                                                                                                                                                                        | Why                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5-1 | How is an individual provider modelled?                                     | **A user-level `provider_profile` with no tenant**, exactly as the review drew it (§4.2, §7). Companies stay tenants.                                                                                                                                                 | It matches the approved architecture and needs no fake one-person tenants (the same reasoning as ADR-009). Phase 9 assignment grants already allow `assignee_user_id` (ADR-010). |
| P5-2 | How does an individual act as a provider?                                   | **A "Provider" workspace** (`X-OGS-Workspace: provider`), shown once a profile exists and restricted until approval                                                                                                                                                   | Review §7 lists exactly this. The capacity stays explicit in the header like every other workspace.                                                                              |
| P5-3 | Where do skills come from?                                                  | **A platform-owned skill taxonomy** seeded with an initial ICT list, managed by staff. Free-text skills are not allowed.                                                                                                                                              | Eligibility needs exact matching, and Phase 6 services will reference the same codes.                                                                                            |
| P5-4 | Should technicians have their own skills and availability now?              | **No: company-level only in Phase 5.** Technician-level data comes with dispatch in Phase 9.                                                                                                                                                                          | OGS offers work to the company, and the company picks its technician (review §10). Nothing would use the data yet.                                                               |
| P5-5 | How much KYC data is stored?                                                | **Documents plus the reviewer's verdict. No ID number or date-of-birth fields.** Identity documents are only visible to the provider and to elevated staff with the right permission, and every access is audited. 24-month retention marker on rejected individuals. | Data minimisation under the Data Protection Act 2019 (ADR-018). Less stored means less to protect and to explain in the DPIA.                                                    |
| P5-6 | How is coverage expressed?                                                  | **Kenyan counties (47, ISO codes) plus a "remote" flag.** Countries and regions are data, so other markets add rows, not code.                                                                                                                                        | Counties are how Kenyan customers and providers think about location. Distance-based matching can come later if needed.                                                          |
| P5-7 | Does individual-provider approval use the same permission as organisations? | **No: `platform.provider.approve`** (already in the catalogue). Provider companies use `platform.tenant.approve`, like organisations.                                                                                                                                 | It matches the role catalogue: the provider relationship manager vets providers.                                                                                                 |

## 7. Risks

- **CI has still not run on Phases 2–4.** Phase 5 stacks a fourth unverified branch. Mitigation: open the Phase 2 PR before 5A is complete. I can do it if the GitHub CLI is set up.
- **Refactoring the Phase 4 review onto a shared workflow** could change organisation behaviour. Mitigation: no organisation test (C1–C11) may change, apart from the new type filter.
- **KYC documents are personal data.** Mitigation: P5-5, the access tests in D4, and no identity data in logs, audit metadata or emails.

## 8. Delivery notes (2026-11-06)

Delivered as planned, with these refinements:

- **Decision permissions.** Provider decision and suspension routes open with `platform.tenant.review` under an elevation. The service then requires the approve permission of the provider's kind: `platform.tenant.approve` for companies, `platform.provider.approve` for individuals. One route serves both kinds, and a compliance officer can review without being able to decide.
- **File purposes.** The Phase 3 placeholder `provider.document` is replaced by the three purposes in §2.7. A restricted (pending) workspace may upload application evidence only.
- **Eligibility access.** Staff need `ticket.assign` under an elevation (operations, service and ICT support managers): eligibility is a dispatch tool. Availability reasons are written in Kenya time.
- **Web availability editor.** The editor offers one range per weekday. The API accepts several, so split shifts can come later without a migration.
- **Retention marker.** `provider.retain_until` is set when an individual is rejected. The deletion job remains Phase 15/16, as planned.
- **Found while testing.**
  - The Phase 4 invitation list queried concurrently inside one transaction; it is now sequential.
  - The upload guard treated the Provider workspace as a tenant workspace; it now treats it as the person's own.
