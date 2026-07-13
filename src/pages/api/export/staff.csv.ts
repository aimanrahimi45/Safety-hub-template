import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { buildCsv, csvResponse, type CsvColumn } from '../../../lib/csvExport';
import type { Staff } from '../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createSupabaseServerClient({ request, cookies } as Parameters<typeof createSupabaseServerClient>[0]);
  if (!supabase) return new Response('Supabase is not configured.', { status: 503 });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });
  const { data: tenantId } = await supabase.rpc('get_my_tenant_id');
  if (!tenantId) return new Response('Tenant not found.', { status: 403 });

  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('full_name', { ascending: true });

  if (error) return new Response(`Query error: ${error.message}`, { status: 500 });

  const rows = (data ?? []) as Staff[];
  const columns: CsvColumn[] = [
    { key: 'employee_id', header: 'Employee ID' },
    { key: 'full_name', header: 'Full Name' },
    { key: 'email', header: 'Email' },
    { key: 'phone', header: 'Phone' },
    { key: 'department', header: 'Department' },
    { key: 'position', header: 'Position' },
    { key: 'is_active', header: 'Status', format: (r) => (r.is_active ? 'Active' : 'Inactive') },
    { key: 'join_date', header: 'Join Date' },
    { key: 'leave_date', header: 'Leave Date' },
    { key: 'created_at', header: 'Created At' },
  ];

  const csv = buildCsv(rows as unknown as Record<string, unknown>[], columns);
  const today = new Date().toISOString().split('T')[0];
  return csvResponse(csv, `staff_${today}.csv`);
};
