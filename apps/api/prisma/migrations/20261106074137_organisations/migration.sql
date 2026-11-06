-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "department_id" UUID;

-- CreateTable
CREATE TABLE "organisation_profile" (
    "tenant_id" UUID NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "trading_name" VARCHAR(200),
    "registration_number" VARCHAR(50),
    "registration_number_absent_why" VARCHAR(300),
    "kra_pin" VARCHAR(20),
    "kra_pin_absent_why" VARCHAR(300),
    "country" CHAR(2) NOT NULL DEFAULT 'KE',
    "region" VARCHAR(100),
    "address" VARCHAR(300),
    "phone" VARCHAR(20),
    "contact_email" CITEXT,
    "industry" VARCHAR(100),
    "employee_band" VARCHAR(20),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_profile_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "organisation_application" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "applicant_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_reason" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_application_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "application_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" VARCHAR(1000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_application_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role_ids" UUID[],
    "department_id" UUID,
    "token_hash" CHAR(64),
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "invited_by" UUID NOT NULL,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisation_application_tenant_id_key" ON "organisation_application"("tenant_id");

-- CreateIndex
CREATE INDEX "organisation_application_status_submitted_at_idx" ON "organisation_application"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "organisation_application_event_application_id_occurred_at_idx" ON "organisation_application_event"("application_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_tenant_id_status_idx" ON "invitation"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "invitation_tenant_id_email_idx" ON "invitation"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "department_tenant_id_name_key" ON "department"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_profile" ADD CONSTRAINT "organisation_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_application" ADD CONSTRAINT "organisation_application_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_application_event" ADD CONSTRAINT "organisation_application_event_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "organisation_application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written: constraints, protection triggers, grants, RLS (Phase 4)
-- ===========================================================================

ALTER TABLE "organisation_profile" ADD CONSTRAINT "organisation_profile_country_chk" CHECK ("country" ~ '^[A-Z]{2}$');
ALTER TABLE "organisation_profile" ADD CONSTRAINT "organisation_profile_phone_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "organisation_profile" ADD CONSTRAINT "organisation_profile_kra_pin_chk" CHECK ("kra_pin" IS NULL OR "kra_pin" ~ '^[A-Z][0-9]{9}[A-Z]$');
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_roles_chk" CHECK (cardinality("role_ids") BETWEEN 1 AND 10);
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_hash_chk" CHECK ("token_hash" IS NULL OR "token_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_chk"
  CHECK (("status" = 'ACCEPTED') = ("accepted_at" IS NOT NULL));
ALTER TABLE "department" ADD CONSTRAINT "department_name_chk" CHECK (length(btrim("name")) > 0);
-- Only one live invitation per email and tenant (re-inviting revokes the old one first).
CREATE UNIQUE INDEX "invitation_one_pending_key" ON "invitation"("tenant_id", "email") WHERE "status" = 'PENDING';

-- Tenants: kind never changes; status only through platform staff or server
-- jobs. (tenant_update lets a member's workspace update its own tenant row, e.g.
-- its name; this stops that from ever touching approval state.)
CREATE OR REPLACE FUNCTION app.protect_tenant_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind" THEN
    RAISE EXCEPTION 'tenant kind is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (app.is_platform() OR app.current_actor_kind() = 'SYSTEM') THEN
    RAISE EXCEPTION 'tenant status changes only through platform review'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_tenant_columns() FROM PUBLIC;
CREATE TRIGGER "tenant_protect_columns" BEFORE UPDATE ON "tenant"
  FOR EACH ROW EXECUTE FUNCTION app.protect_tenant_columns();

-- Applications: the organisation may only (re)submit; decisions are platform-only.
CREATE OR REPLACE FUNCTION app.protect_application_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT app.is_platform()
     AND app.current_actor_kind() IS DISTINCT FROM 'SYSTEM' THEN
    IF NOT (NEW."status" = 'SUBMITTED' AND OLD."status" IN ('DRAFT', 'CHANGES_REQUESTED')) THEN
      RAISE EXCEPTION 'application status % -> % is a platform decision', OLD."status", NEW."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF (NEW."decided_by" IS DISTINCT FROM OLD."decided_by" OR NEW."decision_reason" IS DISTINCT FROM OLD."decision_reason")
     AND NOT app.is_platform() THEN
    RAISE EXCEPTION 'only platform staff record decisions' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_application_status() FROM PUBLIC;
CREATE TRIGGER "organisation_application_protect_status" BEFORE UPDATE ON "organisation_application"
  FOR EACH ROW EXECUTE FUNCTION app.protect_application_status();

CREATE TRIGGER "organisation_application_event_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "organisation_application_event"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "organisation_application_event_reject_truncate"
  BEFORE TRUNCATE ON "organisation_application_event"
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- Last-admin protection (P4-4). An organisation or provider company must always
-- keep at least one ACTIVE member holding its admin role. Checked at COMMIT
-- (deferred), so replacing a member's roles in one transaction is fine, and
-- serialised per tenant with an advisory lock, so two concurrent demotions
-- cannot both pass. Runs with the caller's RLS (it only needs the tenant's rows).
CREATE OR REPLACE FUNCTION app.assert_tenant_keeps_admin(target_tenant uuid) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  tenant_kind "TenantKind";
  admin_code text;
  remaining integer;
BEGIN
  SELECT t."kind" INTO tenant_kind FROM "tenant" t WHERE t."id" = target_tenant;
  admin_code := CASE tenant_kind WHEN 'ORGANISATION' THEN 'org_admin'
                                 WHEN 'PROVIDER_COMPANY' THEN 'provider_admin' END;
  IF admin_code IS NULL THEN
    RETURN; -- PLATFORM (managed by OGS) or tenant not visible
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ogs:last-admin:' || target_tenant::text, 0));
  SELECT count(*) INTO remaining
    FROM "membership" m
    JOIN "membership_role" mr ON mr."membership_id" = m."id"
    JOIN "role" r ON r."id" = mr."role_id"
   WHERE m."tenant_id" = target_tenant AND m."status" = 'ACTIVE'
     AND r."code" = admin_code AND r."tenant_id" IS NULL;
  IF remaining = 0 THEN
    RAISE EXCEPTION 'tenant % would have no active %', target_tenant, admin_code
      USING ERRCODE = 'check_violation', HINT = 'last_admin';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.assert_tenant_keeps_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assert_tenant_keeps_admin(uuid) TO ogs_app, ogs_maint;

CREATE OR REPLACE FUNCTION app.check_last_admin_role() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM app.assert_tenant_keeps_admin(OLD."tenant_id");
  RETURN NULL;
END
$$;
CREATE OR REPLACE FUNCTION app.check_last_admin_membership() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD."status" = 'ACTIVE' AND NEW."status" <> 'ACTIVE' THEN
    PERFORM app.assert_tenant_keeps_admin(OLD."tenant_id");
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.check_last_admin_role(), app.check_last_admin_membership() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "membership_role_keep_admin"
  AFTER DELETE ON "membership_role" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_last_admin_role();
CREATE CONSTRAINT TRIGGER "membership_keep_admin"
  AFTER UPDATE OF "status" ON "membership" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_last_admin_membership();

-- Grants ----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "organisation_profile", "organisation_application", "invitation", "department" TO ogs_app;
GRANT SELECT, INSERT ON "organisation_application_event" TO ogs_app;

-- Row-level security ----------------------------------------------------------
ALTER TABLE "organisation_profile"           ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "organisation_application"       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "organisation_application_event" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "invitation"                     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "department"                     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Registration: a new organisation is created by the server job
-- `organisations.register` before any tenant context exists. That job may create
-- the tenant and its first rows and read them back; nothing else.
CREATE POLICY "tenant_insert_register" ON "tenant" FOR INSERT
  WITH CHECK (app.is_job('organisations.register') AND "kind" = 'ORGANISATION' AND "status" = 'PENDING_APPROVAL');
CREATE POLICY "tenant_select_register" ON "tenant" FOR SELECT USING (app.is_job('organisations.register'));
CREATE POLICY "membership_insert_register" ON "membership" FOR INSERT WITH CHECK (app.is_job('organisations.register'));
CREATE POLICY "membership_select_register" ON "membership" FOR SELECT USING (app.is_job('organisations.register'));
CREATE POLICY "membership_role_insert_register" ON "membership_role" FOR INSERT WITH CHECK (app.is_job('organisations.register'));

-- Shared shape: the owning tenant, platform staff, or the register job.
CREATE POLICY "organisation_profile_select" ON "organisation_profile" FOR SELECT
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform() OR app.is_job('organisations.%'));
CREATE POLICY "organisation_profile_insert" ON "organisation_profile" FOR INSERT
  WITH CHECK (app.is_job('organisations.register'));
CREATE POLICY "organisation_profile_update" ON "organisation_profile" FOR UPDATE
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform())
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform());

CREATE POLICY "organisation_application_select" ON "organisation_application" FOR SELECT
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform() OR app.is_job('organisations.%'));
CREATE POLICY "organisation_application_insert" ON "organisation_application" FOR INSERT
  WITH CHECK (app.is_job('organisations.register'));
CREATE POLICY "organisation_application_update" ON "organisation_application" FOR UPDATE
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform())
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform());

CREATE POLICY "organisation_application_event_select" ON "organisation_application_event" FOR SELECT
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform());
CREATE POLICY "organisation_application_event_insert" ON "organisation_application_event" FOR INSERT
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform() OR app.is_job('organisations.register'));

-- Invitations: the tenant manages them; the worker (`invitations.email`) mints
-- the emailed token; acceptance (`invitations.accept`) finds one by token hash.
CREATE POLICY "invitation_select" ON "invitation" FOR SELECT
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform() OR app.is_job('invitations.%'));
CREATE POLICY "invitation_insert" ON "invitation" FOR INSERT
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform());
CREATE POLICY "invitation_update" ON "invitation" FOR UPDATE
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform() OR app.is_job('invitations.%'))
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform() OR app.is_job('invitations.%'));

CREATE POLICY "department_select" ON "department" FOR SELECT
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform());
CREATE POLICY "department_insert" ON "department" FOR INSERT
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform());
CREATE POLICY "department_update" ON "department" FOR UPDATE
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform())
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform());
