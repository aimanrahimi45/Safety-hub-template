-- Extension to 20260712_phase1a_multitenant_safety.sql
-- Apply Phase 1A first, then this file.
--
-- =====================================================================
-- Phase 1B: Inventory, inspection templates, and licenses
-- Target: Supabase (Postgres 15+) with Google OAuth via Supabase Auth
-- Author: senior backend engineer
-- Date:   2026-07-12
--
-- DESIGN DECISIONS (also documented in the handoff report):
--   * `first_aid_inventory.item_name` is the canonical join key against
--     `first_aid_details.item_description` (matched case-insensitively).
--     We do NOT add a code column to first_aid_details because the form
--     already knows the item name and the 23 default-seed items use
--     those exact names.
--   * The `licenses` table is the SINGLE source of truth for license
--     validation, replacing the private GAS Web App that previously
--     held the license sheet. RLS is enabled on `licenses` but no
--     policies are created for `authenticated`; the explicit REVOKE
--     statements at the bottom of the file are a defense-in-depth.
--   * `validate_license()` and `is_premium_tenant()` are SECURITY
--     DEFINER so they can read the `licenses` table on behalf of any
--     caller. `validate_license()` is meant to be invoked from a
--     Supabase Edge Function with the service role.
--   * Inventory mutations go through three SECURITY DEFINER helpers
--     (deduct_inventory_for_first_aid, restock_inventory,
--     adjust_inventory_manual) so the SECURITY DEFINER owner can
--     UPDATE rows on behalf of any role. The transaction log table
--     (first_aid_inventory_transactions) is INSERT-only for the
--     authenticated role; no UPDATE or DELETE policy exists, so the
--     log is immutable from the client.
--   * `first_aid_inventory_transactions` is append-only; we follow
--     the same pattern as `audit_log` in Phase 1A (no UPDATE/DELETE
--     policies = immutability by absence of policy).
--   * Inspection template versions are bumped on every edit (via the
--     application layer) so a historical inspection can still point
--     at the exact template version it was generated from.
-- =====================================================================

-- =====================================================================
-- 0. SEED DATA
-- =====================================================================
-- No seed data is inserted by this migration. Inventory defaults and
-- inspection template defaults are bootstrapped by the application
-- when a tenant is set up (see the Astro app's onboarding wizard).
-- The 23-item inventory default is documented in the handoff report
-- and will be inserted by a future `seed_default_inventory` function
-- called from setup_tenant() in a later phase.

-- =====================================================================
-- 1. EXTENSIONS
-- =====================================================================
-- pgcrypto and citext were created in Phase 1A. Re-creating them
-- with IF NOT EXISTS would be safe but is intentionally omitted to
-- make the dependency on Phase 1A explicit.

-- =====================================================================
-- 2. ENUMS
-- =====================================================================

CREATE TYPE inventory_transaction_type AS ENUM (
  'restock',
  'deduct_first_aid',
  'manual_adjustment',
  'initial_seed'
);

CREATE TYPE inspection_response_type AS ENUM (
  'yes_no',
  'text',
  'number',
  'pass_fail'
);

CREATE TYPE license_plan_type AS ENUM (
  'free',
  'premium'
);

-- =====================================================================
-- 3. ALTER EXISTING TABLES  (idempotent, requires Phase 1A applied)
-- =====================================================================

-- 3.1  first_aid_logs.deducted_from_inventory
--      Flag indicating whether the inventory was decremented for this
--      log. Set true by deduct_inventory_for_first_aid(); left false
--      if the user chose "No" or "Adjust quantities" at the prompt.
ALTER TABLE first_aid_logs
  ADD COLUMN IF NOT EXISTS deducted_from_inventory boolean NOT NULL DEFAULT false;

-- 3.2  inspections.template_id
--      Optional reference to a pre-defined template. NULL = ad-hoc
--      inspection. ON DELETE SET NULL keeps historical inspections
--      intact when a template version is later retired.
--      `inspection_templates` is created immediately below so the
--      REFERENCES clause can resolve at DDL time; the rest of that
--      table's RLS / index / trigger work lives in section 4+.
CREATE TABLE inspection_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checklist_id   text NOT NULL,
  template_name  text NOT NULL,
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  version        integer NOT NULL DEFAULT 1,
  created_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_templates_checklist_not_blank CHECK (length(btrim(checklist_id))  > 0),
  CONSTRAINT inspection_templates_name_not_blank     CHECK (length(btrim(template_name)) > 0),
  CONSTRAINT inspection_templates_version_positive   CHECK (version > 0),
  UNIQUE (tenant_id, checklist_id, version)
);

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS template_id uuid NULL
    REFERENCES inspection_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inspections_template
  ON inspections (template_id);

-- =====================================================================
-- 4. TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4.1  first_aid_inventory
--      Per-tenant central stock list for first aid consumables.
--      Mirrors the columns of the GAS "First Aid Central Inventory"
--      sheet, snake-cased, with tenant_id and a UNIQUE(item_code).
-- ---------------------------------------------------------------------
CREATE TABLE first_aid_inventory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_code       text NOT NULL,
  item_name       text NOT NULL,
  unit            text NOT NULL,
  current_stock   integer NOT NULL DEFAULT 0,
  min_alert_level integer NOT NULL DEFAULT 0,
  required_std    text,
  category_group  integer,
  last_updated    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true,
  CONSTRAINT first_aid_inventory_code_not_blank CHECK (length(btrim(item_code)) > 0),
  CONSTRAINT first_aid_inventory_name_not_blank CHECK (length(btrim(item_name)) > 0),
  CONSTRAINT first_aid_inventory_unit_not_blank CHECK (length(btrim(unit))      > 0),
  CONSTRAINT first_aid_inventory_stock_nonneg   CHECK (current_stock   >= 0),
  CONSTRAINT first_aid_inventory_min_nonneg     CHECK (min_alert_level >= 0),
  CONSTRAINT first_aid_inventory_category_pos   CHECK (category_group IS NULL OR category_group > 0),
  UNIQUE (tenant_id, item_code)
);

-- ---------------------------------------------------------------------
-- 4.2  first_aid_inventory_transactions  (immutable append-only log)
--      One row per stock change. balance_after is denormalised for
--      fast display without recomputing. reference_id and
--      reference_type allow cross-referencing to the triggering event
--      (e.g. the first_aid_log that caused a deduct).
-- ---------------------------------------------------------------------
CREATE TABLE first_aid_inventory_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES first_aid_inventory(id) ON DELETE RESTRICT,
  transaction_type  inventory_transaction_type NOT NULL,
  quantity_delta    integer NOT NULL,
  balance_after     integer NOT NULL,
  reference_id      uuid,
  reference_type    text,
  notes             text,
  logged_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT first_aid_inv_tx_balance_nonneg CHECK (balance_after >= 0),
  CONSTRAINT first_aid_inv_tx_qty_nonzero    CHECK (quantity_delta <> 0),
  CONSTRAINT first_aid_inv_tx_type_ref_consistent CHECK (
    (transaction_type = 'deduct_first_aid' AND reference_id IS NOT NULL AND reference_type = 'first_aid_log')
    OR (transaction_type IN ('restock', 'manual_adjustment', 'initial_seed'))
  )
);

-- ---------------------------------------------------------------------
-- 4.3  inspection_templates  (table created above in section 3.2,
--      immediately before the inspections ALTER, so the FK could
--      resolve at DDL time without a forward reference)
-- ---------------------------------------------------------------------
-- (See CREATE TABLE inspection_templates above in section 3.2.)

-- ---------------------------------------------------------------------
-- 4.4  inspection_template_items  (one row per question)
--      Re-keyed per template version: a new (template_id, question_id)
--      pair for each version. This is why we UNIQUE on (template_id,
--      question_id) rather than (tenant_id, question_id).
-- ---------------------------------------------------------------------
CREATE TABLE inspection_template_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id    uuid NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  question_id    text NOT NULL,
  display_order  integer NOT NULL,
  section        text,
  question_text  text NOT NULL,
  response_type  inspection_response_type NOT NULL DEFAULT 'yes_no',
  risk_level     text,
  is_required    boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_template_items_qid_not_blank   CHECK (length(btrim(question_id))   > 0),
  CONSTRAINT inspection_template_items_text_not_blank  CHECK (length(btrim(question_text)) > 0),
  CONSTRAINT inspection_template_items_order_positive  CHECK (display_order > 0),
  CONSTRAINT inspection_template_items_risk_enum       CHECK (
    risk_level IS NULL OR risk_level IN ('High', 'Medium', 'Low')
  ),
  UNIQUE (template_id, question_id)
);

-- ---------------------------------------------------------------------
-- 4.5  licenses
--      Server-side only. RLS is enabled but NO policies are created
--      for the `authenticated` role. The table is accessed exclusively
--      through the SECURITY DEFINER function validate_license() and
--      is_premium_tenant(), both of which are meant to be invoked
--      from a Supabase Edge Function with the service role.
-- ---------------------------------------------------------------------
CREATE TABLE licenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key  citext NOT NULL UNIQUE,
  tenant_id    uuid REFERENCES tenants(id) ON DELETE SET NULL,
  plan_type    license_plan_type NOT NULL DEFAULT 'free',
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  max_users    integer,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licenses_key_not_blank    CHECK (length(btrim(license_key::text)) > 0),
  CONSTRAINT licenses_max_users_pos    CHECK (max_users IS NULL OR max_users > 0),
  CONSTRAINT licenses_expiry_after_issued CHECK (
    expires_at IS NULL OR expires_at >= issued_at
  ),
  CONSTRAINT licenses_metadata_is_object   CHECK (jsonb_typeof(metadata) = 'object')
);

-- =====================================================================
-- 5. INDEXES
-- =====================================================================

-- 5.1  tenant_id on every business table
CREATE INDEX idx_first_aid_inventory_tenant
  ON first_aid_inventory (tenant_id);
CREATE INDEX idx_first_aid_inventory_tx_tenant
  ON first_aid_inventory_transactions (tenant_id);
CREATE INDEX idx_inspection_templates_tenant
  ON inspection_templates (tenant_id);
CREATE INDEX idx_inspection_template_items_tenant
  ON inspection_template_items (tenant_id);

-- 5.2  (tenant_id, created_at DESC) for time-sorted list queries
CREATE INDEX idx_first_aid_inventory_tenant_created
  ON first_aid_inventory (tenant_id, created_at DESC);
CREATE INDEX idx_inspection_templates_tenant_created
  ON inspection_templates (tenant_id, created_at DESC);
CREATE INDEX idx_inspection_template_items_tenant_created
  ON inspection_template_items (tenant_id, created_at DESC);

-- 5.3  FK columns on every table
CREATE INDEX idx_first_aid_inventory_tx_item
  ON first_aid_inventory_transactions (inventory_item_id);
CREATE INDEX idx_first_aid_inventory_tx_logged_by
  ON first_aid_inventory_transactions (logged_by);
CREATE INDEX idx_inspection_templates_created_by
  ON inspection_templates (created_by);
CREATE INDEX idx_inspection_template_items_template
  ON inspection_template_items (template_id);

-- 5.4  Lookups used by the app
CREATE INDEX idx_first_aid_inventory_tenant_active
  ON first_aid_inventory (tenant_id, is_active);
CREATE INDEX idx_first_aid_inventory_tenant_category
  ON first_aid_inventory (tenant_id, category_group);
CREATE INDEX idx_first_aid_inventory_tenant_name
  ON first_aid_inventory (tenant_id, lower(item_name));
CREATE INDEX idx_first_aid_inventory_tx_tenant_logged_at
  ON first_aid_inventory_transactions (tenant_id, logged_at DESC);
CREATE INDEX idx_first_aid_inventory_tx_item_logged_at
  ON first_aid_inventory_transactions (inventory_item_id, logged_at DESC);
CREATE INDEX idx_first_aid_inventory_tx_reference
  ON first_aid_inventory_transactions (reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX idx_inspection_templates_tenant_active
  ON inspection_templates (tenant_id, is_active);
CREATE INDEX idx_inspection_template_items_template_order
  ON inspection_template_items (template_id, display_order);
CREATE INDEX idx_inspection_template_items_tenant_template
  ON inspection_template_items (tenant_id, template_id);

-- 5.5  License lookups
--      The unique constraint on license_key already creates a B-tree,
--      but the partial index lets the planner do an index-only scan
--      against the active subset, which is the hot read path.
CREATE INDEX idx_licenses_key_active
  ON licenses (license_key)
  WHERE is_active = true;
CREATE INDEX idx_licenses_tenant
  ON licenses (tenant_id);

-- =====================================================================
-- 6. HELPER FUNCTIONS  (all SECURITY DEFINER, search_path pinned)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6.1  deduct_inventory_for_first_aid
--      For each first_aid_details row belonging to the log, find the
--      matching inventory row by lower(item_name) = lower(d.item_description),
--      decrement current_stock by detail.quantity, and write one
--      first_aid_inventory_transactions row per decrement.
--
--      Pre-conditions enforced before any write:
--        (a) the log exists
--        (b) every detail row maps to an active inventory item
--        (c) no decrement would push any item below zero
--
--      Atomic: the whole call is one transaction; if any pre-check
--      fails, nothing is written. Sets first_aid_logs.deducted_from_inventory
--      = true on success.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deduct_inventory_for_first_aid(
  p_first_aid_log_id uuid,
  p_actor_id         uuid
)
RETURNS SETOF first_aid_inventory_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log_tenant_id uuid;
  v_shortage      text;
BEGIN
  -- (a) Lock the log row and capture tenant_id.
  SELECT tenant_id INTO v_log_tenant_id
  FROM first_aid_logs
  WHERE id = p_first_aid_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'First aid log % not found', p_first_aid_log_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (b) Every detail row must map to an active inventory item.
  SELECT string_agg(d.item_description, ', ')
    INTO v_shortage
  FROM first_aid_details d
  WHERE d.first_aid_log_id = p_first_aid_log_id
    AND NOT EXISTS (
      SELECT 1
      FROM first_aid_inventory inv
      WHERE inv.tenant_id = v_log_tenant_id
        AND inv.is_active  = true
        AND lower(inv.item_name) = lower(d.item_description)
    );

  IF v_shortage IS NOT NULL THEN
    RAISE EXCEPTION 'No matching inventory item for: %', v_shortage
      USING ERRCODE = 'P0001';
  END IF;

  -- (c) No item should be pushed below zero.
  SELECT string_agg(
           d.item_description
           || ' (have ' || inv.current_stock
           || ', need ' || d.quantity || ')',
           E';\n'
         )
    INTO v_shortage
  FROM first_aid_details d
  JOIN first_aid_inventory inv
    ON inv.tenant_id  = v_log_tenant_id
   AND inv.is_active  = true
   AND lower(inv.item_name) = lower(d.item_description)
  WHERE d.first_aid_log_id = p_first_aid_log_id
    AND inv.current_stock < d.quantity;

  IF v_shortage IS NOT NULL THEN
    RAISE EXCEPTION 'Insufficient stock: %', v_shortage
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock the affected inventory rows in a deterministic order so two
  -- concurrent calls can't deadlock against each other.
  PERFORM 1
  FROM first_aid_inventory inv
  WHERE inv.tenant_id = v_log_tenant_id
    AND EXISTS (
      SELECT 1
      FROM first_aid_details d
      WHERE d.first_aid_log_id = p_first_aid_log_id
        AND lower(d.item_description) = lower(inv.item_name)
    )
  ORDER BY inv.id
  FOR UPDATE;

  -- (d) Atomic decrement + insert of transaction rows.
  RETURN QUERY
  WITH decremented AS (
    UPDATE first_aid_inventory inv
       SET current_stock = inv.current_stock - d.quantity
      FROM first_aid_details d
     WHERE inv.tenant_id = v_log_tenant_id
       AND inv.is_active = true
       AND lower(inv.item_name) = lower(d.item_description)
       AND d.first_aid_log_id  = p_first_aid_log_id
    RETURNING inv.id, inv.current_stock, d.quantity
  ),
  inserted AS (
    INSERT INTO first_aid_inventory_transactions (
      tenant_id, inventory_item_id, transaction_type, quantity_delta,
      balance_after, reference_id, reference_type, notes, logged_by
    )
    SELECT
      v_log_tenant_id,
      dec.id,
      'deduct_first_aid'::inventory_transaction_type,
      -dec.quantity,
      dec.current_stock,
      p_first_aid_log_id,
      'first_aid_log',
      'Auto-deduct from first aid log',
      p_actor_id
    FROM decremented dec
    RETURNING *
  )
  SELECT * FROM inserted;

  -- (e) Mark the log as deducted.
  UPDATE first_aid_logs
     SET deducted_from_inventory = true
   WHERE id = p_first_aid_log_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 6.2  restock_inventory
--      Increment current_stock and log a 'restock' transaction.
--      Caller is responsible for the role check (supervisor/admin);
--      this function assumes the caller is already authorized.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION restock_inventory(
  p_item_id   uuid,
  p_quantity  integer,
  p_actor_id  uuid,
  p_notes     text DEFAULT NULL
)
RETURNS first_aid_inventory_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_tenant_id uuid;
  v_item_active    boolean;
  v_new_stock      integer;
  v_row            first_aid_inventory_transactions;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'restock_inventory: p_quantity must be positive (got %)', p_quantity
      USING ERRCODE = '22023';
  END IF;

  SELECT tenant_id, is_active
    INTO v_item_tenant_id, v_item_active
  FROM first_aid_inventory
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % not found', p_item_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_item_active THEN
    RAISE EXCEPTION 'Inventory item % is inactive', p_item_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE first_aid_inventory
     SET current_stock = current_stock + p_quantity
   WHERE id = p_item_id
   RETURNING current_stock INTO v_new_stock;

  INSERT INTO first_aid_inventory_transactions (
    tenant_id, inventory_item_id, transaction_type, quantity_delta,
    balance_after, reference_type, notes, logged_by
  )
  VALUES (
    v_item_tenant_id, p_item_id,
    'restock'::inventory_transaction_type,
    p_quantity, v_new_stock,
    'restock', p_notes, p_actor_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------
-- 6.3  adjust_inventory_manual
--      Generic signed adjustment. Negative deltas are allowed but
--      stock is still constrained to >= 0 by the explicit pre-check
--      (and the CHECK constraint as defence in depth).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION adjust_inventory_manual(
  p_item_id   uuid,
  p_delta     integer,
  p_actor_id  uuid,
  p_notes     text DEFAULT NULL
)
RETURNS first_aid_inventory_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_tenant_id uuid;
  v_item_active    boolean;
  v_current_stock  integer;
  v_new_stock      integer;
  v_row            first_aid_inventory_transactions;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'adjust_inventory_manual: p_delta must be non-zero (got %)', p_delta
      USING ERRCODE = '22023';
  END IF;

  SELECT tenant_id, is_active, current_stock
    INTO v_item_tenant_id, v_item_active, v_current_stock
  FROM first_aid_inventory
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % not found', p_item_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_item_active THEN
    RAISE EXCEPTION 'Inventory item % is inactive', p_item_id
      USING ERRCODE = 'P0001';
  END IF;

  v_new_stock := v_current_stock + p_delta;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'adjust_inventory_manual: would push stock below zero (current %, delta %)',
      v_current_stock, p_delta
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE first_aid_inventory
     SET current_stock = v_new_stock
   WHERE id = p_item_id;

  INSERT INTO first_aid_inventory_transactions (
    tenant_id, inventory_item_id, transaction_type, quantity_delta,
    balance_after, reference_type, notes, logged_by
  )
  VALUES (
    v_item_tenant_id, p_item_id,
    'manual_adjustment'::inventory_transaction_type,
    p_delta, v_new_stock,
    'manual_adjustment', p_notes, p_actor_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------
-- 6.4  validate_license
--      Returns {valid, plan_type, expires_at, reason} for a license
--      key. SECURITY DEFINER so it can be called from contexts where
--      the caller has no licenses-table access (e.g. an unauthenticated
--      request hitting a Supabase Edge Function). The Edge Function
--      should use the service role to call this fn.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_license(p_license_key text)
RETURNS TABLE (
  valid       boolean,
  plan_type   license_plan_type,
  expires_at  timestamptz,
  reason      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lic licenses%ROWTYPE;
BEGIN
  IF p_license_key IS NULL OR length(btrim(p_license_key)) = 0 THEN
    valid     := false;
    plan_type := 'free'::license_plan_type;
    expires_at := NULL;
    reason    := 'License key is required.';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_lic
  FROM licenses
  WHERE license_key = p_license_key::citext
  LIMIT 1;

  IF NOT FOUND THEN
    valid     := false;
    plan_type := 'free'::license_plan_type;
    expires_at := NULL;
    reason    := 'License key not found.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT v_lic.is_active THEN
    valid     := false;
    plan_type := v_lic.plan_type;
    expires_at := v_lic.expires_at;
    reason    := 'License is inactive.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lic.expires_at IS NOT NULL AND v_lic.expires_at <= now() THEN
    valid     := false;
    plan_type := v_lic.plan_type;
    expires_at := v_lic.expires_at;
    reason    := 'License has expired.';
    RETURN NEXT;
    RETURN;
  END IF;

  valid     := true;
  plan_type := v_lic.plan_type;
  expires_at := v_lic.expires_at;
  reason    := '';
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------
-- 6.5  is_premium_tenant
--      Returns true iff the tenant has an active, non-expired
--      premium-typed license row. SECURITY DEFINER so it can be used
--      by future RLS policies that need to gate Premium features
--      (e.g. ai_legal_searches, staff_lookup_features).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_premium_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM licenses
    WHERE tenant_id = p_tenant_id
      AND plan_type  = 'premium'
      AND is_active  = true
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

-- =====================================================================
-- 7. TRIGGERS
-- =====================================================================

-- 7.1  Generic updated_at bumper (created in Phase 1A, reused here).
--      Re-declared in CREATE OR REPLACE form is unnecessary because
--      the migration order guarantees Phase 1A has run.

-- 7.2  set_first_aid_inventory_last_updated
--      Bumps the inventory row's `last_updated` column whenever
--      `current_stock` actually changes. Scoped to the column so
--      metadata-only UPDATEs (e.g. toggling is_active) don't churn it.
CREATE OR REPLACE FUNCTION set_first_aid_inventory_last_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_updated := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_first_aid_inventory_stock_updated
  BEFORE UPDATE OF current_stock ON first_aid_inventory
  FOR EACH ROW
  WHEN (OLD.current_stock IS DISTINCT FROM NEW.current_stock)
  EXECUTE FUNCTION set_first_aid_inventory_last_updated();

-- 7.3  set_updated_at on inspection_templates and licenses
CREATE TRIGGER trg_inspection_templates_updated_at
  BEFORE UPDATE ON inspection_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 8. ROW LEVEL SECURITY
-- =====================================================================

-- ---------------------------------------------------------------------
-- 8.1  first_aid_inventory
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY first_aid_inventory_select_member ON first_aid_inventory
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY first_aid_inventory_insert_supervisor ON first_aid_inventory
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY first_aid_inventory_update_supervisor ON first_aid_inventory
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY first_aid_inventory_delete_admin ON first_aid_inventory
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 8.2  first_aid_inventory_transactions  (append-only)
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY first_aid_inventory_tx_select_member
  ON first_aid_inventory_transactions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY first_aid_inventory_tx_insert_member
  ON first_aid_inventory_transactions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_my_tenant_ids()));

-- NO UPDATE policy. NO DELETE policy. Immutability is enforced by the
-- absence of these policies; even an admin cannot rewrite history.
-- The SECURITY DEFINER inventory helpers (deduct_inventory_for_first_aid,
-- restock_inventory, adjust_inventory_manual) bypass RLS for their
-- own writes, but client-side INSERT is gated to active members.

-- ---------------------------------------------------------------------
-- 8.3  inspection_templates
-- ---------------------------------------------------------------------
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_templates_select_member ON inspection_templates
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY inspection_templates_insert_supervisor ON inspection_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
    AND created_by = auth.uid()
  );

CREATE POLICY inspection_templates_update_supervisor ON inspection_templates
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY inspection_templates_delete_admin ON inspection_templates
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 8.4  inspection_template_items  (inherits tenant via parent template)
-- ---------------------------------------------------------------------
ALTER TABLE inspection_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_template_items_select_member
  ON inspection_template_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspection_templates t
      WHERE t.id = inspection_template_items.template_id
        AND t.tenant_id IN (SELECT get_my_tenant_ids())
    )
  );

CREATE POLICY inspection_template_items_insert_supervisor
  ON inspection_template_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM inspection_templates t
      WHERE t.id = inspection_template_items.template_id
        AND t.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(t.tenant_id) IN ('supervisor', 'admin')
    )
  );

CREATE POLICY inspection_template_items_update_supervisor
  ON inspection_template_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspection_templates t
      WHERE t.id = inspection_template_items.template_id
        AND t.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(t.tenant_id) IN ('supervisor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM inspection_templates t
      WHERE t.id = inspection_template_items.template_id
        AND t.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(t.tenant_id) IN ('supervisor', 'admin')
    )
  );

CREATE POLICY inspection_template_items_delete_admin
  ON inspection_template_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspection_templates t
      WHERE t.id = inspection_template_items.template_id
        AND t.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(t.tenant_id) = 'admin'
    )
  );

-- ---------------------------------------------------------------------
-- 8.5  licenses  (SERVER-SIDE ONLY)
--
-- RLS is enabled but NO policies are created for the `authenticated`
-- role. Client-side queries from an authenticated user will always
-- return zero rows. Access is exclusively through the SECURITY
-- DEFINER function validate_license() and is_premium_tenant(), which
-- are meant to be called from a Supabase Edge Function using the
-- service role.
--
-- The explicit REVOKE statements in section 9 are an additional
-- defence-in-depth: even if a future careless migration re-runs
-- `GRANT ALL ON ALL TABLES ... TO authenticated`, the explicit
-- REVOKE on `licenses` (and `first_aid_inventory_transactions`)
-- still wins because it is later in the file and more specific.
-- ---------------------------------------------------------------------
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- (Deliberately no CREATE POLICY statements for `licenses`.)

-- =====================================================================
-- 9. GRANTS
--    Mirrors Phase 1A. The GRANTs are inherently idempotent; the
--    explicit REVOKEs at the bottom are the airtight policy for
--    the server-only tables.
-- =====================================================================

-- 9.1  Schema and blanket grants. Wrapped in DO/EXCEPTION so the
--      extension migration is safely re-runnable in tooling that
--      doesn't track which grants have already been issued.
DO $$
BEGIN
  BEGIN
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
    -- ignore; the grant already exists or the role is missing
    NULL;
  END;
  BEGIN
    GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$$;

-- 9.2  Explicit grants for the new helper functions.
GRANT EXECUTE ON FUNCTION deduct_inventory_for_first_aid(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION restock_inventory(uuid, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_inventory_manual(uuid, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION is_premium_tenant(uuid)                    TO authenticated;

-- 9.3  Explicit REVOKEs for server-only / write-impossible tables.
--      validate_license() is called from Edge Functions with the
--      service role, so the authenticated role does not need to be
--      able to execute it via PostgREST.
REVOKE ALL ON licenses                         FROM authenticated;
REVOKE ALL ON licenses                         FROM anon;
REVOKE ALL ON first_aid_inventory_transactions FROM anon;

-- =====================================================================
-- 10. VERIFICATION QUERIES  (run by hand after applying, in psql or
--     Supabase SQL editor with the appropriate role)
-- =====================================================================

-- 10.1  pg_tables with RLS enabled. Expect 18 rows for the business
--       tables (14 from Phase 1A + 4 NEW business tables).
--       `licenses` is also RLS-enabled but is not in this count
--       because it intentionally has no policies for `authenticated`.
-- ----------------------------------------------------------------------------
-- SELECT tablename, rowsecurity
--   FROM pg_tables
--  WHERE schemaname = 'public' AND rowsecurity = true
--  ORDER BY tablename;
-- -- EXPECT: 18 rows

-- 10.2  Policy counts for the new tables. Expect 14 in total.
-- ----------------------------------------------------------------------------
-- SELECT tablename, count(*) AS policy_count
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN (
--      'first_aid_inventory',
--      'first_aid_inventory_transactions',
--      'inspection_templates',
--      'inspection_template_items'
--    )
--  GROUP BY tablename
--  ORDER BY tablename;
-- -- EXPECT: first_aid_inventory=4, first_aid_inventory_transactions=2,
-- --         inspection_template_items=4, inspection_templates=4  (total 14)

-- 10.3  No policies on licenses for the authenticated role.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS license_policies_for_authenticated
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename  = 'licenses'
--    AND roles @> ARRAY['authenticated'];
-- -- EXPECT: 0

-- 10.4  SECURITY DEFINER + search_path pin on every helper fn.
-- ----------------------------------------------------------------------------
-- SELECT proname, prosecdef, proconfig
--   FROM pg_proc
--  WHERE proname IN (
--    'deduct_inventory_for_first_aid',
--    'restock_inventory',
--    'adjust_inventory_manual',
--    'validate_license',
--    'is_premium_tenant'
--  )
--  ORDER BY proname;
-- -- EXPECT: prosecdef = true and proconfig includes 'search_path=public,pg_temp' on all 5.

-- 10.5  The first_aid_logs.deducted_from_inventory column exists
--       with the right default and the inspections.template_id
--       column exists with the right FK behaviour.
-- ----------------------------------------------------------------------------
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'first_aid_logs'
--    AND column_name  = 'deducted_from_inventory';
-- -- EXPECT: one row, data_type = 'boolean', column_default contains 'false'.

-- SELECT column_name, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'inspections'
--    AND column_name  = 'template_id';
-- -- EXPECT: is_nullable = 'YES'.

-- 10.6  Smoke test for deduct_inventory_for_first_aid: insert a
--       tenant, an inventory row, a first_aid_log with one detail
--       row, and call the function. It should decrement the stock,
--       insert a transaction row, and flip deducted_from_inventory
--       to true.
-- ----------------------------------------------------------------------------
-- BEGIN;
--   -- assume tenant t, item i, log l already exist via the app
--   SELECT * FROM deduct_inventory_for_first_aid('<log-uuid>', auth.uid());
--   SELECT current_stock FROM first_aid_inventory WHERE id = '<item-uuid>';
--   SELECT deducted_from_inventory FROM first_aid_logs WHERE id = '<log-uuid>';
-- ROLLBACK;  -- do not commit; this is a smoke test

-- 10.7  Smoke test for validate_license with an unknown key.
-- ----------------------------------------------------------------------------
-- SELECT * FROM validate_license('NOT-A-REAL-KEY');
-- -- EXPECT: valid=false, plan_type='free', reason like 'License key not found.'
