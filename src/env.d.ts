/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    user: {
      id: string;
      email: string;
    } | null;
    tenantId: string | null;
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly LICENSE_VALIDATION_WEBAPP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
