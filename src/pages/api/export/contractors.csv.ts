import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { buildCsv, csvResponse, type CsvColumn } from '../../../lib/csvExport';
import type { Contractor } from '../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createSupabaseServerClient({ request, cookies } as Parameters<typeof createSupabaseServerClient>[0]);
  if (!supabase) return new Response('Supabase is not configured.', { status: 503 });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });
  const { data: tenantId } = await supabase.rpc('get_my_tenant_id');
  if (!tenantId) return new Response('Tenant not found.', { status: 403 });

  const { data, error } = await supabase
    .from('contractors')
    .select('*, induction_records(count)')
    .order('company_name', { ascending: true });

  if (error) return new Response(`Query error: ${error.message}`, { status: 500 });

  type Row = Contractor & { induction_records: Array<{ count: number }> };
  const rows = (data ?? []) as Row[];

  const columns: CsvColumn[] = [
    { key: 'company_name', header: 'Company Name' },
    { key: 'contact_person', header: 'Contact Person' },
    { key: 'contact_email', header: 'Email' },
    { key: 'contact_phone', header: 'Phone' },
    { key: 'work_scope', header: 'Work Scope' },
    { key: 'status', header: 'Status' },
    { key: 'valid_from', header: 'Valid From' },
    { key: 'valid_until', header: 'Valid Until' },
    { key: 'workers_inducted', header: 'Workers Inducted', format: (r) => (r as unknown as Row).induction_records?.[0]?.count ?? 0 },
    { key: 'created_at', header: 'Created At' },
  ];

  const csv = buildCsv(rows as unknown as Record<string, unknown>[], columns);
  const today = new Date().toISOString().split('T')[0];
  return csvResponse(csv, `contractors_${today}.csv`);
};
