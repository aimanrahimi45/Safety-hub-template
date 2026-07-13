import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { buildCsv, csvResponse, type CsvColumn } from '../../../lib/csvExport';
import type { PpeRequest } from '../../../lib/types';

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

  let q = supabase
    .from('ppe_requests')
    .select('*')
    .order('request_date', { ascending: false });
  if (from) q = q.gte('request_date', from);
  if (to) q = q.lte('request_date', to);

  const { data, error } = await q;
  if (error) return new Response(`Query error: ${error.message}`, { status: 500 });

  const rows = (data ?? []) as PpeRequest[];
  const columns: CsvColumn[] = [
    { key: 'request_code', header: 'Request Code' },
    { key: 'request_date', header: 'Request Date' },
    { key: 'staff_id', header: 'Staff ID' },
    { key: 'staff_name', header: 'Staff Name' },
    { key: 'department', header: 'Department' },
    { key: 'ppe_type', header: 'PPE Type' },
    { key: 'size', header: 'Size' },
    { key: 'color_specs', header: 'Color/Specs' },
    { key: 'replacement_reason', header: 'Reason' },
    { key: 'condition_remarks', header: 'Condition' },
    { key: 'status', header: 'Status' },
    { key: 'authorized_by', header: 'Authorized By' },
    { key: 'action_date', header: 'Action Date' },
    { key: 'created_at', header: 'Created At' },
  ];

  const csv = buildCsv(rows as unknown as Record<string, unknown>[], columns);
  const today = new Date().toISOString().slice(0, 7);
  const filename = from || to ? `ppe_${from ?? 'all'}_to_${to ?? 'all'}.csv` : `ppe_${today}.csv`;
  return csvResponse(csv, filename);
};
