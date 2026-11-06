-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('QUARANTINED', 'CLEAN', 'REJECTED');

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "mfa_factor" (
    "user_id" UUID NOT NULL,
    "secret_sealed" VARCHAR(200) NOT NULL,
    "key_id" VARCHAR(32) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factor_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "recovery_code" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_metadata" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID,
    "owner_user_id" UUID,
    "purpose" VARCHAR(50) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(200) NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'QUARANTINED',
    "status_reason" VARCHAR(100),
    "uploaded_by" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_code_hash_key" ON "recovery_code"("code_hash");

-- CreateIndex
CREATE INDEX "recovery_code_user_id_idx" ON "recovery_code"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_metadata_storage_key_key" ON "file_metadata"("storage_key");

-- CreateIndex
CREATE INDEX "file_metadata_tenant_id_created_at_idx" ON "file_metadata"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "file_metadata_owner_user_id_created_at_idx" ON "file_metadata"("owner_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written: constraints, protection trigger, grants, RLS (Phase 3B)
-- ===========================================================================

ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_hash_format_chk" CHECK ("code_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_last_step_chk" CHECK ("last_used_step" >= 0);
ALTER TABLE "file_metadata" ADD CONSTRAINT "file_metadata_one_owner_chk"
  CHECK (("tenant_id" IS NULL) <> ("owner_user_id" IS NULL));
ALTER TABLE "file_metadata" ADD CONSTRAINT "file_metadata_size_chk" CHECK ("size_bytes" > 0);
ALTER TABLE "file_metadata" ADD CONSTRAINT "file_metadata_sha256_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "file_metadata" ADD CONSTRAINT "file_metadata_purpose_chk" CHECK ("purpose" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$');

-- Security-relevant user columns may only change through identity jobs or
-- platform staff. The app_user update policy lets a user update their own row
-- (profile fields arrive later); this stops that from touching status, email
-- or the MFA flag.
CREATE OR REPLACE FUNCTION app.protect_app_user_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."email" IS DISTINCT FROM OLD."email"
      OR NEW."mfa_enabled" IS DISTINCT FROM OLD."mfa_enabled")
     AND NOT (app.is_job('identity.%') OR app.is_platform()) THEN
    RAISE EXCEPTION 'app_user status, email and mfa_enabled change only through identity flows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_app_user_columns() FROM PUBLIC;
CREATE TRIGGER "app_user_protect_columns"
  BEFORE UPDATE ON "app_user"
  FOR EACH ROW EXECUTE FUNCTION app.protect_app_user_columns();

-- Grants: MFA rows are replaced (re-enrolment, new recovery codes, disabling
-- MFA), so DELETE is granted on them. Files are never deleted by the API.
GRANT SELECT, INSERT, UPDATE, DELETE ON "mfa_factor", "recovery_code" TO ogs_app;
GRANT SELECT, INSERT, UPDATE ON "file_metadata" TO ogs_app;

ALTER TABLE "mfa_factor"    ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "recovery_code" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "file_metadata" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- MFA secrets: identity jobs only (like credentials).
CREATE POLICY "mfa_factor_identity" ON "mfa_factor" FOR ALL
  USING (app.is_job('identity.%')) WITH CHECK (app.is_job('identity.%'));
CREATE POLICY "recovery_code_identity" ON "recovery_code" FOR ALL
  USING (app.is_job('identity.%')) WITH CHECK (app.is_job('identity.%'));

-- Files: the owning tenant, the owning user, platform staff, and the scanner job.
CREATE POLICY "file_metadata_select" ON "file_metadata" FOR SELECT USING (
  "tenant_id" = app.current_tenant_id()
  OR "owner_user_id" = app.current_user_id()
  OR app.is_platform()
  OR app.is_job('files.%')
);
CREATE POLICY "file_metadata_insert" ON "file_metadata" FOR INSERT WITH CHECK (
  "uploaded_by" = app.current_user_id()
  AND (
    ("tenant_id" = app.current_tenant_id() AND "owner_user_id" IS NULL)
    OR ("owner_user_id" = app.current_user_id() AND "tenant_id" IS NULL)
    OR app.is_platform()
  )
);
-- Only the scanner (or platform staff) changes a file's status.
CREATE POLICY "file_metadata_update" ON "file_metadata" FOR UPDATE
  USING (app.is_job('files.%') OR app.is_platform())
  WITH CHECK (app.is_job('files.%') OR app.is_platform());
