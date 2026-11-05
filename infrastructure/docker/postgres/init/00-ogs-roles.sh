#!/bin/sh
# Creates the OGS database roles and databases (ADR-010, Phase 2 plan §2.1).
#
# Runs in two ways:
#   1. Automatically on a NEW volume (mounted into /docker-entrypoint-initdb.d).
#   2. On demand for an EXISTING volume: `pnpm db:roles` (docker compose exec).
#
# Idempotent: safe to run any number of times. It (re)applies role attributes and
# passwords, so changing a password in .env and re-running it rotates it.
#
# Roles:
#   ogs_owner    owns the databases/schema, runs migrations. Never used at runtime.
#   ogs_app      API + worker. NOBYPASSRLS, not an owner.
#   ogs_readonly reporting (SELECT through RLS). Unused until later phases.
#   ogs_maint    BYPASSRLS. Dev seeding and break-glass only. Never configured in the API.
#
# Development only. Production roles are provisioned separately (Phase 15).
set -eu

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
: "${OGS_OWNER_PASSWORD:?OGS_OWNER_PASSWORD must be set}"
: "${OGS_APP_PASSWORD:?OGS_APP_PASSWORD must be set}"
: "${OGS_READONLY_PASSWORD:?OGS_READONLY_PASSWORD must be set}"
: "${OGS_MAINT_PASSWORD:?OGS_MAINT_PASSWORD must be set}"
TEST_DB="${OGS_TEST_DB:-ogs_test}"

psql_admin() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc --quiet --username "$POSTGRES_USER" "$@"
}

# Cluster-level: roles and databases. Passwords are passed as psql variables and
# quoted with format(%L); they never appear on a command line.
psql_admin --dbname postgres \
  -v owner_pw="$OGS_OWNER_PASSWORD" \
  -v app_pw="$OGS_APP_PASSWORD" \
  -v ro_pw="$OGS_READONLY_PASSWORD" \
  -v maint_pw="$OGS_MAINT_PASSWORD" \
  -v dev_db="$POSTGRES_DB" \
  -v test_db="$TEST_DB" <<'SQL'
SELECT format('CREATE ROLE %I', r) FROM unnest(ARRAY['ogs_owner','ogs_app','ogs_readonly','ogs_maint']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec

-- CREATEDB on the owner lets `prisma migrate dev` create its shadow database (dev only).
SELECT format('ALTER ROLE ogs_owner    WITH LOGIN NOSUPERUSER CREATEDB   NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT   PASSWORD %L', :'owner_pw') \gexec
SELECT format('ALTER ROLE ogs_app      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'app_pw') \gexec
SELECT format('ALTER ROLE ogs_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'ro_pw') \gexec
SELECT format('ALTER ROLE ogs_maint    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS   NOINHERIT PASSWORD %L', :'maint_pw') \gexec

-- Runtime roles must not be able to assume any other role.
SELECT format('REVOKE %I FROM %I', m.rolname, r.rolname)
  FROM pg_auth_members am
  JOIN pg_roles m ON m.oid = am.roleid
  JOIN pg_roles r ON r.oid = am.member
 WHERE r.rolname IN ('ogs_app','ogs_readonly','ogs_maint') \gexec

SELECT format('CREATE DATABASE %I OWNER ogs_owner', :'test_db')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'test_db') \gexec

SELECT format('ALTER DATABASE %I OWNER TO ogs_owner', d), format('REVOKE ALL ON DATABASE %I FROM PUBLIC', d),
       format('GRANT CONNECT ON DATABASE %I TO ogs_app, ogs_readonly, ogs_maint', d)
  FROM unnest(ARRAY[:'dev_db', :'test_db']) AS d \gexec
SQL

# Database-level: the database owner (ogs_owner) owns schema public through
# pg_database_owner (PostgreSQL 15+). Runtime roles get USAGE only, never CREATE.
for db in "$POSTGRES_DB" "$TEST_DB"; do
  psql_admin --dbname "$db" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ogs_app, ogs_readonly, ogs_maint;
SQL
done

echo "OGS roles ready (databases: $POSTGRES_DB, $TEST_DB)."
