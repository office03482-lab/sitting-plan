import { createClient } from '@supabase/supabase-js'
import { runtimeConfig } from './runtimeConfig'

const fallbackSupabaseUrl = 'https://example.supabase.co'
const fallbackSupabaseAnonKey = 'public-anon-key-placeholder'

if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Falling back to placeholder config.');
}

export const supabase = createClient(
  runtimeConfig.supabaseUrl || fallbackSupabaseUrl,
  runtimeConfig.supabaseAnonKey || fallbackSupabaseAnonKey
)
