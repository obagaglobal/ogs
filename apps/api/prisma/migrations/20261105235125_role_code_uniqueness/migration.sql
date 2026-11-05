-- The (tenant_id, code) unique index is NULLS NOT DISTINCT (created in the previous
-- migration), so it also keeps system role codes (tenant_id NULL) unique.
-- Prisma models it as @@unique([tenantId, code]); this migration only aligns names
-- and drops the now-redundant tenant_id index.

-- DropIndex
DROP INDEX "role_tenant_id_idx";

-- RenameIndex
ALTER INDEX "role_tenant_code_key" RENAME TO "role_tenant_id_code_key";
