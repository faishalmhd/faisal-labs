import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').trim();
const anonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '').trim();
const forcedDemo = String(import.meta.env.VITE_DEMO_MODE ?? '').toLowerCase() === 'true';

function looksLikePlaceholder(value: string): boolean {
  return /^(YOUR_|SET_|CHANGE_ME|xxx)/i.test(value) || value.includes('YOUR_PROJECT');
}

function isValidSupabaseUrl(value: string): boolean {
  if (looksLikePlaceholder(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && /\.supabase\.(co|in)$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** True when both public Supabase credentials look real and demo is not forced. */
export const isBackendConfigured =
  isValidSupabaseUrl(url) && anonKey.length > 20 && !looksLikePlaceholder(anonKey);

/** Demo mode never touches the network: catalog, orders, OTP, and admin data are local mocks. */
export const isDemoMode = forcedDemo || !isBackendConfigured;

/** Shown in the UI to explain why demo data is being used. */
export const demoReason = isDemoMode
  ? forcedDemo
    ? 'VITE_DEMO_MODE=true'
    : 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diisi dengan kredensial asli.'
  : null;

const demoClient = {
  auth: {
    getSession: async () => {
      const user = sessionStorage.getItem('demo_admin_user');
      if (user) {
        return { data: { session: { user: { id: 'demo-admin-id', email: user } } }, error: null };
      }
      return { data: { session: null }, error: null };
    },
    signInWithPassword: async ({ email }: { email: string }) => {
      sessionStorage.setItem('demo_admin_user', email || 'admin@demo.local');
      return {
        data: { user: { id: 'demo-admin-id', email: email || 'admin@demo.local' }, session: { user: { id: 'demo-admin-id', email } } },
        error: null,
      };
    },
    signOut: async () => {
      sessionStorage.removeItem('demo_admin_user');
      return { error: null };
    },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  functions: {
    invoke: async () => {
      throw new Error('Supabase Edge Functions tidak aktif dalam mode demo offline.');
    },
  },
} as unknown as SupabaseClient;

export const supabase: SupabaseClient = isDemoMode
  ? demoClient
  : createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
