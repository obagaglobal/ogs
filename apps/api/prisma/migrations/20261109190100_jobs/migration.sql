-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'OFFERED', 'ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'PAUSED', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssigneeKind" AS ENUM ('INTERNAL', 'INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DeclineReason" AS ENUM ('NOT_AVAILABLE', 'TOO_FAR', 'LACKS_SKILLS', 'WORKLOAD', 'OTHER');

-- CreateEnum
CREATE TYPE "JobAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "AssignmentEndReason" AS ENUM ('REASSIGNED', 'REMOVED', 'TECHNICIAN_CHANGED', 'JOB_COMPLETED', 'JOB_CANCELLED', 'PROVIDER_SUSPENDED');

-- CreateEnum
CREATE TYPE "CompletionOutcome" AS ENUM ('CONFIRMED', 'ISSUE_RAISED', 'AUTO_CONFIRMED', 'STAFF_CONFIRMED');

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(20) NOT NULL,
    "service_order_id" UUID,
    "ticket_id" UUID,
    "customer_tenant_id" UUID,
    "customer_user_id" UUID,
    "customer_display" VARCHAR(200) NOT NULL,
    "service_id" UUID,
    "title" VARCHAR(150) NOT NULL,
    "allow_internal" BOOLEAN NOT NULL DEFAULT true,
    "allow_individual" BOOLEAN NOT NULL DEFAULT true,
    "allow_company" BOOLEAN NOT NULL DEFAULT true,
    "on_site" BOOLEAN NOT NULL DEFAULT true,
    "remote_allowed" BOOLEAN NOT NULL DEFAULT false,
    "region_code" VARCHAR(10) NOT NULL,
    "brief" VARCHAR(4000) NOT NULL DEFAULT '',
    "site_address" VARCHAR(300) NOT NULL,
    "site_contact_name" VARCHAR(100),
    "site_contact_phone" VARCHAR(20),
    "window_from" DATE,
    "window_to" DATE,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "assigned_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_skill" (
    "job_id" UUID NOT NULL,
    "skill_code" VARCHAR(60) NOT NULL,
    "min_experience" "ExperienceBand" NOT NULL DEFAULT 'UNDER_1_YEAR',

    CONSTRAINT "job_skill_pkey" PRIMARY KEY ("job_id","skill_code")
);

-- CreateTable
CREATE TABLE "job_offer" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "kind" "AssigneeKind" NOT NULL,
    "provider_id" UUID,
    "assignee_tenant_id" UUID,
    "technician_user_id" UUID,
    "offered_by" UUID NOT NULL DEFAULT app.current_user_id(),
    "offered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "JobOfferStatus" NOT NULL DEFAULT 'PENDING',
    "decline_reason" "DeclineReason",
    "decline_note" VARCHAR(500),
    "responded_by" UUID,
    "responded_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_assignment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "job_number" VARCHAR(20) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "customer_tenant_id" UUID,
    "customer_user_id" UUID,
    "kind" "AssigneeKind" NOT NULL,
    "provider_id" UUID,
    "assignee_tenant_id" UUID,
    "technician_user_id" UUID NOT NULL,
    "technician_name" VARCHAR(60),
    "status" "JobAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "end_reason" "AssignmentEndReason",
    "end_note" VARCHAR(500),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by" UUID,

    CONSTRAINT "job_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "assignment_id" UUID,
    "kind" VARCHAR(30) NOT NULL,
    "from_value" VARCHAR(40),
    "to_value" VARCHAR(40),
    "actor_user_id" UUID DEFAULT app.current_user_id(),
    "reason" VARCHAR(2000),
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "provider_visible" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_work_note" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL DEFAULT app.current_user_id(),
    "body" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_work_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_evidence" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "caption" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_completion" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "minutes_on_site" INTEGER,
    "materials" VARCHAR(1000) NOT NULL DEFAULT '',
    "evidence_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "submitted_by" UUID NOT NULL DEFAULT app.current_user_id(),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "CompletionOutcome",
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_reason" VARCHAR(500),

    CONSTRAINT "job_completion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_number_key" ON "job"("number");

-- CreateIndex
CREATE UNIQUE INDEX "job_service_order_id_key" ON "job"("service_order_id");

-- CreateIndex
CREATE INDEX "job_status_created_at_idx" ON "job"("status", "created_at");

-- CreateIndex
CREATE INDEX "job_customer_tenant_id_created_at_idx" ON "job"("customer_tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "job_customer_user_id_created_at_idx" ON "job"("customer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "job_ticket_id_idx" ON "job"("ticket_id");

-- CreateIndex
CREATE INDEX "job_offer_job_id_offered_at_idx" ON "job_offer"("job_id", "offered_at");

-- CreateIndex
CREATE INDEX "job_offer_status_expires_at_idx" ON "job_offer"("status", "expires_at");

-- CreateIndex
CREATE INDEX "job_offer_provider_id_status_idx" ON "job_offer"("provider_id", "status");

-- CreateIndex
CREATE INDEX "job_offer_assignee_tenant_id_status_idx" ON "job_offer"("assignee_tenant_id", "status");

-- CreateIndex
CREATE INDEX "job_offer_technician_user_id_status_idx" ON "job_offer"("technician_user_id", "status");

-- CreateIndex
CREATE INDEX "job_assignment_job_id_started_at_idx" ON "job_assignment"("job_id", "started_at");

-- CreateIndex
CREATE INDEX "job_assignment_provider_id_status_idx" ON "job_assignment"("provider_id", "status");

-- CreateIndex
CREATE INDEX "job_assignment_assignee_tenant_id_status_idx" ON "job_assignment"("assignee_tenant_id", "status");

-- CreateIndex
CREATE INDEX "job_assignment_technician_user_id_status_idx" ON "job_assignment"("technician_user_id", "status");

-- CreateIndex
CREATE INDEX "job_event_job_id_occurred_at_idx" ON "job_event"("job_id", "occurred_at");

-- CreateIndex
CREATE INDEX "job_event_assignment_id_idx" ON "job_event"("assignment_id");

-- CreateIndex
CREATE INDEX "job_work_note_assignment_id_created_at_idx" ON "job_work_note"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "job_work_note_job_id_idx" ON "job_work_note"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_evidence_file_id_key" ON "job_evidence"("file_id");

-- CreateIndex
CREATE INDEX "job_evidence_assignment_id_created_at_idx" ON "job_evidence"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "job_evidence_job_id_idx" ON "job_evidence"("job_id");

-- CreateIndex
CREATE INDEX "job_completion_job_id_submitted_at_idx" ON "job_completion"("job_id", "submitted_at");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_skill" ADD CONSTRAINT "job_skill_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_skill" ADD CONSTRAINT "job_skill_skill_code_fkey" FOREIGN KEY ("skill_code") REFERENCES "skill"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignment" ADD CONSTRAINT "job_assignment_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignment" ADD CONSTRAINT "job_assignment_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "job_offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignment" ADD CONSTRAINT "job_assignment_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "job_assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_note" ADD CONSTRAINT "job_work_note_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_note" ADD CONSTRAINT "job_work_note_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "job_assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evidence" ADD CONSTRAINT "job_evidence_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evidence" ADD CONSTRAINT "job_evidence_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "job_assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evidence" ADD CONSTRAINT "job_evidence_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_metadata"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_completion" ADD CONSTRAINT "job_completion_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_completion" ADD CONSTRAINT "job_completion_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "job_assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================================
-- Hand-written below: Phase 9 plan §2.1–§2.4. Constraints, context helpers,
-- eligibility, transition guards, cascades, grants and row-level security.
--
-- Policy graph (no cycles): job → job_assignment, job_offer; job_assignment
-- (insert only) → job_offer; job_skill, job_event, job_work_note, job_evidence,
-- job_completion → job / job_assignment; job_evidence → job_completion;
-- file_metadata → job_evidence. job_offer reads no other job table, and
-- job_assignment never reads "job" (its copies carry the customer).
-- ===================================================================================

-- Constraints -------------------------------------------------------------------

ALTER TABLE "job"
  ADD CONSTRAINT "job_one_customer_chk" CHECK (("customer_tenant_id" IS NULL) <> ("customer_user_id" IS NULL)),
  ADD CONSTRAINT "job_one_source_chk" CHECK (("service_order_id" IS NULL) <> ("ticket_id" IS NULL)),
  ADD CONSTRAINT "job_number_chk" CHECK ("number" ~ '^JOB-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT "job_title_chk" CHECK (length(btrim("title")) >= 3),
  ADD CONSTRAINT "job_address_chk" CHECK (length(btrim("site_address")) >= 3),
  ADD CONSTRAINT "job_channel_chk" CHECK ("allow_internal" OR "allow_individual" OR "allow_company"),
  ADD CONSTRAINT "job_where_chk" CHECK ("on_site" OR "remote_allowed"),
  ADD CONSTRAINT "job_window_chk" CHECK ("window_from" IS NULL OR "window_to" IS NULL OR "window_to" >= "window_from"),
  ADD CONSTRAINT "job_cancel_chk" CHECK (("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL)),
  ADD CONSTRAINT "job_completed_chk" CHECK (("status" = 'COMPLETED') = ("confirmed_at" IS NOT NULL));

-- One unfinished job per ticket at a time (an order has exactly one job: unique index above).
CREATE UNIQUE INDEX "job_ticket_open_key" ON "job"("ticket_id")
  WHERE "ticket_id" IS NOT NULL AND "status" NOT IN ('COMPLETED', 'CANCELLED');

ALTER TABLE "job_offer"
  ADD CONSTRAINT "job_offer_assignee_chk" CHECK (
    ("kind" = 'INTERNAL' AND "technician_user_id" IS NOT NULL AND "provider_id" IS NULL AND "assignee_tenant_id" IS NOT NULL)
    OR ("kind" = 'INDIVIDUAL' AND "provider_id" IS NOT NULL AND "assignee_tenant_id" IS NULL AND "technician_user_id" IS NULL)
    OR ("kind" = 'COMPANY' AND "provider_id" IS NOT NULL AND "assignee_tenant_id" IS NOT NULL AND "technician_user_id" IS NULL)
  ),
  ADD CONSTRAINT "job_offer_window_chk" CHECK ("expires_at" > "offered_at"),
  ADD CONSTRAINT "job_offer_decline_chk" CHECK (
    ("status" = 'DECLINED') = ("decline_reason" IS NOT NULL)
    AND ("decline_reason" IS DISTINCT FROM 'OTHER' OR length(btrim(coalesce("decline_note", ''))) >= 3)
  ),
  ADD CONSTRAINT "job_offer_response_chk" CHECK (("status" = 'PENDING') = ("responded_at" IS NULL));

-- P9-4: one PENDING offer per job.
CREATE UNIQUE INDEX "job_offer_one_pending_key" ON "job_offer"("job_id") WHERE "status" = 'PENDING';

ALTER TABLE "job_assignment"
  ADD CONSTRAINT "job_assignment_assignee_chk" CHECK (
    ("kind" = 'INTERNAL' AND "provider_id" IS NULL AND "assignee_tenant_id" IS NOT NULL)
    OR ("kind" = 'INDIVIDUAL' AND "provider_id" IS NOT NULL AND "assignee_tenant_id" IS NULL)
    OR ("kind" = 'COMPANY' AND "provider_id" IS NOT NULL AND "assignee_tenant_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "job_assignment_one_customer_chk" CHECK (("customer_tenant_id" IS NULL) <> ("customer_user_id" IS NULL)),
  ADD CONSTRAINT "job_assignment_end_chk" CHECK (
    ("status" = 'ENDED') = ("end_reason" IS NOT NULL) AND ("status" = 'ENDED') = ("ended_at" IS NOT NULL)
  );

-- One ACTIVE assignment per job.
CREATE UNIQUE INDEX "job_assignment_one_active_key" ON "job_assignment"("job_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "job_event"
  ADD CONSTRAINT "job_event_kind_chk" CHECK ("kind" ~ '^[a-z][a-z_]{1,29}$'),
  ADD CONSTRAINT "job_event_provider_chk" CHECK (NOT "provider_visible" OR "assignment_id" IS NOT NULL);
ALTER TABLE "job_work_note"
  ADD CONSTRAINT "job_work_note_body_chk" CHECK (length(btrim("body")) >= 1);
ALTER TABLE "job_completion"
  ADD CONSTRAINT "job_completion_summary_chk" CHECK (length(btrim("summary")) >= 10),
  ADD CONSTRAINT "job_completion_minutes_chk" CHECK ("minutes_on_site" IS NULL OR "minutes_on_site" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "job_completion_decision_chk" CHECK (("outcome" IS NULL) = ("decided_at" IS NULL)),
  ADD CONSTRAINT "job_completion_evidence_chk" CHECK ("evidence_ids" IS NOT NULL);
-- One open (undecided) report per job.
CREATE UNIQUE INDEX "job_completion_one_open_key" ON "job_completion"("job_id") WHERE "outcome" IS NULL;

ALTER TABLE "document_counter" DROP CONSTRAINT "document_counter_kind_chk";
ALTER TABLE "document_counter"
  ADD CONSTRAINT "document_counter_kind_chk" CHECK ("kind" IN ('REQ', 'QUO', 'ORD', 'TCK', 'JOB'));

-- Context helpers (P9-3) -------------------------------------------------------------

-- The individual provider acting in the Provider workspace. Set ONLY by the
-- `provider` DbContext (transaction-local set_config), never by the personal one.
CREATE OR REPLACE FUNCTION app.current_provider_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.provider_id', true), '')::uuid $$;

-- A person's own customer rows are visible only in their personal workspace:
-- the Provider workspace (app.provider_id set) is a different capacity.
CREATE OR REPLACE FUNCTION app.owns_customer_row(tenant uuid, owner uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT (tenant IS NOT NULL AND tenant = app.current_tenant_id())
        OR (owner IS NOT NULL AND owner = app.current_user_id() AND app.current_tenant_id() IS NULL
            AND app.current_provider_id() IS NULL)
  $$;

-- Does this person hold this permission through an ACTIVE membership of this tenant?
-- Reads membership, membership_role and role_permission under the caller's RLS:
-- a context that cannot see the rows gets false (fail closed).
CREATE OR REPLACE FUNCTION app.user_holds_permission(p_tenant uuid, p_user uuid, p_code text) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(EXISTS (
      SELECT 1 FROM "membership" m
        JOIN "membership_role" mr ON mr."membership_id" = m."id"
        JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
       WHERE m."tenant_id" = p_tenant AND m."user_id" = p_user AND m."status" = 'ACTIVE'
         AND rp."permission_code" = p_code
    ), false)
  $$;

-- The current member's permission in the current workspace.
CREATE OR REPLACE FUNCTION app.holds_permission(p_code text) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app.user_holds_permission(app.current_tenant_id(), app.current_user_id(), p_code) $$;

-- Does the current context hold this assignment (plan §2.2)?
--  * INTERNAL: the technician, in the PLATFORM workspace (not elevated);
--  * INDIVIDUAL: the Provider workspace of that provider, while it is ACTIVE;
--  * COMPANY: the named technician, or a company dispatcher (ticket.assign),
--    in the company's workspace, while the provider and tenant are ACTIVE.
-- The caller adds `status = 'ACTIVE'` where access to the job depends on it.
CREATE OR REPLACE FUNCTION app.holds_assignment(p_kind "AssigneeKind", p_provider uuid, p_tenant uuid, p_technician uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(CASE p_kind
      WHEN 'INTERNAL' THEN p_tenant = app.current_tenant_id() AND p_technician = app.current_user_id()
      WHEN 'INDIVIDUAL' THEN p_provider = app.current_provider_id()
        AND EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = p_provider AND p."status" = 'ACTIVE')
      WHEN 'COMPANY' THEN p_tenant = app.current_tenant_id()
        AND (p_technician = app.current_user_id() OR app.holds_permission('ticket.assign'))
        AND EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = p_provider AND p."status" = 'ACTIVE')
        AND EXISTS (SELECT 1 FROM "tenant" t WHERE t."id" = p_tenant AND t."status" = 'ACTIVE')
    END, false)
  $$;

-- Is the current context the addressee of this offer?
CREATE OR REPLACE FUNCTION app.holds_offer(p_kind "AssigneeKind", p_provider uuid, p_tenant uuid, p_technician uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(CASE p_kind
      WHEN 'INTERNAL' THEN p_tenant = app.current_tenant_id() AND p_technician = app.current_user_id()
      WHEN 'INDIVIDUAL' THEN p_provider = app.current_provider_id()
      WHEN 'COMPANY' THEN p_tenant = app.current_tenant_id() AND app.holds_permission('assignment.respond')
    END, false)
  $$;

-- Eligibility (plan §2.3, P9-11): the ONE definition of who may take a job.
-- Used by the job_offer triggers (on offer and on accept) and by EligibilityService.
CREATE OR REPLACE FUNCTION app.can_take_job(p_job uuid, p_kind "AssigneeKind", p_provider uuid, p_technician uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(CASE p_kind
      WHEN 'INTERNAL' THEN EXISTS (
        SELECT 1 FROM "job" j, "tenant" t
         WHERE j."id" = p_job AND j."allow_internal" AND t."kind" = 'PLATFORM'
           AND app.user_holds_permission(t."id", p_technician, 'assignment.respond')
           AND app.user_holds_permission(t."id", p_technician, 'ticket.update_progress'))
      ELSE EXISTS (
        SELECT 1 FROM "job" j, "provider" p
          JOIN "provider_application" a ON a."provider_id" = p."id" AND a."status" = 'APPROVED'
          LEFT JOIN "tenant" t ON t."id" = p."tenant_id"
         WHERE j."id" = p_job AND p."id" = p_provider
           AND p."status" = 'ACTIVE' AND p."accepting_work"
           AND p."kind"::text = p_kind::text
           AND ((p."kind" = 'INDIVIDUAL' AND j."allow_individual")
                OR (p."kind" = 'COMPANY' AND j."allow_company" AND t."status" = 'ACTIVE' AND t."deleted_at" IS NULL))
           AND NOT EXISTS (
             SELECT 1 FROM "job_skill" s
              WHERE s."job_id" = j."id"
                AND NOT EXISTS (SELECT 1 FROM "provider_skill" ps
                                 WHERE ps."provider_id" = p."id" AND ps."skill_code" = s."skill_code"
                                   AND ps."experience" >= s."min_experience"))
           AND (EXISTS (SELECT 1 FROM "provider_region" r WHERE r."provider_id" = p."id" AND r."region_code" = j."region_code")
                OR (j."remote_allowed" AND p."remote_ok")))
    END, false)
  $$;

-- Append-only rows ---------------------------------------------------------------------
CREATE TRIGGER "job_event_reject_update_delete" BEFORE UPDATE OR DELETE ON "job_event"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "job_work_note_reject_update_delete" BEFORE UPDATE OR DELETE ON "job_work_note"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "job_evidence_reject_update_delete" BEFORE UPDATE OR DELETE ON "job_evidence"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "job_skill_reject_update_delete" BEFORE UPDATE OR DELETE ON "job_skill"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Jobs: the second guard behind src/jobs/transitions.ts (plan §2.4).
--  * Created only by staff or jobs.* workers, QUEUED, for the source's own customer.
--  * Origin columns are immutable; COMPLETED and CANCELLED are final.
--  * Outside staff and workers, only status moves are allowed, and only these:
--      offeree: OFFERED → ASSIGNED (accept), OFFERED → QUEUED (decline);
--      holder:  ASSIGNED → ON_THE_WAY (on site) / IN_PROGRESS (remote only),
--               ON_THE_WAY → IN_PROGRESS, IN_PROGRESS ⇄ PAUSED,
--               IN_PROGRESS → AWAITING_CONFIRMATION;
--      company dispatcher: any working state → QUEUED, only when the assigned
--               technician no longer has an ACTIVE membership (released);
--      customer: AWAITING_CONFIRMATION → COMPLETED (confirm) / IN_PROGRESS (problem).
--  * jobs.* workers: OFFERED → QUEUED (expiry), AWAITING_CONFIRMATION → COMPLETED
--    (auto-confirm after 7 days).
CREATE OR REPLACE FUNCTION app.protect_job() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  src record;
  staff boolean := app.is_platform();
  worker boolean := app.is_job('jobs.%');
  holder boolean;
  offeree boolean;
  customer boolean;
  released boolean;
  moved boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT (staff OR worker) THEN
      RAISE EXCEPTION 'jobs are created by OGS' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" <> 'QUEUED' OR NEW."version" <> 0 OR NEW."assigned_at" IS NOT NULL OR NEW."started_at" IS NOT NULL
       OR NEW."completed_at" IS NOT NULL OR NEW."confirmed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'a job starts QUEUED' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."service_order_id" IS NOT NULL THEN
      SELECT "customer_tenant_id", "customer_user_id" INTO src FROM "service_order" WHERE "id" = NEW."service_order_id";
    ELSE
      SELECT "customer_tenant_id", "customer_user_id" INTO src FROM "ticket" WHERE "id" = NEW."ticket_id";
    END IF;
    IF src IS NULL OR src."customer_tenant_id" IS DISTINCT FROM NEW."customer_tenant_id"
       OR src."customer_user_id" IS DISTINCT FROM NEW."customer_user_id" THEN
      RAISE EXCEPTION 'a job belongs to its order''s or ticket''s customer' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'a finished job is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW."number", NEW."service_order_id", NEW."ticket_id", NEW."customer_tenant_id", NEW."customer_user_id",
         NEW."customer_display", NEW."service_id", NEW."created_by", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."number", OLD."service_order_id", OLD."ticket_id", OLD."customer_tenant_id", OLD."customer_user_id",
         OLD."customer_display", OLD."service_id", OLD."created_by", OLD."created_at") THEN
    RAISE EXCEPTION 'job origin is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF staff THEN
    RETURN NEW;
  END IF;

  -- Everyone else changes the status (and its timestamps) only.
  IF ROW(NEW."title", NEW."allow_internal", NEW."allow_individual", NEW."allow_company", NEW."on_site",
         NEW."remote_allowed", NEW."region_code", NEW."brief", NEW."site_address", NEW."site_contact_name",
         NEW."site_contact_phone", NEW."window_from", NEW."window_to", NEW."cancel_reason")
     IS DISTINCT FROM
     ROW(OLD."title", OLD."allow_internal", OLD."allow_individual", OLD."allow_company", OLD."on_site",
         OLD."remote_allowed", OLD."region_code", OLD."brief", OLD."site_address", OLD."site_contact_name",
         OLD."site_contact_phone", OLD."window_from", OLD."window_to", OLD."cancel_reason") THEN
    RAISE EXCEPTION 'only OGS staff change a job''s details' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;

  IF worker THEN
    IF (OLD."status" = 'OFFERED' AND NEW."status" = 'QUEUED')
       OR (OLD."status" = 'AWAITING_CONFIRMATION' AND NEW."status" = 'COMPLETED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'job workers may only expire offers and auto-confirm' USING ERRCODE = 'insufficient_privilege';
  END IF;

  holder := EXISTS (
    SELECT 1 FROM "job_assignment" a
     WHERE a."job_id" = OLD."id" AND a."status" = 'ACTIVE'
       AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"));
  offeree := EXISTS (
    SELECT 1 FROM "job_offer" o
     WHERE o."job_id" = OLD."id" AND o."status" = 'PENDING'
       AND app.holds_offer(o."kind", o."provider_id", o."assignee_tenant_id", o."technician_user_id"));
  customer := app.owns_customer_row(OLD."customer_tenant_id", OLD."customer_user_id");
  released := holder AND EXISTS (
    SELECT 1 FROM "job_assignment" a
     WHERE a."job_id" = OLD."id" AND a."status" = 'ACTIVE' AND a."kind" = 'COMPANY'
       AND app.holds_permission('ticket.assign')
       AND NOT EXISTS (SELECT 1 FROM "membership" m
                        WHERE m."tenant_id" = a."assignee_tenant_id" AND m."user_id" = a."technician_user_id"
                          AND m."status" = 'ACTIVE'));

  moved := (offeree AND OLD."status" = 'OFFERED' AND NEW."status" IN ('ASSIGNED', 'QUEUED'))
    OR (holder AND (
          (OLD."status" = 'ASSIGNED' AND NEW."status" = 'ON_THE_WAY' AND OLD."on_site")
          OR (OLD."status" = 'ASSIGNED' AND NEW."status" = 'IN_PROGRESS' AND NOT OLD."on_site")
          OR (OLD."status" = 'ON_THE_WAY' AND NEW."status" = 'IN_PROGRESS')
          OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" IN ('PAUSED', 'AWAITING_CONFIRMATION'))
          OR (OLD."status" = 'PAUSED' AND NEW."status" = 'IN_PROGRESS')))
    OR (released AND NEW."status" = 'QUEUED')
    OR (customer AND OLD."status" = 'AWAITING_CONFIRMATION' AND NEW."status" IN ('COMPLETED', 'IN_PROGRESS'));
  IF NOT moved THEN
    RAISE EXCEPTION 'job transition % -> % is not allowed here', OLD."status", NEW."status"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_job() FROM PUBLIC;
CREATE TRIGGER "job_protect" BEFORE INSERT OR UPDATE ON "job"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job();

-- Requirements are copied when the job is created (P9-11) and never edited.
CREATE OR REPLACE FUNCTION app.protect_job_skill() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "job" j WHERE j."id" = NEW."job_id" AND j."status" = 'QUEUED' AND j."version" = 0) THEN
    RAISE EXCEPTION 'job requirements are set when the job is created' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_job_skill() FROM PUBLIC;
CREATE TRIGGER "job_skill_protect" BEFORE INSERT ON "job_skill"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_skill();

-- Offers (plan §2.3, §2.4):
--  * staff send them to an ELIGIBLE assignee (app.can_take_job), for a QUEUED job;
--  * the addressee accepts (eligibility checked again) or declines before expiry;
--  * jobs.* workers expire them at or after expires_at; staff withdraw them.
CREATE OR REPLACE FUNCTION app.protect_job_offer() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  job_status "JobStatus";
  platform_tenant uuid;
  provider_row record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT app.is_platform() OR NEW."offered_by" IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'offers are sent by OGS staff as themselves' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" <> 'PENDING' OR NEW."version" <> 0 OR NEW."expires_at" <= now() THEN
      RAISE EXCEPTION 'an offer starts PENDING and expires in the future' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT j."status" INTO job_status FROM "job" j WHERE j."id" = NEW."job_id";
    IF job_status IS DISTINCT FROM 'QUEUED' THEN
      RAISE EXCEPTION 'only a queued job can be offered' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."kind" = 'INTERNAL' THEN
      SELECT t."id" INTO platform_tenant FROM "tenant" t WHERE t."kind" = 'PLATFORM';
      IF NEW."assignee_tenant_id" IS DISTINCT FROM platform_tenant THEN
        RAISE EXCEPTION 'internal offers go to the PLATFORM tenant' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      SELECT p."kind", p."tenant_id" INTO provider_row FROM "provider" p WHERE p."id" = NEW."provider_id";
      IF provider_row IS NULL OR provider_row."kind"::text <> NEW."kind"::text
         OR provider_row."tenant_id" IS DISTINCT FROM NEW."assignee_tenant_id" THEN
        RAISE EXCEPTION 'the offer does not match the provider' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NOT app.can_take_job(NEW."job_id", NEW."kind", NEW."provider_id", NEW."technician_user_id") THEN
      RAISE EXCEPTION 'the assignee is not eligible for this job' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW."job_id", NEW."kind", NEW."provider_id", NEW."assignee_tenant_id", NEW."technician_user_id",
         NEW."offered_by", NEW."offered_at", NEW."expires_at")
     IS DISTINCT FROM
     ROW(OLD."job_id", OLD."kind", OLD."provider_id", OLD."assignee_tenant_id", OLD."technician_user_id",
         OLD."offered_by", OLD."offered_at", OLD."expires_at") THEN
    RAISE EXCEPTION 'an offer is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'only a pending offer can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" IN ('ACCEPTED', 'DECLINED') THEN
    IF NOT app.holds_offer(OLD."kind", OLD."provider_id", OLD."assignee_tenant_id", OLD."technician_user_id")
       OR NEW."responded_by" IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'only the addressee answers an offer' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."expires_at" <= now() THEN
      RAISE EXCEPTION 'the offer has expired' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Accepting: the assignment was inserted first in this transaction (see
    -- protect_job_assignment, which also checked eligibility); check it again.
    IF NEW."status" = 'ACCEPTED' AND NOT EXISTS (
         SELECT 1 FROM "job_assignment" a WHERE a."offer_id" = OLD."id" AND a."status" = 'ACTIVE') THEN
      RAISE EXCEPTION 'accepting an offer creates its assignment first' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" = 'ACCEPTED'
       AND NOT app.can_take_job(OLD."job_id", OLD."kind", OLD."provider_id", OLD."technician_user_id") THEN
      RAISE EXCEPTION 'the assignee is not eligible for this job' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW."status" = 'EXPIRED' THEN
    IF NOT (app.is_job('jobs.%') OR app.is_platform()) OR OLD."expires_at" > now() THEN
      RAISE EXCEPTION 'offers expire at their deadline, by the jobs worker' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW."status" = 'WITHDRAWN' THEN
    IF NOT app.is_platform() THEN
      RAISE EXCEPTION 'only OGS staff withdraw an offer' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid offer change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_job_offer() FROM PUBLIC;
CREATE TRIGGER "job_offer_protect" BEFORE INSERT OR UPDATE ON "job_offer"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_offer();

-- Assignments:
--  * ACCEPTING: the addressee of a PENDING, unexpired offer inserts the
--    assignment first (the job is still visible through the offer), then marks
--    the offer ACCEPTED (protect_job_offer requires this assignment). The
--    assignee must be eligible (app.can_take_job) and the copies match the job;
--  * CHANGING TECHNICIAN: a company dispatcher ends the assignment with
--    TECHNICIAN_CHANGED, then inserts a new one for the same ACCEPTED offer,
--    with the same copies;
--  * the technician is the internal technician of the offer, the individual
--    provider's own person, or an ACTIVE company member with ticket.update_progress;
--  * only ACTIVE → ENDED, once, with a reason allowed for the actor.
CREATE OR REPLACE FUNCTION app.protect_job_assignment() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  o record;
  j record;
  prev record;
  owner uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO o FROM "job_offer" WHERE "id" = NEW."offer_id";
    IF o IS NULL OR o."job_id" <> NEW."job_id"
       OR o."kind" <> NEW."kind" OR o."provider_id" IS DISTINCT FROM NEW."provider_id"
       OR o."assignee_tenant_id" IS DISTINCT FROM NEW."assignee_tenant_id" THEN
      RAISE EXCEPTION 'an assignment follows an offer of the same job and assignee' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" <> 'ACTIVE' OR NEW."end_reason" IS NOT NULL THEN
      RAISE EXCEPTION 'an assignment starts ACTIVE' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."offer_id" = NEW."offer_id") THEN
      -- A company changes the technician of an accepted job.
      SELECT * INTO prev FROM "job_assignment" a
       WHERE a."offer_id" = NEW."offer_id" AND a."status" = 'ENDED' AND a."end_reason" = 'TECHNICIAN_CHANGED'
       ORDER BY a."ended_at" DESC LIMIT 1;
      IF prev IS NULL OR o."status" <> 'ACCEPTED' OR NEW."kind" <> 'COMPANY'
         OR EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."job_id" = NEW."job_id" AND a."status" = 'ACTIVE') THEN
        RAISE EXCEPTION 'only a company changes the technician of its accepted job' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW."job_number" <> prev."job_number" OR NEW."title" <> prev."title"
         OR NEW."customer_tenant_id" IS DISTINCT FROM prev."customer_tenant_id"
         OR NEW."customer_user_id" IS DISTINCT FROM prev."customer_user_id" THEN
        RAISE EXCEPTION 'assignment copies must match the job' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT app.is_platform()
         AND NOT (NEW."assignee_tenant_id" = app.current_tenant_id() AND app.holds_permission('ticket.assign')) THEN
        RAISE EXCEPTION 'only the company''s dispatcher changes its technician' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      -- Accepting the offer.
      SELECT * INTO j FROM "job" WHERE "id" = NEW."job_id";
      IF j IS NULL OR o."status" <> 'PENDING' OR o."expires_at" <= now() THEN
        RAISE EXCEPTION 'an assignment comes from accepting a pending offer' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW."job_number" <> j."number" OR NEW."title" <> j."title"
         OR NEW."customer_tenant_id" IS DISTINCT FROM j."customer_tenant_id"
         OR NEW."customer_user_id" IS DISTINCT FROM j."customer_user_id" THEN
        RAISE EXCEPTION 'assignment copies must match the job' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT app.is_platform() AND NOT app.holds_offer(o."kind", o."provider_id", o."assignee_tenant_id", o."technician_user_id") THEN
        RAISE EXCEPTION 'only the addressee accepts an offer' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT app.can_take_job(o."job_id", o."kind", o."provider_id", o."technician_user_id") THEN
        RAISE EXCEPTION 'the assignee is not eligible for this job' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW."kind" = 'INTERNAL' AND NEW."technician_user_id" IS DISTINCT FROM o."technician_user_id" THEN
      RAISE EXCEPTION 'the internal technician is the one offered' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."kind" = 'INDIVIDUAL' THEN
      SELECT p."owner_user_id" INTO owner FROM "provider" p WHERE p."id" = NEW."provider_id";
      IF owner IS NULL OR NEW."technician_user_id" IS DISTINCT FROM owner THEN
        RAISE EXCEPTION 'an individual provider does the work themself' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW."kind" = 'COMPANY'
       AND NOT app.user_holds_permission(NEW."assignee_tenant_id", NEW."technician_user_id", 'ticket.update_progress') THEN
      RAISE EXCEPTION 'the technician must be an active company member who can work jobs' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW."job_id", NEW."offer_id", NEW."job_number", NEW."title", NEW."customer_tenant_id", NEW."customer_user_id",
         NEW."kind", NEW."provider_id", NEW."assignee_tenant_id", NEW."technician_user_id", NEW."technician_name",
         NEW."started_at")
     IS DISTINCT FROM
     ROW(OLD."job_id", OLD."offer_id", OLD."job_number", OLD."title", OLD."customer_tenant_id", OLD."customer_user_id",
         OLD."kind", OLD."provider_id", OLD."assignee_tenant_id", OLD."technician_user_id", OLD."technician_name",
         OLD."started_at") THEN
    RAISE EXCEPTION 'an assignment is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" <> 'ACTIVE' OR NEW."status" <> 'ENDED' THEN
    RAISE EXCEPTION 'an assignment only ends, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."ended_by" IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'ended_by is the current user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app.is_platform() THEN
    RETURN NEW;
  END IF;
  IF app.is_job('jobs.%') AND NEW."end_reason" = 'JOB_COMPLETED' THEN
    RETURN NEW;
  END IF;
  IF NEW."end_reason" = 'JOB_COMPLETED'
     AND app.owns_customer_row(OLD."customer_tenant_id", OLD."customer_user_id") THEN
    RETURN NEW;
  END IF;
  IF NEW."end_reason" = 'TECHNICIAN_CHANGED' AND OLD."kind" = 'COMPANY'
     AND OLD."assignee_tenant_id" = app.current_tenant_id() AND app.holds_permission('ticket.assign') THEN
    RETURN NEW;
  END IF;
  IF NEW."end_reason" = 'REMOVED' AND OLD."assignee_tenant_id" = app.current_tenant_id()
     AND NOT EXISTS (SELECT 1 FROM "membership" m
                      WHERE m."tenant_id" = OLD."assignee_tenant_id" AND m."user_id" = OLD."technician_user_id"
                        AND m."status" = 'ACTIVE') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'this assignment cannot be ended here' USING ERRCODE = 'insufficient_privilege';
END
$$;
REVOKE ALL ON FUNCTION app.protect_job_assignment() FROM PUBLIC;
CREATE TRIGGER "job_assignment_protect" BEFORE INSERT OR UPDATE ON "job_assignment"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_assignment();

-- Events: written as yourself (workers: no user), on a job you can see.
CREATE OR REPLACE FUNCTION app.protect_job_event() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."actor_user_id" IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'events are written as yourself' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."assignment_id" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."id" = NEW."assignment_id" AND a."job_id" = NEW."job_id") THEN
    RAISE EXCEPTION 'the assignment belongs to another job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_job_event() FROM PUBLIC;
CREATE TRIGGER "job_event_protect" BEFORE INSERT ON "job_event"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_event();

-- Work notes and evidence: on the ACTIVE assignment of a job that is being worked.
CREATE OR REPLACE FUNCTION app.protect_job_work() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  a record;
  j record;
  f record;
BEGIN
  SELECT * INTO a FROM "job_assignment" WHERE "id" = NEW."assignment_id";
  SELECT * INTO j FROM "job" WHERE "id" = NEW."job_id";
  IF a IS NULL OR j IS NULL OR a."job_id" <> NEW."job_id" OR a."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'work is recorded on the job''s active assignment' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF j."status" NOT IN ('ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'PAUSED', 'AWAITING_CONFIRMATION') THEN
    RAISE EXCEPTION 'the job is not being worked' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_TABLE_NAME = 'job_work_note' THEN
    IF NEW."author_user_id" IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'notes are written as yourself' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  -- job_evidence: a job.evidence file you uploaded, owned by the job's customer.
  SELECT "tenant_id", "owner_user_id", "purpose", "uploaded_by" INTO f FROM "file_metadata" WHERE "id" = NEW."file_id";
  IF f IS NULL OR f."purpose" <> 'job.evidence' OR f."uploaded_by" IS DISTINCT FROM app.current_user_id()
     OR f."tenant_id" IS DISTINCT FROM j."customer_tenant_id" OR f."owner_user_id" IS DISTINCT FROM j."customer_user_id" THEN
    RAISE EXCEPTION 'evidence must be your own job.evidence upload for this customer' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT count(*) FROM "job_evidence" e WHERE e."assignment_id" = NEW."assignment_id") >= 30 THEN
    RAISE EXCEPTION 'at most 30 photos per assignment' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_job_work() FROM PUBLIC;
CREATE TRIGGER "job_work_note_protect" BEFORE INSERT ON "job_work_note"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_work();
CREATE TRIGGER "job_evidence_protect" BEFORE INSERT ON "job_evidence"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_work();

-- Completion reports: submitted on the active assignment of an IN_PROGRESS job,
-- citing that assignment's photos (at least one on site); then decided once:
-- CONFIRMED / ISSUE_RAISED by the customer, AUTO_CONFIRMED by the jobs worker
-- after 7 days, STAFF_CONFIRMED by staff.
CREATE OR REPLACE FUNCTION app.protect_job_completion() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  a record;
  j record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO a FROM "job_assignment" WHERE "id" = NEW."assignment_id";
    SELECT * INTO j FROM "job" WHERE "id" = NEW."job_id";
    IF a IS NULL OR j IS NULL OR a."job_id" <> NEW."job_id" OR a."status" <> 'ACTIVE' OR j."status" <> 'IN_PROGRESS' THEN
      RAISE EXCEPTION 'a report is submitted on the active assignment of a job in progress' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."submitted_by" IS DISTINCT FROM app.current_user_id() OR NEW."outcome" IS NOT NULL THEN
      RAISE EXCEPTION 'a report is submitted as yourself, undecided' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(NEW."evidence_ids") AS e(id)
                WHERE NOT EXISTS (SELECT 1 FROM "job_evidence" x WHERE x."id" = e.id AND x."assignment_id" = NEW."assignment_id")) THEN
      RAISE EXCEPTION 'the report cites photos of another assignment' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF j."on_site" AND cardinality(NEW."evidence_ids") = 0 THEN
      RAISE EXCEPTION 'an on-site report needs at least one photo' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW."job_id", NEW."assignment_id", NEW."summary", NEW."minutes_on_site", NEW."materials", NEW."evidence_ids",
         NEW."submitted_by", NEW."submitted_at")
     IS DISTINCT FROM
     ROW(OLD."job_id", OLD."assignment_id", OLD."summary", OLD."minutes_on_site", OLD."materials", OLD."evidence_ids",
         OLD."submitted_by", OLD."submitted_at")
     OR OLD."outcome" IS NOT NULL OR NEW."outcome" IS NULL THEN
    RAISE EXCEPTION 'a report is decided once and never edited' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."decided_by" IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'decided_by is the current user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app.is_platform() THEN
    IF NEW."outcome" <> 'STAFF_CONFIRMED' OR NEW."decision_reason" IS NULL THEN
      RAISE EXCEPTION 'staff confirm on the customer''s behalf, with a reason' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF app.is_job('jobs.%') THEN
    IF NEW."outcome" <> 'AUTO_CONFIRMED' OR OLD."submitted_at" + interval '7 days' > now() THEN
      RAISE EXCEPTION 'reports auto-confirm after 7 days' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    SELECT * INTO j FROM "job" WHERE "id" = OLD."job_id";
    IF j IS NULL OR NOT app.owns_customer_row(j."customer_tenant_id", j."customer_user_id")
       OR NEW."outcome" NOT IN ('CONFIRMED', 'ISSUE_RAISED')
       OR (NEW."outcome" = 'ISSUE_RAISED' AND NEW."decision_reason" IS NULL) THEN
      RAISE EXCEPTION 'the customer confirms or reports a problem' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_job_completion() FROM PUBLIC;
CREATE TRIGGER "job_completion_protect" BEFORE INSERT OR UPDATE ON "job_completion"
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_completion();

-- Cascades (plan §2.3): access ends in the same transaction ---------------------------

-- Ends an assignment and puts its job back in the queue, with an event the
-- dispatcher and the customer ("arranging a new technician") can see. A job
-- whose report is already with the customer stays there: the work is done and
-- the customer (or the 7-day auto-confirm) still decides it.
-- Runs under the caller's RLS: a context that cannot see the assignment does nothing.
CREATE OR REPLACE FUNCTION app.release_assignment(p_assignment uuid, p_reason "AssignmentEndReason", p_note text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  a record;
  previous "JobStatus";
BEGIN
  SELECT * INTO a FROM "job_assignment" WHERE "id" = p_assignment AND "status" = 'ACTIVE';
  IF a IS NULL THEN
    RETURN;
  END IF;
  SELECT "status" INTO previous FROM "job" WHERE "id" = a."job_id";
  -- The job and its event first: a company dispatcher sees the job only while
  -- the assignment is ACTIVE.
  IF previous IN ('ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'PAUSED') THEN
    UPDATE "job" SET "status" = 'QUEUED', "assigned_at" = NULL, "version" = "version" + 1
     WHERE "id" = a."job_id";
    INSERT INTO "job_event" ("job_id", "assignment_id", "kind", "from_value", "to_value", "reason", "customer_visible")
    VALUES (a."job_id", p_assignment, 'released', previous::text, 'QUEUED', left(p_note, 2000), true);
  ELSE
    INSERT INTO "job_event" ("job_id", "assignment_id", "kind", "reason")
    VALUES (a."job_id", p_assignment, 'released', left(p_note, 2000));
  END IF;
  UPDATE "job_assignment"
     SET "status" = 'ENDED', "end_reason" = p_reason, "end_note" = left(p_note, 500), "ended_at" = now(),
         "ended_by" = app.current_user_id()
   WHERE "id" = p_assignment;
END
$$;
REVOKE ALL ON FUNCTION app.release_assignment(uuid, "AssignmentEndReason", text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.release_assignment(uuid, "AssignmentEndReason", text) TO ogs_app;

-- A provider (or its company tenant) stops being ACTIVE: its pending offers are
-- withdrawn and its assignments released. Runs as the staff member who acted.
CREATE OR REPLACE FUNCTION app.release_provider_jobs(p_provider uuid) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  o record;
  a record;
BEGIN
  FOR o IN SELECT "id", "job_id" FROM "job_offer" WHERE "provider_id" = p_provider AND "status" = 'PENDING' LOOP
    UPDATE "job" SET "status" = 'QUEUED', "version" = "version" + 1 WHERE "id" = o."job_id" AND "status" = 'OFFERED';
    UPDATE "job_offer" SET "status" = 'WITHDRAWN', "responded_at" = now(), "responded_by" = app.current_user_id()
     WHERE "id" = o."id";
    INSERT INTO "job_event" ("job_id", "kind", "from_value", "to_value", "reason")
    VALUES (o."job_id", 'offer_withdrawn', 'OFFERED', 'QUEUED', 'Provider no longer active');
  END LOOP;
  FOR a IN SELECT "id" FROM "job_assignment" WHERE "provider_id" = p_provider AND "status" = 'ACTIVE' LOOP
    PERFORM app.release_assignment(a."id", 'PROVIDER_SUSPENDED', 'Provider no longer active');
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION app.release_provider_jobs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.release_provider_jobs(uuid) TO ogs_app;

CREATE OR REPLACE FUNCTION app.on_provider_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD."status" = 'ACTIVE' AND NEW."status" <> 'ACTIVE' THEN
    PERFORM app.release_provider_jobs(NEW."id");
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.on_provider_status() FROM PUBLIC;
CREATE TRIGGER "provider_release_jobs" AFTER UPDATE OF "status" ON "provider"
  FOR EACH ROW EXECUTE FUNCTION app.on_provider_status();

CREATE OR REPLACE FUNCTION app.on_tenant_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  p uuid;
BEGIN
  IF NEW."kind" = 'PROVIDER_COMPANY' AND OLD."status" = 'ACTIVE' AND NEW."status" <> 'ACTIVE' THEN
    FOR p IN SELECT "id" FROM "provider" WHERE "tenant_id" = NEW."id" LOOP
      PERFORM app.release_provider_jobs(p);
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.on_tenant_status() FROM PUBLIC;
CREATE TRIGGER "tenant_release_jobs" AFTER UPDATE OF "status" ON "tenant"
  FOR EACH ROW EXECUTE FUNCTION app.on_tenant_status();

-- A technician's membership ends or is suspended: their assignments in that
-- tenant are released (company dispatchers and staff can see them; a context
-- that cannot see them leaves them to the dispatcher, and the technician has
-- lost the workspace anyway).
CREATE OR REPLACE FUNCTION app.on_membership_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  a record;
BEGIN
  IF OLD."status" = 'ACTIVE' AND NEW."status" <> 'ACTIVE' THEN
    FOR a IN SELECT "id" FROM "job_assignment"
              WHERE "assignee_tenant_id" = NEW."tenant_id" AND "technician_user_id" = NEW."user_id" AND "status" = 'ACTIVE' LOOP
      PERFORM app.release_assignment(a."id", 'REMOVED', 'Technician no longer a member');
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.on_membership_status() FROM PUBLIC;
CREATE TRIGGER "membership_release_jobs" AFTER UPDATE OF "status" ON "membership"
  FOR EACH ROW EXECUTE FUNCTION app.on_membership_status();

-- An order cancelled by staff cancels its unfinished job (ends the assignment,
-- withdraws a pending offer).
CREATE OR REPLACE FUNCTION app.on_order_cancelled() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  j record;
BEGIN
  IF NEW."status" = 'CANCELLED' AND OLD."status" <> 'CANCELLED' THEN
    SELECT * INTO j FROM "job" WHERE "service_order_id" = NEW."id" AND "status" NOT IN ('COMPLETED', 'CANCELLED');
    IF j IS NULL THEN
      RETURN NULL;
    END IF;
    UPDATE "job_offer" SET "status" = 'WITHDRAWN', "responded_at" = now(), "responded_by" = app.current_user_id()
     WHERE "job_id" = j."id" AND "status" = 'PENDING';
    UPDATE "job_assignment"
       SET "status" = 'ENDED', "end_reason" = 'JOB_CANCELLED', "ended_at" = now(), "ended_by" = app.current_user_id()
     WHERE "job_id" = j."id" AND "status" = 'ACTIVE';
    UPDATE "job" SET "status" = 'CANCELLED', "cancel_reason" = coalesce(NEW."cancel_reason", 'Order cancelled'),
                     "version" = "version" + 1
     WHERE "id" = j."id";
    INSERT INTO "job_event" ("job_id", "kind", "from_value", "to_value", "reason", "customer_visible")
    VALUES (j."id", 'cancelled', j."status"::text, 'CANCELLED', coalesce(NEW."cancel_reason", 'Order cancelled'), true);
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.on_order_cancelled() FROM PUBLIC;
CREATE TRIGGER "service_order_cancel_job" AFTER UPDATE OF "status" ON "service_order"
  FOR EACH ROW EXECUTE FUNCTION app.on_order_cancelled();

-- Orders follow their job (P9-10): the jobs worker moves READY_FOR_ASSIGNMENT →
-- IN_DELIVERY → COMPLETED. Same function as Phase 7 plus that one allowance.
CREATE OR REPLACE FUNCTION app.protect_service_order() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  q record;
  r record;
  terms "PaymentTerms";
  days integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app.is_platform() THEN
      RETURN NEW;
    END IF;
    SELECT * INTO r FROM "service_request" WHERE "id" = NEW."request_id";
    SELECT * INTO q FROM "quotation" WHERE "id" = NEW."quotation_id";
    IF q IS NULL OR q."request_id" <> NEW."request_id" OR q."status" <> 'ACCEPTED'
       OR q."subtotal_minor" <> NEW."subtotal_minor" OR q."vat_minor" <> NEW."vat_minor"
       OR q."total_minor" <> NEW."total_minor" OR NEW."paid_minor" <> 0
       OR r."customer_tenant_id" IS DISTINCT FROM NEW."customer_tenant_id"
       OR r."customer_user_id" IS DISTINCT FROM NEW."customer_user_id" THEN
      RAISE EXCEPTION 'an order must match its accepted quotation' USING ERRCODE = 'insufficient_privilege';
    END IF;
    terms := 'PREPAY';
    days := NULL;
    IF NEW."customer_tenant_id" IS NOT NULL THEN
      SELECT "payment_terms", "net_days" INTO terms, days
        FROM "organisation_billing" WHERE "tenant_id" = NEW."customer_tenant_id";
      terms := coalesce(terms, 'PREPAY');
    END IF;
    IF NEW."payment_terms" <> terms OR NEW."net_days" IS DISTINCT FROM days
       OR NEW."status" <> (CASE WHEN terms = 'POSTPAID' THEN 'READY_FOR_ASSIGNMENT' ELSE 'AWAITING_PAYMENT' END)::"OrderStatus" THEN
      RAISE EXCEPTION 'order terms must match the organisation''s billing terms'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW."number", NEW."request_id", NEW."quotation_id", NEW."customer_tenant_id", NEW."customer_user_id",
         NEW."payment_terms", NEW."net_days", NEW."subtotal_minor", NEW."vat_minor", NEW."total_minor")
     IS DISTINCT FROM
     ROW(OLD."number", OLD."request_id", OLD."quotation_id", OLD."customer_tenant_id", OLD."customer_user_id",
         OLD."payment_terms", OLD."net_days", OLD."subtotal_minor", OLD."vat_minor", OLD."total_minor") THEN
    RAISE EXCEPTION 'order terms and totals are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app.is_job('jobs.%') AND NOT app.is_platform() THEN
    IF NEW."paid_minor" IS DISTINCT FROM OLD."paid_minor" OR NEW."refund_due" IS DISTINCT FROM OLD."refund_due"
       OR NOT ((OLD."status" = 'READY_FOR_ASSIGNMENT' AND NEW."status" = 'IN_DELIVERY')
               OR (OLD."status" = 'IN_DELIVERY' AND NEW."status" = 'COMPLETED')) THEN
      RAISE EXCEPTION 'the jobs worker only moves orders into and out of delivery' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT app.is_platform() AND (
       NEW."paid_minor" IS DISTINCT FROM OLD."paid_minor"
       OR NEW."refund_due" IS DISTINCT FROM OLD."refund_due"
       OR (NEW."status" IS DISTINCT FROM OLD."status"
           AND NOT (OLD."status" = 'AWAITING_PAYMENT' AND NEW."status" = 'CANCELLED' AND OLD."paid_minor" = 0))
     ) THEN
    RAISE EXCEPTION 'only staff change payments and order status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- Permission catalogue change (P9-2): providers never hold these two. System
-- roles are re-synced at start-up; custom provider-company roles are cleaned here.
DELETE FROM "role_permission" rp
 USING "role" r
 WHERE r."id" = rp."role_id" AND r."scope" = 'PROVIDER_COMPANY'
   AND rp."permission_code" IN ('ticket.internal_note', 'ticket.comment');
UPDATE "permission" SET "allowed_kinds" = array_remove("allowed_kinds", 'PROVIDER_COMPANY'::"TenantKind")
 WHERE "code" IN ('ticket.internal_note', 'ticket.comment');

-- Grants -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "job", "job_offer", "job_assignment", "job_completion" TO ogs_app;
GRANT SELECT, INSERT ON "job_skill", "job_event", "job_work_note", "job_evidence" TO ogs_app;

-- Row-level security -----------------------------------------------------------------
ALTER TABLE "job"            ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_skill"      ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_offer"      ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_assignment" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_event"      ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_work_note"  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_evidence"   ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_completion" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Offers: staff, jobs.* workers, and the addressee (all their own offers).
CREATE POLICY "job_offer_select" ON "job_offer" FOR SELECT USING (
  app.is_platform() OR app.is_job('jobs.%')
  OR app.holds_offer("kind", "provider_id", "assignee_tenant_id", "technician_user_id")
);
CREATE POLICY "job_offer_insert" ON "job_offer" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY "job_offer_update" ON "job_offer" FOR UPDATE
  USING (app.is_platform() OR app.is_job('jobs.%')
         OR app.holds_offer("kind", "provider_id", "assignee_tenant_id", "technician_user_id"))
  WITH CHECK (app.is_platform() OR app.is_job('jobs.%')
              OR app.holds_offer("kind", "provider_id", "assignee_tenant_id", "technician_user_id"));

-- Assignments: staff, workers, the holder (any status: the "Done" list), and the
-- customer (who is assigned). Never reads "job" (copies carry the customer).
CREATE POLICY "job_assignment_select" ON "job_assignment" FOR SELECT USING (
  app.is_platform() OR app.is_job('jobs.%')
  OR app.holds_assignment("kind", "provider_id", "assignee_tenant_id", "technician_user_id")
  OR app.owns_customer_row("customer_tenant_id", "customer_user_id")
);
-- Inserted by the offer's addressee (accepting) or a company dispatcher
-- (changing the technician); protect_job_assignment checks which.
CREATE POLICY "job_assignment_insert" ON "job_assignment" FOR INSERT WITH CHECK (
  app.is_platform()
  OR EXISTS (SELECT 1 FROM "job_offer" o WHERE o."id" = "job_assignment"."offer_id"
                AND app.holds_offer(o."kind", o."provider_id", o."assignee_tenant_id", o."technician_user_id"))
  OR ("kind" = 'COMPANY' AND "assignee_tenant_id" = app.current_tenant_id() AND app.holds_permission('ticket.assign'))
);
CREATE POLICY "job_assignment_update" ON "job_assignment" FOR UPDATE
  USING (app.is_platform() OR app.is_job('jobs.%')
         OR ("status" = 'ACTIVE' AND app.holds_assignment("kind", "provider_id", "assignee_tenant_id", "technician_user_id"))
         OR ("status" = 'ACTIVE' AND app.owns_customer_row("customer_tenant_id", "customer_user_id")))
  WITH CHECK (app.is_platform() OR app.is_job('jobs.%')
              OR app.holds_assignment("kind", "provider_id", "assignee_tenant_id", "technician_user_id")
              OR app.owns_customer_row("customer_tenant_id", "customer_user_id"));

-- Jobs: staff, workers, the customer, the holder of the ACTIVE assignment, and
-- the addressee of a PENDING offer. Providers have no policy on any customer table.
CREATE POLICY "job_select" ON "job" FOR SELECT USING (
  app.is_platform() OR app.is_job('jobs.%')
  OR app.owns_customer_row("customer_tenant_id", "customer_user_id")
  OR EXISTS (SELECT 1 FROM "job_assignment" a
              WHERE a."job_id" = "job"."id" AND a."status" = 'ACTIVE'
                AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
  OR EXISTS (SELECT 1 FROM "job_offer" o
              WHERE o."job_id" = "job"."id" AND o."status" = 'PENDING'
                AND app.holds_offer(o."kind", o."provider_id", o."assignee_tenant_id", o."technician_user_id"))
);
CREATE POLICY "job_insert" ON "job" FOR INSERT WITH CHECK (app.is_platform() OR app.is_job('jobs.%'));
CREATE POLICY "job_update" ON "job" FOR UPDATE
  USING (
    app.is_platform() OR app.is_job('jobs.%')
    OR app.owns_customer_row("customer_tenant_id", "customer_user_id")
    OR EXISTS (SELECT 1 FROM "job_assignment" a
                WHERE a."job_id" = "job"."id" AND a."status" = 'ACTIVE'
                  AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
    OR EXISTS (SELECT 1 FROM "job_offer" o
                WHERE o."job_id" = "job"."id" AND o."status" = 'PENDING'
                  AND app.holds_offer(o."kind", o."provider_id", o."assignee_tenant_id", o."technician_user_id"))
  )
  WITH CHECK (
    app.is_platform() OR app.is_job('jobs.%')
    OR app.owns_customer_row("customer_tenant_id", "customer_user_id")
    OR EXISTS (SELECT 1 FROM "job_assignment" a
                WHERE a."job_id" = "job"."id" AND a."status" = 'ACTIVE'
                  AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
    OR EXISTS (SELECT 1 FROM "job_offer" o
                WHERE o."job_id" = "job"."id" AND o."status" = 'PENDING'
                  AND app.holds_offer(o."kind", o."provider_id", o."assignee_tenant_id", o."technician_user_id"))
  );

-- Requirements follow the job.
CREATE POLICY "job_skill_select" ON "job_skill" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "job" j WHERE j."id" = "job_skill"."job_id")
);
CREATE POLICY "job_skill_insert" ON "job_skill" FOR INSERT WITH CHECK (app.is_platform() OR app.is_job('jobs.%'));

-- Activity: staff and workers all rows; customers customer_visible rows of their
-- jobs; holders provider_visible rows of their ACTIVE assignment.
CREATE POLICY "job_event_select" ON "job_event" FOR SELECT USING (
  app.is_platform() OR app.is_job('jobs.%')
  OR ("customer_visible" AND EXISTS (
        SELECT 1 FROM "job" j WHERE j."id" = "job_event"."job_id"
           AND app.owns_customer_row(j."customer_tenant_id", j."customer_user_id")))
  OR ("provider_visible" AND EXISTS (
        SELECT 1 FROM "job_assignment" a WHERE a."id" = "job_event"."assignment_id" AND a."status" = 'ACTIVE'
           AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id")))
);
CREATE POLICY "job_event_insert" ON "job_event" FOR INSERT WITH CHECK (
  app.is_platform() OR app.is_job('jobs.%')
  OR EXISTS (SELECT 1 FROM "job" j WHERE j."id" = "job_event"."job_id")
);

-- Work notes: staff, workers and the ACTIVE holder of their assignment. Never customers.
CREATE POLICY "job_work_note_select" ON "job_work_note" FOR SELECT USING (
  app.is_platform() OR app.is_job('jobs.%')
  OR EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."id" = "job_work_note"."assignment_id" AND a."status" = 'ACTIVE'
                AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
);
CREATE POLICY "job_work_note_insert" ON "job_work_note" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."id" = "job_work_note"."assignment_id" AND a."status" = 'ACTIVE'
             AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
);

-- Completion reports: staff, workers, the ACTIVE holder (their own), the customer.
CREATE POLICY "job_completion_select" ON "job_completion" FOR SELECT USING (
  app.is_platform() OR app.is_job('jobs.%')
  OR EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."id" = "job_completion"."assignment_id" AND a."status" = 'ACTIVE'
                AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
  OR EXISTS (SELECT 1 FROM "job" j WHERE j."id" = "job_completion"."job_id"
                AND app.owns_customer_row(j."customer_tenant_id", j."customer_user_id"))
);
CREATE POLICY "job_completion_insert" ON "job_completion" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."id" = "job_completion"."assignment_id" AND a."status" = 'ACTIVE'
             AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
);
CREATE POLICY "job_completion_update" ON "job_completion" FOR UPDATE
  USING (app.is_platform() OR app.is_job('jobs.%')
         OR EXISTS (SELECT 1 FROM "job" j WHERE j."id" = "job_completion"."job_id"
                       AND app.owns_customer_row(j."customer_tenant_id", j."customer_user_id")))
  WITH CHECK (app.is_platform() OR app.is_job('jobs.%')
              OR EXISTS (SELECT 1 FROM "job" j WHERE j."id" = "job_completion"."job_id"
                            AND app.owns_customer_row(j."customer_tenant_id", j."customer_user_id")));

-- Evidence: staff, workers, the ACTIVE holder, and the customer only for photos
-- cited in a submitted report.
CREATE POLICY "job_evidence_select" ON "job_evidence" FOR SELECT USING (
  app.is_platform() OR app.is_job('jobs.%')
  OR EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."id" = "job_evidence"."assignment_id" AND a."status" = 'ACTIVE'
                AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
  OR (EXISTS (SELECT 1 FROM "job" j WHERE j."id" = "job_evidence"."job_id"
                 AND app.owns_customer_row(j."customer_tenant_id", j."customer_user_id"))
      AND EXISTS (SELECT 1 FROM "job_completion" c
                   WHERE c."job_id" = "job_evidence"."job_id" AND "job_evidence"."id" = ANY (c."evidence_ids")))
);
CREATE POLICY "job_evidence_insert" ON "job_evidence" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."id" = "job_evidence"."assignment_id" AND a."status" = 'ACTIVE'
             AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id"))
);

-- Evidence files (plan §2.6): owned by the job's customer, uploaded by the holder.
-- Visible through a visible job_evidence row, or to the uploader inside the
-- uploading transaction only (created_at = now(): the protect trigger reads it).
CREATE POLICY "file_metadata_select_job_evidence" ON "file_metadata" FOR SELECT USING (
  "purpose" = 'job.evidence' AND (
    EXISTS (SELECT 1 FROM "job_evidence" e WHERE e."file_id" = "file_metadata"."id")
    OR ("uploaded_by" = app.current_user_id() AND "created_at" = now())
  )
);
CREATE POLICY "file_metadata_insert_job_evidence" ON "file_metadata" FOR INSERT WITH CHECK (
  "purpose" = 'job.evidence' AND "uploaded_by" = app.current_user_id()
  AND EXISTS (
    SELECT 1 FROM "job_assignment" a
      JOIN "job" j ON j."id" = a."job_id"
     WHERE a."status" = 'ACTIVE'
       AND app.holds_assignment(a."kind", a."provider_id", a."assignee_tenant_id", a."technician_user_id")
       AND j."customer_tenant_id" IS NOT DISTINCT FROM "file_metadata"."tenant_id"
       AND j."customer_user_id" IS NOT DISTINCT FROM "file_metadata"."owner_user_id"
  )
);

-- Internal notes (P9-2): an INTERNAL OGS technician may read the notes of the
-- ticket behind their ACTIVE job. There is no provider branch, ever.
CREATE POLICY "ticket_internal_note_assigned_technician" ON "ticket_internal_note" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "job" j
      JOIN "job_assignment" a ON a."job_id" = j."id"
     WHERE j."ticket_id" = "ticket_internal_note"."ticket_id"
       AND a."status" = 'ACTIVE' AND a."kind" = 'INTERNAL'
       AND a."technician_user_id" = app.current_user_id()
       AND a."assignee_tenant_id" = app.current_tenant_id()
  )
);

-- The jobs.* workers: create jobs from orders (reading the order, its request,
-- its service and the customer's name), move orders into and out of delivery,
-- and read recipients for emails.
CREATE POLICY "service_order_select_jobs" ON "service_order" FOR SELECT USING (app.is_job('jobs.%'));
CREATE POLICY "service_order_update_jobs" ON "service_order" FOR UPDATE
  USING (app.is_job('jobs.%')) WITH CHECK (app.is_job('jobs.%'));
CREATE POLICY "service_request_select_jobs" ON "service_request" FOR SELECT USING (app.is_job('jobs.%'));
CREATE POLICY "service_select_jobs" ON "service" FOR SELECT USING (app.is_job('jobs.%'));
CREATE POLICY "service_skill_select_jobs" ON "service_skill" FOR SELECT USING (app.is_job('jobs.%'));
CREATE POLICY "ticket_select_jobs" ON "ticket" FOR SELECT USING (app.is_job('jobs.%'));
CREATE POLICY "tenant_select_jobs" ON "tenant" FOR SELECT USING (app.is_job('jobs.%'));
CREATE POLICY "provider_select_jobs" ON "provider" FOR SELECT USING (app.is_job('jobs.%'));
CREATE POLICY "membership_select_jobs_notify" ON "membership" FOR SELECT USING (app.is_job('jobs.notify'));
CREATE POLICY "membership_role_select_jobs_notify" ON "membership_role" FOR SELECT USING (app.is_job('jobs.notify'));
CREATE POLICY "role_select_jobs_notify" ON "role" FOR SELECT USING (app.is_job('jobs.notify'));
CREATE POLICY "app_user_select_jobs_notify" ON "app_user" FOR SELECT USING (
  app.is_job('jobs.notify')
  AND (
    EXISTS (SELECT 1 FROM "job" j WHERE j."customer_user_id" = "app_user"."id")
    OR EXISTS (SELECT 1 FROM "job_assignment" a WHERE a."technician_user_id" = "app_user"."id")
    OR EXISTS (SELECT 1 FROM "job_offer" o WHERE o."technician_user_id" = "app_user"."id" OR o."offered_by" = "app_user"."id")
    OR EXISTS (SELECT 1 FROM "provider" p
                WHERE p."owner_user_id" = "app_user"."id"
                  AND EXISTS (SELECT 1 FROM "job_offer" o WHERE o."provider_id" = p."id"))
    OR EXISTS (SELECT 1 FROM "membership" m
                WHERE m."user_id" = "app_user"."id" AND m."status" = 'ACTIVE'
                  AND (EXISTS (SELECT 1 FROM "job" j WHERE j."customer_tenant_id" = m."tenant_id")
                       OR EXISTS (SELECT 1 FROM "job_offer" o WHERE o."assignee_tenant_id" = m."tenant_id")))
    OR EXISTS (SELECT 1 FROM "service_order" so
                 JOIN "service_request" r ON r."id" = so."request_id"
                WHERE r."created_by" = "app_user"."id"
                  AND EXISTS (SELECT 1 FROM "job" j WHERE j."service_order_id" = so."id"))
    OR EXISTS (SELECT 1 FROM "ticket" t
                WHERE t."requester_user_id" = "app_user"."id"
                  AND EXISTS (SELECT 1 FROM "job" j WHERE j."ticket_id" = t."id"))
  )
);
