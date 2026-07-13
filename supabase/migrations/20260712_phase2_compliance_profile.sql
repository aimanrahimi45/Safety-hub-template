-- =====================================================================
-- Phase 2 — Compliance profile columns
-- Target: Supabase (Postgres 15+) — extends the existing `tenants` table
--          created by 20260712_phase1a_solo_sho.sql.
-- Author: senior full-stack engineer (Phase 2.7 — Compliance page)
-- Date:   2026-07-13
--
-- SCOPE
--   * Adds 10 columns to `tenants` that drive the "Setup Profiler" tab
--     and, by extension, the "Active Checklist" (compliance register)
--     tab on the Compliance page. The user's site baseline is captured
--     here and used to match relevant OSH obligations from the public
--     legal Supabase (Project A) via vector search.
--
--   * Industry is a free-text column. The legacy dropdown values are:
--       'other'         (General Offices & Services)
--       'manufacturing'
--       'construction'
--       'shipbuilding'
--       'utilities'
--       'agriculture'
--
--   * Operations is a text array. Allowed values are:
--       'heights', 'confined', 'chemicals', 'machinery',
--       'gig', 'petroleum', 'transport', 'noise',
--       'lifting', 'toxic', 'radiation'
--
--   * No new table. No RLS changes. RLS already covers `tenants`
--     (select/update only by the owner_user_id). RLS continues to
--     enforce that the SHO can only read/write their own row.
--
--   * These fields power the register-generation call. They are NOT
--     directly used by any RLS policy or SECURITY DEFINER function.
-- =====================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS industry         text,
  ADD COLUMN IF NOT EXISTS headcount        integer CHECK (headcount IS NULL OR headcount >= 0),
  ADD COLUMN IF NOT EXISTS hazard_noise     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hazard_chemicals boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hazard_machinery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hazard_lifting   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hazard_toxic     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hazard_radiation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS operations       text[]   NOT NULL DEFAULT '{}';

-- =====================================================================
-- VERIFICATION (run manually after migration; commented out)
-- =====================================================================
-- SELECT attname, format_type(atttypid, atttypmod) AS type, attnotnull
-- FROM   pg_attribute
-- WHERE  attrelid = 'tenants'::regclass
--    AND attname IN (
--      'industry', 'headcount',
--      'hazard_noise', 'hazard_chemicals', 'hazard_machinery',
--      'hazard_lifting', 'hazard_toxic', 'hazard_radiation',
--      'operations'
--    )
-- ORDER BY attname;
-- Expected: 10 rows, all NOT NULL = true except industry, headcount
-- =====================================================================
