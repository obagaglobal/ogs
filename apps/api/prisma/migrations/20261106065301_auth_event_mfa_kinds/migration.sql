-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventKind" ADD VALUE 'MFA_ENABLED';
ALTER TYPE "AuthEventKind" ADD VALUE 'MFA_DISABLED';
ALTER TYPE "AuthEventKind" ADD VALUE 'MFA_VERIFIED';
ALTER TYPE "AuthEventKind" ADD VALUE 'MFA_FAILED';
ALTER TYPE "AuthEventKind" ADD VALUE 'RECOVERY_CODE_USED';
ALTER TYPE "AuthEventKind" ADD VALUE 'RECOVERY_CODES_REGENERATED';
