-- CreateEnum
CREATE TYPE "UserTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "AuthEventKind" AS ENUM ('REGISTERED', 'REGISTER_EXISTING_EMAIL', 'EMAIL_VERIFIED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT', 'ACCOUNT_LOCKED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGED', 'SESSION_REVOKED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT');

-- CreateTable
CREATE TABLE "credential" (
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_token" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "purpose" "UserTokenPurpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authentication_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "AuthEventKind" NOT NULL,
    "user_id" UUID,
    "email_hash" CHAR(64),
    "reason" VARCHAR(100),
    "ip" INET,
    "user_agent" VARCHAR(500),
    "request_id" VARCHAR(100),

    CONSTRAINT "authentication_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "event_id" UUID NOT NULL,
    "kind" VARCHAR(100) NOT NULL,
    "user_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "permission" (
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "allowed_kinds" "TenantKind"[],

    CONSTRAINT "permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID,
    "scope" "TenantKind" NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(300),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_code" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "membership_role" (
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_role_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_token_token_hash_key" ON "user_token"("token_hash");

-- CreateIndex
CREATE INDEX "user_token_user_id_purpose_idx" ON "user_token"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "authentication_event_user_id_occurred_at_idx" ON "authentication_event"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "authentication_event_email_hash_occurred_at_idx" ON "authentication_event"("email_hash", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "role_tenant_id_idx" ON "role"("tenant_id");

-- CreateIndex
CREATE INDEX "membership_role_tenant_id_idx" ON "membership_role"("tenant_id");

-- CreateIndex
CREATE INDEX "membership_role_role_id_idx" ON "membership_role"("role_id");

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_token" ADD CONSTRAINT "user_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written: context helper, constraints, triggers, grants, RLS (Phase 3A)
-- ===========================================================================

-- app.job names the background job of a `system` context (TenantDb sets it only
-- for system contexts). Identity tables are reachable only from identity.* jobs.
CREATE OR REPLACE FUNCTION app.current_job() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.job', true), '') $$;

CREATE OR REPLACE FUNCTION app.is_job(pattern text) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(app.current_actor_kind() = 'SYSTEM' AND app.current_job() LIKE pattern, false) $$;

REVOKE ALL ON FUNCTION app.current_job(), app.is_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_job(), app.is_job(text) TO ogs_app, ogs_readonly, ogs_maint;

-- Constraints ---------------------------------------------------------------

-- System roles have no tenant; custom roles always belong to one.
CREATE UNIQUE INDEX "role_tenant_code_key" ON "role"("tenant_id", "code") NULLS NOT DISTINCT;
ALTER TABLE "role" ADD CONSTRAINT "role_system_has_no_tenant_chk" CHECK ("is_system" = ("tenant_id" IS NULL));
ALTER TABLE "role" ADD CONSTRAINT "role_code_format_chk" CHECK ("code" ~ '^[a-z][a-z0-9_]*$');
ALTER TABLE "role" ADD CONSTRAINT "role_version_chk" CHECK ("version" >= 0);
ALTER TABLE "permission" ADD CONSTRAINT "permission_code_format_chk"
  CHECK ("code" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE "permission" ADD CONSTRAINT "permission_kinds_chk"
  CHECK ("allowed_kinds" IS NOT NULL AND cardinality("allowed_kinds") > 0);
ALTER TABLE "credential" ADD CONSTRAINT "credential_failed_attempts_chk" CHECK ("failed_attempts" >= 0);
ALTER TABLE "credential" ADD CONSTRAINT "credential_hash_format_chk" CHECK ("password_hash" LIKE '$argon2id$%');
ALTER TABLE "user_token" ADD CONSTRAINT "user_token_expiry_chk" CHECK ("expires_at" > "created_at");
ALTER TABLE "user_token" ADD CONSTRAINT "user_token_hash_format_chk" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "authentication_event" ADD CONSTRAINT "authentication_event_email_hash_chk"
  CHECK ("email_hash" IS NULL OR "email_hash" ~ '^[0-9a-f]{64}$');

-- Triggers ------------------------------------------------------------------

-- Generic append-only guard (used by authentication_event).
CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
REVOKE ALL ON FUNCTION app.reject_mutation() FROM PUBLIC;

CREATE TRIGGER "authentication_event_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "authentication_event"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "authentication_event_reject_truncate"
  BEFORE TRUNCATE ON "authentication_event"
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- A role may only hold permissions allowed for its tenant kind (review §11:
-- "org roles cannot contain platform permissions"). Runs with the caller's RLS:
-- if the role or permission is not visible, the insert fails (fail closed).
CREATE OR REPLACE FUNCTION app.check_role_permission() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  role_scope "TenantKind";
  kinds "TenantKind"[];
BEGIN
  SELECT r."scope" INTO role_scope FROM "role" r WHERE r."id" = NEW."role_id";
  SELECT p."allowed_kinds" INTO kinds FROM "permission" p WHERE p."code" = NEW."permission_code";
  IF role_scope IS NULL OR kinds IS NULL THEN
    RAISE EXCEPTION 'role or permission not found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT role_scope = ANY (kinds) THEN
    RAISE EXCEPTION 'permission % is not allowed for % roles', NEW."permission_code", role_scope
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.check_role_permission() FROM PUBLIC;
CREATE TRIGGER "role_permission_check"
  BEFORE INSERT OR UPDATE ON "role_permission"
  FOR EACH ROW EXECUTE FUNCTION app.check_role_permission();

-- A membership role must match the membership's tenant and that tenant's kind,
-- and a custom role can only be granted inside its own tenant.
CREATE OR REPLACE FUNCTION app.check_membership_role() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  membership_tenant uuid;
  tenant_kind "TenantKind";
  role_scope "TenantKind";
  role_tenant uuid;
BEGIN
  SELECT m."tenant_id" INTO membership_tenant FROM "membership" m WHERE m."id" = NEW."membership_id";
  SELECT t."kind" INTO tenant_kind FROM "tenant" t WHERE t."id" = NEW."tenant_id";
  SELECT r."scope", r."tenant_id" INTO role_scope, role_tenant FROM "role" r WHERE r."id" = NEW."role_id";
  IF membership_tenant IS NULL OR tenant_kind IS NULL OR role_scope IS NULL THEN
    RAISE EXCEPTION 'membership, tenant or role not found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF membership_tenant <> NEW."tenant_id" THEN
    RAISE EXCEPTION 'membership_role.tenant_id must equal the membership tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF role_scope <> tenant_kind THEN
    RAISE EXCEPTION '% role cannot be granted in a % tenant', role_scope, tenant_kind USING ERRCODE = 'check_violation';
  END IF;
  IF role_tenant IS NOT NULL AND role_tenant <> NEW."tenant_id" THEN
    RAISE EXCEPTION 'custom role belongs to another tenant' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.check_membership_role() FROM PUBLIC;
CREATE TRIGGER "membership_role_check"
  BEFORE INSERT OR UPDATE ON "membership_role"
  FOR EACH ROW EXECUTE FUNCTION app.check_membership_role();

-- Grants --------------------------------------------------------------------
-- Link tables get DELETE: removing a role from a membership (or a permission
-- from a role) is a deliberate hard delete; history lives in the audit log.
-- ogs_readonly / ogs_maint receive these tables through the default privileges
-- set in the first migration.

GRANT SELECT, INSERT, UPDATE ON "credential", "user_token", "notification_delivery", "permission", "role" TO ogs_app;
GRANT SELECT, INSERT ON "authentication_event" TO ogs_app;
GRANT SELECT, INSERT, DELETE ON "role_permission", "membership_role" TO ogs_app;

-- Row-level security --------------------------------------------------------

ALTER TABLE "credential"            ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_token"            ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "authentication_event"  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "notification_delivery" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "permission"            ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "role"                  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "role_permission"       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "membership_role"       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Secrets: only identity jobs. Never a user or tenant context, not even the owner.
CREATE POLICY "credential_identity" ON "credential" FOR ALL
  USING (app.is_job('identity.%')) WITH CHECK (app.is_job('identity.%'));
CREATE POLICY "user_token_identity" ON "user_token" FOR ALL
  USING (app.is_job('identity.%')) WITH CHECK (app.is_job('identity.%'));

-- Users may read their own sign-in history.
CREATE POLICY "authentication_event_insert" ON "authentication_event" FOR INSERT
  WITH CHECK (app.is_job('identity.%'));
CREATE POLICY "authentication_event_select" ON "authentication_event" FOR SELECT USING (
  app.is_job('identity.%') OR "user_id" = app.current_user_id() OR app.is_platform()
);

CREATE POLICY "notification_delivery_system" ON "notification_delivery" FOR ALL
  USING (app.current_actor_kind() = 'SYSTEM') WITH CHECK (app.current_actor_kind() = 'SYSTEM');

-- app_user: identity jobs find users by email (login, reset) and create them (register).
CREATE POLICY "app_user_select_identity" ON "app_user" FOR SELECT USING (app.is_job('identity.%'));
CREATE POLICY "app_user_insert_register" ON "app_user" FOR INSERT WITH CHECK (app.is_job('identity.register'));
CREATE POLICY "app_user_update_identity" ON "app_user" FOR UPDATE
  USING (app.is_job('identity.%')) WITH CHECK (app.is_job('identity.%'));

-- permission: platform-owned catalogue, readable by any context, written only by the sync job.
CREATE POLICY "permission_select" ON "permission" FOR SELECT USING (app.current_actor_kind() IS NOT NULL);
CREATE POLICY "permission_sync_insert" ON "permission" FOR INSERT WITH CHECK (app.is_job('authz.sync'));
CREATE POLICY "permission_sync_update" ON "permission" FOR UPDATE
  USING (app.is_job('authz.sync')) WITH CHECK (app.is_job('authz.sync'));

-- role: system roles are visible to everyone with a context; custom roles only in their tenant.
CREATE POLICY "role_select" ON "role" FOR SELECT USING (
  ("tenant_id" IS NULL AND app.current_actor_kind() IS NOT NULL)
  OR "tenant_id" = app.current_tenant_id()
  OR app.is_platform()
);
CREATE POLICY "role_insert" ON "role" FOR INSERT WITH CHECK (
  ("tenant_id" = app.current_tenant_id() AND NOT "is_system")
  OR (app.is_platform() AND NOT "is_system")
  OR (app.is_job('authz.sync') AND "is_system")
);
CREATE POLICY "role_update" ON "role" FOR UPDATE
  USING (
    ("tenant_id" = app.current_tenant_id() AND NOT "is_system")
    OR (app.is_platform() AND NOT "is_system")
    OR (app.is_job('authz.sync') AND "is_system")
  )
  WITH CHECK (
    ("tenant_id" = app.current_tenant_id() AND NOT "is_system")
    OR (app.is_platform() AND NOT "is_system")
    OR (app.is_job('authz.sync') AND "is_system")
  );

-- role_permission follows the visibility and editability of its role.
-- Must never be referenced from role policies (no recursion).
CREATE POLICY "role_permission_select" ON "role_permission" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "role" r WHERE r."id" = "role_permission"."role_id"));
CREATE POLICY "role_permission_insert" ON "role_permission" FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "role" r WHERE r."id" = "role_permission"."role_id" AND (
      (r."tenant_id" = app.current_tenant_id() AND NOT r."is_system")
      OR (app.is_platform() AND NOT r."is_system")
      OR (app.is_job('authz.sync') AND r."is_system")
    )
  )
);
CREATE POLICY "role_permission_delete" ON "role_permission" FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "role" r WHERE r."id" = "role_permission"."role_id" AND (
      (r."tenant_id" = app.current_tenant_id() AND NOT r."is_system")
      OR (app.is_platform() AND NOT r."is_system")
      OR (app.is_job('authz.sync') AND r."is_system")
    )
  )
);

-- membership_role: the tenant sees and manages its grants; a user sees their own.
-- Reads membership (whose policies never read membership_role: no recursion).
CREATE POLICY "membership_role_select" ON "membership_role" FOR SELECT USING (
  "tenant_id" = app.current_tenant_id()
  OR app.is_platform()
  OR EXISTS (
    SELECT 1 FROM "membership" m
     WHERE m."id" = "membership_role"."membership_id" AND m."user_id" = app.current_user_id()
  )
);
CREATE POLICY "membership_role_insert" ON "membership_role" FOR INSERT
  WITH CHECK ("tenant_id" = app.current_tenant_id() OR app.is_platform());
CREATE POLICY "membership_role_delete" ON "membership_role" FOR DELETE
  USING ("tenant_id" = app.current_tenant_id() OR app.is_platform());
