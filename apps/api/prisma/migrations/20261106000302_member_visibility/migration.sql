-- Fellow members of the current tenant may see each other's user row (email,
-- status), so a workspace can list its members (GET /api/v1/workspace/members).
-- Reads membership, whose policies never read app_user (no recursion).
CREATE POLICY "app_user_select_tenant_member" ON "app_user" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "membership" m
     WHERE m."user_id" = "app_user"."id" AND m."tenant_id" = app.current_tenant_id()
  )
);
