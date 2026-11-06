-- Phase 5 follow-up (hand-written).
-- The provider notification job may read the email of individual providers only.
-- Reads provider, whose policies never read app_user (no recursion).
CREATE POLICY "app_user_select_provider_notify" ON "app_user" FOR SELECT USING (
  app.is_job('providers.notify')
  AND EXISTS (SELECT 1 FROM "provider" p WHERE p."owner_user_id" = "app_user"."id")
);
