-- =====================================================================
-- Phase 2.4: Supabase Storage buckets + RLS for the solo-SHO app
--
-- TARGET: Supabase (Postgres 15+), runs AFTER
--         20260712_phase1a_solo_sho.sql
--         20260712_phase2_contractors_rebuild.sql
--
-- SCOPE OF THIS FILE
--   Two private storage buckets:
--     * signatures         — used by First Aid signature pads, the
--                            contractor induction signature pad, and
--                            any future module that captures a
--                            signature.
--     * induction-photos   — used by the contractor induction form
--                            to store the optional photo of the
--                            worker being inducted.
--
--   Both buckets are private (public = false). Access is gated by
--   storage.objects RLS policies that key off the first folder
--   component of the object path, which the application sets to the
--   caller's tenant_id.
--
--   Path convention (set by src/lib/storage.ts):
--     {tenant_id}/{filenamePrefix}-{timestamp}.{extension}
--   e.g. a438...e21/photo-1718000000000.jpg
--
--   The RLS policies use storage.foldername(name)[1] to read the
--   first path component and compare it to the calling user's
--   tenant_id. This keeps file access naturally tenant-scoped
--   without any per-file ACLs.
--
--   USAGE NOTES
--     * Run this migration AFTER creating the Supabase project
--       and AFTER running 20260712_phase1a_solo_sho.sql. The
--       tenants table must exist for the RLS subquery to resolve.
--     * The buckets are private by default. If a future release
--       wants to generate signed URLs for printable PDFs, change
--       `public = false` to `public = true` and the existing
--       policies still work (the public URL is then open to the
--       world). For now, all signature access goes through the
--       SHO's authenticated session.
--     * The SHO client uses supabase.storage.from(bucket).upload
--       with `upsert: false`. File names therefore must be unique
--       per tenant; the timestamp prefix in src/lib/storage.ts
--       guarantees this.
--
-- IDEMPOTENCY
--   ON CONFLICT DO NOTHING for the bucket inserts; CREATE POLICY
--   is preceded by DROP POLICY IF EXISTS.
-- =====================================================================

-- =====================================================================
-- 1. Create the two buckets
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('signatures',       'signatures',       false),
  ('induction-photos', 'induction-photos', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 2. RLS policies on storage.objects
--    Keyed off the first path component being equal to the calling
--    user's tenant_id. Reuses the same solo-SHO pattern as the rest
--    of the app: authenticated, owner-scoped, no role variants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2.1  signatures — SELECT
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "select_own_tenant_files_signatures" ON storage.objects;

CREATE POLICY "select_own_tenant_files_signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2.2  signatures — INSERT
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "insert_own_tenant_files_signatures" ON storage.objects;

CREATE POLICY "insert_own_tenant_files_signatures" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2.3  signatures — UPDATE
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "update_own_tenant_files_signatures" ON storage.objects;

CREATE POLICY "update_own_tenant_files_signatures" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2.4  signatures — DELETE
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "delete_own_tenant_files_signatures" ON storage.objects;

CREATE POLICY "delete_own_tenant_files_signatures" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2.5  induction-photos — SELECT
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "select_own_tenant_files_photos" ON storage.objects;

CREATE POLICY "select_own_tenant_files_photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'induction-photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2.6  induction-photos — INSERT
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "insert_own_tenant_files_photos" ON storage.objects;

CREATE POLICY "insert_own_tenant_files_photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'induction-photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2.7  induction-photos — UPDATE
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "update_own_tenant_files_photos" ON storage.objects;

CREATE POLICY "update_own_tenant_files_photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'induction-photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'induction-photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2.8  induction-photos — DELETE
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "delete_own_tenant_files_photos" ON storage.objects;

CREATE POLICY "delete_own_tenant_files_photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'induction-photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM tenants WHERE owner_user_id = auth.uid())
  );

-- =====================================================================
-- 3. VERIFICATION QUERIES  (run by hand after applying)
-- =====================================================================

-- 3.1  Both buckets exist and are private.
-- ----------------------------------------------------------------------------
-- SELECT id, name, public FROM storage.buckets
--  WHERE id IN ('signatures', 'induction-photos')
--  ORDER BY id;
-- -- EXPECT: 2 rows, public = false for both

-- 3.2  Exactly 8 policies on storage.objects for our 2 buckets.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS policy_count
--   FROM pg_policies
--  WHERE schemaname = 'storage'
--    AND tablename  = 'objects'
--    AND policyname LIKE '%signatures%' OR policyname LIKE '%photos%';
-- -- EXPECT: 8
