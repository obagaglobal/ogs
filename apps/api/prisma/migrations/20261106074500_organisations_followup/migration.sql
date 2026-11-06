-- Phase 4 follow-up (hand-written).

-- Custom roles can be deleted by their tenant when no membership holds them
-- (the API checks that first; the membership_role foreign key enforces it).
-- System roles can never be deleted through the API role.
GRANT DELETE ON "role" TO ogs_app;
CREATE POLICY "role_delete" ON "role" FOR DELETE
  USING (("tenant_id" = app.current_tenant_id() AND NOT "is_system") OR (app.is_platform() AND NOT "is_system"));

-- The registration job writes the "organisation registered" audit row for the
-- tenant it has just created (no tenant context exists yet).
CREATE POLICY "audit_log_insert_register" ON "audit_log" FOR INSERT WITH CHECK (
  app.is_job('organisations.register')
  AND "actor_kind" = 'SYSTEM'
  AND "actor_user_id" IS NULL
);
