-- =====================================================================
-- Phase 2.6: Inspections module rebuild
-- Date:   2026-07-12
--
-- SCOPE OF THIS FILE
--   Brings the inspections schema in line with the legacy AmerisPro
--   audit model captured in dist/inspection.html and the GAS code in
--   Safety_Hub_Backend.js (saveInspectionAudit, lines 1211-1285).
--   Every change is idempotent so this file can be re-run safely.
--
-- WHAT THIS FIXES (vs. the Phase 1A baseline)
--   1. The inspection_response_type enum did not include 'dropdown',
--      even though the legacy supports Dropdown questions with custom
--      options.
--   2. inspection_template_items had no column to hold Dropdown options.
--   3. inspections was missing audit_code, auditor_name, auditor_position,
--      signature_url, signature_uploaded_at.
--   4. inspection_items was missing question_id and response_value (the
--      legacy "Answer" / "Question ID" columns).
--   5. inspection_items.status had a CHECK constraint that only accepted
--      'pass'/'fail'/'na'/'n/a' — the new flow writes free text
--      ("Yes", "No", numbers, free text). The column is kept for
--      backward compat; new writes go to response_value.
--   6. inspections.status (the inspection_status enum) was over-
--      engineered. The "is done" indicator is now
--      inspections.completed_date IS NOT NULL. The enum is left in
--      place for a future "scheduled inspections" feature, but a
--      comment documents that it is not actively used today.
--   7. A new next_audit_code() SECURITY DEFINER function generates
--      "INS-XXXXX" audit codes per tenant.
-- =====================================================================

-- =====================================================================
-- 1. EXTEND inspection_response_type ENUM WITH 'dropdown'
--    ADD VALUE IF NOT EXISTS is safe to re-run. Postgres does not
--    support removing enum values, so this is a forward-only change.
-- =====================================================================
ALTER TYPE inspection_response_type ADD VALUE IF NOT EXISTS 'dropdown';

-- =====================================================================
-- 2. ADD options COLUMN TO inspection_template_items
--    Stores a comma-separated list of options for response_type =
--    'dropdown' (e.g. "Pass, Fail, Pending"). NULL for non-dropdown
--    items; the calling code decides whether to split.
-- =====================================================================
ALTER TABLE inspection_template_items
  ADD COLUMN IF NOT EXISTS options text;

COMMENT ON COLUMN inspection_template_items.options IS
  'Comma-separated choices, used when response_type = ''dropdown''. Example: ''Pass, Fail, Pending''.';

-- =====================================================================
-- 3. ADD 5 MISSING COLUMNS TO inspections
--    audit_code is the human-friendly "INS-XXXXX" identifier shown in
--    the UI. UNIQUE(tenant_id, audit_code) so two tenants can both have
--    INS-00001 without colliding.
-- =====================================================================
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS audit_code             text,
  ADD COLUMN IF NOT EXISTS auditor_name           text,
  ADD COLUMN IF NOT EXISTS auditor_position       text,
  ADD COLUMN IF NOT EXISTS signature_url          text,
  ADD COLUMN IF NOT EXISTS signature_uploaded_at  timestamptz;

-- Postgres does not support ADD CONSTRAINT IF NOT EXISTS, so guard
-- the constraint creation in a DO block. Safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inspections_audit_code_unique'
  ) THEN
    ALTER TABLE inspections
      ADD CONSTRAINT inspections_audit_code_unique
      UNIQUE (tenant_id, audit_code);
  END IF;
END $$;

-- Backfill audit_code for any pre-existing rows so the UNIQUE
-- constraint can be created. Phase 2.6 ships with no data, but this
-- is defensive for later runs.
DO $$
DECLARE
  v_row record;
  v_next integer;
BEGIN
  FOR v_row IN
    SELECT id, tenant_id
    FROM inspections
    WHERE audit_code IS NULL
    ORDER BY tenant_id, created_at
  LOOP
    SELECT COALESCE(MAX(CAST(substring(audit_code FROM 'INS-([0-9]+)') AS integer)), 0) + 1
      INTO v_next
      FROM inspections
      WHERE tenant_id = v_row.tenant_id
        AND audit_code ~ '^INS-[0-9]+$';
    UPDATE inspections
       SET audit_code = 'INS-' || lpad(v_next::text, 5, '0')
     WHERE id = v_row.id;
  END LOOP;
END $$;

-- =====================================================================
-- 4. DROP THE OVERLY-RESTRICTIVE CHECK CONSTRAINT ON inspection_items
--    The old constraint only allowed status = 'pass'|'fail'|'na'|'n/a'.
--    The new flow writes the answer to response_value (free text:
--    "Yes", "No", "N/A", "Pass", a number, or free text). status is
--    kept for backward compat but is no longer the source of truth.
-- =====================================================================
ALTER TABLE inspection_items DROP CONSTRAINT IF EXISTS inspection_items_status_enum;

-- =====================================================================
-- 5. ADD 2 MISSING COLUMNS TO inspection_items
--    question_id mirrors the template's question_id (e.g. "Q-01").
--    response_value is the actual answer (free text — Yes / No / N/A /
--    a Pass/Fail choice / a number / a dropdown option / free text).
-- =====================================================================
ALTER TABLE inspection_items
  ADD COLUMN IF NOT EXISTS question_id    text,
  ADD COLUMN IF NOT EXISTS response_value text;

-- =====================================================================
-- 6. DOCUMENT THE UNUSED inspection_status ENUM
--    inspections.status (the inspection_status enum) is kept for
--    backward compatibility but is NOT actively used. The "is done"
--    indicator is inspections.completed_date IS NOT NULL. Submissions
--    from the conduct form directly create a row with completed_date
--    = today and skip the status workflow. A future "scheduled
--    inspections" feature may use this enum.
-- =====================================================================
COMMENT ON COLUMN inspections.status IS
  'Reserved for future schedule feature; currently always defaults to scheduled. Use completed_date IS NOT NULL to check if audit is done.';

-- =====================================================================
-- 7. next_audit_code() — SECURITY DEFINER, per-tenant sequence
--    Returns the next "INS-XXXXX" code for the calling user's tenant.
--    Refuses to run for unauthenticated callers (no tenant context).
--    Pattern matches the existing get_my_tenant_id() helper.
-- =====================================================================
CREATE OR REPLACE FUNCTION next_audit_code()
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
    RAISE EXCEPTION 'next_audit_code: caller has no tenant'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(CAST(substring(audit_code FROM 'INS-([0-9]+)') AS integer)), 0) + 1
    INTO v_next
    FROM inspections
   WHERE tenant_id = v_tenant_id
     AND audit_code ~ '^INS-[0-9]+$';

  RETURN 'INS-' || lpad(v_next::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION next_audit_code() TO authenticated;

-- =====================================================================
-- 8. VERIFICATION HINTS (commented out — uncomment to spot-check)
--    Run after this migration:
--
--    -- Enum should now have 5 values.
--    SELECT enumlabel
--    FROM pg_enum
--    WHERE enumtypid = 'inspection_response_type'::regtype
--    ORDER BY enumsortorder;
--    -- Expected: yes_no, text, number, pass_fail, dropdown
--
--    -- next_audit_code should be SECURITY DEFINER and search_path
--    -- should be locked to {public, pg_temp}.
--    SELECT proname, prosecdef, proconfig
--    FROM pg_proc
--    WHERE proname = 'next_audit_code';
--    -- Expected: 1 row, prosecdef = true,
--    --           proconfig = {"search_path=public,pg_temp"}
--
--    -- Smoke test: should return 'INS-00001' for a fresh tenant.
--    SELECT next_audit_code();
-- =====================================================================
