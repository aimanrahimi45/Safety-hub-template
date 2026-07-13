import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { buildCsv, csvResponse, type CsvColumn } from '../../../lib/csvExport';
import type { FirstAidLog } from '../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const supabase = createSupabaseServerClient({ request, cookies } as Parameters<typeof createSupabaseServerClient>[0]);
  if (!supabase) {
    return new Response('Supabase is not configured.', { status: 503 });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { data: tenantId } = await supabase.rpc('get_my_tenant_id');
  if (!tenantId) {
    return new Response('Tenant not found.', { status: 403 });
  }

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let q = supabase
    .from('first_aid_logs')
    .select('*')
    .order('incident_date', { ascending: false })
    .order('incident_time', { ascending: false });
  if (from) q = q.gte('incident_date', from);
  if (to) q = q.lte('incident_date', to);

  const { data, error } = await q;
  if (error) {
    return new Response(`Query error: ${error.message}`, { status: 500 });
  }

  const rows = (data ?? []) as FirstAidLog[];
  const columns: CsvColumn[] = [
    { key: 'id', header: 'ID' },
    { key: 'incident_date', header: 'Incident Date' },
    { key: 'incident_time', header: 'Incident Time' },
    { key: 'location', header: 'Location' },
    { key: 'injured_person_name', header: 'Injured Person' },
    { key: 'injured_person_id', header: 'Employee ID' },
    { key: 'injury_type', header: 'Injury Type' },
    { key: 'treatment_given', header: 'Treatment Given' },
    { key: 'referred_to_hospital', header: 'Referred to Hospital', format: (r) => (r.referred_to_hospital ? 'Yes' : 'No') },
    { key: 'hospital_name', header: 'Hospital' },
    { key: 'deducted_from_inventory', header: 'Deducted from Inventory', format: (r) => (r.deducted_from_inventory ? 'Yes' : 'No') },
    { key: 'status', header: 'Status' },
    { key: 'created_at', header: 'Created At' },
  ];

  const csv = buildCsv(rows as unknown as Record<string, unknown>[], columns);
  const today = new Date().toISOString().split('T')[0];
  const filename = from || to ? `first_aid_${from ?? 'all'}_to_${to ?? 'all'}.csv` : `first_aid_${today}.csv`;
  return csvResponse(csv, filename);
};
