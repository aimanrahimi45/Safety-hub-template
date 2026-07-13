// =====================================================================
// Unified CSV export library.
//
// One source of truth for CSV escaping, BOM handling, and HTTP response
// construction. Every server-side API route in src/pages/api/export/*
// and the client-side Compliance register export share these three
// helpers — no code duplication, no per-module escape logic.
//
// The BOM (\uFEFF) is prepended so that Excel on Windows auto-detects
// UTF-8 instead of mis-rendering non-ASCII characters.
//
// Filename characters are scrubbed to [a-zA-Z0-9._-] before being put
// in the Content-Disposition header so a stray quote / slash / semicolon
// from a row value can't break the response.
// =====================================================================

export function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface CsvColumn {
  /** Property name in the row object. Ignored when `format` is set. */
  key: string;
  /** Column header text rendered in the first row. */
  header: string;
  /** Optional formatter that returns the value for this column. */
  format?: (row: Record<string, unknown>) => string | number | boolean | null | undefined;
}

export function buildCsv(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const headerLine = columns.map((c) => escapeCsvValue(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns
      .map((c) => {
        const val = c.format ? c.format(row) : row[c.key];
        return escapeCsvValue(val);
      })
      .join(','),
  );
  return '\uFEFF' + [headerLine, ...dataLines].join('\n');
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
