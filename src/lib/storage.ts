// =====================================================================
// Supabase Storage upload helper.
//
// The two private buckets (`signatures`, `induction-photos`) are
// created by 20260712_phase2_storage_setup.sql. Their RLS policies
// key off the first folder component of the object path, which this
// helper sets to the caller's tenant_id.
//
// Path convention:
//     {tenant_id}/{filenamePrefix}-{timestamp}.{ext}
// e.g. a438...e21/photo-1718000000000.jpg
//
// The tenant_id is read via the SECURITY DEFINER get_my_tenant_id()
// RPC (defined in 20260712_phase1a_solo_sho.sql). RLS on tenants
// ensures the SHO only sees their own tenant row.
// =====================================================================

import { getSupabase } from './supabase';

export type StorageBucket = 'signatures' | 'induction-photos';

export interface UploadResult {
  url: string;
  path: string;
  error: string | null;
}

const TENANT_CACHE: { value: string | null; ts: number } = { value: null, ts: 0 };
const TENANT_CACHE_TTL_MS = 30_000;

async function getMyTenantIdCached(): Promise<string | null> {
  const now = Date.now();
  if (TENANT_CACHE.value && now - TENANT_CACHE.ts < TENANT_CACHE_TTL_MS) {
    return TENANT_CACHE.value;
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_my_tenant_id');
  if (error || !data) {
    return null;
  }
  TENANT_CACHE.value = String(data);
  TENANT_CACHE.ts = now;
  return TENANT_CACHE.value;
}

export function clearTenantCache(): void {
  TENANT_CACHE.value = null;
  TENANT_CACHE.ts = 0;
}

function buildPath(tenantId: string, filenamePrefix: string, extension: string): string {
  const safePrefix = filenamePrefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'file';
  const safeExt = extension.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) || 'bin';
  return `${tenantId}/${safePrefix}-${Date.now()}.${safeExt}`;
}

function friendlyError(err: { message?: string } | null | undefined, fallback: string): string {
  const msg = err?.message ?? '';
  if (!msg) return fallback;
  if (/Bucket not found/i.test(msg)) return `Storage bucket not found. Did you run the storage setup migration?`;
  if (/new row violates row-level security/i.test(msg)) {
    return `Upload denied — your account may not have access to this bucket.`;
  }
  if (/Payload too large|exceeded the maximum allowed size/i.test(msg)) {
    return `File too large for upload. Try a smaller image.`;
  }
  if (/duplicate/i.test(msg)) {
    return `A file with this name already exists. Please retry.`;
  }
  return msg;
}

export async function uploadToStorage(
  bucket: StorageBucket,
  blob: Blob,
  filenamePrefix: string,
  extension: 'jpg' | 'png' = 'jpg',
): Promise<UploadResult> {
  if (!blob) {
    return { url: '', path: '', error: 'No file data to upload.' };
  }
  const tenantId = await getMyTenantIdCached();
  if (!tenantId) {
    return { url: '', path: '', error: 'No active workspace. Complete onboarding first.' };
  }

  const supabase = getSupabase();
  const path = buildPath(tenantId, filenamePrefix, extension);
  const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';

  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType, upsert: false });

  if (uploadErr) {
    return { url: '', path, error: friendlyError(uploadErr, 'Upload failed.') };
  }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = pub?.publicUrl ?? '';
  if (!url) {
    return { url, path, error: 'Upload succeeded but no public URL was returned.' };
  }
  return { url, path, error: null };
}
