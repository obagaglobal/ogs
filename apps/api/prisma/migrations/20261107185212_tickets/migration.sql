-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'ON_HOLD', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('INCIDENT', 'QUESTION');

-- CreateEnum
CREATE TYPE "TicketUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('WEB', 'PHONE', 'EMAIL', 'WALK_IN', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "TicketClosure" AS ENUM ('ACCEPTED', 'AUTO_CLOSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TicketAuthorSide" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "TicketEventVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- AlterTable
ALTER TABLE "service_request" ADD COLUMN     "entered_by" UUID,
ADD COLUMN     "on_behalf" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ticket_category" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ticket_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(20) NOT NULL,
    "customer_tenant_id" UUID,
    "customer_user_id" UUID,
    "requester_user_id" UUID NOT NULL,
    "department_id" UUID,
    "created_by" UUID NOT NULL,
    "on_behalf" BOOLEAN NOT NULL DEFAULT false,
    "channel" "TicketChannel" NOT NULL DEFAULT 'WEB',
    "type" "TicketType" NOT NULL DEFAULT 'INCIDENT',
    "category_id" UUID NOT NULL,
    "subject" VARCHAR(150) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "urgency" "TicketUrgency" NOT NULL DEFAULT 'NORMAL',
    "priority" "TicketPriority",
    "service_order_id" UUID,
    "related_ticket_id" UUID,
    "assignee_user_id" UUID,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "resolution" VARCHAR(2000),
    "closure" "TicketClosure",
    "closure_reason" VARCHAR(500),
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "first_response_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL DEFAULT app.current_user_id(),
    "side" "TicketAuthorSide" NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_internal_note" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL DEFAULT app.current_user_id(),
    "body" VARCHAR(5000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_internal_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "comment_id" UUID,
    "note_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "visibility" "TicketEventVisibility" NOT NULL,
    "from_value" VARCHAR(40),
    "to_value" VARCHAR(40),
    "actor_user_id" UUID DEFAULT app.current_user_id(),
    "reason" VARCHAR(2000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_category_code_key" ON "ticket_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_number_key" ON "ticket"("number");

-- CreateIndex
CREATE INDEX "ticket_customer_tenant_id_created_at_idx" ON "ticket"("customer_tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_customer_user_id_created_at_idx" ON "ticket"("customer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_status_priority_created_at_idx" ON "ticket"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "ticket_assignee_user_id_status_idx" ON "ticket"("assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "ticket_status_resolved_at_idx" ON "ticket"("status", "resolved_at");

-- CreateIndex
CREATE INDEX "ticket_comment_ticket_id_created_at_idx" ON "ticket_comment"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_internal_note_ticket_id_created_at_idx" ON "ticket_internal_note"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_attachment_file_id_key" ON "ticket_attachment"("file_id");

-- CreateIndex
CREATE INDEX "ticket_attachment_ticket_id_idx" ON "ticket_attachment"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_event_ticket_id_occurred_at_idx" ON "ticket_event"("ticket_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_related_ticket_id_fkey" FOREIGN KEY ("related_ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_internal_note" ADD CONSTRAINT "ticket_internal_note_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "ticket_comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "ticket_internal_note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_metadata"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================================
-- Hand-written below: Phase 8 plan §2.1–§2.4. Constraints, seed data, triggers,
-- grants and row-level security.
-- ===================================================================================

-- Constraints -------------------------------------------------------------------

ALTER TABLE "ticket"
  ADD CONSTRAINT "ticket_one_customer_chk" CHECK (("customer_tenant_id" IS NULL) <> ("customer_user_id" IS NULL)),
  ADD CONSTRAINT "ticket_number_chk" CHECK ("number" ~ '^TCK-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT "ticket_subject_chk" CHECK (length(btrim("subject")) >= 3),
  ADD CONSTRAINT "ticket_description_chk" CHECK (length(btrim("description")) >= 10),
  ADD CONSTRAINT "ticket_personal_requester_chk" CHECK ("customer_user_id" IS NULL OR "requester_user_id" = "customer_user_id"),
  ADD CONSTRAINT "ticket_personal_department_chk" CHECK ("customer_tenant_id" IS NOT NULL OR "department_id" IS NULL),
  ADD CONSTRAINT "ticket_on_behalf_chk" CHECK ("on_behalf" OR ("channel" = 'WEB' AND "created_by" = "requester_user_id")),
  ADD CONSTRAINT "ticket_reopen_chk" CHECK ("reopen_count" >= 0),
  ADD CONSTRAINT "ticket_related_chk" CHECK ("related_ticket_id" IS NULL OR "related_ticket_id" <> "id"),
  ADD CONSTRAINT "ticket_resolved_chk" CHECK (
    ("status" <> 'RESOLVED' OR ("resolved_at" IS NOT NULL AND "resolution" IS NOT NULL))
    AND ("status" IN ('RESOLVED', 'CLOSED') OR ("resolved_at" IS NULL AND "resolution" IS NULL))
  ),
  ADD CONSTRAINT "ticket_closed_chk" CHECK (
    ("status" = 'CLOSED') = ("closure" IS NOT NULL)
    AND ("status" = 'CLOSED') = ("closed_at" IS NOT NULL)
    AND ("closure" IS NULL OR "closure" = 'WITHDRAWN' OR "resolved_at" IS NOT NULL)
    AND ("closure" IS DISTINCT FROM 'WITHDRAWN' OR "closure_reason" IS NOT NULL)
  );

ALTER TABLE "ticket_comment"
  ADD CONSTRAINT "ticket_comment_body_chk" CHECK (length(btrim("body")) >= 1);
ALTER TABLE "ticket_internal_note"
  ADD CONSTRAINT "ticket_internal_note_body_chk" CHECK (length(btrim("body")) >= 1);
-- A file sits on the ticket itself (both NULL), a public comment, or an internal note.
ALTER TABLE "ticket_attachment"
  ADD CONSTRAINT "ticket_attachment_owner_chk" CHECK ("comment_id" IS NULL OR "note_id" IS NULL);
ALTER TABLE "ticket_event"
  ADD CONSTRAINT "ticket_event_kind_chk" CHECK ("kind" ~ '^[a-z][a-z_]{1,29}$');
ALTER TABLE "ticket_category"
  ADD CONSTRAINT "ticket_category_code_chk" CHECK ("code" ~ '^[a-z][a-z0-9_]{1,39}$');

ALTER TABLE "document_counter" DROP CONSTRAINT "document_counter_kind_chk";
ALTER TABLE "document_counter"
  ADD CONSTRAINT "document_counter_kind_chk" CHECK ("kind" IN ('REQ', 'QUO', 'ORD', 'TCK'));

-- Requests on behalf (P8-7): the staff member who entered it, and only then.
ALTER TABLE "service_request"
  ADD CONSTRAINT "service_request_on_behalf_chk" CHECK ("on_behalf" = ("entered_by" IS NOT NULL));

-- Seed: ticket categories ------------------------------------------------------------
INSERT INTO "ticket_category" ("code", "name", "position") VALUES
  ('hardware', 'Hardware', 1),
  ('software', 'Software', 2),
  ('network', 'Network and internet', 3),
  ('email_accounts', 'Email and accounts', 4),
  ('printers', 'Printers', 5),
  ('security', 'Security incident', 6),
  ('other', 'Other', 7);

-- Append-only rows ---------------------------------------------------------------------
CREATE TRIGGER "ticket_comment_reject_update_delete" BEFORE UPDATE OR DELETE ON "ticket_comment"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "ticket_internal_note_reject_update_delete" BEFORE UPDATE OR DELETE ON "ticket_internal_note"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "ticket_attachment_reject_update_delete" BEFORE UPDATE OR DELETE ON "ticket_attachment"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "ticket_event_reject_update_delete" BEFORE UPDATE OR DELETE ON "ticket_event"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Tickets: the second guard behind src/tickets/transitions.ts (plan §2.2).
--  * Linked orders, follow-ups, requesters and departments must belong to the
--    ticket's own customer (read under the caller's RLS: a foreign row is invisible).
--  * Customers may only open NEW tickets, reply out of "awaiting customer", reopen
--    within 7 days of resolution, accept a resolution, or withdraw.
--  * The tickets.* job may only auto-close a resolution older than 7 days.
--  * CLOSED is final for everyone.
CREATE OR REPLACE FUNCTION app.protect_ticket() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  linked record;
  dept uuid;
  customer_side boolean := NOT app.is_platform() AND app.current_actor_kind() IS DISTINCT FROM 'SYSTEM';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'CLOSED' THEN
      RAISE EXCEPTION 'a closed ticket is final' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF ROW(NEW."number", NEW."customer_tenant_id", NEW."customer_user_id", NEW."requester_user_id",
           NEW."department_id", NEW."created_by", NEW."on_behalf", NEW."channel", NEW."description", NEW."created_at")
       IS DISTINCT FROM
       ROW(OLD."number", OLD."customer_tenant_id", OLD."customer_user_id", OLD."requester_user_id",
           OLD."department_id", OLD."created_by", OLD."on_behalf", OLD."channel", OLD."description", OLD."created_at") THEN
      RAISE EXCEPTION 'ticket origin is immutable' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Links must stay within the customer.
  IF NEW."service_order_id" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."service_order_id" IS DISTINCT FROM OLD."service_order_id") THEN
    SELECT "customer_tenant_id", "customer_user_id" INTO linked FROM "service_order" WHERE "id" = NEW."service_order_id";
    IF NOT FOUND OR linked."customer_tenant_id" IS DISTINCT FROM NEW."customer_tenant_id"
       OR linked."customer_user_id" IS DISTINCT FROM NEW."customer_user_id" THEN
      RAISE EXCEPTION 'the linked order belongs to another customer' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW."related_ticket_id" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."related_ticket_id" IS DISTINCT FROM OLD."related_ticket_id") THEN
    SELECT "customer_tenant_id", "customer_user_id" INTO linked FROM "ticket" WHERE "id" = NEW."related_ticket_id";
    IF NOT FOUND OR linked."customer_tenant_id" IS DISTINCT FROM NEW."customer_tenant_id"
       OR linked."customer_user_id" IS DISTINCT FROM NEW."customer_user_id" THEN
      RAISE EXCEPTION 'the related ticket belongs to another customer' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."customer_tenant_id" IS NOT NULL THEN
      SELECT m."department_id" INTO dept FROM "membership" m
       WHERE m."tenant_id" = NEW."customer_tenant_id" AND m."user_id" = NEW."requester_user_id" AND m."status" = 'ACTIVE';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'the requester is not an active member of the organisation' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW."department_id" IS DISTINCT FROM dept THEN
        RAISE EXCEPTION 'the department must be the requester''s own' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW."status" <> 'NEW' OR NEW."assignee_user_id" IS NOT NULL OR NEW."first_response_at" IS NOT NULL
       OR NEW."reopen_count" <> 0 OR NEW."version" <> 0 THEN
      RAISE EXCEPTION 'a ticket starts as NEW and unassigned' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF customer_side AND (NEW."priority" IS NOT NULL OR NEW."on_behalf") THEN
      RAISE EXCEPTION 'customers cannot set a priority' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF app.current_actor_kind() = 'SYSTEM' AND NOT app.is_platform() THEN
    IF NOT (OLD."status" = 'RESOLVED' AND NEW."status" = 'CLOSED' AND NEW."closure" = 'AUTO_CLOSED'
            AND OLD."resolved_at" + interval '7 days' <= now()) THEN
      RAISE EXCEPTION 'ticket jobs may only auto-close an old resolution' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF customer_side OR app.current_actor_kind() = 'SYSTEM' AND NOT app.is_platform() THEN
    IF ROW(NEW."type", NEW."category_id", NEW."subject", NEW."urgency", NEW."priority", NEW."service_order_id",
           NEW."related_ticket_id", NEW."assignee_user_id", NEW."first_response_at")
       IS DISTINCT FROM
       ROW(OLD."type", OLD."category_id", OLD."subject", OLD."urgency", OLD."priority", OLD."service_order_id",
           OLD."related_ticket_id", OLD."assignee_user_id", OLD."first_response_at") THEN
      RAISE EXCEPTION 'only OGS staff change ticket details' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF customer_side AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'AWAITING_CUSTOMER' AND NEW."status" = 'IN_PROGRESS')
      OR (OLD."status" = 'RESOLVED' AND NEW."status" = 'IN_PROGRESS'
          AND OLD."resolved_at" + interval '7 days' > now() AND NEW."reopen_count" = OLD."reopen_count" + 1)
      OR (OLD."status" = 'RESOLVED' AND NEW."status" = 'CLOSED' AND NEW."closure" = 'ACCEPTED')
      OR (OLD."status" IN ('NEW', 'OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'ON_HOLD')
          AND NEW."status" = 'CLOSED' AND NEW."closure" = 'WITHDRAWN')
    ) THEN
      RAISE EXCEPTION 'ticket transition % -> % is not allowed for customers', OLD."status", NEW."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF customer_side AND (NEW."resolution" IS DISTINCT FROM OLD."resolution"
                           OR NEW."reopen_count" IS DISTINCT FROM OLD."reopen_count") THEN
    RAISE EXCEPTION 'only OGS staff change ticket details' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_ticket() FROM PUBLIC;
CREATE TRIGGER "ticket_protect" BEFORE INSERT OR UPDATE ON "ticket"
  FOR EACH ROW EXECUTE FUNCTION app.protect_ticket();

-- Comments: nobody writes on a closed ticket; customers write as the customer,
-- staff (platform) as staff, and only as themselves.
CREATE OR REPLACE FUNCTION app.protect_ticket_comment() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  current_status "TicketStatus";
BEGIN
  SELECT "status" INTO current_status FROM "ticket" WHERE "id" = NEW."ticket_id";
  IF NOT FOUND OR current_status = 'CLOSED' THEN
    RAISE EXCEPTION 'comments need an open ticket' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."author_user_id" IS DISTINCT FROM app.current_user_id()
     OR NEW."side" <> (CASE WHEN app.is_platform() THEN 'STAFF' ELSE 'CUSTOMER' END)::"TicketAuthorSide" THEN
    RAISE EXCEPTION 'comments are written as yourself, from your own side' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_ticket_comment() FROM PUBLIC;
CREATE TRIGGER "ticket_comment_protect" BEFORE INSERT ON "ticket_comment"
  FOR EACH ROW EXECUTE FUNCTION app.protect_ticket_comment();

CREATE OR REPLACE FUNCTION app.protect_ticket_internal_note() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT app.is_platform() OR NEW."author_user_id" IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'internal notes are written by OGS staff as themselves' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ticket" t WHERE t."id" = NEW."ticket_id" AND t."status" <> 'CLOSED') THEN
    RAISE EXCEPTION 'notes need an open ticket' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_ticket_internal_note() FROM PUBLIC;
CREATE TRIGGER "ticket_internal_note_protect" BEFORE INSERT ON "ticket_internal_note"
  FOR EACH ROW EXECUTE FUNCTION app.protect_ticket_internal_note();

-- Attachments: only ticket.attachment files you uploaded yourself, on the same
-- ticket as their comment or note. Public files belong to the ticket's customer;
-- internal (note) files belong to the PLATFORM tenant, so a customer's file
-- policies can never reach them.
CREATE OR REPLACE FUNCTION app.protect_ticket_attachment() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  f record;
  t record;
BEGIN
  SELECT "tenant_id", "owner_user_id", "purpose", "uploaded_by" INTO f FROM "file_metadata" WHERE "id" = NEW."file_id";
  SELECT "customer_tenant_id", "customer_user_id" INTO t FROM "ticket" WHERE "id" = NEW."ticket_id";
  IF f IS NULL OR t IS NULL OR f."purpose" <> 'ticket.attachment' OR f."uploaded_by" IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'attach your own ticket files only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."comment_id" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "ticket_comment" c WHERE c."id" = NEW."comment_id" AND c."ticket_id" = NEW."ticket_id") THEN
    RAISE EXCEPTION 'the comment is on another ticket' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."note_id" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "ticket_internal_note" n WHERE n."id" = NEW."note_id" AND n."ticket_id" = NEW."ticket_id") THEN
      RAISE EXCEPTION 'the note is on another ticket' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF f."owner_user_id" IS NOT NULL
       OR f."tenant_id" IS DISTINCT FROM (SELECT "id" FROM "tenant" WHERE "kind" = 'PLATFORM') THEN
      RAISE EXCEPTION 'internal files belong to OGS' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF f."tenant_id" IS DISTINCT FROM t."customer_tenant_id" OR f."owner_user_id" IS DISTINCT FROM t."customer_user_id" THEN
    RAISE EXCEPTION 'public files belong to the ticket''s customer' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_ticket_attachment() FROM PUBLIC;
CREATE TRIGGER "ticket_attachment_protect" BEFORE INSERT ON "ticket_attachment"
  FOR EACH ROW EXECUTE FUNCTION app.protect_ticket_attachment();

-- Service requests: only elevated staff enter a request on behalf (as themselves),
-- and the on-behalf facts join the immutable snapshot.
CREATE OR REPLACE FUNCTION app.protect_service_request_origin() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."on_behalf" AND (NOT app.is_platform() OR NEW."entered_by" IS DISTINCT FROM app.current_user_id()) THEN
      RAISE EXCEPTION 'only OGS staff enter requests on behalf of a customer' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."on_behalf" IS DISTINCT FROM OLD."on_behalf" OR NEW."entered_by" IS DISTINCT FROM OLD."entered_by" THEN
    RAISE EXCEPTION 'request snapshot is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_service_request_origin() FROM PUBLIC;
CREATE TRIGGER "service_request_protect_origin" BEFORE INSERT OR UPDATE ON "service_request"
  FOR EACH ROW EXECUTE FUNCTION app.protect_service_request_origin();

-- Grants -----------------------------------------------------------------------------
GRANT SELECT ON "ticket_category" TO ogs_app;
GRANT SELECT, INSERT, UPDATE ON "ticket" TO ogs_app;
GRANT SELECT, INSERT ON "ticket_comment", "ticket_internal_note", "ticket_attachment", "ticket_event" TO ogs_app;

-- Row-level security -----------------------------------------------------------------
ALTER TABLE "ticket_category"      ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket"               ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_comment"       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_internal_note" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_attachment"    ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_event"         ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Categories: any signed-in or system context (no anonymous reads).
CREATE POLICY "ticket_category_select" ON "ticket_category" FOR SELECT USING (app.current_actor_kind() IS NOT NULL);

-- Tickets: the owning organisation or person, elevated staff, and tickets.* jobs.
-- The member / department / admin split is the service layer's (P8-4, as ADR-054).
CREATE POLICY "ticket_select" ON "ticket" FOR SELECT USING (
  app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform() OR app.is_job('tickets.%')
);
CREATE POLICY "ticket_insert" ON "ticket" FOR INSERT WITH CHECK (
  (app.owns_customer_row("customer_tenant_id", "customer_user_id") AND NOT app.is_platform()
   AND "created_by" = app.current_user_id() AND "requester_user_id" = app.current_user_id() AND NOT "on_behalf")
  OR (app.is_platform() AND "created_by" = app.current_user_id() AND "on_behalf")
);
CREATE POLICY "ticket_update" ON "ticket" FOR UPDATE
  USING (app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform() OR app.is_job('tickets.%'))
  WITH CHECK (app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform() OR app.is_job('tickets.%'));

-- The public conversation: whoever can see the ticket.
CREATE POLICY "ticket_comment_select" ON "ticket_comment" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "ticket" t WHERE t."id" = "ticket_comment"."ticket_id")
);
CREATE POLICY "ticket_comment_insert" ON "ticket_comment" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "ticket" t WHERE t."id" = "ticket_comment"."ticket_id")
);

-- Internal notes (P8-5): elevated OGS staff ONLY. There is deliberately no
-- customer, job or tenant branch. Phase 9 adds the assigned-provider branch.
CREATE POLICY "ticket_internal_note_platform" ON "ticket_internal_note" FOR ALL
  USING (app.is_platform()) WITH CHECK (app.is_platform());

-- Attachments: public ones (not on a note) with the ticket; note files staff only.
CREATE POLICY "ticket_attachment_select" ON "ticket_attachment" FOR SELECT USING (
  app.is_platform()
  OR ("note_id" IS NULL AND EXISTS (SELECT 1 FROM "ticket" t WHERE t."id" = "ticket_attachment"."ticket_id"))
);
CREATE POLICY "ticket_attachment_insert" ON "ticket_attachment" FOR INSERT WITH CHECK (
  app.is_platform()
  OR ("note_id" IS NULL AND EXISTS (SELECT 1 FROM "ticket" t WHERE t."id" = "ticket_attachment"."ticket_id"))
);

-- Activity: customers see PUBLIC rows of their tickets only.
CREATE POLICY "ticket_event_select" ON "ticket_event" FOR SELECT USING (
  app.is_platform() OR app.is_job('tickets.%')
  OR ("visibility" = 'PUBLIC' AND EXISTS (SELECT 1 FROM "ticket" t WHERE t."id" = "ticket_event"."ticket_id"))
);
CREATE POLICY "ticket_event_insert" ON "ticket_event" FOR INSERT WITH CHECK (
  app.is_platform() OR app.is_job('tickets.%')
  OR ("visibility" = 'PUBLIC' AND EXISTS (SELECT 1 FROM "ticket" t WHERE t."id" = "ticket_event"."ticket_id"))
);

-- Requests on behalf (P8-7): elevated staff insert for a customer as themselves.
CREATE POLICY "service_request_insert_on_behalf" ON "service_request" FOR INSERT WITH CHECK (
  app.is_platform() AND "on_behalf" AND "entered_by" = app.current_user_id() AND "status" = 'SUBMITTED'
);

-- The tickets.notify job may read the email of requesters and staff assignees.
CREATE POLICY "app_user_select_tickets_notify" ON "app_user" FOR SELECT USING (
  app.is_job('tickets.notify')
  AND EXISTS (
    SELECT 1 FROM "ticket" t
     WHERE t."requester_user_id" = "app_user"."id" OR t."assignee_user_id" = "app_user"."id"
  )
);
