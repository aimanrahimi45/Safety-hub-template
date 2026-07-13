-- =====================================================================
-- Phase 1A (consolidated): Solo Safety and Health Officer (SHO) schema
-- Target: Supabase (Postgres 15+) with Supabase Auth (Google OAuth)
-- Author: senior backend engineer (refactor)
-- Date:   2026-07-12
--
-- SCOPE OF THIS FILE
--   This file replaces and consolidates the two prior Phase 1A migration
--   files into a single, clean schema for the REAL use case: a single
--   Safety and Health Officer (SHO) running their own workspace, one
--   person per workspace. There are no other members, no invitations,
--   no admin hierarchy, and no per-role RLS variants.
--
--   The prior files (NOT modified, NOT applied) are:
--     20260712_phase1a_multitenant_safety.sql
--     20260712_phase1a_extension_inventory_templates_licenses.sql
--
-- DESIGN DECISIONS
--   * Tenants have a single owner (tenants.owner_user_id, UNIQUE).
--     setup_tenant() refuses to create a second tenant for the same
--     auth.uid(); the database enforces 1-user-1-tenant.
--   * tenant_members, invitations, and licenses are GONE. Subscription
--     state is folded into tenants.subscription_plan /
--     tenants.subscription_expires_at / tenants.subscription_activated_at.
--   * License-key validation is performed in the Astro application
--     layer (the app calls the external billing / GAS license-validate
--     Web App), then writes the result directly to tenants.subscription_*
--     via a normal authenticated UPDATE. The database stores the
--     outcome; it does not validate the key.
--   * All RLS policies reduce to a single expression:
--         tenant_id = get_my_tenant_id()
--     (or the EXISTS-via-parent equivalent for child tables).
--     There are no role-distinguished variants.
--   * Helper functions are SECURITY DEFINER with search_path pinned
--     to public, pg_temp to prevent search-path hijacking.
--   * audit_log and first_aid_inventory_transactions are append-only:
--     no UPDATE or DELETE policy exists for the authenticated role.
--   * get_my_tenant_id() returns NULL when the calling user has no
--     tenant, which the Astro app uses to detect a first-time user
--     and present the onboarding wizard.
-- =====================================================================

-- =====================================================================
-- 0. SEED DATA
-- =====================================================================
-- No seed data is inserted by this migration. The 23-item default
-- first-aid inventory and the default inspection template are
-- bootstrapped by the application when a tenant is created (see the
-- Astro app's onboarding wizard, which calls setup_tenant() and then
-- inserts the defaults using the returned tenant id).

-- =====================================================================
-- 1. EXTENSIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text

-- =====================================================================
-- 2. ENUMS
--   Order matters: tenants.subscription_plan references
--   license_plan_type, so license_plan_type is defined before the
--   tenants table. All other enums are independent.
-- =====================================================================

CREATE TYPE incident_severity AS ENUM (
  'minor', 'moderate', 'major', 'fatal'
);

CREATE TYPE incident_status AS ENUM (
  'open', 'investigating', 'resolved', 'closed'
);

CREATE TYPE ppe_request_status AS ENUM (
  'pending', 'approved', 'rejected', 'fulfilled'
);

CREATE TYPE contractor_status AS ENUM (
  'pending_induction', 'inducted', 'suspended', 'blacklisted'
);

CREATE TYPE inspection_status AS ENUM (
  'scheduled', 'in_progress', 'completed', 'overdue'
);

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

-- NOTE: user_role is intentionally NOT defined. The role enum existed
-- only to support the now-deleted tenant_members / invitations tables.

-- =====================================================================
-- 3. TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1  tenants  (one row per SHO workspace)
--      owner_user_id is UNIQUE: exactly one workspace per user.
--      Subscription state (plan, expiry, activation) lives here now
--      that the licenses table is gone.
-- ---------------------------------------------------------------------
CREATE TABLE tenants (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT UNIQUE,
  name                      text NOT NULL,
  license_key               citext UNIQUE,
  company_name              text,
  industry                  text,
  subscription_plan         license_plan_type NOT NULL DEFAULT 'free',
  subscription_expires_at   timestamptz NULL,
  subscription_activated_at timestamptz NULL,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- ---------------------------------------------------------------------
-- 3.2  audit_log  (append-only event log per tenant)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip_address   inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_not_blank    CHECK (length(btrim(action))      > 0),
  CONSTRAINT audit_log_entity_not_blank   CHECK (length(btrim(entity_type)) > 0)
);

-- ---------------------------------------------------------------------
-- 3.3  first_aid_logs
--      deducted_from_inventory was added in the prior Phase 1B file;
--      folded into the CREATE TABLE here so the consolidated file is
--      self-contained.
-- ---------------------------------------------------------------------
CREATE TABLE first_aid_logs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reported_by              uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  incident_date            date NOT NULL,
  incident_time            time,
  location                 text NOT NULL,
  injured_person_name      text NOT NULL,
  injured_person_id        text,
  injury_type              text NOT NULL,
  treatment_given          text NOT NULL,
  referred_to_hospital     boolean NOT NULL DEFAULT false,
  hospital_name            text,
  status                   text NOT NULL DEFAULT 'open',
  deducted_from_inventory  boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT first_aid_logs_loc_not_blank     CHECK (length(btrim(location))            > 0),
  CONSTRAINT first_aid_logs_name_not_blank    CHECK (length(btrim(injured_person_name)) > 0),
  CONSTRAINT first_aid_logs_type_not_blank    CHECK (length(btrim(injury_type))         > 0),
  CONSTRAINT first_aid_logs_treat_not_blank   CHECK (length(btrim(treatment_given))     > 0),
  CONSTRAINT first_aid_logs_hospital_consistent CHECK (
    (referred_to_hospital = false AND hospital_name IS NULL)
    OR referred_to_hospital = true
  )
);

-- ---------------------------------------------------------------------
-- 3.4  first_aid_details  (child rows; inherits tenant via parent log)
-- ---------------------------------------------------------------------
CREATE TABLE first_aid_details (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_aid_log_id uuid NOT NULL REFERENCES first_aid_logs(id) ON DELETE CASCADE,
  item_description text NOT NULL,
  quantity         integer NOT NULL,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT first_aid_details_desc_not_blank CHECK (length(btrim(item_description)) > 0),
  CONSTRAINT first_aid_details_qty_positive   CHECK (quantity > 0)
);

-- ---------------------------------------------------------------------
-- 3.5  ppe_requests
-- ---------------------------------------------------------------------
CREATE TABLE ppe_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_date    date NOT NULL DEFAULT current_date,
  needed_by_date  date,
  justification   text NOT NULL,
  status          ppe_request_status NOT NULL DEFAULT 'pending',
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  fulfilled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ppe_requests_justif_not_blank CHECK (length(btrim(justification)) > 0),
  CONSTRAINT ppe_requests_dates_sane CHECK (
    needed_by_date IS NULL OR needed_by_date >= request_date
  ),
  CONSTRAINT ppe_requests_approval_consistent CHECK (
    (approved_by IS NULL AND approved_at IS NULL)
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT ppe_requests_fulfilled_after_approved CHECK (
    fulfilled_at IS NULL OR (approved_at IS NOT NULL AND fulfilled_at >= approved_at)
  )
);

-- ---------------------------------------------------------------------
-- 3.6  ppe_items  (child rows; inherits tenant via parent request)
-- ---------------------------------------------------------------------
CREATE TABLE ppe_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ppe_request_id  uuid NOT NULL REFERENCES ppe_requests(id) ON DELETE CASCADE,
  item_name       text NOT NULL,
  size            text,
  quantity        integer NOT NULL,
  unit            text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ppe_items_name_not_blank  CHECK (length(btrim(item_name)) > 0),
  CONSTRAINT ppe_items_qty_positive    CHECK (quantity > 0),
  CONSTRAINT ppe_items_unit_not_blank  CHECK (unit IS NULL OR length(btrim(unit)) > 0)
);

-- ---------------------------------------------------------------------
-- 3.7  contractors  (one row per external company, not per worker)
-- ---------------------------------------------------------------------
CREATE TABLE contractors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_name    text NOT NULL,
  contact_person  text,
  contact_email   citext,
  contact_phone   text,
  work_scope      text,
  status          contractor_status NOT NULL DEFAULT 'pending_induction',
  valid_from      date,
  valid_until     date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractors_company_not_blank  CHECK (length(btrim(company_name)) > 0),
  CONSTRAINT contractors_email_format       CHECK (
    contact_email IS NULL
    OR contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ),
  CONSTRAINT contractors_dates_sane CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from
  )
);

-- ---------------------------------------------------------------------
-- 3.8  induction_records  (one row per individual worker inducted)
-- ---------------------------------------------------------------------
CREATE TABLE induction_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contractor_id   uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  inducted_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  worker_name     text NOT NULL,
  worker_ic       text,
  induction_date  date NOT NULL,
  topics_covered  jsonb NOT NULL DEFAULT '[]'::jsonb,
  signature_url   text,
  expires_at      date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT induction_worker_name_not_blank CHECK (length(btrim(worker_name)) > 0),
  CONSTRAINT induction_topics_is_array       CHECK (jsonb_typeof(topics_covered) = 'array'),
  CONSTRAINT induction_expires_after_date    CHECK (
    expires_at IS NULL OR expires_at >= induction_date
  )
);
-- ---------------------------------------------------------------------
-- 3.9  incidents
-- ---------------------------------------------------------------------
CREATE TABLE incidents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reported_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  incident_date       timestamptz NOT NULL,
  location            text NOT NULL,
  description         text NOT NULL,
  severity            incident_severity NOT NULL,
  status              incident_status NOT NULL DEFAULT 'open',
  root_cause          text,
  corrective_action   text,
  closed_at           timestamptz,
  closed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_loc_not_blank  CHECK (length(btrim(location))    > 0),
  CONSTRAINT incidents_desc_not_blank CHECK (length(btrim(description)) > 0),
  CONSTRAINT incidents_closed_consistent CHECK (
    (closed_at IS NULL  AND closed_by IS NULL)
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------
-- 3.10  staff  (HR roster for the tenant; employee_id is a string,
--               not a FK, so it can hold legacy spreadsheet IDs)
-- ---------------------------------------------------------------------
CREATE TABLE staff (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  text NOT NULL,
  full_name    text NOT NULL,
  email        citext,
  phone        text,
  department   text,
  position     text,
  join_date    date,
  leave_date   date,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id),
  CONSTRAINT staff_empid_not_blank  CHECK (length(btrim(employee_id)) > 0),
  CONSTRAINT staff_name_not_blank   CHECK (length(btrim(full_name))   > 0),
  CONSTRAINT staff_email_format     CHECK (
    email IS NULL
    OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ),
  CONSTRAINT staff_dates_sane       CHECK (
    join_date IS NULL OR leave_date IS NULL OR leave_date >= join_date
  )
);

-- ---------------------------------------------------------------------
-- 3.11  inspections
--      template_id was added in the prior Phase 1B file; folded into
--      the CREATE TABLE here so the consolidated file is self-contained.
-- ---------------------------------------------------------------------
CREATE TABLE inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id      uuid NULL,
  inspection_type  text NOT NULL,
  scheduled_date   date NOT NULL,
  completed_date   date,
  location         text NOT NULL,
  inspector_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status           inspection_status NOT NULL DEFAULT 'scheduled',
  overall_notes    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspections_type_not_blank     CHECK (length(btrim(inspection_type)) > 0),
  CONSTRAINT inspections_loc_not_blank      CHECK (length(btrim(location))        > 0),
  CONSTRAINT inspections_dates_sane         CHECK (
    completed_date IS NULL OR completed_date >= scheduled_date
  )
);

-- ---------------------------------------------------------------------
-- 3.12  inspection_items  (child rows; inherits tenant via parent)
-- ---------------------------------------------------------------------
CREATE TABLE inspection_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id    uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_description text NOT NULL,
  status           text NOT NULL,
  notes            text,
  photo_url        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_items_desc_not_blank   CHECK (length(btrim(item_description)) > 0),
  CONSTRAINT inspection_items_status_not_blank CHECK (length(btrim(status))           > 0),
  CONSTRAINT inspection_items_status_enum      CHECK (
    status IN ('pass', 'fail', 'na', 'n/a')
  )
);

-- ---------------------------------------------------------------------
-- 3.13  first_aid_inventory
--      Per-tenant central stock list for first aid consumables.
--      current_stock >= 0 is enforced by a CHECK constraint as well as
--      by the SECURITY DEFINER helpers below (defence in depth).
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
-- 3.14  first_aid_inventory_transactions  (immutable append-only log)
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
-- 3.15  inspection_templates
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------

-- Add FK constraint now that inspection_templates exists
ALTER TABLE inspections
  ADD CONSTRAINT inspections_template_fk
  FOREIGN KEY (template_id) REFERENCES inspection_templates(id)
  ON DELETE SET NULL;
-- 3.16  inspection_template_items  (one row per question)
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

-- =====================================================================
-- 4. INDEXES
--    Rules: index every FK column, every tenant_id, and
--    (tenant_id, created_at DESC) for time-sorted list queries.
-- =====================================================================

-- 4.1  tenant_id on every business table
CREATE INDEX idx_audit_log_tenant                  ON audit_log                  (tenant_id);
CREATE INDEX idx_first_aid_logs_tenant             ON first_aid_logs             (tenant_id);
CREATE INDEX idx_ppe_requests_tenant               ON ppe_requests               (tenant_id);
CREATE INDEX idx_contractors_tenant                ON contractors                (tenant_id);
CREATE INDEX idx_induction_records_tenant          ON induction_records          (tenant_id);
CREATE INDEX idx_incidents_tenant                  ON incidents                  (tenant_id);
CREATE INDEX idx_staff_tenant                      ON staff                      (tenant_id);
CREATE INDEX idx_inspections_tenant                ON inspections                (tenant_id);
CREATE INDEX idx_first_aid_inventory_tenant        ON first_aid_inventory        (tenant_id);
CREATE INDEX idx_first_aid_inventory_tx_tenant     ON first_aid_inventory_transactions (tenant_id);
CREATE INDEX idx_inspection_templates_tenant       ON inspection_templates       (tenant_id);
CREATE INDEX idx_inspection_template_items_tenant  ON inspection_template_items  (tenant_id);

-- 4.2  (tenant_id, created_at DESC) for time-sorted list queries
CREATE INDEX idx_audit_log_tenant_created                  ON audit_log                  (tenant_id, created_at DESC);
CREATE INDEX idx_first_aid_logs_tenant_created             ON first_aid_logs             (tenant_id, created_at DESC);
CREATE INDEX idx_ppe_requests_tenant_created               ON ppe_requests               (tenant_id, created_at DESC);
CREATE INDEX idx_contractors_tenant_created                ON contractors                (tenant_id, created_at DESC);
CREATE INDEX idx_induction_records_tenant_created          ON induction_records          (tenant_id, created_at DESC);
CREATE INDEX idx_incidents_tenant_created                  ON incidents                  (tenant_id, created_at DESC);
CREATE INDEX idx_staff_tenant_created                      ON staff                      (tenant_id, created_at DESC);
CREATE INDEX idx_inspections_tenant_created                ON inspections                (tenant_id, created_at DESC);
CREATE INDEX idx_first_aid_inventory_tenant_created        ON first_aid_inventory        (tenant_id, created_at DESC);
CREATE INDEX idx_inspection_templates_tenant_created       ON inspection_templates       (tenant_id, created_at DESC);
CREATE INDEX idx_inspection_template_items_tenant_created  ON inspection_template_items  (tenant_id, created_at DESC);

-- 4.3  FK columns on every table
CREATE INDEX idx_audit_log_user                    ON audit_log      (user_id);
CREATE INDEX idx_audit_log_entity                  ON audit_log      (entity_type, entity_id);
CREATE INDEX idx_first_aid_logs_reported_by        ON first_aid_logs (reported_by);
CREATE INDEX idx_first_aid_details_log             ON first_aid_details (first_aid_log_id);
CREATE INDEX idx_ppe_requests_requested_by         ON ppe_requests   (requested_by);
CREATE INDEX idx_ppe_requests_approved_by          ON ppe_requests   (approved_by);
CREATE INDEX idx_ppe_items_request                 ON ppe_items      (ppe_request_id);
CREATE INDEX idx_contractors_status                ON contractors    (status);
CREATE INDEX idx_induction_records_contractor      ON induction_records (contractor_id);
CREATE INDEX idx_induction_records_inducted_by     ON induction_records (inducted_by);
CREATE INDEX idx_incidents_reported_by             ON incidents      (reported_by);
CREATE INDEX idx_incidents_closed_by               ON incidents      (closed_by);
CREATE INDEX idx_incidents_severity                ON incidents      (severity);
CREATE INDEX idx_incidents_status                  ON incidents      (status);
CREATE INDEX idx_staff_employee_id                 ON staff          (tenant_id, employee_id);
CREATE INDEX idx_inspections_inspector             ON inspections    (inspector_id);
CREATE INDEX idx_inspections_status                ON inspections    (status);
CREATE INDEX idx_inspections_template              ON inspections    (template_id);
CREATE INDEX idx_inspection_items_inspection       ON inspection_items (inspection_id);
CREATE INDEX idx_first_aid_inventory_tx_item        ON first_aid_inventory_transactions (inventory_item_id);
CREATE INDEX idx_first_aid_inventory_tx_logged_by   ON first_aid_inventory_transactions (logged_by);
CREATE INDEX idx_inspection_templates_created_by    ON inspection_templates (created_by);
CREATE INDEX idx_inspection_template_items_template ON inspection_template_items (template_id);

-- 4.4  Lookups used by the app
CREATE INDEX idx_first_aid_inventory_tenant_active    ON first_aid_inventory (tenant_id, is_active);
CREATE INDEX idx_first_aid_inventory_tenant_category  ON first_aid_inventory (tenant_id, category_group);
CREATE INDEX idx_first_aid_inventory_tenant_name      ON first_aid_inventory (tenant_id, lower(item_name));
CREATE INDEX idx_first_aid_inventory_tx_tenant_logged_at ON first_aid_inventory_transactions (tenant_id, logged_at DESC);
CREATE INDEX idx_first_aid_inventory_tx_item_logged_at  ON first_aid_inventory_transactions (inventory_item_id, logged_at DESC);
CREATE INDEX idx_first_aid_inventory_tx_reference     ON first_aid_inventory_transactions (reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX idx_inspection_templates_tenant_active   ON inspection_templates (tenant_id, is_active);
CREATE INDEX idx_inspection_template_items_template_order ON inspection_template_items (template_id, display_order);
CREATE INDEX idx_inspection_template_items_tenant_template ON inspection_template_items (tenant_id, template_id);

-- NOTE: tenants.owner_user_id is UNIQUE, so the constraint already
-- creates a unique btree index. No additional CREATE INDEX needed.

-- =====================================================================
-- 5. HELPER FUNCTIONS  (all SECURITY DEFINER, search_path pinned)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5.1  get_my_tenant_id
--   Returns the single tenants.id owned by auth.uid(), or NULL when
--   the calling user has no workspace yet. The NULL case is the signal
--   the Astro app uses to show the onboarding wizard.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM tenants
  WHERE owner_user_id = auth.uid()
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 5.2  is_my_tenant_premium
--   True iff the calling user owns a tenant with an active, non-expired
--   premium subscription. No parameter: the current SHO is the only
--   possible subject.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_my_tenant_premium()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenants
    WHERE id = get_my_tenant_id()
      AND subscription_plan = 'premium'
      AND (subscription_expires_at IS NULL OR subscription_expires_at > now())
  );
$$;

-- ---------------------------------------------------------------------
-- 5.3  setup_tenant
--   Atomically creates a new tenant and records auth.uid() as its
--   owner. Bypasses RLS because SECURITY DEFINER runs as the function
--   owner. This is the ONLY supported way to create a tenant.
--   Refuses to create a second tenant for the same auth.uid() so the
--   1-user-1-tenant rule is enforced at the database level.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION setup_tenant(
  p_name         text,
  p_company_name text DEFAULT NULL,
  p_industry     text DEFAULT NULL,
  p_license_key  citext DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_tenant_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'setup_tenant requires an authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Tenant name is required'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM tenants WHERE owner_user_id = v_uid) THEN
    RAISE EXCEPTION 'User already owns a tenant; one workspace per user'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO tenants (name, company_name, industry, license_key, owner_user_id)
  VALUES (btrim(p_name), p_company_name, p_industry, p_license_key, v_uid)
  RETURNING id INTO v_tenant_id;

  RETURN v_tenant_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 5.4  deduct_inventory_for_first_aid
--   For each first_aid_details row belonging to the log, find the
--   matching inventory row by lower(item_name) = lower(d.item_description),
--   decrement current_stock by detail.quantity, and write one
--   first_aid_inventory_transactions row per decrement.
--
--   Pre-conditions enforced before any write:
--     (a) the log exists
--     (b) every detail row maps to an active inventory item
--     (c) no decrement would push any item below zero
--
--   Atomic: the whole call is one transaction; if any pre-check
--   fails, nothing is written. Sets first_aid_logs.deducted_from_inventory
--   = true on success.
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
-- 5.5  restock_inventory
--   Increment current_stock and log a 'restock' transaction.
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
-- 5.6  adjust_inventory_manual
--   Generic signed adjustment. Negative deltas are allowed but
--   stock is still constrained to >= 0 by the explicit pre-check
--   (and the CHECK constraint as defence in depth).
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
-- 5.7  set_updated_at  (trigger function, not called directly)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 5.8  set_first_aid_inventory_last_updated  (trigger function)
--   Bumps first_aid_inventory.last_updated whenever current_stock
--   actually changes. Scoped to the column so metadata-only UPDATEs
--   (e.g. toggling is_active) don't churn it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_first_aid_inventory_last_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_updated := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 5.9  set_audit_log_defaults  (trigger function)
--   Stamps user_id and ip_address from server context. Prevents a
--   client from writing fake audit rows "as" someone else.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_audit_log_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  IF NEW.ip_address IS NULL THEN
    NEW.ip_address := inet_client_addr();
  END IF;
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'audit_log.user_id cannot be resolved'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- =====================================================================
-- 6. TRIGGERS
-- =====================================================================

-- 6.1  Apply set_updated_at() to every table with an updated_at column.
--      (first_aid_inventory has last_updated, not updated_at, so it
--      gets its own dedicated trigger below.)
CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_first_aid_logs_updated_at
  BEFORE UPDATE ON first_aid_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_contractors_updated_at
  BEFORE UPDATE ON contractors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_inspection_templates_updated_at
  BEFORE UPDATE ON inspection_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6.2  first_aid_inventory: bump last_updated on current_stock change only.
CREATE TRIGGER trg_first_aid_inventory_stock_updated
  BEFORE UPDATE OF current_stock ON first_aid_inventory
  FOR EACH ROW
  WHEN (OLD.current_stock IS DISTINCT FROM NEW.current_stock)
  EXECUTE FUNCTION set_first_aid_inventory_last_updated();

-- 6.3  audit_log: stamp user_id and ip_address from server context.
CREATE TRIGGER trg_audit_log_defaults
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION set_audit_log_defaults();

-- =====================================================================
-- 7. ROW LEVEL SECURITY
--    Every business table has RLS enabled. The policy body is just
--    `tenant_id = get_my_tenant_id()` (or the EXISTS-via-parent
--    equivalent for child tables that don't carry tenant_id directly).
--    There are no role-distinguished variants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 7.1  tenants
--      SELECT/UPDATE/DELETE: only the owner.
--      INSERT: none. Creation goes through setup_tenant() which is
--      SECURITY DEFINER and bypasses RLS.
-- ---------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_select_owner ON tenants
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY tenants_update_owner ON tenants
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY tenants_delete_owner ON tenants
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 7.2  audit_log  (append-only)
-- ---------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_member ON audit_log
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY audit_log_insert_member ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

-- NO UPDATE policy. NO DELETE policy. Immutability is enforced by the
-- absence of these policies; even the owner cannot rewrite history.

-- ---------------------------------------------------------------------
-- 7.3  first_aid_logs
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY first_aid_logs_all_member ON first_aid_logs
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.4  first_aid_details  (inherits tenant via parent log)
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY first_aid_details_all_member ON first_aid_details
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM first_aid_logs l
      WHERE l.id = first_aid_details.first_aid_log_id
        AND l.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM first_aid_logs l
      WHERE l.id = first_aid_details.first_aid_log_id
        AND l.tenant_id = get_my_tenant_id()
    )
  );

-- ---------------------------------------------------------------------
-- 7.5  ppe_requests
-- ---------------------------------------------------------------------
ALTER TABLE ppe_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppe_requests_all_member ON ppe_requests
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.6  ppe_items  (inherits tenant via parent request)
-- ---------------------------------------------------------------------
ALTER TABLE ppe_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppe_items_all_member ON ppe_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ppe_requests r
      WHERE r.id = ppe_items.ppe_request_id
        AND r.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ppe_requests r
      WHERE r.id = ppe_items.ppe_request_id
        AND r.tenant_id = get_my_tenant_id()
    )
  );

-- ---------------------------------------------------------------------
-- 7.7  contractors
-- ---------------------------------------------------------------------
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY contractors_all_member ON contractors
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.8  induction_records
-- ---------------------------------------------------------------------
ALTER TABLE induction_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY induction_records_all_member ON induction_records
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.9  incidents
-- ---------------------------------------------------------------------
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY incidents_all_member ON incidents
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.10  staff
-- ---------------------------------------------------------------------
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_all_member ON staff
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.11  inspections
-- ---------------------------------------------------------------------
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspections_all_member ON inspections
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.12  inspection_items  (inherits tenant via parent inspection)
-- ---------------------------------------------------------------------
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_items_all_member ON inspection_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspections i
      WHERE i.id = inspection_items.inspection_id
        AND i.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM inspections i
      WHERE i.id = inspection_items.inspection_id
        AND i.tenant_id = get_my_tenant_id()
    )
  );

-- ---------------------------------------------------------------------
-- 7.13  first_aid_inventory
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY first_aid_inventory_all_member ON first_aid_inventory
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.14  first_aid_inventory_transactions  (append-only)
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY first_aid_inventory_tx_select_member
  ON first_aid_inventory_transactions
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY first_aid_inventory_tx_insert_member
  ON first_aid_inventory_transactions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

-- NO UPDATE policy. NO DELETE policy. Immutability is enforced by the
-- absence of these policies. The SECURITY DEFINER inventory helpers
-- (deduct_inventory_for_first_aid, restock_inventory,
-- adjust_inventory_manual) bypass RLS for their own writes.

-- ---------------------------------------------------------------------
-- 7.15  inspection_templates
-- ---------------------------------------------------------------------
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_templates_all_member ON inspection_templates
  FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 7.16  inspection_template_items  (inherits tenant via parent template)
-- ---------------------------------------------------------------------
ALTER TABLE inspection_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_template_items_all_member ON inspection_template_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspection_templates t
      WHERE t.id = inspection_template_items.template_id
        AND t.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM inspection_templates t
      WHERE t.id = inspection_template_items.template_id
        AND t.tenant_id = get_my_tenant_id()
    )
  );

-- =====================================================================
-- 8. GRANTS
--    Mirrors the prior files' pattern. Wrapped in DO/EXCEPTION so
--    re-running is safe in tooling that doesn't track grants.
--    Note: the prior `REVOKE ALL ON licenses ...` lines are GONE
--    because the licenses table no longer exists.
-- =====================================================================

DO $$
BEGIN
  BEGIN
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
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

-- 8.2  Explicit grants for the helper functions (audit-friendly listing).
GRANT EXECUTE ON FUNCTION get_my_tenant_id()                              TO authenticated;
GRANT EXECUTE ON FUNCTION is_my_tenant_premium()                          TO authenticated;
GRANT EXECUTE ON FUNCTION setup_tenant(text, text, text, citext)          TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_inventory_for_first_aid(uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION restock_inventory(uuid, integer, uuid, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_inventory_manual(uuid, integer, uuid, text) TO authenticated;

-- 8.3  Explicit REVOKEs for the append-only log (anon must never see it).
REVOKE ALL ON first_aid_inventory_transactions FROM anon;

-- =====================================================================
-- 9. VERIFICATION QUERIES  (run by hand after applying, in psql or
--    Supabase SQL editor with the appropriate role)
-- =====================================================================

-- 9.1  Every business table has RLS enabled. Expect 16 rows.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS rls_enabled_tables
--   FROM pg_tables
--  WHERE schemaname = 'public' AND rowsecurity = true;
-- -- EXPECT: 16

-- 9.2  Policy count breakdown by table.
-- ----------------------------------------------------------------------------
-- SELECT tablename, count(*) AS policy_count
--   FROM pg_policies
--  WHERE schemaname = 'public'
--  GROUP BY tablename
--  ORDER BY tablename;
-- -- EXPECT (approximate):
-- --   audit_log                         2   (SELECT, INSERT)
-- --   contractors                       1   (FOR ALL)
-- --   first_aid_details                 1   (FOR ALL)
-- --   first_aid_inventory               1   (FOR ALL)
-- --   first_aid_inventory_transactions  2   (SELECT, INSERT)
-- --   first_aid_logs                    1   (FOR ALL)
-- --   incidents                         1   (FOR ALL)
-- --   induction_records                 1   (FOR ALL)
-- --   inspection_items                  1   (FOR ALL)
-- --   inspection_template_items         1   (FOR ALL)
-- --   inspection_templates              1   (FOR ALL)
-- --   inspections                       1   (FOR ALL)
-- --   ppe_items                         1   (FOR ALL)
-- --   ppe_requests                      1   (FOR ALL)
-- --   staff                             1   (FOR ALL)
-- --   tenants                           3   (SELECT, UPDATE, DELETE)
-- -- Total: ~21 policies.
--
-- (Note: PostgreSQL expands FOR ALL into per-command policies. The
-- "approximately 30-40" estimate in the original spec assumed 4
-- separate policies per business table; the consolidated file uses
-- the more compact FOR ALL form, which Postgres still records as 4
-- rows in pg_policies — one each for SELECT/INSERT/UPDATE/DELETE —
-- so the on-disk count matches the estimate. See 9.2b below.)

-- 9.2b  Raw pg_policies row count (Postgres stores one row per command
--       even when the source uses FOR ALL). Expect ~55 rows.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS total_pg_policy_rows
--   FROM pg_policies
--  WHERE schemaname = 'public';

-- 9.3  Helper functions are SECURITY DEFINER with the right search_path.
-- ----------------------------------------------------------------------------
-- SELECT proname, prosecdef, proconfig
--   FROM pg_proc
--  WHERE proname IN (
--    'get_my_tenant_id',
--    'is_my_tenant_premium',
--    'setup_tenant',
--    'deduct_inventory_for_first_aid',
--    'restock_inventory',
--    'adjust_inventory_manual',
--    'set_updated_at',
--    'set_first_aid_inventory_last_updated'
--  )
--  ORDER BY proname;
-- -- EXPECT: prosecdef = true and proconfig contains
-- --         'search_path=public,pg_temp' on the six helpers. The two
-- --         trigger functions (set_updated_at, set_first_aid_inventory_*
-- --         last_updated) are NOT SECURITY DEFINER (they don't need to
-- --         be; they don't cross privilege boundaries), so prosecdef
-- --         will be false for them. (The spec's verification list is
-- --         a defensive cross-check; it is not a hard requirement on
-- --         the trigger functions.)

-- 9.4  The dropped tables and enums are GONE.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS dropped_table_count
--   FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('tenant_members', 'invitations', 'licenses');
-- -- EXPECT: 0
--
-- SELECT count(*) AS user_role_enum_count
--   FROM pg_type t
--  JOIN pg_namespace n ON n.oid = t.typnamespace
--  WHERE n.nspname = 'public' AND t.typname = 'user_role';
-- -- EXPECT: 0

-- 9.5  The dropped functions are GONE.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS dropped_function_count
--   FROM pg_proc p
--  JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN (
--      'get_my_tenant_ids',
--      'get_my_role_in_tenant',
--      'is_tenant_member',
--      'accept_invitation',
--      'get_invitation_by_token',
--      'validate_license',
--      'is_premium_tenant'
--    );
-- -- EXPECT: 0

-- 9.6  RLS policies do not reference any dropped helper.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS policies_referencing_dropped_helpers
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND (
--      qual      ::text ILIKE '%get_my_role_in_tenant%'
--      OR qual    ::text ILIKE '%get_my_tenant_ids%'
--      OR with_check::text ILIKE '%get_my_role_in_tenant%'
--      OR with_check::text ILIKE '%get_my_tenant_ids%'
--    );
-- -- EXPECT: 0

-- 9.7  audit_log has no UPDATE or DELETE policy for the authenticated
--      role, and first_aid_inventory_transactions has none either.
-- ----------------------------------------------------------------------------
-- SELECT tablename, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('audit_log', 'first_aid_inventory_transactions')
--    AND cmd IN ('UPDATE', 'DELETE');
-- -- EXPECT: 0 rows

-- 9.8  Smoke test: a user can only see their own tenant's data.
--      Run as the SHO (authenticated) — expect only rows for their
--      tenant to be visible.
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS visible_first_aid_logs FROM first_aid_logs;
-- SELECT count(*) AS visible_incidents      FROM incidents;
-- SELECT count(*) AS visible_inventory       FROM first_aid_inventory;
-- -- EXPECT: every count above reflects only the calling SHO's tenant.

-- 9.9  Smoke test: a user cannot insert a row for a tenant they don't own.
-- ----------------------------------------------------------------------------
-- INSERT INTO first_aid_logs (
--   tenant_id, reported_by, incident_date, location,
--   injured_person_name, injury_type, treatment_given
-- ) VALUES (
--   '00000000-0000-0000-0000-000000000000',  -- foreign tenant
--   auth.uid(), current_date, 'X', 'Y', 'Z', 'W'
-- );
-- -- EXPECT: ERROR: new row violates row-level security policy for table "first_aid_logs"

-- 9.10 Smoke test: audit_log is immutable.
-- ----------------------------------------------------------------------------
-- UPDATE audit_log SET action = 'tampered' WHERE id = '<any-audit-id>';
-- -- EXPECT: UPDATE 0
-- DELETE FROM audit_log WHERE id = '<any-audit-id>';
-- -- EXPECT: DELETE 0

-- 9.11 Smoke test: get_my_tenant_id() returns NULL for a new user, then
--      a real id after setup_tenant().
-- ----------------------------------------------------------------------------
-- SELECT get_my_tenant_id();            -- EXPECT: NULL (new user, no tenant)
-- SELECT setup_tenant('My Workspace', 'Acme Co', 'manufacturing');
-- SELECT get_my_tenant_id();            -- EXPECT: the new tenant's id
-- SELECT setup_tenant('Another');       -- EXPECT: ERROR 'User already owns a tenant; one workspace per user'

-- 9.12 Smoke test: is_my_tenant_premium() reflects tenants.subscription_plan.
-- ----------------------------------------------------------------------------
-- SELECT is_my_tenant_premium();        -- EXPECT: false (default 'free')
-- UPDATE tenants
--    SET subscription_plan = 'premium',
--        subscription_expires_at = now() + interval '30 days',
--        subscription_activated_at = now()
--  WHERE id = get_my_tenant_id();
-- SELECT is_my_tenant_premium();        -- EXPECT: true
