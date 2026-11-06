-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ExperienceBand" AS ENUM ('UNDER_1_YEAR', 'YEARS_1_3', 'YEARS_3_5', 'OVER_5_YEARS');

-- CreateTable
CREATE TABLE "skill" (
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "region" (
    "code" VARCHAR(10) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "region_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "provider" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "ProviderKind" NOT NULL,
    "tenant_id" UUID,
    "owner_user_id" UUID,
    "display_name" VARCHAR(200) NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "phone" VARCHAR(20),
    "home_region" VARCHAR(10),
    "remote_ok" BOOLEAN NOT NULL DEFAULT false,
    "accepting_work" BOOLEAN NOT NULL DEFAULT true,
    "retain_until" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_skill" (
    "provider_id" UUID NOT NULL,
    "skill_code" VARCHAR(60) NOT NULL,
    "experience" "ExperienceBand" NOT NULL DEFAULT 'YEARS_1_3',

    CONSTRAINT "provider_skill_pkey" PRIMARY KEY ("provider_id","skill_code")
);

-- CreateTable
CREATE TABLE "provider_region" (
    "provider_id" UUID NOT NULL,
    "region_code" VARCHAR(10) NOT NULL,

    CONSTRAINT "provider_region_pkey" PRIMARY KEY ("provider_id","region_code")
);

-- CreateTable
CREATE TABLE "provider_working_hours" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,

    CONSTRAINT "provider_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_time_off" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_application" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider_id" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "applicant_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_reason" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_application_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "application_id" UUID NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" VARCHAR(1000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_application_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_verification" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "application_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "identity_checked" BOOLEAN NOT NULL,
    "registration_checked" BOOLEAN NOT NULL,
    "tax_checked" BOOLEAN NOT NULL,
    "skills_checked" BOOLEAN NOT NULL,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "region_country_idx" ON "region"("country");

-- CreateIndex
CREATE UNIQUE INDEX "provider_tenant_id_key" ON "provider"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_owner_user_id_key" ON "provider"("owner_user_id");

-- CreateIndex
CREATE INDEX "provider_skill_skill_code_idx" ON "provider_skill"("skill_code");

-- CreateIndex
CREATE INDEX "provider_region_region_code_idx" ON "provider_region"("region_code");

-- CreateIndex
CREATE INDEX "provider_working_hours_provider_id_weekday_idx" ON "provider_working_hours"("provider_id", "weekday");

-- CreateIndex
CREATE INDEX "provider_time_off_provider_id_starts_at_idx" ON "provider_time_off"("provider_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_application_provider_id_key" ON "provider_application"("provider_id");

-- CreateIndex
CREATE INDEX "provider_application_status_submitted_at_idx" ON "provider_application"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "provider_application_event_application_id_occurred_at_idx" ON "provider_application_event"("application_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "provider_skill" ADD CONSTRAINT "provider_skill_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_skill" ADD CONSTRAINT "provider_skill_skill_code_fkey" FOREIGN KEY ("skill_code") REFERENCES "skill"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_region" ADD CONSTRAINT "provider_region_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_region" ADD CONSTRAINT "provider_region_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_working_hours" ADD CONSTRAINT "provider_working_hours_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_time_off" ADD CONSTRAINT "provider_time_off_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_application" ADD CONSTRAINT "provider_application_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_application_event" ADD CONSTRAINT "provider_application_event_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "provider_application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification" ADD CONSTRAINT "provider_verification_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "provider_application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written: reference data, constraints, triggers, grants, RLS (Phase 5)
-- ===========================================================================

-- Reference data (inserted before RLS is enabled on these tables) -------------

-- Kenya: 47 counties, ISO 3166-2:KE codes (P5-6).
INSERT INTO "region" ("code", "country", "name") VALUES
  ('KE-01', 'KE', 'Baringo'), ('KE-02', 'KE', 'Bomet'), ('KE-03', 'KE', 'Bungoma'),
  ('KE-04', 'KE', 'Busia'), ('KE-05', 'KE', 'Elgeyo-Marakwet'), ('KE-06', 'KE', 'Embu'),
  ('KE-07', 'KE', 'Garissa'), ('KE-08', 'KE', 'Homa Bay'), ('KE-09', 'KE', 'Isiolo'),
  ('KE-10', 'KE', 'Kajiado'), ('KE-11', 'KE', 'Kakamega'), ('KE-12', 'KE', 'Kericho'),
  ('KE-13', 'KE', 'Kiambu'), ('KE-14', 'KE', 'Kilifi'), ('KE-15', 'KE', 'Kirinyaga'),
  ('KE-16', 'KE', 'Kisii'), ('KE-17', 'KE', 'Kisumu'), ('KE-18', 'KE', 'Kitui'),
  ('KE-19', 'KE', 'Kwale'), ('KE-20', 'KE', 'Laikipia'), ('KE-21', 'KE', 'Lamu'),
  ('KE-22', 'KE', 'Machakos'), ('KE-23', 'KE', 'Makueni'), ('KE-24', 'KE', 'Mandera'),
  ('KE-25', 'KE', 'Marsabit'), ('KE-26', 'KE', 'Meru'), ('KE-27', 'KE', 'Migori'),
  ('KE-28', 'KE', 'Mombasa'), ('KE-29', 'KE', 'Murang''a'), ('KE-30', 'KE', 'Nairobi City'),
  ('KE-31', 'KE', 'Nakuru'), ('KE-32', 'KE', 'Nandi'), ('KE-33', 'KE', 'Narok'),
  ('KE-34', 'KE', 'Nyamira'), ('KE-35', 'KE', 'Nyandarua'), ('KE-36', 'KE', 'Nyeri'),
  ('KE-37', 'KE', 'Samburu'), ('KE-38', 'KE', 'Siaya'), ('KE-39', 'KE', 'Taita-Taveta'),
  ('KE-40', 'KE', 'Tana River'), ('KE-41', 'KE', 'Tharaka-Nithi'), ('KE-42', 'KE', 'Trans Nzoia'),
  ('KE-43', 'KE', 'Turkana'), ('KE-44', 'KE', 'Uasin Gishu'), ('KE-45', 'KE', 'Vihiga'),
  ('KE-46', 'KE', 'Wajir'), ('KE-47', 'KE', 'West Pokot');

-- Initial ICT skill taxonomy (P5-3). Staff extend it with platform.catalogue.manage.
INSERT INTO "skill" ("code", "name", "category") VALUES
  ('networking', 'Network installation and troubleshooting', 'Networks'),
  ('structured_cabling', 'Structured cabling', 'Networks'),
  ('wifi', 'Wi-Fi design and installation', 'Networks'),
  ('cctv', 'CCTV installation and maintenance', 'Security systems'),
  ('access_control', 'Access control systems', 'Security systems'),
  ('desktop_support', 'Desktop and laptop support', 'End-user computing'),
  ('hardware_repair', 'Computer hardware repair', 'End-user computing'),
  ('printer_repair', 'Printer and copier repair', 'End-user computing'),
  ('microsoft_365', 'Microsoft 365 administration', 'Cloud and productivity'),
  ('google_workspace', 'Google Workspace administration', 'Cloud and productivity'),
  ('cloud_infrastructure', 'Cloud infrastructure (AWS, Azure, GCP)', 'Cloud and productivity'),
  ('windows_server', 'Windows Server administration', 'Servers'),
  ('linux_administration', 'Linux administration', 'Servers'),
  ('cybersecurity', 'Cybersecurity assessment and hardening', 'Security'),
  ('telephony_voip', 'Telephony and VoIP', 'Communications'),
  ('pos_systems', 'Point-of-sale systems', 'Business systems'),
  ('software_installation', 'Software installation and configuration', 'End-user computing'),
  ('data_recovery', 'Data backup and recovery', 'Data');

-- Constraints ------------------------------------------------------------------

ALTER TABLE "provider" ADD CONSTRAINT "provider_owner_matches_kind_chk" CHECK (
  ("kind" = 'COMPANY' AND "tenant_id" IS NOT NULL AND "owner_user_id" IS NULL)
  OR ("kind" = 'INDIVIDUAL' AND "owner_user_id" IS NOT NULL AND "tenant_id" IS NULL)
);
ALTER TABLE "provider" ADD CONSTRAINT "provider_phone_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "provider" ADD CONSTRAINT "provider_display_name_chk" CHECK (length(btrim("display_name")) >= 2);
ALTER TABLE "provider_working_hours" ADD CONSTRAINT "provider_working_hours_range_chk"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440);
ALTER TABLE "provider_time_off" ADD CONSTRAINT "provider_time_off_range_chk" CHECK ("ends_at" > "starts_at");
ALTER TABLE "skill" ADD CONSTRAINT "skill_code_chk" CHECK ("code" ~ '^[a-z][a-z0-9_]*$');
ALTER TABLE "region" ADD CONSTRAINT "region_code_chk" CHECK ("code" ~ '^[A-Z]{2}-[0-9A-Z]{1,3}$');

-- Triggers ---------------------------------------------------------------------

-- A provider's identity never changes; its status only through platform review
-- or server jobs (the provider itself may toggle accepting_work, not approval).
CREATE OR REPLACE FUNCTION app.protect_provider_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id" THEN
    RAISE EXCEPTION 'provider identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."retain_until" IS DISTINCT FROM OLD."retain_until")
     AND NOT (app.is_platform() OR app.current_actor_kind() = 'SYSTEM') THEN
    RAISE EXCEPTION 'provider status changes only through platform review'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_provider_columns() FROM PUBLIC;
CREATE TRIGGER "provider_protect_columns" BEFORE UPDATE ON "provider"
  FOR EACH ROW EXECUTE FUNCTION app.protect_provider_columns();

-- Same rules as organisation applications (columns have the same names).
CREATE TRIGGER "provider_application_protect_status" BEFORE UPDATE ON "provider_application"
  FOR EACH ROW EXECUTE FUNCTION app.protect_application_status();
CREATE TRIGGER "provider_application_event_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "provider_application_event"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "provider_application_event_reject_truncate"
  BEFORE TRUNCATE ON "provider_application_event"
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "provider_verification_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "provider_verification"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Grants -------------------------------------------------------------------------
-- Skills, regions, hours and time off are replaced as sets: DELETE is granted on
-- those link tables only. Providers and applications are never deleted.
GRANT SELECT, INSERT, UPDATE ON "provider", "provider_application", "skill" TO ogs_app;
GRANT SELECT, INSERT, DELETE ON "provider_skill", "provider_region", "provider_working_hours", "provider_time_off" TO ogs_app;
GRANT SELECT, INSERT ON "provider_application_event", "provider_verification" TO ogs_app;
GRANT SELECT ON "region" TO ogs_app;

-- Row-level security ---------------------------------------------------------------
ALTER TABLE "skill"                      ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "region"                     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider"                   ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider_skill"             ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider_region"            ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider_working_hours"     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider_time_off"          ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider_application"       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider_application_event" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "provider_verification"      ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Taxonomies: readable by any context; skills are written by the catalogue job or staff.
CREATE POLICY "skill_select" ON "skill" FOR SELECT USING (app.current_actor_kind() IS NOT NULL);
CREATE POLICY "skill_write" ON "skill" FOR INSERT WITH CHECK (app.is_job('catalogue.%') OR app.is_platform());
CREATE POLICY "skill_update" ON "skill" FOR UPDATE
  USING (app.is_job('catalogue.%') OR app.is_platform()) WITH CHECK (app.is_job('catalogue.%') OR app.is_platform());
CREATE POLICY "region_select" ON "region" FOR SELECT USING (app.current_actor_kind() IS NOT NULL);

-- provider: the individual themself, the provider company's tenant, staff, provider jobs.
CREATE POLICY "provider_select" ON "provider" FOR SELECT USING (
  "owner_user_id" = app.current_user_id()
  OR "tenant_id" = app.current_tenant_id()
  OR app.is_platform()
  OR app.is_job('providers.%')
);
CREATE POLICY "provider_insert" ON "provider" FOR INSERT WITH CHECK (
  ("kind" = 'INDIVIDUAL' AND "owner_user_id" = app.current_user_id() AND "status" = 'PENDING_APPROVAL'
     AND app.current_actor_kind() = 'USER')
  OR (app.is_job('providers.register') AND "kind" = 'COMPANY' AND "status" = 'PENDING_APPROVAL')
  OR app.is_platform()
);
CREATE POLICY "provider_update" ON "provider" FOR UPDATE
  USING ("owner_user_id" = app.current_user_id() OR "tenant_id" = app.current_tenant_id() OR app.is_platform())
  WITH CHECK ("owner_user_id" = app.current_user_id() OR "tenant_id" = app.current_tenant_id() OR app.is_platform());

-- Children follow the visibility of their provider (provider policies never read them).
CREATE POLICY "provider_skill_all" ON "provider_skill" FOR ALL
  USING (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_skill"."provider_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_skill"."provider_id"));
CREATE POLICY "provider_region_all" ON "provider_region" FOR ALL
  USING (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_region"."provider_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_region"."provider_id"));
CREATE POLICY "provider_working_hours_all" ON "provider_working_hours" FOR ALL
  USING (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_working_hours"."provider_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_working_hours"."provider_id"));
CREATE POLICY "provider_time_off_all" ON "provider_time_off" FOR ALL
  USING (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_time_off"."provider_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_time_off"."provider_id"));
CREATE POLICY "provider_application_select" ON "provider_application" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_application"."provider_id"));
CREATE POLICY "provider_application_insert" ON "provider_application" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_application"."provider_id"));
CREATE POLICY "provider_application_update" ON "provider_application" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_application"."provider_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "provider" p WHERE p."id" = "provider_application"."provider_id"));
CREATE POLICY "provider_application_event_select" ON "provider_application_event" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "provider_application" a WHERE a."id" = "provider_application_event"."application_id")
);
CREATE POLICY "provider_application_event_insert" ON "provider_application_event" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "provider_application" a WHERE a."id" = "provider_application_event"."application_id")
);
-- The verification checklist is staff-only, in both directions.
CREATE POLICY "provider_verification_platform" ON "provider_verification" FOR ALL
  USING (app.is_platform()) WITH CHECK (app.is_platform());

-- Provider-company registration (job `providers.register`), mirroring Phase 4's organisation job.
CREATE POLICY "tenant_insert_provider_register" ON "tenant" FOR INSERT
  WITH CHECK (app.is_job('providers.register') AND "kind" = 'PROVIDER_COMPANY' AND "status" = 'PENDING_APPROVAL');
CREATE POLICY "tenant_select_provider_register" ON "tenant" FOR SELECT USING (app.is_job('providers.register'));
CREATE POLICY "membership_insert_provider_register" ON "membership" FOR INSERT WITH CHECK (app.is_job('providers.register'));
CREATE POLICY "membership_select_provider_register" ON "membership" FOR SELECT USING (app.is_job('providers.register'));
CREATE POLICY "membership_role_insert_provider_register" ON "membership_role" FOR INSERT WITH CHECK (app.is_job('providers.register'));
CREATE POLICY "organisation_profile_insert_provider_register" ON "organisation_profile" FOR INSERT
  WITH CHECK (app.is_job('providers.register'));
CREATE POLICY "audit_log_insert_provider_register" ON "audit_log" FOR INSERT WITH CHECK (
  app.is_job('providers.register') AND "actor_kind" = 'SYSTEM' AND "actor_user_id" IS NULL
);
