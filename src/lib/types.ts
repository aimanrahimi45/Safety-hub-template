// =====================================================================
// TypeScript types mirroring supabase/migrations/20260712_phase1a_solo_sho.sql
//
// These are hand-rolled string-literal unions and row shapes — we are
// not using `supabase gen types` in this phase. Keep them in sync with
// the SQL migration when columns or enums change.
// =====================================================================

// --- Enums -------------------------------------------------------------

export type IncidentSeverityType = 'First Aid' | 'Minor' | 'Major' | 'Fatal' | 'Other';
export type PpeRequestStatus = 'pending_approval' | 'approved_dispatched';
export type ContractorStatus =
  | 'pending_induction'
  | 'inducted'
  | 'suspended'
  | 'blacklisted';
export type InspectionStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'overdue';
export type InventoryTransactionType =
  | 'restock'
  | 'deduct_first_aid'
  | 'manual_adjustment'
  | 'initial_seed';
export type InspectionResponseType = 'yes_no' | 'text' | 'number' | 'pass_fail' | 'dropdown';
export type LicensePlanType = 'free' | 'premium';

// --- Tables ------------------------------------------------------------

export interface Tenant {
  id: string;
  owner_user_id: string;
  name: string;
  license_key: string | null;
  company_name: string | null;
  industry: string | null;
  subscription_plan: LicensePlanType;
  subscription_expires_at: string | null;
  subscription_activated_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
  ip_address: string | null;
  created_at: string;
}

export interface FirstAidLog {
  id: string;
  tenant_id: string;
  reported_by: string;
  incident_date: string;
  incident_time: string | null;
  location: string;
  injured_person_name: string;
  injured_person_id: string | null;
  injury_type: string;
  treatment_given: string;
  referred_to_hospital: boolean;
  hospital_name: string | null;
  status: string;
  deducted_from_inventory: boolean;
  signature_url: string | null;
  signature_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FirstAidDetail {
  id: string;
  first_aid_log_id: string;
  item_description: string;
  quantity: number;
  notes: string | null;
  created_at: string;
}

// PPE Issue Log (per-issue model; see supabase/migrations/20260712_phase2_ppe_rebuild.sql).
// One row = one PPE item issued to one staff member, with reason and
// condition recorded. There is no separate ppe_items child table.
export interface PpeRequest {
  id: string;
  tenant_id: string;
  request_code: string;
  request_date: string;
  staff_id: string;
  staff_name: string;
  department: string;
  ppe_type: string;
  size: string | null;
  color_specs: string | null;
  replacement_reason: string;
  condition_remarks: string | null;
  status: PpeRequestStatus;
  authorized_by: string | null;
  action_date: string;
  recorded_by: string;
  created_at: string;
  updated_at: string;
}

// Returned by the check_last_ppe_issue(p_staff_id, p_ppe_type) RPC.
// When no prior issue exists the RPC returns 0 rows; the client then
// treats (null found) as false.
export interface PpeIssueCheck {
  found: boolean;
  last_date: string | null;
  diff_months: number | null;
}

// Tenant-level configuration (ppe_types + departments are stored as
// comma-separated strings on tenants; this shape is the client-side
// derived view used by the settings page and the PPE form dropdowns).
export interface TenantSettings {
  ppeTypes: string[];
  departments: string[];
}

export interface Contractor {
  id: string;
  tenant_id: string;
  company_name: string;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  work_scope: string | null;
  status: ContractorStatus;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface InductionRecord {
  id: string;
  tenant_id: string;
  contractor_id: string;
  inducted_by: string;
  worker_name: string;
  worker_ic: string | null;
  induction_date: string;
  topics_covered: string[];
  signature_url: string | null;
  photo_url: string | null;
  expires_at: string | null;
  created_at: string;
}

// Returned by the lookup_worker_by_ic(p_ic) RPC.
// When no matching induction is found, the RPC returns 0 rows; the
// client then renders a "not found" state. When 1 row matches, the
// is_expired flag is true if the induction has an expiry date in the
// past.
export interface WorkerLookupResult {
  found: boolean;
  worker_name: string;
  company_name: string;
  induction_date: string;
  expires_at: string | null;
  is_expired: boolean;
}

// Plain string alias for tenants.contractor_declaration. Defined
// here so settings.astro and the induct form can both refer to a
// single named type rather than re-declaring string in two places.
export type ContractorDeclaration = string;

export interface InductionRecord {
  id: string;
  tenant_id: string;
  contractor_id: string;
  inducted_by: string;
  worker_name: string;
  worker_ic: string | null;
  induction_date: string;
  topics_covered: string[];
  signature_url: string | null;
  expires_at: string | null;
  created_at: string;
}

// Incidents log (legacy 12-column AmerisPro shape; see
// supabase/migrations/20260712_phase2_incidents_rebuild.sql). No
// investigation workflow fields (root_cause, corrective_action, status,
// closed_at, closed_by) — they are intentionally absent and will be
// re-introduced in a later phase. severity_other is required when
// severity_type === 'Other' (DB CHECK constraint enforces it).
export interface Incident {
  id: string;
  tenant_id: string;
  incident_code: string;
  recorded_at: string;
  incident_date: string;
  incident_time: string | null;
  victim_name: string;
  staff_id: string | null;
  location_dept: string;
  body_part_injured: string | null;
  description: string;
  man_days_lost: number;
  severity_type: IncidentSeverityType;
  severity_other: string | null;
  reported_to_jkkp: boolean;
  investigation_submitted: boolean;
  reported_by: string;
  created_at: string;
  updated_at: string;
}

// Returned by the lookup_staff_by_id(p_staff_id) RPC. Used by the
// Premium staff auto-fill on the new incident form. When no staff
// member matches, the RPC returns 0 rows; the client then renders a
// "not found" state. When 1 row matches, total_incidents /
// last_incident_date are the caller's tenant-scoped history for that
// staff member.
export interface StaffLookupResult {
  found: boolean;
  staff_id: string;
  full_name: string;
  department: string | null;
  position: string | null;
  email: string | null;
  is_active: boolean;
  total_incidents: number;
  last_incident_date: string | null;
}

export interface Staff {
  id: string;
  tenant_id: string;
  employee_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  join_date: string | null;
  leave_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Inspection {
  id: string;
  tenant_id: string;
  template_id: string | null;
  inspection_type: string;
  scheduled_date: string;
  completed_date: string | null;
  location: string;
  inspector_id: string;
  // status is reserved for a future schedule feature; currently always
  // defaults to 'scheduled'. The "is done" indicator is
  // completed_date IS NOT NULL. See 20260712_phase2_inspections_rebuild.sql.
  status: InspectionStatus;
  overall_notes: string | null;
  // New in Phase 2.6 — match the legacy AmerisPro audit shape.
  audit_code: string | null;
  auditor_name: string | null;
  auditor_position: string | null;
  signature_url: string | null;
  signature_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionItem {
  id: string;
  inspection_id: string;
  item_description: string;
  // status is kept for backward compat with the Phase 1A CHECK
  // constraint (now removed). New writes go to response_value
  // (free text — Yes / No / N/A / Pass / a number / free text).
  status: 'pass' | 'fail' | 'na' | 'n/a' | string;
  notes: string | null;
  photo_url: string | null;
  // New in Phase 2.6 — the actual answer (free text).
  question_id: string | null;
  response_value: string | null;
  created_at: string;
}

export interface FirstAidInventory {
  id: string;
  tenant_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  current_stock: number;
  min_alert_level: number;
  required_std: string | null;
  category_group: number | null;
  last_updated: string;
  created_at: string;
  is_active: boolean;
}

export interface FirstAidInventoryTransaction {
  id: string;
  tenant_id: string;
  inventory_item_id: string;
  transaction_type: InventoryTransactionType;
  quantity_delta: number;
  balance_after: number;
  reference_id: string | null;
  reference_type: string | null;
  notes: string | null;
  logged_by: string | null;
  logged_at: string;
}

export interface InspectionTemplate {
  id: string;
  tenant_id: string;
  checklist_id: string;
  template_name: string;
  description: string | null;
  is_active: boolean;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InspectionTemplateItem {
  id: string;
  tenant_id: string;
  template_id: string;
  question_id: string;
  display_order: number;
  section: string | null;
  question_text: string;
  response_type: InspectionResponseType;
  risk_level: 'High' | 'Medium' | 'Low' | null;
  is_required: boolean;
  // New in Phase 2.6 — comma-separated options for response_type =
  // 'dropdown' (e.g. "Pass, Fail, Pending"). NULL otherwise.
  options: string | null;
  created_at: string;
}

// --- Import Wizard ----------------------------------------------------
//
// Public API of the reusable Excel/CSV import wizard
// (see src/lib/importWizard.ts). The Staff page uses it for the
// roster import; the Inspections module (Phase 2.6) will reuse it
// for Inspection Template upload.

export interface WizardField {
  /** Key used in each row object returned to onComplete. */
  id: string;
  /** Human-readable label rendered in the mapping card. */
  label: string;
  /** If true, the "Confirm" button stays disabled until this is mapped. */
  required: boolean;
  /** Lowercase keywords auto-matched against source column headers. */
  autoMatches: string[];
  /**
   * Optional. When true, the field is rendered with a small "+ Options"
   * affordance in the mapping card so the user can attach a custom
   * dropdown options list (used by the Inspections module to capture
   * Dropdown field options inline). Captured options are written into
   * the row object as the synthetic "Field Type" + "Options" pair so
   * callers can read them as `r["Field Type"]` / `r["Options"]`.
   */
  enableCustomType?: boolean;
}

/**
 * Row shape returned to `WizardOptions.onComplete`. Every mapped field
 * is a string. When `enableSectionHeaders` is true, an extra boolean
 * `isSectionHeader` may be present on rows the user marked as section
 * headers in the preview (purple-highlighted). Callers decide how to
 * treat them — typically by updating a "currentCategory" context for
 * subsequent question rows (see Inspections import flow).
 */
export type WizardMappedRow = Record<string, string> & {
  isSectionHeader?: boolean;
};

export interface WizardOptions {
  /** Modal title. */
  title: string;
  /** Target fields the caller wants the wizard to populate. */
  fields: WizardField[];
  /**
   * Invoked with the array of mapped row objects when the user
   * clicks "Confirm Import". The wizard shows a loading overlay
   * automatically; on success it closes, on error it stays open.
   */
  onComplete: (mappedRows: WizardMappedRow[]) => void | Promise<void>;
  /**
   * Optional. When true, the wizard shows a "Click Mode" toggle
   * between the upload zone and the preview. In "Main Header" mode
   * the user picks the column-header row (default behaviour). In
   * "Section Headers" mode, clicking a row toggles it as a section
   * header (purple highlight). Marked rows are passed to `onComplete`
   * with `r.isSectionHeader = true` so the caller can treat them
   * specially (e.g. set the category for subsequent question rows).
   *
   * Default: false (legacy Staff behaviour — no toggle shown).
   */
  enableSectionHeaders?: boolean;
}

// --- Auth helper types ------------------------------------------------

export interface AppUser {
  id: string;
  email: string;
}

// --- License validation -----------------------------------------------

export interface LicenseValidationResult {
  valid: boolean;
  planType?: LicensePlanType;
  expiry?: string | null;
  reason?: string;
}

// --- Compliance (Phase 2.7) -------------------------------------------
//
// Types for the Compliance page (4 tabs: Setup Profiler, Active Checklist,
// Policy Standards, AI Legal Search). The legal data lives in the
// separate PUBLIC Supabase project (Project A) and is fetched by
// server-side Astro API routes that call OpenRouter for embeddings and
// the `match_clauses` RPC for vector search. The browser never talks to
// the public Supabase or OpenRouter directly.

export interface TenantProfile {
  industry: string | null;
  headcount: number | null;
  hazards: {
    noise: boolean;
    chemicals: boolean;
    machinery: boolean;
    lifting: boolean;
    toxic: boolean;
    radiation: boolean;
  };
  // Allowed values: 'heights', 'confined', 'chemicals', 'machinery',
  // 'gig', 'petroleum', 'transport', 'noise', 'lifting', 'toxic',
  // 'radiation'.
  operations: string[];
}

// One row returned by the `match_clauses` RPC joined back to its parent
// `obligations` row (and grand-parent `clauses` + `documents` rows).
// This is the shape the Active Checklist, AI Search, and Policy tabs
// all render.
export interface LegalSearchResult {
  id: string;
  clause_id: string;
  clause_text: string;
  section_number: string | null;
  document_name: string;
  document_type: string;
  parent_citations: string[] | null;
  trigger_activity: string;
  required_action: string;
  frequency: string;
  legal_weight: string;
  similarity: number;
}

// Returned by /api/ai-summary. Mirrors the legacy GAS shape
// (status + summary/message) so the existing parseMarkdown helper can
// be reused unchanged on the client.
export interface AiSummaryResponse {
  status: 'SUCCESS' | 'ERROR';
  summary?: string;
  message?: string;
}

// Same shape as LegalSearchResult; the register view groups these by
// `frequency`. Kept as a distinct alias so the type system documents
// the difference.
export interface ComplianceRegisterItem extends LegalSearchResult {}
