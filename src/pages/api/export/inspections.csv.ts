import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { buildCsv, csvResponse, type CsvColumn } from '../../../lib/csvExport';
import type { Inspection } from '../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const supabase = createSupabaseServerClient({ request, cookies } as Parameters<typeof createSupabaseServerClient>[0]);
  if (!supabase) return new Response('Supabase is not configured.', { status: 503 });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });
  const { data: tenantId } = await supabase.rpc('get_my_tenant_id');
  if (!tenantId) return new Response('Tenant not found.', { status: 403 });

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const qParam = url.searchParams.get('q');

  let q = supabase
    .from('inspections')
    .select('*')
    .order('scheduled_date', { ascending: false });
  if (from) q = q.gte('scheduled_date', from);
  if (to) q = q.lte('scheduled_date', to);
  if (qParam) {
    q = q.or(
      `audit_code.ilike.%${qParam}%,auditor_name.ilike.%${qParam}%,location.ilike.%${qParam}%,overall_notes.ilike.%${qParam}%`,
    );
  }

  const { data, error } = await q;
  if (error) return new Response(`Query error: ${error.message}`, { status: 500 });

  const rows = (data ?? []) as Inspection[];
  const columns: CsvColumn[] = [
    { key: 'audit_code', header: 'Audit Code' },
    { key: 'id', header: 'ID', format: (r) => String((r.id as string) ?? '').slice(0, 8) },
    { key: 'scheduled_date', header: 'Scheduled Date' },
    { key: 'completed_date', header: 'Completed Date' },
    { key: 'auditor_name', header: 'Auditor' },
    { key: 'auditor_position', header: 'Auditor Position' },
    { key: 'location', header: 'Location' },
    { key: 'overall_notes', header: 'Overall Notes' },
    { key: 'status', header: 'Status' },
    { key: 'created_at', header: 'Created At' },
  ];

  const csv = buildCsv(rows as unknown as Record<string, unknown>[], columns);
  const today = new Date().toISOString().split('T')[0];
  const filename = from || to ? `inspections_${from ?? 'all'}_to_${to ?? 'all'}.csv` : `inspections_${today}.csv`;
  return csvResponse(csv, filename);
};
