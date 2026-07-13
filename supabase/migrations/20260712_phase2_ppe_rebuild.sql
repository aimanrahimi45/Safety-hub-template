-- =====================================================================
-- Phase 2.2: PPE Module Rebuild — per-issue log (not request/item)
--
-- TARGET: Supabase (Postgres 15+), runs AFTER
--         20260712_phase1a_solo_sho.sql
--
-- SCOPE OF THIS FILE
--   Replaces the Phase 1A PPE schema (ppe_requests + ppe_items) with the
--   per-issue model that matches the legacy AmerisPro GAS workflow:
--     Request ID, Timestamp, Staff ID, Staff Name, Department,
--     Supervisor Name, PPE Type, Size, Color/Specs, Replacement Reason,
--     Condition Remarks, Status, Authorized By, Action Date
--
--   Each row = ONE PPE item issued to ONE staff member, with reason and
--   condition recorded. There is no separate ppe_items child table.
--
--   Adds four helper functions:
--     check_last_ppe_issue(staff_id, ppe_type)   — 6-month warning check
--     next_ppe_request_code()                    — sequential REQ-XXXXX
--     get_ppe_types()                            — text[] from tenants
--     get_departments()                          — text[] from tenants
--
--   Adds two columns to tenants: ppe_types, departments (comma-separated).
--
-- IDEMPOTENCY
--   This file is safe to re-run. Every CREATE is preceded by DROP
--   IF EXISTS (tables, types, policies, triggers, columns via ADD
--   COLUMN IF NOT EXISTS, function replacements via CREATE OR REPLACE).
-- =====================================================================

-- =====================================================================
-- 1. DROP old PPE schema (Phase 1A per-request model with child items)
-- =====================================================================

-- Drop ppe_items first (it has a FK to ppe_requests).
DROP TABLE IF EXISTS ppe_items CASCADE;

-- Drop ppe_requests. The CASCADE also drops the RLS policy and trigger.
DROP TABLE IF EXISTS ppe_requests CASCADE;

-- Drop the old 4-value status enum. CASCADE removes any stragglers.
DROP TYPE  IF EXISTS ppe_request_status CASCADE;

-- =====================================================================
-- 2. Recreate the ppe_request_status enum with the new 2-value set
-- =====================================================================

CREATE TYPE ppe_request_status AS ENUM (
  'pending_approval',
  'approved_dispatched'
);

-- =====================================================================
-- 3. Recreate the ppe_requests table (one row per PPE issue)
-- =====================================================================

CREATE TABLE ppe_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Sequential per-tenant code (e.g. REQ-00001). Auto-assigned by the
  -- next_ppe_request_code() helper called from the app or a trigger.
  request_code        text NOT NULL,

  -- When the record was created (mirrors the legacy "Timestamp" column).
  request_date        timestamptz NOT NULL DEFAULT now(),

  -- Who the PPE was issued to.
  staff_id            text NOT NULL,
  staff_name          text NOT NULL,
  department          text NOT NULL,

  -- The PPE itself.
  ppe_type            text NOT NULL,
  size                text,
  color_specs         text,

  -- Why and notes.
  replacement_reason  text NOT NULL DEFAULT 'Damaged',
  condition_remarks   text,

  -- Approval + dispatch.
  status              ppe_request_status NOT NULL DEFAULT 'approved_dispatched',
  authorized_by       text,
  action_date         date NOT NULL,

  -- Audit.
  recorded_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- request_code must be unique within a tenant.
  UNIQUE (tenant_id, request_code),

  -- Defensive CHECKs (NULL/blank guards; mirrors Phase 1A style).
  CONSTRAINT ppe_requests_staff_id_not_blank    CHECK (length(btrim(staff_id))   > 0),
  CONSTRAINT ppe_requests_staff_name_not_blank  CHECK (length(btrim(staff_name)) > 0),
  CONSTRAINT ppe_requests_dept_not_blank        CHECK (length(btrim(department)) > 0),
  CONSTRAINT ppe_requests_ppe_type_not_blank    CHECK (length(btrim(ppe_type))   > 0),
  CONSTRAINT ppe_requests_reason_not_blank      CHECK (length(btrim(replacement_reason)) > 0)
);

-- =====================================================================
-- 4. INDEXES
-- =====================================================================

CREATE INDEX idx_ppe_requests_tenant              ON ppe_requests (tenant_id);
CREATE INDEX idx_ppe_requests_tenant_date         ON ppe_requests (tenant_id, request_date DESC);
CREATE INDEX idx_ppe_requests_staff               ON ppe_requests (tenant_id, staff_id);
CREATE INDEX idx_ppe_requests_ppe_type            ON ppe_requests (tenant_id, ppe_type);
CREATE INDEX idx_ppe_requests_status              ON ppe_requests (tenant_id, status);
CREATE INDEX idx_ppe_requests_recorded_by         ON ppe_requests (recorded_by);

-- =====================================================================
-- 5. TRIGGER: bump updated_at on every UPDATE
--    set_updated_at() is already defined in Phase 1A.
-- =====================================================================

DROP TRIGGER IF EXISTS trg_ppe_requests_updated_at ON ppe_requests;

CREATE TRIGGER trg_ppe_requests_updated_at
  BEFORE UPDATE ON ppe_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 6. HELPER FUNCTIONS (all SECURITY DEFINER, search_path pinned)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6.1  check_last_ppe_issue
--   6-month warning check used by the new-issue form.
--
--   Returns the most recent prior issue of the same PPE type to the
--   same staff member (case-insensitive match on both, status must be
--   'approved_dispatched'). If no prior issue exists, returns 0 rows
--   (the client interprets that as "no prior issue").
--
--   diff_months is the calendar-month difference between now() and
--   the prior action_date (year*12 + month arithmetic, same as the
--   legacy GAS checkLastIssue() in Safety_Hub_Backend.js:911).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_last_ppe_issue(
  p_staff_id text,
  p_ppe_type text
)
RETURNS TABLE (
  found        boolean,
  last_date    date,
  diff_months  integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- When 0 rows match, the client gets no rows back and treats
  -- (null found) as false. When 1 row matches, found=true.
  SELECT
    true,
    p.action_date,
    (
      (date_part('year', now()) - date_part('year', p.action_date)) * 12
      + (date_part('month', now()) - date_part('month', p.action_date))
    )::integer AS diff_months
  FROM ppe_requests p
  WHERE p.tenant_id = get_my_tenant_id()
    AND lower(btrim(p.staff_id)) = lower(btrim(p_staff_id))
    AND lower(btrim(p.ppe_type)) = lower(btrim(p_ppe_type))
    AND p.status = 'approved_dispatched'
  ORDER BY p.action_date DESC, p.request_date DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 6.2  next_ppe_request_code
--   Returns the next sequential per-tenant code "REQ-00001", "REQ-00002"...
--
--   Implementation: max of the integer suffix of all matching codes
--   in the current tenant, +1, zero-padded to 5 digits. Malformed
--   codes (anything that does not match ^REQ-[0-9]+$) are ignored, so
--   a future change to the code format will not break the sequence.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_ppe_request_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_next      integer;
BEGIN
  v_tenant_id := get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'next_ppe_request_code: caller has no tenant'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(
    CAST(substring(request_code FROM 5) AS integer)
  ), 0) + 1
  INTO v_next
  FROM ppe_requests
  WHERE tenant_id = v_tenant_id
    AND request_code ~ '^REQ-[0-9]+$';

  RETURN 'REQ-' || lpad(v_next::text, 5, '0');
END;
$$;

-- ---------------------------------------------------------------------
-- 6.3  get_ppe_types
--   Returns the SHO's PPE_TYPES list (comma-separated column) as a
--   text[]. Used by the new-issue form to populate the PPE Type
--   <select>.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_ppe_types()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT string_to_array(ppe_types, ',') FROM tenants WHERE id = get_my_tenant_id();
$$;

-- ---------------------------------------------------------------------
-- 6.4  get_departments
--   Returns the SHO's DEPARTMENTS list (comma-separated column) as a
--   text[]. Used by the new-issue form to populate the Department
--   <select>.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_departments()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT string_to_array(departments, ',') FROM tenants WHERE id = get_my_tenant_id();
$$;

-- =====================================================================
-- 7. TENANT SETTINGS: ppe_types + departments columns
--    Defaults match the legacy AmerisPro GAS settings
--    (Safety_Hub_Backend.js:1868-1869).
-- =====================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ppe_types   text NOT NULL DEFAULT 'Safety Shoe,Safety Helmet,Respirator,Earmuff,Filter Cartridge,Other',
  ADD COLUMN IF NOT EXISTS departments text NOT NULL DEFAULT 'Production,Maintenance,QA/QC,Warehouse,Safety/HR,Engineering,Electrical,Security,Recycle,DIP,Wire Drawing,Logistic,Finance,Purchasing,MFP,Admin,Contractor,Others';

-- =====================================================================
-- 8. ROW LEVEL SECURITY
--    Standard solo-SHO policy: tenant_id = get_my_tenant_id().
-- =====================================================================

ALTER TABLE ppe_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ppe_requests_all_member ON ppe_requests;

CREATE POLICY ppe_requests_all_member ON ppe_requests
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- =====================================================================
-- 9. GRANTS for the new helper functions
-- =====================================================================

GRANT EXECUTE ON FUNCTION check_last_ppe_issue(text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION next_ppe_request_code()            TO authenticated;
GRANT EXECUTE ON FUNCTION get_ppe_types()                    TO authenticated;
GRANT EXECUTE ON FUNCTION get_departments()                  TO authenticated;

-- =====================================================================
-- 10. VERIFICATION QUERIES  (run by hand after applying, in psql or
--     Supabase SQL editor with the appropriate role)
-- =====================================================================

-- 10.1  ppe_requests table exists; ppe_items does NOT.
-- ----------------------------------------------------------------------------
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public' AND tablename LIKE 'ppe_%'
--  ORDER BY tablename;
-- -- EXPECT: ppe_requests
-- -- (ppe_items must be gone)

-- 10.2  ppe_request_status enum has exactly 2 values.
-- ----------------------------------------------------------------------------
-- SELECT enumlabel
--   FROM pg_enum
--  WHERE enumtypid = 'ppe_request_status'::regtype
--  ORDER BY enumsortorder;
-- -- EXPECT:
-- --   approved_dispatched
-- --   pending_approval

-- 10.3  All four new functions exist and are SECURITY DEFINER.
-- ----------------------------------------------------------------------------
-- SELECT proname, prosecdef
--   FROM pg_proc
--  WHERE proname IN (
--    'check_last_ppe_issue',
--    'next_ppe_request_code',
--    'get_ppe_types',
--    'get_departments'
--  )
--  ORDER BY proname;
-- -- EXPECT: 4 rows, all prosecdef = true

-- 10.4  ppe_requests is RLS-enabled and has exactly one policy.
-- ----------------------------------------------------------------------------
-- SELECT relname, relrowsecurity
--   FROM pg_class
--  WHERE relname = 'ppe_requests';
-- -- EXPECT: relrowsecurity = true
-- SELECT count(*) AS policy_count
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'ppe_requests';
-- -- EXPECT: 1

-- 10.5  Smoke test: check_last_ppe_issue returns 0 rows for an empty
--       tenant. (Run as an authenticated user with a tenant; or after
--       temporarily setting role + get_my_tenant_id context.)
-- ----------------------------------------------------------------------------
-- SELECT * FROM check_last_ppe_issue('STAFF-001', 'Safety Shoe');
-- -- EXPECT: 0 rows

-- 10.6  Smoke test: next_ppe_request_code returns REQ-00001 for a
--       fresh tenant.
-- ----------------------------------------------------------------------------
-- SELECT next_ppe_request_code();
-- -- EXPECT: REQ-00001
-- -- After inserting one row with that code, the next call should
-- -- return REQ-00002.

-- 10.7  ppe_types and departments columns exist on tenants.
-- ----------------------------------------------------------------------------
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'tenants'
--    AND column_name IN ('ppe_types', 'departments')
--  ORDER BY column_name;
-- -- EXPECT: 2 rows
