export interface ReelsBrainEnvStatus {
  supabase: {
    configured: boolean;
    url: boolean;
    service_role: boolean;
    missing: string[];
  };
  cron_secret: boolean;
}
export function reelsBrainEnvStatus(): ReelsBrainEnvStatus {
  const supabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseServiceRole) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return {
    supabase: {
      configured: supabaseUrl && supabaseServiceRole,
      url: supabaseUrl,
      service_role: supabaseServiceRole,
      missing,
    },
    cron_secret: Boolean(process.env.CRON_SECRET),
  };
}
