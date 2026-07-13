import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { buildCsv, csvResponse, type CsvColumn } from '../../../lib/csvExport';
import type { Incident } from '../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const supabase = createSupabaseServerClient({ request, cookies } as Parameters<typeof createSupabaseServerClient>[0]);
  if (!supabase) return new Response('Supabase is not configured.', { status: 503 });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });
  const { data: tenantId } = await supabase.rpc('get_my_tenant_id');
  if (!tenantId) return new Response('Tenant not found.', { status: 403 });

  const year = url.searchParams.get('year');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let q = supabase
    .from('incidents')
    .select('*')
    .order('incident_date', { ascending: false })
    .order('recorded_at', { ascending: false });

  if (year) {
    const yStart = `${year}-01-01T00:00:00.000Z`;
    const nextYear = String(Number(year) + 1);
    const yEnd = `${nextYear}-01-01T00:00:00.000Z`;
    q = q.gte('incident_date', yStart).lt('incident_date', yEnd);
  } else {
    if (from) q = q.gte('incident_date', `${from}T00:00:00.000Z`);
    if (to) q = q.lte('incident_date', `${to}T23:59:59.999Z`);
  }

  const { data, error } = await q;
  if (error) return new Response(`Query error: ${error.message}`, { status: 500 });

  const rows = (data ?? []) as Incident[];
  const columns: CsvColumn[] = [
    { key: 'incident_code', header: 'Incident Code' },
    { key: 'incident_date', header: 'Incident Date' },
    { key: 'incident_time', header: 'Incident Time' },
    { key: 'victim_name', header: 'Victim Name' },
    { key: 'staff_id', header: 'Staff ID' },
    { key: 'location_dept', header: 'Location / Department' },
    { key: 'body_part_injured', header: 'Body Part Injured' },
    { key: 'severity_type', header: 'Severity' },
    { key: 'severity_other', header: 'Severity (Other)' },
    { key: 'description', header: 'Description' },
    { key: 'man_days_lost', header: 'Man-Days Lost' },
    { key: 'reported_to_jkkp', header: 'Reported to JKKP', format: (r) => (r.reported_to_jkkp ? 'Yes' : 'No') },
    { key: 'investigation_submitted', header: 'Investigation Submitted', format: (r) => (r.investigation_submitted ? 'Yes' : 'No') },
    { key: 'created_at', header: 'Created At' },
  ];

  const csv = buildCsv(rows as unknown as Record<string, unknown>[], columns);
  const today = new Date().toISOString().split('T')[0];
  const filename = year ? `incidents_${year}.csv` : (from || to ? `incidents_${from ?? 'all'}_to_${to ?? 'all'}.csv` : `incidents_${today}.csv`);
  return csvResponse(csv, filename);
};
