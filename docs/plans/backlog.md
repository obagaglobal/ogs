# Backlog

Items the owner has asked for that belong to a later phase. Each phase plan starts by reading this file, proposes the items for its phase (with any decision they need), and moves them out of here once the plan is approved. Nothing here is approved scope until a phase plan includes it.

## Phase 10

### Customer first name for the assigned technician

**Asked:** by the owner on 2026-11-10, after the Phase 9 build.

**What:** the technician holding a job sees the customer's display name (a first name) next to the "Call site contact" link, for example "Customer: Wanjiru".

**Rules to keep:**

- Shown **only while they hold the job**: the ACTIVE assignment, exactly like the site address and contact today (ADR-063). Never on the offer (before accepting), never in the "Done" list, never after reassignment, removal or completion.
- Copied onto the job when it is dispatched (or set by the dispatcher on the brief), like the rest of the provider-facing data; providers still get no policy on any customer table (ADR-063).
- A first name only: no surname, email, phone beyond the site contact's, or account details.

**Open points for the Phase 10 plan:**

- **Source of the name.** There is no name field yet (Phase 6b); providers currently see the organisation's name or "Private customer". Deriving it from the email would expose part of the customer's email address to a third party, so the plan should propose a real first-name field (on the profile, or entered on the request) and a fallback when it is empty.
- **Data protection (ADR-018):** sharing a customer's name with an outside provider needs the same lawful basis and privacy-notice wording as the site contact's phone (Phase 9 plan §7).
- **Tests:** a T3/T4-style check that the name is absent before acceptance and after the assignment ends, and present while it is ACTIVE.
