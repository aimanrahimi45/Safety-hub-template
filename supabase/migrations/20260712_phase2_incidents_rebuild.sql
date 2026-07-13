-- =====================================================================
-- Phase 2.4: Incidents Module Rebuild — legacy 12-column AmerisPro model
--
-- TARGET: Supabase (Postgres 15+), runs AFTER
--         20260712_phase1a_solo_sho.sql
--         20260712_phase2_ppe_rebuild.sql
--         20260712_phase2_contractors_rebuild.sql
--
-- SCOPE OF THIS FILE
--   Replaces the Phase 1A `incidents` schema (which modelled a SHO
--   investigation workflow: severity enum, status enum, root_cause,
--   corrective_action, closed_at, closed_by) with the legacy 12-column
--   AmerisPro Incidents Log:
--     Incident ID, Timestamp, Date & Time, Victim Name, Staff ID,
--     Location / Dept, Body Part Injured, Man-days Lost,
--     Reported to JKKP?, Severity Type,
--     Incident Investigation Submitted?, Description
--
--   Severity is now `text` with a CHECK constraint allowing
--   'First Aid' | 'Minor' | 'Major' | 'Fatal' | 'Other'. The 5th value
--   'Other' reveals a free-text `severity_other` column on the form.
--   The `incident_severity` and `incident_status` enums from Phase 1A
--   are dropped.
--
--   Investigation follow-up fields (root_cause, corrective_action,
--   status, closed_at, closed_by) are intentionally NOT carried over
--   — they will be re-introduced in a later phase when the user wants
--   the investigation workflow.
--
--   Adds two helper functions:
--     next_incident_code()              — sequential INC-YYYY-XXXX
--     lookup_staff_by_id(p_staff_id)    — Premium staff auto-fill RPC
--                                         used by the new incident form
--                                         (gate is client-side; the RPC
--                                         is callable by any SHO; the
--                                         data is already RLS-scoped to
--                                         the caller's tenant).
--
-- IDEMPOTENCY
--   DROP TABLE IF EXISTS + DROP TYPE IF EXISTS are no-ops on re-run.
--   CREATE OR REPLACE FUNCTION overwrites the helper. The RLS policy
--   is dropped and re-created.
-- =====================================================================

-- =====================================================================
-- 1. DROP the old Phase 1A incidents schema
-- =====================================================================

-- Drop the table. CASCADE removes the RLS policy and the
-- set_updated_at trigger. The Phase 1A indexes on the old columns
-- (idx_incidents_severity, idx_incidents_status, idx_incidents_closed_by)
-- are also dropped with the table.
DROP TABLE IF EXISTS incidents CASCADE;

-- Drop the two enums. They are not used by any other table.
DROP TYPE IF EXISTS incident_severity CASCADE;
DROP TYPE IF EXISTS incident_status   CASCADE;

-- =====================================================================
-- 2. Recreate the `incidents` table (legacy 12-column shape)
--    The 12 legacy columns map as:
--      Incident ID                        -> incident_code
--      Timestamp                          -> recorded_at
--      Date & Time                        -> incident_date + incident_time
--      Victim Name                        -> victim_name
--      Staff ID                           -> staff_id (free-text; see RPC)
--      Location / Dept                    -> location_dept
--      Body Part Injured                  -> body_part_injured
--      Man-days Lost                      -> man_days_lost
--      Reported to JKKP?                  -> reported_to_jkkp
--      Severity Type                      -> severity_type + severity_other
--      Incident Investigation Submitted?  -> investigation_submitted
--      Description                        -> description
-- =====================================================================

CREATE TABLE incidents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Auto-generated per-tenant code, format INC-YYYY-XXXX
  incident_code            text NOT NULL,

  -- When recorded (defaults to now; mirrors legacy "Timestamp")
  recorded_at              timestamptz NOT NULL DEFAULT now(),

  -- When the incident occurred
  incident_date            timestamptz NOT NULL,
  incident_time            time,

  -- Who was injured / where
  victim_name              text NOT NULL,
  staff_id                 text,
  location_dept            text NOT NULL,

  -- What happened
  body_part_injured        text,
  description              text NOT NULL,

  -- Numbers
  man_days_lost            int NOT NULL DEFAULT 0 CHECK (man_days_lost >= 0),

  -- Severity (text, not enum; defaults to "First Aid")
  severity_type            text NOT NULL DEFAULT 'First Aid'
    CHECK (severity_type IN ('First Aid', 'Minor', 'Major', 'Fatal', 'Other')),
  severity_other           text,  -- shown only when severity_type = 'Other'

  -- Regulatory + investigation status (booleans, NOT workflow)
  reported_to_jkkp         boolean NOT NULL DEFAULT false,
  investigation_submitted  boolean NOT NULL DEFAULT false,

  -- Audit
  reported_by              uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- incident_code must be unique within a tenant
  UNIQUE (tenant_id, incident_code),

  -- Defensive NOT-BLANK CHECKs (mirror Phase 1A style)
  CONSTRAINT incidents_code_not_blank        CHECK (length(btrim(incident_code))   > 0),
  CONSTRAINT incidents_victim_not_blank      CHECK (length(btrim(victim_name))     > 0),
  CONSTRAINT incidents_location_not_blank    CHECK (length(btrim(location_dept))   > 0),
  CONSTRAINT incidents_description_not_blank CHECK (length(btrim(description))     > 0),

  -- severity_other is required iff severity_type = 'Other' (loose: a
  -- value for the 4 named severities is allowed to be null; for 'Other'
  -- it must be non-blank).
  CONSTRAINT incidents_severity_other_consistent CHECK (
    (severity_type = 'Other' AND severity_other IS NOT NULL AND length(btrim(severity_other)) > 0)
    OR (severity_type <> 'Other')
  )
);

-- =====================================================================
-- 3. INDEXES
-- =====================================================================

-- 3.1  tenant_id for RLS performance
CREATE INDEX idx_incidents_tenant              ON incidents (tenant_id);

-- 3.2  Time-sorted list queries
CREATE INDEX idx_incidents_tenant_date         ON incidents (tenant_id, incident_date DESC);
CREATE INDEX idx_incidents_tenant_recorded     ON incidents (tenant_id, recorded_at DESC);

-- 3.3  Filter columns
CREATE INDEX idx_incidents_staff               ON incidents (tenant_id, staff_id);
CREATE INDEX idx_incidents_severity            ON incidents (tenant_id, severity_type);
CREATE INDEX idx_incidents_jkkp                ON incidents (tenant_id, reported_to_jkkp);
CREATE INDEX idx_incidents_investigation       ON incidents (tenant_id, investigation_submitted);

-- 3.4  FK columns
CREATE INDEX idx_incidents_reported_by         ON incidents (reported_by);

-- =====================================================================
-- 4. TRIGGER: bump updated_at on every UPDATE
--    set_updated_at() is already defined in Phase 1A.
-- =====================================================================

DROP TRIGGER IF EXISTS trg_incidents_updated_at ON incidents;

CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 5. HELPER FUNCTIONS  (all SECURITY DEFINER, search_path pinned)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5.1  next_incident_code
--   Returns the next sequential per-tenant code "INC-YYYY-0001",
--   "INC-YYYY-0002", ... for the CURRENT calendar year.
--
--   Implementation: max of the integer suffix of all matching codes in
--   the caller's tenant for the current year, +1, zero-padded to 4
--   digits. Malformed codes (anything that does not match
--   ^INC-[0-9]{4}-[0-9]+$) are ignored by the regex capture, so a
--   future change to the code format will not break the sequence.
--
--   NOTE: this uses to_char(now(), 'YYYY'), matching the user-approved
--   spec. The legacy AmerisPro GAS code used the incident's year; this
--   rebuild deliberately scopes the sequence to the wall-clock year so
--   year-rollover behaviour is predictable for an SHO who logs late.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_incident_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_year      text;
  v_next      integer;
BEGIN
  v_tenant_id := get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'next_incident_code: caller has no tenant'
      USING ERRCODE = '42501';
  END IF;

  v_year := to_char(now(), 'YYYY');

  SELECT COALESCE(MAX(
    CAST(substring(incident_code FROM 'INC-[0-9]{4}-([0-9]+)') AS integer)
  ), 0) + 1
  INTO v_next
  FROM incidents
  WHERE tenant_id = v_tenant_id
    AND incident_code LIKE 'INC-' || v_year || '-%';

  RETURN 'INC-' || v_year || '-' || lpad(v_next::text, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------
-- 5.2  lookup_staff_by_id
--   Premium staff auto-fill used by the new incident form. The form
--   calls this on blur of the Staff ID input (only when the tenant is
--   premium; the client-side gate is what hides the auto-fill UI for
--   free users). The function is callable by any authenticated SHO
--   because the data it returns is already RLS-scoped to the caller's
--   tenant — this is a UX gate, not a security gate.
--
--   Returns 0 rows when no staff member with that employee_id exists
--   in the caller's tenant; the client treats the empty result as
--   "not found". When 1 row matches, the row carries the staff member's
--   name / department / position / email / is_active flag and their
--   aggregated incident history (total count + last incident date) for
--   the caller's tenant.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lookup_staff_by_id(p_staff_id text)
RETURNS TABLE (
  found                boolean,
  staff_id             text,
  full_name            text,
  department           text,
  "position"             text,
  email                text,
  is_active            boolean,
  total_incidents      bigint,
  last_incident_date   date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    true,
    s.employee_id,
    s.full_name,
    s.department,
    s."position",
    s.email::text,
    s.is_active,
    (SELECT COUNT(*) FROM incidents i
       WHERE i.tenant_id = get_my_tenant_id()
         AND i.staff_id = s.employee_id),
    (SELECT MAX(i.incident_date::date) FROM incidents i
       WHERE i.tenant_id = get_my_tenant_id()
         AND i.staff_id = s.employee_id)
  FROM staff s
  WHERE s.tenant_id = get_my_tenant_id()
    AND s.employee_id = p_staff_id
  LIMIT 1;
$$;

-- =====================================================================
-- 6. ROW LEVEL SECURITY
--    Standard solo-SHO policy: tenant_id = get_my_tenant_id().
-- =====================================================================

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incidents_all_member ON incidents;

CREATE POLICY incidents_all_member ON incidents
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- =====================================================================
-- 7. GRANTS for the new helper functions
-- =====================================================================

GRANT EXECUTE ON FUNCTION next_incident_code()            TO authenticated;
GRANT EXECUTE ON FUNCTION lookup_staff_by_id(text)         TO authenticated;

-- =====================================================================
-- 8. VERIFICATION QUERIES  (run by hand after applying, in psql or
--    Supabase SQL editor with the appropriate role)
-- =====================================================================

-- 8.1  incidents table exists with RLS enabled.
-- ----------------------------------------------------------------------------
-- SELECT tablename, rowsecurity
--   FROM pg_tables
--  WHERE schemaname = 'public' AND tablename = 'incidents';
-- -- EXPECT: 1 row, rowsecurity = true

-- 8.2  incidents has the new column shape.
-- ----------------------------------------------------------------------------
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'incidents'
--  ORDER BY ordinal_position;
-- -- EXPECT (in order):
-- --   id                       uuid
-- --   tenant_id                uuid
-- --   incident_code            text
-- --   recorded_at              timestamptz
-- --   incident_date            timestamptz
-- --   incident_time            time
-- --   victim_name              text
-- --   staff_id                 text
-- --   location_dept            text
-- --   body_part_injured        text
-- --   description              text
-- --   man_days_lost            integer
-- --   severity_type            text
-- --   severity_other           text
-- --   reported_to_jkkp         boolean
-- --   investigation_submitted  boolean
-- --   reported_by              uuid
-- --   created_at               timestamptz
-- --   updated_at               timestamptz

-- 8.3  The two dropped enums are gone.
-- ----------------------------------------------------------------------------
-- SELECT typname FROM pg_type WHERE typname IN ('incident_severity', 'incident_status');
-- -- EXPECT: 0 rows

-- 8.4  Both new functions exist and are SECURITY DEFINER.
-- ----------------------------------------------------------------------------
-- SELECT proname, prosecdef
--   FROM pg_proc
--  WHERE proname IN ('next_incident_code', 'lookup_staff_by_id')
--  ORDER BY proname;
-- -- EXPECT: 2 rows, both prosecdef = true

-- 8.5  incidents has exactly one RLS policy.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS policy_count
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'incidents';
-- -- EXPECT: 1

-- 8.6  Smoke test: next_incident_code returns INC-YYYY-0001 for a fresh
--       tenant (run as an authenticated user with a tenant).
-- ----------------------------------------------------------------------------
-- SELECT next_incident_code();
-- -- EXPECT: INC-<current-year>-0001
-- -- After inserting one row with that code, the next call should
-- -- return INC-<current-year>-0002.

-- 8.7  Smoke test: lookup_staff_by_id returns 0 rows for a missing ID.
-- ----------------------------------------------------------------------------
-- SELECT * FROM lookup_staff_by_id('DOES-NOT-EXIST');
-- -- EXPECT: 0 rows
