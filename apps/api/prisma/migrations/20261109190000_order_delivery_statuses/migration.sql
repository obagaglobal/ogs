-- Phase 9 (P9-10): orders follow their job. A separate migration because a new
-- enum value cannot be used in the transaction that adds it, and the jobs
-- migration that follows refers to these values.

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'IN_DELIVERY' BEFORE 'CANCELLED';
ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED' BEFORE 'CANCELLED';
