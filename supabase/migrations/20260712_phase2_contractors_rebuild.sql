-- =====================================================================
-- Phase 2.3: Contractors Module — solo-SHO per-worker induction workflow
--
-- TARGET: Supabase (Postgres 15+), runs AFTER
--         20260712_phase1a_solo_sho.sql
--
-- SCOPE OF THIS FILE
--   The Phase 1A `contractors` and `induction_records` tables are
--   already correct for the solo-SHO workflow (one row per company,
--   one row per inducted worker). We do NOT drop/recreate them.
--
--   What this migration adds:
--     1. tenants.contractor_declaration  — the text the worker
--        acknowledges during induction; editable in /app/settings.
--     2. get_contractor_declaration()     — SECURITY DEFINER reader.
--     3. lookup_worker_by_ic(p_ic)        — SECURITY DEFINER lookup
--        used by /app/induction-lookup and the gate check.
--     4. induction_records.photo_url      — column for the worker's
--        induction photo stored in the `induction-photos` bucket.
--        Added because Phase 1A only had signature_url; we now
--        also store an optional photo.
--
--   No 2-step approval flow (Solo SHO submits → induction is
--   immediately valid). The `status` column on induction_records
--   is intentionally absent: a row in induction_records is valid
--   by virtue of existing.
--
-- IDEMPOTENCY
--   ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, GRANT
--   are all safe to re-run.
-- =====================================================================

-- =====================================================================
-- 1. tenants.contractor_declaration
-- =====================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS contractor_declaration text NOT NULL
  DEFAULT 'Agreed: Emergency Evac, PPE Rules, Incident Reporting';

-- =====================================================================
-- 2. get_contractor_declaration
--    Returns the declaration text for the calling tenant, or NULL if
--    the caller has no tenant. Used by the induct-worker form to
--    display the callout the worker must acknowledge.
-- =====================================================================

CREATE OR REPLACE FUNCTION get_contractor_declaration()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT contractor_declaration
  FROM tenants
  WHERE id = get_my_tenant_id();
$$;

GRANT EXECUTE ON FUNCTION get_contractor_declaration() TO authenticated;

-- =====================================================================
-- 3. lookup_worker_by_ic
--    The "is this worker inducted?" check. Returns the most recent
--    induction record for the given IC across the caller's tenant
--    where the parent contractor is currently `inducted`.
--
--    Returns 0 rows when no matching worker is found (the client
--    treats that as "not found"). When 1 row matches, the row's
--    `is_expired` flag is true if the induction has an expiry date
--    and that date is in the past.
--
--    SECURITY DEFINER is needed so the SHO can read across
--    contractors (the RLS policies already scope by tenant_id, but
--    this joins two tables and is invoked from an unauthenticated-
--    looking flow at the gate; keeping the function SECURITY DEFINER
--    mirrors the other helpers in Phase 1A).
-- =====================================================================

CREATE OR REPLACE FUNCTION lookup_worker_by_ic(p_ic text)
RETURNS TABLE (
  found          boolean,
  worker_name    text,
  company_name   text,
  induction_date date,
  expires_at     date,
  is_expired     boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    true,
    ir.worker_name,
    c.company_name,
    ir.induction_date,
    ir.expires_at,
    (ir.expires_at IS NOT NULL AND ir.expires_at < CURRENT_DATE) AS is_expired
  FROM induction_records ir
  JOIN contractors c ON c.id = ir.contractor_id
  WHERE ir.tenant_id = get_my_tenant_id()
    AND btrim(ir.worker_ic) = btrim(p_ic)
    AND c.status = 'inducted'
  ORDER BY ir.induction_date DESC, ir.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION lookup_worker_by_ic(text) TO authenticated;

-- =====================================================================
-- 4. induction_records.photo_url
--    Optional URL of the worker's induction photo in the
--    `induction-photos` Supabase Storage bucket. RLS on
--    induction_records already restricts reads to the caller's
--    tenant; the URL is just a path; actual file access is gated
--    by the storage.objects policies in
--    20260712_phase2_storage_setup.sql.
-- =====================================================================

ALTER TABLE induction_records
  ADD COLUMN IF NOT EXISTS photo_url text;

-- =====================================================================
-- 5. No new RLS or triggers required.
--    - contractors and induction_records already have the standard
--      solo-SHO `tenant_id = get_my_tenant_id()` RLS policies from
--      Phase 1A.
--    - set_updated_at() is already wired on contractors.
--    - induction_records has no updated_at column; the existing
--      trigger set is complete.
-- =====================================================================

-- =====================================================================
-- 6. VERIFICATION QUERIES  (run by hand after applying, in psql or
--    Supabase SQL editor with the appropriate role)
-- =====================================================================

-- 6.1  tenants.contractor_declaration column exists.
-- ----------------------------------------------------------------------------
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'tenants' AND column_name = 'contractor_declaration';
-- -- EXPECT: 1 row, text, NOT NULL DEFAULT 'Agreed: Emergency Evac, ...'

-- 6.2  induction_records.photo_url column exists.
-- ----------------------------------------------------------------------------
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'induction_records' AND column_name = 'photo_url';
-- -- EXPECT: 1 row, text, nullable

-- 6.3  All three new functions exist and are SECURITY DEFINER.
-- ----------------------------------------------------------------------------
-- SELECT proname, prosecdef
--   FROM pg_proc
--  WHERE proname IN (
--    'get_contractor_declaration',
--    'lookup_worker_by_ic',
--    'get_my_tenant_id'  -- sanity check that the existing helper is still there
--  )
--  ORDER BY proname;
-- -- EXPECT: 3 rows, all prosecdef = true
