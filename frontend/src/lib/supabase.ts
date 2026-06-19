import { createClient } from '@supabase/supabase-js'
import { runtimeConfig } from './runtimeConfig'

const fallbackSupabaseUrl = 'https://example.supabase.co'
const fallbackSupabaseAnonKey = 'public-anon-key-placeholder'

if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Falling back to placeholder config.');
}

const resolvedSupabaseUrl = runtimeConfig.supabaseUrl || fallbackSupabaseUrl
const resolvedSupabaseAnonKey = runtimeConfig.supabaseAnonKey || fallbackSupabaseAnonKey

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey)

export function createIsolatedSupabaseClient() {
  return createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
