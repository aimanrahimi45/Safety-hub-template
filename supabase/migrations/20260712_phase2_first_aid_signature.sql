-- =====================================================================
-- Phase 2.5: First Aid signature column (Supabase Storage URL)
--
-- TARGET: Supabase (Postgres 15+), runs AFTER
--         20260712_phase1a_solo_sho.sql
--         20260712_phase2_storage_setup.sql
--
-- SCOPE OF THIS FILE
--   Adds two columns to first_aid_logs:
--     * signature_url          — text, the public URL of the
--                                signature image stored in the
--                                `signatures` Supabase Storage
--                                bucket.
--     * signature_uploaded_at  — timestamptz, when the signature
--                                was uploaded. Distinct from
--                                created_at because a record may
--                                exist for hours before the
--                                signature is captured (the SHO
--                                first records the incident, then
--                                gets the reporter's signature
--                                later).
--
--   Replaces the prior base64 stub in
--   src/pages/app/first-aid/new.astro. The new form uploads a
--   client-side resized PNG to the `signatures` bucket and stores
--   the resulting URL here.
--
--   The buckets + RLS policies live in
--   20260712_phase2_storage_setup.sql.
--
-- IDEMPOTENCY
--   ADD COLUMN IF NOT EXISTS makes this safe to re-run.
-- =====================================================================

ALTER TABLE first_aid_logs
  ADD COLUMN IF NOT EXISTS signature_url         text,
  ADD COLUMN IF NOT EXISTS signature_uploaded_at timestamptz;

-- =====================================================================
-- VERIFICATION QUERIES  (run by hand after applying)
-- =====================================================================

-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'first_aid_logs'
--    AND column_name IN ('signature_url', 'signature_uploaded_at')
--  ORDER BY column_name;
-- -- EXPECT: 2 rows; signature_url text, signature_uploaded_at timestamptz
