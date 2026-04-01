import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Get Supabase URL and anon key from environment variables
function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || (typeof window !== 'undefined' ? (window as unknown as { env?: { PUBLIC_SUPABASE_URL?: string } }).env?.PUBLIC_SUPABASE_URL : undefined);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (typeof window !== 'undefined' ? (window as unknown as { env?: { PUBLIC_SUPABASE_ANON_KEY?: string } }).env?.PUBLIC_SUPABASE_ANON_KEY : undefined);
  
  if (!url || !anonKey) {
    if (typeof window === 'undefined') {
       // On server, we can be more strict
       throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    // On client, we might be in a state where envs are loading (though unlikely with NEXT_PUBLIC)
    console.error('Supabase config missing');
    return { url: '', anonKey: '' };
  }
  
  return { url, anonKey };
}

// Support for singleton across hot reloads in development
const globalForSupabase = global as unknown as { 
    supabaseInstance: SupabaseClient | null;
    serverSupabaseInstance: SupabaseClient | null;
};

// Client-side Supabase client singleton
export function createClientClient(): SupabaseClient {
  // If we already have a client (client-side or cached on global in dev)
  if (typeof window !== 'undefined' && globalForSupabase.supabaseInstance) {
    return globalForSupabase.supabaseInstance;
  }

  const { url, anonKey } = getSupabaseConfig();
  if (!url) return {} as SupabaseClient; // Fallback for safety

  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  if (typeof window !== 'undefined') {
    globalForSupabase.supabaseInstance = client;
  }

  return client;
}

// Server-side Supabase client (cached in dev, new in prod if needed, but usually once per request)
export function createServerClient(): SupabaseClient {
  if (typeof window !== 'undefined') return createClientClient();

  // In development, we can cache this on global to avoid creating multiple clients during HMR
  if (process.env.NODE_ENV !== 'production' && globalForSupabase.serverSupabaseInstance) {
    return globalForSupabase.serverSupabaseInstance;
  }

  const { url, anonKey } = getSupabaseConfig();
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
    },
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForSupabase.serverSupabaseInstance = client;
  }

  return client;
}

// Admin client (server-only)
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

// Export a convenience singleton instance
export const supabase = createClientClient();
