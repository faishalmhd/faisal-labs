import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

let client: SupabaseClient | undefined;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Konfigurasi Supabase server belum lengkap.');
  client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

export async function assertAdmin(request: Request): Promise<string> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Sesi admin tidak valid.');
  const token = authorization.slice(7);
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) throw new Error('Sesi admin tidak valid.');
  const { data: isAdmin, error: roleError } = await supabaseAdmin()
    .rpc('is_admin', { p_user_id: data.user.id });
  if (roleError || isAdmin !== true) throw new Error('Akses admin tidak diizinkan.');
  return data.user.id;
}
