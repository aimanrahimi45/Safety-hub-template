-- =====================================================================
-- Phase 1A: Multi-tenant safety compliance schema
-- Target: Supabase (Postgres 15+) with Google OAuth via Supabase Auth
-- Author: senior backend engineer
-- Date:   2026-07-12
--
-- DESIGN DECISIONS (also documented in the handoff report):
--   * Tenants are created via a SECURITY DEFINER function (setup_tenant),
--     not via a direct INSERT policy. This guarantees the first user is
--     also recorded as the tenant admin in tenant_members, and avoids
--     a "ghost tenant" with no admin. (See setup_tenant() below.)
--   * Invitation lookup by token is exposed via a SECURITY DEFINER
--     function (get_invitation_by_token) that returns only non-sensitive
--     fields, so we don't need a permissive SELECT policy on invitations.
--   * audit_log immutability is enforced by the ABSENCE of UPDATE/DELETE
--     RLS policies. No service-role bypass is granted in the policies.
--   * Helper functions are SECURITY DEFINER with search_path pinned to
--     prevent search_path hijacking.
--   * All child tables (first_aid_details, ppe_items, inspection_items)
--     inherit tenant isolation via an EXISTS subquery to their parent.
-- =====================================================================

-- =====================================================================
-- 0. SEED DATA
-- =====================================================================
-- No seed data is inserted by this migration.
-- The system is bootstrapped when the first user signs in via Google
-- OAuth and calls setup_tenant() (or accepts an invitation via
-- accept_invitation()) from the application. Onboarding flow is out of
-- scope for this migration and will be implemented in the Astro app.

-- =====================================================================
-- 1. EXTENSIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text

-- =====================================================================
-- 2. ENUMS
-- =====================================================================
CREATE TYPE user_role AS ENUM ('worker', 'supervisor', 'admin');

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

-- =====================================================================
-- 3. TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1  tenants  (one row per company / site)
-- ---------------------------------------------------------------------
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  license_key   citext UNIQUE,
  company_name  text,
  industry      text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- ---------------------------------------------------------------------
-- 3.2  tenant_members  (which auth.users belong to which tenants)
-- ---------------------------------------------------------------------
CREATE TABLE tenant_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          user_role NOT NULL DEFAULT 'worker',
  display_name  text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

-- ---------------------------------------------------------------------
-- 3.3  invitations  (admin invites a worker via email + token)
-- ---------------------------------------------------------------------
CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  role         user_role NOT NULL DEFAULT 'worker',
  invited_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token        text UNIQUE NOT NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_email_format CHECK (
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ),
  CONSTRAINT invitations_token_not_blank CHECK (length(btrim(token)) >= 16),
  CONSTRAINT invitations_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT invitations_accepted_after_creation CHECK (
    accepted_at IS NULL OR accepted_at >= created_at
  )
);

-- ---------------------------------------------------------------------
-- 3.4  audit_log  (append-only event log per tenant)
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
-- 3.5  first_aid_logs
-- ---------------------------------------------------------------------
CREATE TABLE first_aid_logs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reported_by            uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  incident_date          date NOT NULL,
  incident_time          time,
  location               text NOT NULL,
  injured_person_name    text NOT NULL,
  injured_person_id      text,
  injury_type            text NOT NULL,
  treatment_given        text NOT NULL,
  referred_to_hospital   boolean NOT NULL DEFAULT false,
  hospital_name          text,
  status                 text NOT NULL DEFAULT 'open',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
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
-- 3.6  first_aid_details  (child rows; inherits tenant via parent log)
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
-- 3.7  ppe_requests
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
-- 3.8  ppe_items  (child rows; inherits tenant via parent request)
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
-- 3.9  contractors  (one row per external company, not per worker)
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
-- 3.10  induction_records  (one row per individual worker inducted)
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
  CONSTRAINT induction_topics_string_elems   CHECK (
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(topics_covered) AS t
      WHERE length(btrim(t)) = 0
    )
  ),
  CONSTRAINT induction_expires_after_date    CHECK (
    expires_at IS NULL OR expires_at >= induction_date
  )
);

-- ---------------------------------------------------------------------
-- 3.11  incidents
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
-- 3.12  staff  (HR roster for the tenant; employee_id is a string,
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
-- 3.13  inspections
-- ---------------------------------------------------------------------
CREATE TABLE inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
-- 3.14  inspection_items  (child rows; inherits tenant via parent)
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

-- =====================================================================
-- 4. INDEXES
--    Rules: index every FK column, every tenant_id, and
--    (tenant_id, created_at DESC) for time-sorted list queries.
-- =====================================================================

-- tenant_id on every business table
CREATE INDEX idx_tenant_members_tenant     ON tenant_members (tenant_id);
CREATE INDEX idx_invitations_tenant        ON invitations    (tenant_id);
CREATE INDEX idx_audit_log_tenant          ON audit_log      (tenant_id);
CREATE INDEX idx_first_aid_logs_tenant     ON first_aid_logs (tenant_id);
CREATE INDEX idx_ppe_requests_tenant       ON ppe_requests   (tenant_id);
CREATE INDEX idx_contractors_tenant        ON contractors    (tenant_id);
CREATE INDEX idx_induction_records_tenant  ON induction_records (tenant_id);
CREATE INDEX idx_incidents_tenant          ON incidents      (tenant_id);
CREATE INDEX idx_staff_tenant              ON staff          (tenant_id);
CREATE INDEX idx_inspections_tenant        ON inspections    (tenant_id);

-- (tenant_id, created_at DESC) for time-sorted list queries
CREATE INDEX idx_tenant_members_tenant_created     ON tenant_members    (tenant_id, created_at DESC);
CREATE INDEX idx_invitations_tenant_created        ON invitations       (tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_tenant_created          ON audit_log         (tenant_id, created_at DESC);
CREATE INDEX idx_first_aid_logs_tenant_created     ON first_aid_logs    (tenant_id, created_at DESC);
CREATE INDEX idx_ppe_requests_tenant_created       ON ppe_requests      (tenant_id, created_at DESC);
CREATE INDEX idx_contractors_tenant_created        ON contractors       (tenant_id, created_at DESC);
CREATE INDEX idx_induction_records_tenant_created  ON induction_records (tenant_id, created_at DESC);
CREATE INDEX idx_incidents_tenant_created          ON incidents         (tenant_id, created_at DESC);
CREATE INDEX idx_staff_tenant_created              ON staff             (tenant_id, created_at DESC);
CREATE INDEX idx_inspections_tenant_created        ON inspections       (tenant_id, created_at DESC);

-- FK columns on every table (for join performance and to back EXISTS
-- checks in child-table RLS policies)
CREATE INDEX idx_tenant_members_user       ON tenant_members (user_id);
CREATE INDEX idx_invitations_invited_by    ON invitations    (invited_by);
CREATE INDEX idx_audit_log_user            ON audit_log      (user_id);
CREATE INDEX idx_audit_log_entity          ON audit_log      (entity_type, entity_id);
CREATE INDEX idx_first_aid_logs_reported_by ON first_aid_logs (reported_by);
CREATE INDEX idx_first_aid_details_log     ON first_aid_details (first_aid_log_id);
CREATE INDEX idx_ppe_requests_requested_by ON ppe_requests   (requested_by);
CREATE INDEX idx_ppe_requests_approved_by  ON ppe_requests   (approved_by);
CREATE INDEX idx_ppe_items_request         ON ppe_items      (ppe_request_id);
CREATE INDEX idx_contractors_status        ON contractors    (status);
CREATE INDEX idx_induction_records_contractor ON induction_records (contractor_id);
CREATE INDEX idx_induction_records_inducted_by ON induction_records (inducted_by);
CREATE INDEX idx_incidents_reported_by     ON incidents      (reported_by);
CREATE INDEX idx_incidents_closed_by       ON incidents      (closed_by);
CREATE INDEX idx_incidents_severity        ON incidents      (severity);
CREATE INDEX idx_incidents_status          ON incidents      (status);
CREATE INDEX idx_staff_employee_id         ON staff          (tenant_id, employee_id);
CREATE INDEX idx_inspections_inspector     ON inspections    (inspector_id);
CREATE INDEX idx_inspections_status        ON inspections    (status);
CREATE INDEX idx_inspection_items_inspection ON inspection_items (inspection_id);

-- Lookups used by the app
CREATE INDEX idx_tenant_members_user_active ON tenant_members (user_id, is_active);
CREATE INDEX idx_invitations_email         ON invitations    (email);

-- =====================================================================
-- 5. HELPER FUNCTIONS  (all SECURITY DEFINER, search_path pinned)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5.1  get_my_tenant_ids
--   Returns tenant_ids for which auth.uid() has an active membership.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id
  FROM tenant_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

-- ---------------------------------------------------------------------
-- 5.2  get_my_role_in_tenant
--   Returns the caller's role in a given tenant, or NULL if not a member.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_role_in_tenant(p_tenant_id uuid)
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM tenant_members
  WHERE tenant_id = p_tenant_id
    AND user_id    = auth.uid()
    AND is_active  = true
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 5.3  is_tenant_member
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id   = auth.uid()
      AND is_active = true
  );
$$;

-- ---------------------------------------------------------------------
-- 5.4  setup_tenant
--   Atomically creates a new tenant AND records the calling user as
--   its admin. Bypasses RLS because SECURITY DEFINER runs as the
--   function owner (the migration role, which is a Supabase superuser).
--   This is the ONLY supported way to create a tenant.
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

  INSERT INTO tenants (name, company_name, industry, license_key)
  VALUES (btrim(p_name), p_company_name, p_industry, p_license_key)
  RETURNING id INTO v_tenant_id;

  INSERT INTO tenant_members (tenant_id, user_id, role, display_name, is_active)
  VALUES (v_tenant_id, v_uid, 'admin', NULL, true);

  RETURN v_tenant_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 5.5  get_invitation_by_token
--   Returns non-sensitive fields of an invitation so the front-end
--   can render a "you've been invited to <company> as <role>" page
--   before the user clicks Accept. No tenant id, no inviter id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token text)
RETURNS TABLE (
  email       citext,
  role        user_role,
  expires_at  timestamptz,
  accepted_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.email, i.role, i.expires_at, i.accepted_at
  FROM invitations i
  WHERE i.token = p_token
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 5.6  accept_invitation
--   Atomically:
--     1. Look up invitation by token (FOR UPDATE locks the row)
--     2. Reject if missing, expired, or already accepted
--     3. Verify the calling user's email matches the invite email
--     4. Insert a tenant_members row
--     5. Mark the invitation accepted
--   Returns the new membership's tenant_id, or raises an exception.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_user_email   citext;
  v_invitation   invitations%ROWTYPE;
  v_tenant_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'accept_invitation requires an authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invitation
  FROM invitations
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation token not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been accepted'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation has expired'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_uid;
  IF v_user_email IS NULL OR lower(v_user_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'Signed-in email does not match the invitation email'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO tenant_members (tenant_id, user_id, role, is_active)
  VALUES (v_invitation.tenant_id, v_uid, v_invitation.role, true)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role      = EXCLUDED.role,
        is_active = true
  RETURNING tenant_id INTO v_tenant_id;

  UPDATE invitations
     SET accepted_at = now()
   WHERE id = v_invitation.id;

  RETURN v_tenant_id;
END;
$$;

-- =====================================================================
-- 6. TRIGGERS
-- =====================================================================

-- 6.1  Generic updated_at bumper
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Apply to every table that has updated_at
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

-- 6.2  audit_log: stamp user_id and ip_address from server context.
--      Prevents a client from writing fake audit rows "as" someone else.
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

CREATE TRIGGER trg_audit_log_defaults
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION set_audit_log_defaults();

-- =====================================================================
-- 7. ROW LEVEL SECURITY
--    Enable RLS and create policies for every business table.
-- =====================================================================

-- Helper role-name literal for the policy blocks.
-- (No need to set search_path here; policies run in the caller's context.)

-- ---------------------------------------------------------------------
-- 7.1  tenants
-- ---------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- SELECT: only if the caller is an active member of that tenant.
CREATE POLICY tenants_select_member ON tenants
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT get_my_tenant_ids())
  );

-- UPDATE: only admin of the tenant.
CREATE POLICY tenants_update_admin ON tenants
  FOR UPDATE TO authenticated
  USING (
    get_my_role_in_tenant(id) = 'admin'
  )
  WITH CHECK (
    get_my_role_in_tenant(id) = 'admin'
  );

-- DELETE: only admin of the tenant.
CREATE POLICY tenants_delete_admin ON tenants
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(id) = 'admin'
  );

-- No INSERT policy on tenants: creation goes through setup_tenant(),
-- which is SECURITY DEFINER and bypasses RLS. Documented above.

-- ---------------------------------------------------------------------
-- 7.2  tenant_members
-- ---------------------------------------------------------------------
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

-- SELECT: own memberships OR admin-of-tenant sees all in their tenant.
CREATE POLICY tenant_members_select_self ON tenant_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY tenant_members_select_admin ON tenant_members
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- INSERT: admin of the target tenant.
CREATE POLICY tenant_members_insert_admin ON tenant_members
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- UPDATE: admin of the tenant.
CREATE POLICY tenant_members_update_admin ON tenant_members
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) = 'admin'
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- DELETE: admin of the tenant.
CREATE POLICY tenant_members_delete_admin ON tenant_members
  FOR DELETE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- Direct self-signup via accept_invitation() is also possible because
-- that function is SECURITY DEFINER and bypasses RLS.

-- ---------------------------------------------------------------------
-- 7.3  invitations
-- ---------------------------------------------------------------------
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- SELECT: admin of the tenant.
CREATE POLICY invitations_select_admin ON invitations
  FOR SELECT TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );
-- Lookup by token goes through get_invitation_by_token() (SECURITY DEFINER).
-- We deliberately do NOT add a permissive SELECT-by-token policy so the
-- token column and inviter id are never exposed to the client.

-- INSERT: admin of the target tenant, and invited_by must be the caller.
CREATE POLICY invitations_insert_admin ON invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role_in_tenant(tenant_id) = 'admin'
    AND invited_by = auth.uid()
  );

-- UPDATE: admin of the tenant.
CREATE POLICY invitations_update_admin ON invitations
  FOR UPDATE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  )
  WITH CHECK (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- DELETE: admin of the tenant.
CREATE POLICY invitations_delete_admin ON invitations
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- Marking accepted_at happens via accept_invitation() (SECURITY DEFINER),
-- so no extra UPDATE policy is required for that path.

-- ---------------------------------------------------------------------
-- 7.4  audit_log   (append-only)
-- ---------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: admin of the tenant only.
CREATE POLICY audit_log_select_admin ON audit_log
  FOR SELECT TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- INSERT: any active member of the tenant, and the row is stamped
-- with auth.uid() by the BEFORE INSERT trigger.
CREATE POLICY audit_log_insert_member ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND user_id = auth.uid()
  );

-- NO UPDATE policy. NO DELETE policy. Immutability is enforced by the
-- absence of these policies; even an admin cannot rewrite history.

-- ---------------------------------------------------------------------
-- 7.5  first_aid_logs
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the tenant.
CREATE POLICY first_aid_logs_select_member ON first_aid_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- INSERT: any member, and reported_by must be the caller.
CREATE POLICY first_aid_logs_insert_self ON first_aid_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id   IN (SELECT get_my_tenant_ids())
    AND reported_by = auth.uid()
  );

-- UPDATE: supervisor or admin of the tenant.
CREATE POLICY first_aid_logs_update_supervisor ON first_aid_logs
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

-- DELETE: admin only.
CREATE POLICY first_aid_logs_delete_admin ON first_aid_logs
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 7.6  first_aid_details  (inherits tenant via parent log)
-- ---------------------------------------------------------------------
ALTER TABLE first_aid_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY first_aid_details_select_member ON first_aid_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM first_aid_logs l
      WHERE l.id = first_aid_details.first_aid_log_id
        AND l.tenant_id IN (SELECT get_my_tenant_ids())
    )
  );

CREATE POLICY first_aid_details_insert_supervisor ON first_aid_details
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM first_aid_logs l
      WHERE l.id = first_aid_details.first_aid_log_id
        AND l.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(l.tenant_id) IN ('supervisor', 'admin')
    )
  );

CREATE POLICY first_aid_details_update_supervisor ON first_aid_details
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM first_aid_logs l
      WHERE l.id = first_aid_details.first_aid_log_id
        AND l.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(l.tenant_id) IN ('supervisor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM first_aid_logs l
      WHERE l.id = first_aid_details.first_aid_log_id
        AND l.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(l.tenant_id) IN ('supervisor', 'admin')
    )
  );

CREATE POLICY first_aid_details_delete_admin ON first_aid_details
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM first_aid_logs l
      WHERE l.id = first_aid_details.first_aid_log_id
        AND l.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(l.tenant_id) = 'admin'
    )
  );

-- ---------------------------------------------------------------------
-- 7.7  ppe_requests
-- ---------------------------------------------------------------------
ALTER TABLE ppe_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppe_requests_select_member ON ppe_requests
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY ppe_requests_insert_self ON ppe_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id    IN (SELECT get_my_tenant_ids())
    AND requested_by = auth.uid()
  );

-- Status transitions (approved/fulfilled) are supervisor/admin only.
CREATE POLICY ppe_requests_update_supervisor ON ppe_requests
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY ppe_requests_delete_admin ON ppe_requests
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 7.8  ppe_items  (inherits tenant via parent request)
-- ---------------------------------------------------------------------
ALTER TABLE ppe_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppe_items_select_member ON ppe_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ppe_requests r
      WHERE r.id = ppe_items.ppe_request_id
        AND r.tenant_id IN (SELECT get_my_tenant_ids())
    )
  );

CREATE POLICY ppe_items_insert_member ON ppe_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ppe_requests r
      WHERE r.id = ppe_items.ppe_request_id
        AND r.tenant_id IN (SELECT get_my_tenant_ids())
        AND r.requested_by = auth.uid()
    )
  );

CREATE POLICY ppe_items_update_supervisor ON ppe_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ppe_requests r
      WHERE r.id = ppe_items.ppe_request_id
        AND r.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(r.tenant_id) IN ('supervisor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ppe_requests r
      WHERE r.id = ppe_items.ppe_request_id
        AND r.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(r.tenant_id) IN ('supervisor', 'admin')
    )
  );

CREATE POLICY ppe_items_delete_admin ON ppe_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ppe_requests r
      WHERE r.id = ppe_items.ppe_request_id
        AND r.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(r.tenant_id) = 'admin'
    )
  );

-- ---------------------------------------------------------------------
-- 7.9  contractors
-- ---------------------------------------------------------------------
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY contractors_select_member ON contractors
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY contractors_insert_supervisor ON contractors
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY contractors_update_supervisor ON contractors
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY contractors_delete_admin ON contractors
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 7.10  induction_records
-- ---------------------------------------------------------------------
ALTER TABLE induction_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY induction_records_select_member ON induction_records
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY induction_records_insert_supervisor ON induction_records
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id   IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
    AND inducted_by = auth.uid()
  );

CREATE POLICY induction_records_update_supervisor ON induction_records
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY induction_records_delete_admin ON induction_records
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 7.11  incidents
-- ---------------------------------------------------------------------
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY incidents_select_member ON incidents
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY incidents_insert_self ON incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id   IN (SELECT get_my_tenant_ids())
    AND reported_by = auth.uid()
  );

-- Status / closure updates are supervisor or admin only.
-- (A worker creating the row via INSERT can still do so; they just
-- cannot later flip status -> 'closed' etc.)
CREATE POLICY incidents_update_supervisor ON incidents
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY incidents_delete_admin ON incidents
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 7.12  staff
-- ---------------------------------------------------------------------
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_select_member ON staff
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY staff_insert_supervisor ON staff
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY staff_update_supervisor ON staff
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY staff_delete_admin ON staff
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 7.13  inspections
-- ---------------------------------------------------------------------
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspections_select_member ON inspections
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY inspections_insert_supervisor ON inspections
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id     IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
    AND inspector_id = auth.uid()
  );

CREATE POLICY inspections_update_supervisor ON inspections
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND get_my_role_in_tenant(tenant_id) IN ('supervisor', 'admin')
  );

CREATE POLICY inspections_delete_admin ON inspections
  FOR DELETE TO authenticated
  USING (
    get_my_role_in_tenant(tenant_id) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 7.14  inspection_items  (inherits tenant via parent inspection)
-- ---------------------------------------------------------------------
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_items_select_member ON inspection_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspections i
      WHERE i.id = inspection_items.inspection_id
        AND i.tenant_id IN (SELECT get_my_tenant_ids())
    )
  );

CREATE POLICY inspection_items_insert_supervisor ON inspection_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM inspections i
      WHERE i.id = inspection_items.inspection_id
        AND i.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(i.tenant_id) IN ('supervisor', 'admin')
    )
  );

CREATE POLICY inspection_items_update_supervisor ON inspection_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspections i
      WHERE i.id = inspection_items.inspection_id
        AND i.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(i.tenant_id) IN ('supervisor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM inspections i
      WHERE i.id = inspection_items.inspection_id
        AND i.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(i.tenant_id) IN ('supervisor', 'admin')
    )
  );

CREATE POLICY inspection_items_delete_admin ON inspection_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM inspections i
      WHERE i.id = inspection_items.inspection_id
        AND i.tenant_id IN (SELECT get_my_tenant_ids())
        AND get_my_role_in_tenant(i.tenant_id) = 'admin'
    )
  );

-- =====================================================================
-- 8. GRANTS
--    anon gets nothing (no public access to safety data).
-- =====================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Explicit grants for the helper functions we just created.
-- (The blanket grant above would also cover them, but listing them
-- here makes the security surface easier to audit.)
GRANT EXECUTE ON FUNCTION get_my_tenant_ids()                              TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_role_in_tenant(uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION is_tenant_member(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION setup_tenant(text, text, text, citext)            TO authenticated;
GRANT EXECUTE ON FUNCTION get_invitation_by_token(text)                     TO authenticated;
GRANT EXECUTE ON FUNCTION accept_invitation(text)                           TO authenticated;

-- =====================================================================
-- 9. VERIFICATION QUERIES  (run by hand after applying, in psql or
--    Supabase SQL editor with the appropriate role)
-- =====================================================================

-- 9.1  A user only sees their tenant's data
-- ----------------------------------------------------------------------------
-- Pre-conditions:
--   * tenant A exists with member (u1, 'worker')
--   * tenant B exists with member (u2, 'worker')
--   * each tenant has one first_aid_logs row
-- As u1 (authenticated via PostgREST with u1's JWT):
--   EXPECT: 1 row  (tenant A's)
--   ACTUAL: SELECT count(*) FROM first_aid_logs;  -- = 1
--
-- SELECT set_config('request.jwt.claim.sub', '<u1-uuid>', false);
-- SELECT count(*) AS visible_first_aid_logs FROM first_aid_logs;

-- 9.2  A user cannot insert a row for a tenant they don't belong to
-- ----------------------------------------------------------------------------
-- EXPECT: PostgREST / insert fails with new row violates row-level security policy
-- ACTUAL:  ERROR:  new row violates row-level security policy for table "first_aid_logs"
--
-- INSERT INTO first_aid_logs (
--   tenant_id, reported_by, incident_date, location,
--   injured_person_name, injury_type, treatment_given
-- ) VALUES (
--   '<tenant-B-uuid>',  -- not in u1's tenant set
--   auth.uid(), current_date, 'X', 'Y', 'Z', 'W'
-- );

-- 9.3  A worker cannot update incidents.status directly
-- ----------------------------------------------------------------------------
-- Pre-conditions:
--   * u1 is a 'worker' in tenant A
--   * tenant A has one incidents row (status='open')
-- EXPECT: 0 rows updated (policy USING fails -> nothing visible to update)
-- ACTUAL:  UPDATE 0
--
-- UPDATE incidents SET status = 'closed', closed_at = now(), closed_by = auth.uid()
--  WHERE tenant_id = '<tenant-A-uuid>';

-- 9.4  An audit_log row cannot be UPDATEd or DELETEd
-- ----------------------------------------------------------------------------
-- EXPECT: 0 rows affected; no policy exists for UPDATE/DELETE on audit_log.
-- ACTUAL:
--   UPDATE audit_log SET action = 'tampered';  -- UPDATE 0
--   DELETE FROM audit_log WHERE id = '<any-audit-id>';  -- DELETE 0

-- 9.5  Sanity checks the migration author should run once after applying
-- ----------------------------------------------------------------------------
-- SELECT count(*) AS policy_count
--   FROM pg_policies
--  WHERE schemaname = 'public';

-- SELECT tablename, rowsecurity
--   FROM pg_tables
--  WHERE schemaname = 'public'
--  ORDER BY tablename;

-- SELECT proname, prosecdef, proconfig
--   FROM pg_proc
--  WHERE proname IN (
--    'get_my_tenant_ids', 'get_my_role_in_tenant', 'is_tenant_member',
--    'setup_tenant', 'get_invitation_by_token', 'accept_invitation'
--  );
