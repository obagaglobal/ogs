-- CreateEnum
CREATE TYPE "CatalogueStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ServiceAudience" AS ENUM ('ALL', 'ORGANISATIONS', 'INDIVIDUALS');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('ON_SITE', 'REMOTE', 'BOTH');

-- CreateEnum
CREATE TYPE "PriceModel" AS ENUM ('FIXED', 'PER_UNIT', 'FROM', 'QUOTE');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('HOUR', 'DEVICE', 'USER', 'VISIT', 'POINT');

-- CreateTable
CREATE TABLE "service_category" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "parent_id" UUID,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "summary" VARCHAR(300),
    "icon" VARCHAR(40) NOT NULL DEFAULT 'folder',
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogueStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "category_id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "summary" VARCHAR(300) NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "inclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customer_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "typical_duration" VARCHAR(100),
    "audience" "ServiceAudience" NOT NULL DEFAULT 'ALL',
    "delivery_mode" "DeliveryMode" NOT NULL DEFAULT 'ON_SITE',
    "channel_ogs" BOOLEAN NOT NULL DEFAULT true,
    "channel_individual" BOOLEAN NOT NULL DEFAULT true,
    "channel_company" BOOLEAN NOT NULL DEFAULT true,
    "status" "ServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_vector" tsvector,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_price" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "service_id" UUID NOT NULL,
    "model" "PriceModel" NOT NULL,
    "amount_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'KES',
    "unit" "PriceUnit",
    "min_quantity" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "service_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_skill" (
    "service_id" UUID NOT NULL,
    "skill_code" VARCHAR(60) NOT NULL,
    "min_experience" "ExperienceBand" NOT NULL DEFAULT 'UNDER_1_YEAR',

    CONSTRAINT "service_skill_pkey" PRIMARY KEY ("service_id","skill_code")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_category_slug_key" ON "service_category"("slug");

-- CreateIndex
CREATE INDEX "service_category_parent_id_position_idx" ON "service_category"("parent_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "service_slug_key" ON "service"("slug");

-- CreateIndex
CREATE INDEX "service_category_id_status_idx" ON "service"("category_id", "status");

-- CreateIndex
CREATE INDEX "service_status_name_idx" ON "service"("status", "name");

-- CreateIndex
CREATE INDEX "service_price_service_id_effective_from_idx" ON "service_price"("service_id", "effective_from");

-- CreateIndex
CREATE INDEX "service_skill_skill_code_idx" ON "service_skill"("skill_code");

-- AddForeignKey
ALTER TABLE "service_category" ADD CONSTRAINT "service_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "service_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_price" ADD CONSTRAINT "service_price_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_skill" ADD CONSTRAINT "service_skill_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_skill" ADD CONSTRAINT "service_skill_skill_code_fkey" FOREIGN KEY ("skill_code") REFERENCES "skill"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 6 (hand-written): constraints, triggers, grants and row-level security
-- for the service catalogue. Platform-owned rows: no tenant column.
-- ============================================================================

-- Constraints -----------------------------------------------------------------

ALTER TABLE "service_category"
  ADD CONSTRAINT "service_category_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "service_category_icon_chk" CHECK ("icon" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "service_category_not_own_parent_chk" CHECK ("parent_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "service_category_name_chk" CHECK (length(trim("name")) >= 2);

ALTER TABLE "service"
  ADD CONSTRAINT "service_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "service_name_chk" CHECK (length(trim("name")) >= 2),
  ADD CONSTRAINT "service_description_len_chk" CHECK (length("description") <= 5000),
  ADD CONSTRAINT "service_published_at_chk" CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL),
  ADD CONSTRAINT "service_retired_at_chk" CHECK ("status" <> 'RETIRED' OR "retired_at" IS NOT NULL),
  ADD CONSTRAINT "service_channel_chk" CHECK ("channel_ogs" OR "channel_individual" OR "channel_company");

-- Money (P6-2, P6-3, P6-8): integer minor units, KES only in v1, at most
-- 10 billion shillings (well inside JavaScript's safe-integer range).
ALTER TABLE "service_price"
  ADD CONSTRAINT "service_price_currency_chk" CHECK ("currency" = 'KES'),
  ADD CONSTRAINT "service_price_amount_chk" CHECK (
    "amount_minor" IS NULL OR ("amount_minor" >= 0 AND "amount_minor" <= 1000000000000)
  ),
  ADD CONSTRAINT "service_price_quote_chk" CHECK (("model" = 'QUOTE') = ("amount_minor" IS NULL)),
  ADD CONSTRAINT "service_price_unit_chk" CHECK (("model" = 'PER_UNIT') = ("unit" IS NOT NULL)),
  ADD CONSTRAINT "service_price_min_quantity_chk" CHECK (
    "min_quantity" BETWEEN 1 AND 10000 AND ("model" = 'PER_UNIT' OR "min_quantity" = 1)
  );

CREATE INDEX "service_search_vector_idx" ON "service" USING GIN ("search_vector");

-- Category tree ----------------------------------------------------------------
-- Two levels at most. An ACTIVE category never sits under an ARCHIVED parent:
-- archiving a parent archives its children, and a child cannot be activated or
-- moved under an archived parent. "status = ACTIVE" is therefore enough for
-- public visibility, with no self-referencing (recursive) policy.
CREATE OR REPLACE FUNCTION app.protect_service_category() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent_parent uuid;
  parent_status "CatalogueStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."slug" IS DISTINCT FROM OLD."slug" THEN
    RAISE EXCEPTION 'category slug is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."parent_id" IS NOT NULL THEN
    SELECT "parent_id", "status" INTO parent_parent, parent_status
      FROM "service_category" WHERE "id" = NEW."parent_id";
    IF parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'categories are at most two levels deep' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" = 'ACTIVE' AND parent_status = 'ARCHIVED' THEN
      RAISE EXCEPTION 'an active category cannot sit under an archived parent'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "service_category" WHERE "parent_id" = NEW."id") THEN
      RAISE EXCEPTION 'a category with sub-categories cannot itself have a parent'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.protect_service_category() FROM PUBLIC;
CREATE TRIGGER "service_category_protect" BEFORE INSERT OR UPDATE ON "service_category"
  FOR EACH ROW EXECUTE FUNCTION app.protect_service_category();

CREATE OR REPLACE FUNCTION app.cascade_category_archive() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."status" = 'ARCHIVED' AND OLD."status" = 'ACTIVE' THEN
    UPDATE "service_category" SET "status" = 'ARCHIVED', "version" = "version" + 1
     WHERE "parent_id" = NEW."id" AND "status" = 'ACTIVE';
  END IF;
  IF NEW."name" IS DISTINCT FROM OLD."name" THEN
    -- Refresh the search vectors that include the category name.
    UPDATE "service" SET "search_vector" = NULL WHERE "category_id" = NEW."id";
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.cascade_category_archive() FROM PUBLIC;
CREATE TRIGGER "service_category_cascade" AFTER UPDATE ON "service_category"
  FOR EACH ROW EXECUTE FUNCTION app.cascade_category_archive();

-- Services ---------------------------------------------------------------------
-- The search vector: the name both unstemmed ('simple', so "M-Pesa", "CCTV" and
-- brand names match exactly) and stemmed ('english'), then the summary, the
-- category name and the body text at lower weights.
CREATE OR REPLACE FUNCTION app.service_search_vector() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  category_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."slug" IS DISTINCT FROM OLD."slug" AND OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'service slug is immutable once published' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "name" INTO category_name FROM "service_category" WHERE "id" = NEW."category_id";
  NEW."search_vector" :=
    setweight(to_tsvector('simple', coalesce(NEW."name", '')), 'A')
    || setweight(to_tsvector('english', coalesce(NEW."name", '')), 'A')
    || setweight(to_tsvector('english', coalesce(NEW."summary", '')), 'B')
    || setweight(to_tsvector('english', coalesce(category_name, '')), 'B')
    || setweight(to_tsvector('english',
         coalesce(NEW."description", '') || ' '
         || array_to_string(coalesce(NEW."inclusions", '{}'), ' ')), 'C');
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.service_search_vector() FROM PUBLIC;
CREATE TRIGGER "service_search_vector" BEFORE INSERT OR UPDATE ON "service"
  FOR EACH ROW EXECUTE FUNCTION app.service_search_vector();

-- Price versions are append-only (P6-3).
CREATE TRIGGER "service_price_reject_update_delete" BEFORE UPDATE OR DELETE ON "service_price"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER "service_price_reject_truncate" BEFORE TRUNCATE ON "service_price"
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- Grants -------------------------------------------------------------------------
-- Nothing is ever deleted except required-skill links (replaced as a set).
GRANT SELECT, INSERT, UPDATE ON "service_category", "service" TO ogs_app;
GRANT SELECT, INSERT ON "service_price" TO ogs_app;
GRANT SELECT, INSERT, DELETE ON "service_skill" TO ogs_app;

-- Row-level security ---------------------------------------------------------------
ALTER TABLE "service_category" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "service"          ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_price"    ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_skill"    ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Public catalogue (P6-1): these SELECT policies are deliberately context-free.
-- Anyone, including the anonymous context (which sets no identity), sees the
-- published catalogue and nothing else. Platform staff see everything.
CREATE POLICY "service_category_select" ON "service_category" FOR SELECT
  USING ("status" = 'ACTIVE' OR app.is_platform());
CREATE POLICY "service_category_insert" ON "service_category" FOR INSERT
  WITH CHECK (app.is_platform());
CREATE POLICY "service_category_update" ON "service_category" FOR UPDATE
  USING (app.is_platform()) WITH CHECK (app.is_platform());

-- The EXISTS reads service_category under its own policy (a different table: no
-- recursion), so a service in an archived category is hidden from the public.
CREATE POLICY "service_select" ON "service" FOR SELECT USING (
  app.is_platform()
  OR (
    "status" = 'PUBLISHED'
    AND EXISTS (
      SELECT 1 FROM "service_category" c WHERE c."id" = "service"."category_id" AND c."status" = 'ACTIVE'
    )
  )
);
CREATE POLICY "service_insert" ON "service" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY "service_update" ON "service" FOR UPDATE
  USING (app.is_platform()) WITH CHECK (app.is_platform());

CREATE POLICY "service_price_select" ON "service_price" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "service" s WHERE s."id" = "service_price"."service_id")
);
CREATE POLICY "service_price_insert" ON "service_price" FOR INSERT WITH CHECK (app.is_platform());

-- Required skills are internal (dispatch input), never public.
CREATE POLICY "service_skill_select" ON "service_skill" FOR SELECT USING (app.is_platform());
CREATE POLICY "service_skill_insert" ON "service_skill" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY "service_skill_delete" ON "service_skill" FOR DELETE USING (app.is_platform());
