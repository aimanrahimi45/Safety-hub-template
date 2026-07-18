// =====================================================================
// Reusable Excel/CSV Import Wizard
//
// A generic, generic-API modal wizard for parsing Excel/CSV files,
// detecting the header row, auto-matching source columns to caller-
// defined target fields, and returning a list of mapped row objects
// to the caller via the onComplete callback.
//
// Design notes
// ------------
// * Self-contained: dynamically injects the CSS it needs into <head>
//   on first use (legacy `shared.js` did the same). All CSS class
//   names are namespaced with `iw-` (import-wizard) to avoid
//   collisions.
// * SheetJS loads on demand from the same CDN the legacy app used
//   (https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js).
// * v1 scope: header-row detection, auto-mapping, manual override,
//   bulk confirm.
// * Phase 2.6 extension (Inspections): `enableSectionHeaders: true`
//   shows a "Click Mode" toggle in the preview. "Main Header" picks
//   the column header row (default). "Section Headers" lets the user
//   toggle any data row as a section header (purple highlight).
//   Marked rows are emitted with `r.isSectionHeader = true` so the
//   caller can treat them specially (e.g. set the currentCategory for
//   subsequent question rows). The Staff flow does not enable this.
// * Phase 2.6 extension (Inspections): when a `WizardField` has
//   `enableCustomType: true`, the mapping card exposes a tiny "+ Type"
//   affordance that lets the user pick a custom response type and
//   attach options (e.g. "Dropdown" + "Pass, Fail, Pending"). The
//   captured value is emitted on each row as `r["Field Type"]` and
//   `r["Options"]`. Other callers can ignore both new keys.
// * Strictly typed; no `any`.
// =====================================================================

// --- Public types -----------------------------------------------------
//
// WizardField, WizardOptions and WizardMappedRow live in
// src/lib/types.ts so they can be imported by callers without pulling
// in this file (and so the wizard and the Staff / Inspections pages
// share one type definition).

import type { WizardField, WizardOptions, WizardMappedRow } from './types';

export type { WizardField, WizardOptions, WizardMappedRow };

// --- Internal types ---------------------------------------------------

/** A single cell value as parsed from the source file. */
type CellValue = string | number | null | undefined;

/** A single row of the source file, as an array of cells. */
type SourceRow = CellValue[];

// --- SheetJS minimal typing -------------------------------------------
// SheetJS is loaded from a CDN script tag, so there's no @types
// package. We declare just the surface we use (read + sheet_to_json).

interface SheetJSSheet {
  [key: string]: unknown;
}
interface SheetJSWorkbook {
  SheetNames: string[];
  Sheets: Record<string, SheetJSSheet>;
}
interface SheetJSLib {
  read: (data: ArrayBuffer, opts: { type: 'array' }) => SheetJSWorkbook;
  utils: {
    sheet_to_json: <T = unknown>(
      sheet: SheetJSSheet,
      opts: { header: 1; defval: string; blankrows: boolean },
    ) => T[];
  };
}
declare global {
  interface Window {
    XLSX?: SheetJSLib;
  }
}

/** The auto-match algorithm picks one of these for each source column. */
interface SourceColumnDecision {
  /** Source column index. */
  colIdx: number;
  /** Header text from the chosen header row. */
  header: string;
  /** Target field id this column is mapped to, or null if SKIP. */
  mappedFieldId: string | null;
}

// --- Style injection --------------------------------------------------

const STYLE_ID = "import-wizard-styles";

const WIZARD_CSS = `
/* Overlay (covers the page; high z-index) */
.iw-overlay {
  position: fixed;
  inset: 0;
  background: rgba(30, 30, 29, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11000;
  padding: 20px;
  font-family: inherit;
}

/* Modal panel */
.iw-modal {
  background: var(--color-bg, #fff);
  border: 1px solid var(--color-border, #E0E0E0);
  width: 100%;
  max-width: 1000px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0,0,0,0.18);
}
@media (max-width: 720px) { .iw-modal { max-width: 100%; } }

/* Header */
.iw-header {
  background: var(--color-bg-grey, #F4F4F4);
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border, #E0E0E0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.iw-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 900;
  color: var(--color-text, #1E1E1D);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.iw-close-btn {
  background: transparent;
  border: 1px solid var(--color-border, #E0E0E0);
  color: var(--color-text, #1E1E1D);
  width: 32px;
  height: 32px;
  font-size: 1.2rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.iw-close-btn:hover { color: var(--color-primary, #E58E1A); border-color: var(--color-primary, #E58E1A); }
.iw-close-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Body */
.iw-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Upload zone */
.iw-upload-zone {
  border: 2px dashed var(--color-border, #E0E0E0);
  background: #FAFAFA;
  border-radius: 12px;
  padding: 36px 20px;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.iw-upload-zone:hover { background: #F4F4F4; }
.iw-upload-zone.iw-dragover { background: #FFF7E6; border-color: var(--color-primary, #E58E1A); }
.iw-upload-text { font-weight: 700; font-size: 1.05rem; color: var(--color-text, #1E1E1D); }
.iw-upload-hint { font-size: 0.8rem; color: var(--color-text-muted, #6A6A69); margin-top: 6px; }

/* Section label inside body */
.iw-step-label {
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text, #1E1E1D);
}
.iw-step-hint {
  font-size: 0.75rem;
  color: var(--color-text-muted, #6A6A69);
  margin-top: -4px;
}

/* Preview table (Step 1) */
.iw-preview-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.iw-preview-scroll {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg, #fff);
}
.iw-preview-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.iw-preview-table th,
.iw-preview-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light, #F0F0F0);
  text-align: left;
  white-space: nowrap;
  border-right: 1px solid var(--color-border-light, #F0F0F0);
}
.iw-preview-table thead th {
  background: var(--color-bg-grey, #F4F4F4);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #6A6A69);
  position: sticky; top: 0;
}
.iw-preview-table tbody tr { cursor: pointer; }
.iw-preview-table tbody tr:hover td { background: #FAFAFA; }
.iw-preview-table tbody tr.iw-selected-header td {
  background: #FFF7E6 !important;
  font-weight: 700;
  border-top: 2px dashed var(--color-primary, #E58E1A);
  border-bottom: 2px dashed var(--color-primary, #E58E1A);
}
/* Section-header rows (Phase 2.6 Inspections extension). Soft purple
   background to match dist/shared.js:596-602. Only applied when
   enableSectionHeaders: true and the row has been toggled. */
.iw-preview-table tbody tr.iw-selected-section-header td {
  background: #F3E8FF !important;
  font-weight: 700;
  color: #5B21B6;
  border-top: 2px dashed #8B5CF6;
  border-bottom: 2px dashed #8B5CF6;
}
.iw-preview-table .iw-row-num {
  background: var(--color-bg-grey, #F4F4F4);
  font-weight: 700;
  text-align: center;
  color: var(--color-text-muted, #6A6A69);
  width: 56px;
  border-right: 2px solid var(--color-border, #E0E0E0);
}

/* Click Mode toggle (Phase 2.6 Inspections extension). Shown only when
   enableSectionHeaders: true. Compact pill-style segmented control. */
.iw-click-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--color-bg-grey, #F4F4F4);
  border: 1px solid var(--color-border, #E0E0E0);
  font-size: 0.78rem;
}
.iw-click-mode-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #6A6A69);
  margin-right: 4px;
}
.iw-click-mode-btn {
  font-family: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 5px 10px;
  border: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
  cursor: pointer;
}
.iw-click-mode-btn:hover { color: var(--color-primary, #E58E1A); border-color: var(--color-primary, #E58E1A); }
.iw-click-mode-btn.iw-active {
  background: #8B5CF6;
  color: #fff;
  border-color: #8B5CF6;
}
.iw-click-mode-hint {
  font-size: 0.72rem;
  color: var(--color-text-muted, #6A6A69);
  margin-left: 4px;
}

/* Custom-type controls (Phase 2.6 Inspections extension). Lets the
   user pick a response type (Yes/No, Dropdown, Text, Number, Pass/Fail)
   and optionally enter a comma-separated options list. The captured
   value is written into every row as r["Field Type"] / r["Options"]. */
.iw-custom-type {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.iw-custom-type select,
.iw-custom-type input {
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 5px 8px;
  border: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
}
.iw-custom-type select:focus,
.iw-custom-type input:focus {
  outline: 2px solid #8B5CF6;
  outline-offset: 1px;
  border-color: #8B5CF6;
}
.iw-custom-type-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #6A6A69);
}

/* Mapping grid (Step 2) */
.iw-mapping-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.iw-mapping-card {
  background: #F8F8F8;
  border: 1px solid var(--color-border, #E0E0E0);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.iw-mapping-card-label {
  font-size: 0.7rem;
  color: var(--color-text-muted, #6A6A69);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.iw-mapping-card-header {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text, #1E1E1D);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-mapping-card-header.iw-empty { color: var(--color-text-muted, #6A6A69); font-weight: 500; font-style: italic; }
.iw-mapping-card select {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--color-border, #E0E0E0);
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
}
.iw-mapping-card select:focus {
  outline: 2px solid var(--color-primary, #E58E1A);
  outline-offset: 1px;
  border-color: var(--color-primary, #E58E1A);
}

/* Footer */
.iw-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg-grey, #F4F4F4);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
.iw-btn {
  font-family: inherit;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 0.78rem;
  padding: 10px 18px;
  border: 1px solid var(--color-border, #E0E0E0);
  cursor: pointer;
}
.iw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.iw-btn-secondary {
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
}
.iw-btn-secondary:hover:not(:disabled) {
  color: var(--color-primary, #E58E1A);
  border-color: var(--color-primary, #E58E1A);
}
.iw-btn-primary {
  background: var(--color-primary, #E58E1A);
  color: #fff;
  border-color: var(--color-primary, #E58E1A);
}
.iw-btn-primary:hover:not(:disabled) { background: var(--color-primary-hover, #D07D12); border-color: var(--color-primary-hover, #D07D12); }

/* Inline error banner */
.iw-error {
  background: #FDECEC;
  border: 1px solid #C0392B;
  color: #8B1A1A;
  padding: 10px 14px;
  font-size: 0.85rem;
  font-weight: 600;
}

/* Loading overlay inside the modal */
.iw-loading {
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  font-weight: 700;
  font-size: 1rem;
  color: var(--color-text, #1E1E1D);
  z-index: 2;
}
.iw-spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--color-border, #E0E0E0);
  border-top-color: var(--color-primary, #E58E1A);
  border-radius: 50%;
  animation: iw-spin 0.9s linear infinite;
}
@keyframes iw-spin { to { transform: rotate(360deg); } }

/* Sheet selector container */
.iw-sheet-select-container {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  margin-top: 14px;
}
.iw-sheet-select-container label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #6A6A69);
}
.iw-sheet-select-container select {
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 6px 12px;
  border: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
}
.iw-sheet-select-container select:focus {
  outline: 2px solid var(--color-primary, #E58E1A);
  border-color: var(--color-primary, #E58E1A);
}
`;

/** Inject wizard styles into <head>; idempotent. */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = WIZARD_CSS;
  document.head.appendChild(style);
}

// --- SheetJS lazy loader ---------------------------------------------

/** Load SheetJS from the CDN on first use. Resolves to the global XLSX. */
function loadSheetJS(): Promise<SheetJSLib> {
  return new Promise((resolve, reject) => {
    if (window.XLSX) {
      resolve(window.XLSX);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.async = true;
    script.onload = () => {
      const x = window.XLSX;
      if (x) resolve(x);
      else reject(new Error("SheetJS loaded but global XLSX is missing."));
    };
    script.onerror = () => reject(new Error("Failed to load SheetJS from CDN."));
    document.head.appendChild(script);
  });
}

// --- Helpers ----------------------------------------------------------

function escapeHtml(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal CSV parser (quoted fields + escaped quotes). */
function parseCSV(text: string): SourceRow[] {
  const rows: SourceRow[] = [];
  let row: string[] = [""];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      row.push("");
    } else if ((c === "\r" || c === "\n") && !inQuotes) {
      if (c === "\r" && next === "\n") i++;
      rows.push(row);
      row = [""];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

/**
 * Auto-match a target field against a list of source column headers.
 *
 * Each target field has `autoMatches` — a list of lowercase keyword
 * substrings. The algorithm picks the first source column whose
 * header (lowercased, trimmed) contains any of the keywords. If two
 * target fields would match the same source column, the earlier field
 * in the input list wins and the other column is left unmapped.
 *
 * The header text is also lowercased once, so the substring check
 * is case-insensitive without per-keyword work.
 */
function autoMapColumns(
  headers: string[],
  fields: WizardField[],
): SourceColumnDecision[] {
  const usedCols = new Set<number>();
  const decisions: SourceColumnDecision[] = headers.map((h, colIdx) => ({
    colIdx,
    header: h,
    mappedFieldId: null,
  }));

  for (const field of fields) {
    const keywords = (field.autoMatches ?? []).map((k) => k.toLowerCase());
    if (keywords.length === 0) continue;
    for (const d of decisions) {
      if (usedCols.has(d.colIdx)) continue;
      const h = (d.header || "").toLowerCase().trim();
      if (!h) continue;
      if (keywords.some((k) => h.includes(k))) {
        d.mappedFieldId = field.id;
        usedCols.add(d.colIdx);
        break;
      }
    }
  }
  return decisions;
}

// --- Public entrypoint ------------------------------------------------

/**
 * Open the Import Wizard modal. The wizard takes over the page until
 * the user either cancels or confirms. `options.onComplete` receives
 * the array of mapped row objects (string-valued). All other UI
 * (filters, validation, etc.) is the caller's responsibility.
 */
export function openImportWizard(options: WizardOptions): void {
  if (!options || !Array.isArray(options.fields) || options.fields.length === 0) {
    throw new Error("openImportWizard: options.fields is required.");
  }
  if (typeof options.onComplete !== "function") {
    throw new Error("openImportWizard: options.onComplete is required.");
  }

  injectStyles();

  // -------------------------------------------------------------------
  // State (closure-scoped)
  // -------------------------------------------------------------------
  let parsedRows: SourceRow[] = [];
  let headerRowIdx = 0;
  let sourceColumnDecisions: SourceColumnDecision[] = [];
  // Phase 2.6 Inspections extension: section-header support.
  const enableSections = options.enableSectionHeaders === true;
  type ClickMode = 'HEADER' | 'SECTION';
  let clickMode: ClickMode = 'HEADER';
  const sectionHeaderRowIdxs: Set<number> = new Set<number>();
  // Phase 2.6 Inspections extension: per-field custom type capture.
  // Map<fieldId, { fieldType: string, options: string }>.
  const customTypeValues: Map<string, { fieldType: string; options: string }> = new Map();

  // -------------------------------------------------------------------
  // DOM construction
  // -------------------------------------------------------------------
  const overlay = document.createElement("div");
  overlay.className = "iw-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", options.title);

  overlay.innerHTML = `
    <div class="iw-modal">
      <div class="iw-header">
        <h3 class="iw-title">${escapeHtml(options.title)}</h3>
        <button type="button" class="iw-close-btn" id="iw-close-x" aria-label="Close">&times;</button>
      </div>
      <div class="iw-body">
        <div id="iw-error" class="iw-error" hidden></div>
 
        <!-- Step 0: Upload & Sheet Select -->
        <div class="iw-preview-wrap" id="iw-step-upload">
          <div class="iw-upload-zone" id="iw-drop-zone">
            <input type="file" id="iw-file-input" accept=".csv,.xlsx,.xls" hidden />
            <div class="iw-upload-text">📥 Click or drag an Excel/CSV file here</div>
            <div class="iw-upload-hint">Supports .csv, .xlsx, .xls</div>
          </div>
          <div id="iw-sheet-container" class="iw-sheet-select-container" hidden></div>
        </div>
 
        <!-- Step 1: Header row selection -->
        <div class="iw-preview-wrap" id="iw-step-preview" hidden>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div>
              <span class="iw-step-label" id="iw-step-1-label">Step 1 — Click the row that contains the column headers</span>
              <span class="iw-step-hint" id="iw-step-1-hint">Row 1 is selected by default. Click any other row to use it as the header.</span>
            </div>
            <div class="iw-click-mode" id="iw-click-mode" hidden>
              <span class="iw-click-mode-label">Click Mode</span>
              <button type="button" class="iw-click-mode-btn iw-active" id="iw-mode-header" data-mode="HEADER">Main Header</button>
              <button type="button" class="iw-click-mode-btn" id="iw-mode-section" data-mode="SECTION">Section Headers</button>
              <span class="iw-click-mode-hint" id="iw-mode-hint">Row 1 is selected by default</span>
            </div>
          </div>
          <div class="iw-preview-scroll">
            <table class="iw-preview-table" aria-label="File preview">
              <thead id="iw-thead"></thead>
              <tbody id="iw-tbody"></tbody>
            </table>
          </div>
        </div>
 
        <!-- Step 2: Field mapping -->
        <div class="iw-preview-wrap" id="iw-step-mapping" hidden>
          <span class="iw-step-label">Step 2 — Match each column to a target field</span>
          <span class="iw-step-hint">Skip columns you do not want to import. Required fields are marked with ★.</span>
          <div class="iw-mapping-grid" id="iw-mapping-grid"></div>
        </div>
      </div>
      <div class="iw-footer">
        <button type="button" class="iw-btn iw-btn-secondary" id="iw-btn-cancel" style="margin-right: auto;">Cancel</button>
        <button type="button" class="iw-btn iw-btn-secondary" id="iw-btn-back" hidden>Back</button>
        <button type="button" class="iw-btn iw-btn-primary" id="iw-btn-next" hidden disabled>Next</button>
        <button type="button" class="iw-btn iw-btn-primary" id="iw-btn-confirm" hidden disabled>Confirm &amp; Import</button>
      </div>
      <div id="iw-loading" class="iw-loading" hidden>
        <div class="iw-spinner" aria-hidden="true"></div>
        <div id="iw-loading-text">Importing…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Make the modal its own positioning context so the loading overlay
  // can sit absolutely on top of it.
  const modal = overlay.querySelector<HTMLElement>(".iw-modal")!;
  modal.style.position = "relative";

  // Refs
  const errEl = overlay.querySelector<HTMLElement>("#iw-error")!;
  const stepUpload = overlay.querySelector<HTMLElement>("#iw-step-upload")!;
  const dropZone = overlay.querySelector<HTMLElement>("#iw-drop-zone")!;
  const fileInput = overlay.querySelector<HTMLInputElement>("#iw-file-input")!;
  const sheetContainer = overlay.querySelector<HTMLElement>("#iw-sheet-container")!;
  const stepPreview = overlay.querySelector<HTMLElement>("#iw-step-preview")!;
  const stepMapping = overlay.querySelector<HTMLElement>("#iw-step-mapping")!;
  const thead = overlay.querySelector<HTMLElement>("#iw-thead")!;
  const tbody = overlay.querySelector<HTMLElement>("#iw-tbody")!;
  const mappingGrid = overlay.querySelector<HTMLElement>("#iw-mapping-grid")!;
  const closeXBtn = overlay.querySelector<HTMLButtonElement>("#iw-close-x")!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>("#iw-btn-cancel")!;
  const backBtn = overlay.querySelector<HTMLButtonElement>("#iw-btn-back")!;
  const nextBtn = overlay.querySelector<HTMLButtonElement>("#iw-btn-next")!;
  const confirmBtn = overlay.querySelector<HTMLButtonElement>("#iw-btn-confirm")!;
  const loadingEl = overlay.querySelector<HTMLElement>("#iw-loading")!;
  const loadingText = overlay.querySelector<HTMLElement>("#iw-loading-text")!;
  // Phase 2.6 Inspections extension refs (only visible when
  // enableSectionHeaders: true).
  const step1Label = overlay.querySelector<HTMLElement>("#iw-step-1-label")!;
  const step1Hint = overlay.querySelector<HTMLElement>("#iw-step-1-hint")!;
  const clickModeBox = overlay.querySelector<HTMLElement>("#iw-click-mode")!;
  const modeHeaderBtn = overlay.querySelector<HTMLButtonElement>("#iw-mode-header")!;
  const modeSectionBtn = overlay.querySelector<HTMLButtonElement>("#iw-mode-section")!;
  const modeHint = overlay.querySelector<HTMLElement>("#iw-mode-hint")!;

  let currentStep = 0; // 0: Upload, 1: Header Picker, 2: Field Mapping

  function showStep(stepIdx: number): void {
    currentStep = stepIdx;
    clearError();

    // Hide all step containers
    stepUpload.hidden = true;
    stepPreview.hidden = true;
    stepMapping.hidden = true;

    // Hide all footer action buttons by default
    backBtn.hidden = true;
    nextBtn.hidden = true;
    confirmBtn.hidden = true;

    if (currentStep === 0) {
      stepUpload.hidden = false;
      nextBtn.hidden = false;
      nextBtn.disabled = parsedRows.length === 0;
    } else if (currentStep === 1) {
      stepPreview.hidden = false;
      backBtn.hidden = false;
      nextBtn.hidden = false;
      nextBtn.disabled = false;
    } else if (currentStep === 2) {
      stepMapping.hidden = false;
      backBtn.hidden = false;
      confirmBtn.hidden = false;
      refreshConfirmEnabled();
    }
  }

  function showError(msg: string): void {
    errEl.hidden = false;
    errEl.textContent = msg;
  }
  function clearError(): void {
    errEl.hidden = true;
    errEl.textContent = "";
  }

  function closeModal(): void {
    overlay.remove();
  }

  function setBusy(busy: boolean, msg?: string): void {
    if (busy) {
      loadingEl.hidden = false;
      if (msg) loadingText.textContent = msg;
      closeXBtn.disabled = true;
      cancelBtn.disabled = true;
      backBtn.disabled = true;
      nextBtn.disabled = true;
      confirmBtn.disabled = true;
    } else {
      loadingEl.hidden = true;
      closeXBtn.disabled = false;
      cancelBtn.disabled = false;
      backBtn.disabled = false;
      nextBtn.disabled = false;
      refreshConfirmEnabled();
    }
  }

  // -------------------------------------------------------------------
  // File parsing
  // -------------------------------------------------------------------
  async function processFile(file: File): Promise<void> {
    clearError();
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xls");
    const isCsv = lower.endsWith(".csv");
    if (!isExcel && !isCsv) {
      showError("Unsupported file format. Please upload a .csv, .xlsx, or .xls file.");
      return;
    }

    // Update upload zone text to confirm selection.
    const textEl = dropZone.querySelector<HTMLElement>(".iw-upload-text")!;
    const hintEl = dropZone.querySelector<HTMLElement>(".iw-upload-hint")!;
    textEl.innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${Math.round(file.size / 1024)} KB)`;
    hintEl.textContent = "Click again or drop another file to replace.";

    try {
      if (isExcel) {
        const XLSX = await loadSheetJS();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });

        // If workbook has multiple sheets, show the selector
        if (wb.SheetNames.length > 1) {
          let selectHtml = `<label for="iw-sheet-select">Select Sheet: </label>`;
          selectHtml += `<select id="iw-sheet-select">`;
          wb.SheetNames.forEach((name) => {
            selectHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
          });
          selectHtml += `</select>`;
          sheetContainer.innerHTML = selectHtml;
          sheetContainer.hidden = false;

          const sheetSelect = sheetContainer.querySelector<HTMLSelectElement>("#iw-sheet-select")!;
          sheetSelect.addEventListener("change", () => {
            clearError();
            const selectedName = sheetSelect.value;
            const sheet = wb.Sheets[selectedName];
            if (sheet) {
              const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
                header: 1,
                defval: "",
                blankrows: false,
              });
              parsedRows = rows.map((r: SourceRow | undefined) => r ?? []);
              headerRowIdx = 0;
              sectionHeaderRowIdxs.clear();
              renderPreview();
              renderMapping();
            }
          });
        } else {
          sheetContainer.hidden = true;
          sheetContainer.innerHTML = "";
        }

        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) {
          showError("The uploaded workbook has no sheets.");
          return;
        }
        const sheet = wb.Sheets[firstSheet];
        const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
          header: 1,
          defval: "",
          blankrows: false,
        });
        if (rows.length === 0) {
          showError("The uploaded sheet is empty.");
          return;
        }
        parsedRows = rows.map((r: SourceRow | undefined) => r ?? []);
      } else {
        sheetContainer.hidden = true;
        sheetContainer.innerHTML = "";
        const text = await file.text();
        const rows = parseCSV(text);
        if (rows.length === 0) {
          showError("The uploaded file is empty.");
          return;
        }
        parsedRows = rows;
      }
      headerRowIdx = 0;
      sectionHeaderRowIdxs.clear();
      // Show click-mode toggle only when the caller opted in.
      clickModeBox.hidden = !enableSections;
      setClickMode("HEADER");
      renderMapping();
      
      // Update navigation step
      nextBtn.disabled = false;
      showStep(0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse the file.";
      showError(msg);
    }
  }

  // -------------------------------------------------------------------
  // Step 1: header row picker (with optional section-header mode)
  // -------------------------------------------------------------------
  function renderPreview(): void {
    thead.innerHTML = "";
    tbody.innerHTML = "";
    // Re-apply click-mode button active state after table rebuild so the
    // highlighted button never visually deselects.
    if (enableSections) {
      if (clickMode === "HEADER") {
        modeHeaderBtn.classList.add("iw-active");
        modeSectionBtn.classList.remove("iw-active");
      } else {
        modeHeaderBtn.classList.remove("iw-active");
        modeSectionBtn.classList.add("iw-active");
      }
    }
    if (parsedRows.length === 0) return;

    const maxCols = Math.max(
      ...parsedRows.slice(0, 20).map((r) => r.length),
      1,
    );
    let headHtml = `<th class="iw-row-num">Row</th>`;
    for (let j = 0; j < maxCols; j++) {
      headHtml += `<th>Col ${j + 1}</th>`;
    }
    thead.innerHTML = `<tr>${headHtml}</tr>`;

    const previewLimit = parsedRows.length;
    for (let i = 0; i < previewLimit; i++) {
      const row = parsedRows[i] ?? [];
      const tr = document.createElement("tr");
      if (clickMode === "HEADER" && i === headerRowIdx) {
        tr.className = "iw-selected-header";
      } else if (clickMode === "SECTION" && sectionHeaderRowIdxs.has(i)) {
        tr.className = "iw-selected-section-header";
      }
      tr.addEventListener("click", () => {
        if (clickMode === "HEADER" || !enableSections) {
          headerRowIdx = i;
          renderPreview();
          renderMapping();
          refreshConfirmEnabled();
        } else {
          // SECTION mode — toggle membership.
          if (sectionHeaderRowIdxs.has(i)) {
            sectionHeaderRowIdxs.delete(i);
          } else {
            sectionHeaderRowIdxs.add(i);
          }
          renderPreview();
        }
        // Defensive: re-assert click-mode button active state after every
        // row click so the highlighted button never deselects.
        if (enableSections) {
          if (clickMode === "HEADER") {
            modeHeaderBtn.classList.add("iw-active");
            modeSectionBtn.classList.remove("iw-active");
          } else {
            modeHeaderBtn.classList.remove("iw-active");
            modeSectionBtn.classList.add("iw-active");
          }
        }
      });
      let html = `<td class="iw-row-num">${i + 1}</td>`;
      for (let j = 0; j < maxCols; j++) {
        const cell = row[j] === undefined || row[j] === null ? "" : row[j];
        html += `<td>${escapeHtml(typeof cell === "number" ? String(cell) : cell)}</td>`;
      }
      tr.innerHTML = html;
      tbody.appendChild(tr);
    }
  }

  function setClickMode(mode: ClickMode): void {
    clickMode = mode;
    if (mode === "HEADER") {
      modeHeaderBtn.classList.add("iw-active");
      modeSectionBtn.classList.remove("iw-active");
      step1Label.textContent = "Step 1 — Click the row that contains the column headers";
      step1Hint.textContent = "Row 1 is selected by default. Click any other row to use it as the header.";
      modeHint.textContent = "Row 1 is selected by default";
    } else {
      modeHeaderBtn.classList.remove("iw-active");
      modeSectionBtn.classList.add("iw-active");
      step1Label.textContent = "Step 1 — Mark section header rows";
      step1Hint.textContent = "Click any data row to toggle it as a section header (purple). Section rows are emitted with isSectionHeader = true.";
      modeHint.textContent = `${sectionHeaderRowIdxs.size} row${sectionHeaderRowIdxs.size === 1 ? "" : "s"} marked`;
    }
    renderPreview();
  }

  // -------------------------------------------------------------------
  // Step 2: mapping grid
  // -------------------------------------------------------------------
  function getHeaders(): string[] {
    const row = parsedRows[headerRowIdx];
    if (!row) return [];
    return row.map((c) => String(c ?? "").trim());
  }

  function renderMapping(): void {
    const headers = getHeaders();
    sourceColumnDecisions = autoMapColumns(headers, options.fields);

    let html = "";
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const isEmpty = !header;
      const selected = sourceColumnDecisions[i]?.mappedFieldId ?? "";
      const selectId = `iw-map-${i}`;

      let optsHtml = `<option value="">— Skip —</option>`;
      for (const f of options.fields) {
        const isSel = f.id === selected;
        optsHtml += `<option value="${escapeHtml(f.id)}"${isSel ? " selected" : ""}>${f.required ? "★ " : ""}${escapeHtml(f.label)}</option>`;
      }

      html += `
        <div class="iw-mapping-card">
          <span class="iw-mapping-card-label">Column ${i + 1}</span>
          <span class="iw-mapping-card-header ${isEmpty ? "iw-empty" : ""}" title="${escapeHtml(header)}">${isEmpty ? "[empty header]" : `"${escapeHtml(header)}"`}</span>
          <select id="${selectId}" data-colidx="${i}">
            ${optsHtml}
          </select>
        </div>
      `;
    }

    // Phase 2.6 Inspections extension: render a "Field Type" + "Options"
    // card for any WizardField that opts in via `enableCustomType: true`.
    // The captured value is written into every output row as
    // r["Field Type"] / r["Options"]. Other callers can ignore the keys.
    if (options.fields.some((f) => f.enableCustomType)) {
      for (const f of options.fields) {
        if (!f.enableCustomType) continue;
        const initial = customTypeValues.get(f.id) ?? { fieldType: "Yes/No", options: "" };
        const fieldTypeId = `iw-custom-type-${cssIdEscape(f.id)}`;
        const optionsId = `iw-custom-opts-${cssIdEscape(f.id)}`;
        html += `
          <div class="iw-mapping-card">
            <span class="iw-mapping-card-label">${escapeHtml(f.label)}</span>
            <span class="iw-mapping-card-header">Response Type &amp; Options</span>
            <div class="iw-custom-type">
              <span class="iw-custom-type-label">Type</span>
              <select id="${fieldTypeId}" data-field-id="${escapeHtml(f.id)}">
                <option value="Yes/No"${initial.fieldType === "Yes/No" ? " selected" : ""}>Yes/No</option>
                <option value="Dropdown"${initial.fieldType === "Dropdown" ? " selected" : ""}>Dropdown</option>
                <option value="Text"${initial.fieldType === "Text" ? " selected" : ""}>Text</option>
                <option value="Number"${initial.fieldType === "Number" ? " selected" : ""}>Number</option>
                <option value="Pass/Fail"${initial.fieldType === "Pass/Fail" ? " selected" : ""}>Pass/Fail</option>
              </select>
              <span class="iw-custom-type-label">Options</span>
              <input type="text" id="${optionsId}" data-field-id="${escapeHtml(f.id)}" placeholder="e.g. Pass, Fail, Pending" value="${escapeHtml(initial.options)}" />
            </div>
          </div>
        `;
      }
    }

    mappingGrid.innerHTML = html;

    for (let i = 0; i < headers.length; i++) {
      const sel = mappingGrid.querySelector<HTMLSelectElement>(`#iw-map-${i}`);
      if (!sel) continue;
      sel.addEventListener("change", () => {
        sourceColumnDecisions[i].mappedFieldId = sel.value || null;
        refreshConfirmEnabled();
      });
    }

    // Wire custom-type handlers (Phase 2.6 Inspections extension).
    for (const f of options.fields) {
      if (!f.enableCustomType) continue;
      const safeId = cssIdEscape(f.id);
      const typeSel = mappingGrid.querySelector<HTMLSelectElement>(`#iw-custom-type-${safeId}`);
      const optsInput = mappingGrid.querySelector<HTMLInputElement>(`#iw-custom-opts-${safeId}`);
      if (typeSel) {
        typeSel.addEventListener("change", () => {
          const cur = customTypeValues.get(f.id) ?? { fieldType: "Yes/No", options: "" };
          cur.fieldType = typeSel.value;
          customTypeValues.set(f.id, cur);
        });
      }
      if (optsInput) {
        optsInput.addEventListener("input", () => {
          const cur = customTypeValues.get(f.id) ?? { fieldType: typeSel?.value ?? "Yes/No", options: "" };
          cur.options = optsInput.value;
          customTypeValues.set(f.id, cur);
        });
      }
    }
  }

  // Sanitise a WizardField.id so it can be used as a CSS id suffix.
  function cssIdEscape(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function refreshConfirmEnabled(): void {
    if (sourceColumnDecisions.length === 0) {
      confirmBtn.disabled = true;
      return;
    }
    const mappedFieldIds = new Set(
      sourceColumnDecisions
        .map((d) => d.mappedFieldId)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    );
    const missing = options.fields
      .filter((f) => f.required && !mappedFieldIds.has(f.id))
      .map((f) => f.label);
    confirmBtn.disabled = missing.length > 0;
    if (missing.length > 0) {
      confirmBtn.title = "Map required fields first: " + missing.join(", ");
    } else {
      confirmBtn.title = "";
    }
  }

  // -------------------------------------------------------------------
  // Build mapped rows from the source data.
  //
  // Returns: one record per data row (rows AFTER the chosen header),
  // with each target field populated from the mapped source column.
  // Rows that are entirely empty (no value in any mapped column) are
  // skipped. Stringifies all values to keep the onComplete signature
  // simple — callers that need numbers/booleans can parse() them.
  //
  // Phase 2.6 Inspections extensions:
  //   * Rows whose index is in sectionHeaderRowIdxs are emitted with
  //     `isSectionHeader: true` so the caller can treat them as
  //     category headers (e.g. set currentCategory for the next
  //     question rows). The caller can decide whether to keep or
  //     drop the row from the final dataset.
  //   * When a WizardField has `enableCustomType: true`, the captured
  //     Field Type + Options are written into every row as
  //     r["Field Type"] / r["Options"].
  // -------------------------------------------------------------------
  function buildMappedRows(): WizardMappedRow[] {
    const headers = getHeaders();
    const mappedCols: Record<string, number> = {};
    for (const d of sourceColumnDecisions) {
      if (d.mappedFieldId) mappedCols[d.mappedFieldId] = d.colIdx;
    }
    const out: WizardMappedRow[] = [];
    for (let i = headerRowIdx + 1; i < parsedRows.length; i++) {
      const row = parsedRows[i] ?? [];
      if (row.length === 0) continue;
      if (row.length === 1 && (row[0] === "" || row[0] === null || row[0] === undefined)) continue;
      const rec: WizardMappedRow = {};
      let anyValue = false;
      for (const f of options.fields) {
        const idx = mappedCols[f.id];
        if (idx === undefined) {
          rec[f.id] = "";
          continue;
        }
        const v = row[idx];
        const s = v === null || v === undefined ? "" : String(v).trim();
        rec[f.id] = s;
        if (s.length > 0) anyValue = true;
      }
      // Phase 2.6 Inspections extension: custom type + options.
      for (const f of options.fields) {
        if (!f.enableCustomType) continue;
        const cur = customTypeValues.get(f.id);
        rec["Field Type"] = cur?.fieldType ?? "Yes/No";
        rec["Options"] = cur?.options ?? "";
      }
      // Phase 2.6 Inspections extension: section-header flag.
      if (sectionHeaderRowIdxs.has(i)) {
        rec.isSectionHeader = true;
        // A section-header row may have a "Safety Question" value (the
        // category name) but no other content; that counts as a value
        // for the purposes of including the row in the output.
        const catValue = rec["Safety Question"] ?? rec["Category"] ?? "";
        if (String(catValue).trim().length > 0) anyValue = true;
      }
      if (anyValue) out.push(rec);
    }
    // Keep headers aligned with source for reference.
    void headers;
    return out;
  }

  // -------------------------------------------------------------------
  // Confirm
  // -------------------------------------------------------------------
  async function onConfirm(): Promise<void> {
    clearError();
    const rows = buildMappedRows();
    if (rows.length === 0) {
      showError("No rows with values were found below the header row.");
      return;
    }
    setBusy(true, `Importing ${rows.length} record${rows.length === 1 ? "" : "s"}…`);
    try {
      await options.onComplete(rows);
      // If onComplete resolved without throwing, close the modal.
      closeModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed.";
      setBusy(false);
      showError(msg);
    }
  }

  // -------------------------------------------------------------------
  // Wire up DOM events
  // -------------------------------------------------------------------
  closeXBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  backBtn.addEventListener("click", () => {
    if (currentStep > 0) showStep(currentStep - 1);
  });
  nextBtn.addEventListener("click", () => {
    if (currentStep < 2) showStep(currentStep + 1);
  });
  confirmBtn.addEventListener("click", () => {
    void onConfirm();
  });
  // Phase 2.6 Inspections extension: click-mode toggle.
  modeHeaderBtn.addEventListener("click", () => setClickMode("HEADER"));
  modeSectionBtn.addEventListener("click", () => setClickMode("SECTION"));

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("iw-dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("iw-dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("iw-dragover");
    const f = e.dataTransfer?.files?.[0];
    if (f) void processFile(f);
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void processFile(f);
  });

  // Bootstrap steps
  showStep(0);
}
