-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'AWAITING_QUOTATION', 'QUOTATION_ISSUED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'READY_FOR_ASSIGNMENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('PREPAY', 'POSTPAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'MPESA_PAYBILL');

-- CreateTable
CREATE TABLE "service_request" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(20) NOT NULL,
    "customer_tenant_id" UUID,
    "customer_user_id" UUID,
    "created_by" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_price_id" UUID NOT NULL,
    "service_name" VARCHAR(150) NOT NULL,
    "price_model" "PriceModel" NOT NULL,
    "unit_amount_minor" BIGINT,
    "price_unit" "PriceUnit",
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "county" VARCHAR(10) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "preferred_from" DATE,
    "preferred_to" DATE,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(20) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "cancel_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "request_id" UUID NOT NULL,
    "from_status" "RequestStatus",
    "to_status" "RequestStatus" NOT NULL,
    "command" VARCHAR(40) NOT NULL,
    "actor_user_id" UUID DEFAULT app.current_user_id(),
    "reason" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(20) NOT NULL,
    "request_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "valid_days" INTEGER NOT NULL DEFAULT 14,
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "vat_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decision_reason" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "quotation_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_amount_minor" BIGINT NOT NULL,
    "net_minor" BIGINT NOT NULL,
    "vat_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,

    CONSTRAINT "quotation_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(20) NOT NULL,
    "request_id" UUID NOT NULL,
    "quotation_id" UUID,
    "customer_tenant_id" UUID,
    "customer_user_id" UUID,
    "payment_terms" "PaymentTerms" NOT NULL,
    "net_days" INTEGER,
    "subtotal_minor" BIGINT NOT NULL,
    "vat_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL,
    "refund_due" BOOLEAN NOT NULL DEFAULT false,
    "cancel_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "command" VARCHAR(40) NOT NULL,
    "actor_user_id" UUID DEFAULT app.current_user_id(),
    "reason" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(60) NOT NULL,
    "note" VARCHAR(300),
    "recorded_by" UUID DEFAULT app.current_user_id(),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_billing" (
    "tenant_id" UUID NOT NULL,
    "payment_terms" "PaymentTerms" NOT NULL DEFAULT 'PREPAY',
    "net_days" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_billing_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(60) NOT NULL,
    "route" VARCHAR(120) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_counter" (
    "kind" VARCHAR(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_counter_pkey" PRIMARY KEY ("kind","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_request_number_key" ON "service_request"("number");

-- CreateIndex
CREATE INDEX "service_request_customer_tenant_id_created_at_idx" ON "service_request"("customer_tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "service_request_customer_user_id_created_at_idx" ON "service_request"("customer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "service_request_status_created_at_idx" ON "service_request"("status", "created_at");

-- CreateIndex
CREATE INDEX "service_request_event_request_id_occurred_at_idx" ON "service_request_event"("request_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_number_key" ON "quotation"("number");

-- CreateIndex
CREATE INDEX "quotation_status_expires_at_idx" ON "quotation"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_request_id_revision_key" ON "quotation"("request_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_line_quotation_id_position_key" ON "quotation_line"("quotation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_number_key" ON "service_order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_request_id_key" ON "service_order"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_quotation_id_key" ON "service_order"("quotation_id");

-- CreateIndex
CREATE INDEX "service_order_customer_tenant_id_created_at_idx" ON "service_order"("customer_tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "service_order_customer_user_id_created_at_idx" ON "service_order"("customer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "service_order_status_created_at_idx" ON "service_order"("status", "created_at");

-- CreateIndex
CREATE INDEX "service_order_event_order_id_occurred_at_idx" ON "service_order_event"("order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_order_id_idx" ON "payment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_reference_key" ON "payment"("method", "reference");

-- CreateIndex
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_user_id_scope_route_key_key" ON "idempotency_key"("user_id", "scope", "route", "key");

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_service_price_id_fkey" FOREIGN KEY ("service_price_id") REFERENCES "service_price"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_event" ADD CONSTRAINT "service_request_event_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_event" ADD CONSTRAINT "service_order_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "service_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "service_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_billing" ADD CONSTRAINT "organisation_billing_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 7 (hand-written): constraints, guards, grants and row-level security for
-- service requests, quotations, orders and manual payments.
-- ============================================================================

-- Constraints -------------------------------------------------------------------

ALTER TABLE "service_request"
  ADD CONSTRAINT "service_request_one_customer_chk" CHECK (("customer_tenant_id" IS NULL) <> ("customer_user_id" IS NULL)),
  ADD CONSTRAINT "service_request_number_chk" CHECK ("number" ~ '^REQ-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT "service_request_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "service_request_amount_chk" CHECK ("unit_amount_minor" IS NULL OR "unit_amount_minor" >= 0),
  ADD CONSTRAINT "service_request_dates_chk" CHECK ("preferred_to" IS NULL OR "preferred_from" IS NULL OR "preferred_to" >= "preferred_from"),
  ADD CONSTRAINT "service_request_cancel_chk" CHECK (("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL));

ALTER TABLE "quotation"
  ADD CONSTRAINT "quotation_number_chk" CHECK ("number" ~ '^QUO-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT "quotation_valid_days_chk" CHECK ("valid_days" BETWEEN 1 AND 60),
  ADD CONSTRAINT "quotation_revision_chk" CHECK ("revision" >= 1),
  ADD CONSTRAINT "quotation_totals_chk" CHECK (
    "subtotal_minor" >= 0 AND "vat_minor" >= 0 AND "total_minor" = "subtotal_minor" + "vat_minor"
  ),
  ADD CONSTRAINT "quotation_issued_chk" CHECK (
    "status" = 'DRAFT' OR ("issued_at" IS NOT NULL AND "expires_at" IS NOT NULL AND "total_minor" > 0)
  );

ALTER TABLE "quotation_line"
  ADD CONSTRAINT "quotation_line_amounts_chk" CHECK (
    "quantity" BETWEEN 1 AND 100000 AND "unit_amount_minor" >= 0
    AND "net_minor" = "unit_amount_minor" * "quantity"
    AND "vat_minor" >= 0 AND "total_minor" = "net_minor" + "vat_minor"
  ),
  ADD CONSTRAINT "quotation_line_position_chk" CHECK ("position" BETWEEN 1 AND 100);

ALTER TABLE "service_order"
  ADD CONSTRAINT "service_order_one_customer_chk" CHECK (("customer_tenant_id" IS NULL) <> ("customer_user_id" IS NULL)),
  ADD CONSTRAINT "service_order_number_chk" CHECK ("number" ~ '^ORD-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT "service_order_totals_chk" CHECK (
    "subtotal_minor" >= 0 AND "vat_minor" >= 0 AND "total_minor" = "subtotal_minor" + "vat_minor"
    AND "paid_minor" >= 0 AND "paid_minor" <= "total_minor"
  ),
  ADD CONSTRAINT "service_order_terms_chk" CHECK (
    ("payment_terms" = 'PREPAY' AND "net_days" IS NULL)
    OR ("payment_terms" = 'POSTPAID' AND "net_days" BETWEEN 1 AND 120 AND "customer_tenant_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "service_order_paid_chk" CHECK (
    "status" NOT IN ('PAID', 'READY_FOR_ASSIGNMENT')
    OR "payment_terms" = 'POSTPAID' OR "paid_minor" = "total_minor"
  ),
  ADD CONSTRAINT "service_order_cancel_chk" CHECK (("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL));

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_chk" CHECK ("amount_minor" > 0 AND "amount_minor" <= 1000000000000),
  ADD CONSTRAINT "payment_reference_chk" CHECK ("reference" ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,59}$');

ALTER TABLE "organisation_billing"
  ADD CONSTRAINT "organisation_billing_terms_chk" CHECK (
    ("payment_terms" = 'PREPAY' AND "net_days" IS NULL)
    OR ("payment_terms" = 'POSTPAID' AND "net_days" BETWEEN 1 AND 120)
  );

ALTER TABLE "document_counter"
  ADD CONSTRAINT "document_counter_kind_chk" CHECK ("kind" IN ('REQ', 'QUO', 'ORD')),
  ADD CONSTRAINT "document_counter_year_chk" CHECK ("year" BETWEEN 2020 AND 2200 AND "last" >= 0);

-- Ownership helper (ADR-009) ------------------------------------------------------
-- An organisation's rows in that organisation's workspace; a person's rows only
-- in their personal (tenant-less) context, never from an organisation workspace.
CREATE OR REPLACE FUNCTION app.owns_customer_row(tenant uuid, owner uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT (tenant IS NOT NULL AND tenant = app.current_tenant_id())
        OR (owner IS NOT NULL AND owner = app.current_user_id() AND app.current_tenant_id() IS NULL)
  $$;

-- Append-only history and payments ---------------------------------------------------
CREATE TRIGGER "service_request_event_reject_update_delete" BEFORE UPDATE OR DELETE ON "service_request_event"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "service_order_event_reject_update_delete" BEFORE UPDATE OR DELETE ON "service_order_event"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "payment_reject_update_delete" BEFORE UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "payment_reject_truncate" BEFORE TRUNCATE ON "payment"
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- Service requests: snapshot columns are immutable; customers may only cancel,
-- accept or reject a quotation (Phase 7 plan §2.2); staff and jobs do the rest.
CREATE OR REPLACE FUNCTION app.protect_service_request() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ROW(NEW."number", NEW."customer_tenant_id", NEW."customer_user_id", NEW."created_by", NEW."service_id",
         NEW."service_price_id", NEW."price_model", NEW."unit_amount_minor", NEW."price_unit", NEW."quantity")
     IS DISTINCT FROM
     ROW(OLD."number", OLD."customer_tenant_id", OLD."customer_user_id", OLD."created_by", OLD."service_id",
         OLD."service_price_id", OLD."price_model", OLD."unit_amount_minor", OLD."price_unit", OLD."quantity") THEN
    RAISE EXCEPTION 'request snapshot is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT app.is_platform() THEN
    IF app.current_actor_kind() = 'SYSTEM' THEN
      IF NOT (OLD."status" = 'QUOTATION_ISSUED' AND NEW."status" = 'AWAITING_QUOTATION') THEN
        RAISE EXCEPTION 'request transition % -> % is not allowed for jobs', OLD."status", NEW."status"
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF NOT (
      (NEW."status" = 'CANCELLED' AND OLD."status" IN ('SUBMITTED', 'UNDER_REVIEW', 'AWAITING_QUOTATION', 'QUOTATION_ISSUED'))
      OR (OLD."status" = 'QUOTATION_ISSUED' AND NEW."status" IN ('ORDERED', 'AWAITING_QUOTATION'))
    ) THEN
      RAISE EXCEPTION 'request transition % -> % is a staff decision', OLD."status", NEW."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_service_request() FROM PUBLIC;
CREATE TRIGGER "service_request_protect" BEFORE UPDATE ON "service_request"
  FOR EACH ROW EXECUTE FUNCTION app.protect_service_request();

-- Quotations: frozen once issued (only the decision columns move); customers may
-- only accept or reject an issued quotation, jobs may only expire one.
CREATE OR REPLACE FUNCTION app.protect_quotation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND ROW(NEW."number", NEW."request_id", NEW."revision", NEW."valid_days", NEW."notes",
       NEW."subtotal_minor", NEW."vat_minor", NEW."total_minor", NEW."issued_at", NEW."expires_at", NEW."created_by")
     IS DISTINCT FROM ROW(OLD."number", OLD."request_id", OLD."revision", OLD."valid_days", OLD."notes",
       OLD."subtotal_minor", OLD."vat_minor", OLD."total_minor", OLD."issued_at", OLD."expires_at", OLD."created_by") THEN
    RAISE EXCEPTION 'an issued quotation is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT app.is_platform() THEN
    IF app.current_actor_kind() = 'SYSTEM' THEN
      IF NOT (OLD."status" = 'ISSUED' AND NEW."status" = 'EXPIRED') THEN
        RAISE EXCEPTION 'quotation transition % -> % is not allowed for jobs', OLD."status", NEW."status"
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF NOT (OLD."status" = 'ISSUED' AND NEW."status" IN ('ACCEPTED', 'REJECTED') AND NEW."expires_at" > now()) THEN
      RAISE EXCEPTION 'quotation transition % -> % is not allowed', OLD."status", NEW."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_quotation() FROM PUBLIC;
CREATE TRIGGER "quotation_protect" BEFORE UPDATE ON "quotation"
  FOR EACH ROW EXECUTE FUNCTION app.protect_quotation();

CREATE OR REPLACE FUNCTION app.protect_quotation_line() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent_status "QuotationStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "quotation"
   WHERE "id" = (CASE WHEN TG_OP = 'DELETE' THEN OLD."quotation_id" ELSE NEW."quotation_id" END);
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'quotation lines change only while the quotation is a draft'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
REVOKE ALL ON FUNCTION app.protect_quotation_line() FROM PUBLIC;
CREATE TRIGGER "quotation_line_protect" BEFORE INSERT OR UPDATE OR DELETE ON "quotation_line"
  FOR EACH ROW EXECUTE FUNCTION app.protect_quotation_line();

-- Orders: the commercial facts are immutable. A customer creates an order only by
-- accepting a quotation, and then the order must match that quotation and the
-- organisation's billing terms exactly. Customers may only cancel an unpaid order.
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
REVOKE ALL ON FUNCTION app.protect_service_order() FROM PUBLIC;
CREATE TRIGGER "service_order_protect" BEFORE INSERT OR UPDATE ON "service_order"
  FOR EACH ROW EXECUTE FUNCTION app.protect_service_order();

-- Grants -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "service_request", "quotation", "service_order", "organisation_billing", "document_counter" TO ogs_app;
GRANT SELECT, INSERT ON "service_request_event", "service_order_event", "payment" TO ogs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "quotation_line", "idempotency_key" TO ogs_app;

-- Row-level security -----------------------------------------------------------------
ALTER TABLE "service_request"       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_request_event" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "quotation"             ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "quotation_line"        ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_order"         ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_order_event"   ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment"               ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "organisation_billing"  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_key"       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "document_counter"      ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Requests: the owning organisation or person, staff, and orders.* jobs.
CREATE POLICY "service_request_select" ON "service_request" FOR SELECT USING (
  app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform() OR app.is_job('orders.%')
);
CREATE POLICY "service_request_insert" ON "service_request" FOR INSERT WITH CHECK (
  app.owns_customer_row("customer_tenant_id", "customer_user_id")
  AND "created_by" = app.current_user_id() AND "status" = 'SUBMITTED'
);
CREATE POLICY "service_request_update" ON "service_request" FOR UPDATE
  USING (app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform() OR app.is_job('orders.%'))
  WITH CHECK (app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform() OR app.is_job('orders.%'));

CREATE POLICY "service_request_event_select" ON "service_request_event" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "service_request" r WHERE r."id" = "service_request_event"."request_id")
);
CREATE POLICY "service_request_event_insert" ON "service_request_event" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "service_request" r WHERE r."id" = "service_request_event"."request_id")
);

-- Quotations: customers never see drafts.
CREATE POLICY "quotation_select" ON "quotation" FOR SELECT USING (
  app.is_platform() OR app.is_job('orders.%')
  OR ("status" <> 'DRAFT' AND EXISTS (SELECT 1 FROM "service_request" r WHERE r."id" = "quotation"."request_id"))
);
CREATE POLICY "quotation_insert" ON "quotation" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY "quotation_update" ON "quotation" FOR UPDATE
  USING (
    app.is_platform() OR app.is_job('orders.%')
    OR ("status" <> 'DRAFT' AND EXISTS (SELECT 1 FROM "service_request" r WHERE r."id" = "quotation"."request_id"))
  )
  WITH CHECK (
    app.is_platform() OR app.is_job('orders.%')
    OR ("status" <> 'DRAFT' AND EXISTS (SELECT 1 FROM "service_request" r WHERE r."id" = "quotation"."request_id"))
  );

CREATE POLICY "quotation_line_select" ON "quotation_line" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "quotation" q WHERE q."id" = "quotation_line"."quotation_id")
);
CREATE POLICY "quotation_line_insert" ON "quotation_line" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY "quotation_line_update" ON "quotation_line" FOR UPDATE
  USING (app.is_platform()) WITH CHECK (app.is_platform());
CREATE POLICY "quotation_line_delete" ON "quotation_line" FOR DELETE USING (app.is_platform());

-- Orders.
CREATE POLICY "service_order_select" ON "service_order" FOR SELECT USING (
  app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform() OR app.is_job('orders.%')
);
CREATE POLICY "service_order_insert" ON "service_order" FOR INSERT WITH CHECK (
  app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform()
);
CREATE POLICY "service_order_update" ON "service_order" FOR UPDATE
  USING (app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform())
  WITH CHECK (app.owns_customer_row("customer_tenant_id", "customer_user_id") OR app.is_platform());

CREATE POLICY "service_order_event_select" ON "service_order_event" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "service_order" o WHERE o."id" = "service_order_event"."order_id")
);
CREATE POLICY "service_order_event_insert" ON "service_order_event" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "service_order" o WHERE o."id" = "service_order_event"."order_id")
);

-- Payments: customers read their own; only finance (platform) records.
CREATE POLICY "payment_select" ON "payment" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "service_order" o WHERE o."id" = "payment"."order_id")
);
CREATE POLICY "payment_insert" ON "payment" FOR INSERT WITH CHECK (app.is_platform());

-- Billing terms: the organisation reads its own; finance (platform) sets them.
CREATE POLICY "organisation_billing_select" ON "organisation_billing" FOR SELECT USING (
  "tenant_id" = app.current_tenant_id() OR app.is_platform() OR app.is_job('orders.%')
);
CREATE POLICY "organisation_billing_insert" ON "organisation_billing" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY "organisation_billing_update" ON "organisation_billing" FOR UPDATE
  USING (app.is_platform()) WITH CHECK (app.is_platform());

-- Idempotency keys: strictly the caller's own.
CREATE POLICY "idempotency_key_own" ON "idempotency_key" FOR ALL
  USING ("user_id" = app.current_user_id()) WITH CHECK ("user_id" = app.current_user_id());

-- Document counters: any authenticated or system context (numbers are not secrets).
CREATE POLICY "document_counter_any_actor" ON "document_counter" FOR ALL
  USING (app.current_actor_kind() IS NOT NULL) WITH CHECK (app.current_actor_kind() IS NOT NULL);

-- The orders.notify job may read the email of people who raised requests.
CREATE POLICY "app_user_select_orders_notify" ON "app_user" FOR SELECT USING (
  app.is_job('orders.notify')
  AND EXISTS (SELECT 1 FROM "service_request" r WHERE r."created_by" = "app_user"."id")
);
