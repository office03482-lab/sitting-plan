const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const rawSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const rawSupabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const rawApiUrl = String(import.meta.env.VITE_API_URL || '').trim();
const rawApiProxyTarget = String(import.meta.env.VITE_API_PROXY_TARGET || '').trim();

export const runtimeConfig = {
  supabaseUrl: rawSupabaseUrl,
  supabaseAnonKey: rawSupabaseAnonKey,
  apiUrl: rawApiUrl ? stripTrailingSlash(rawApiUrl) : '',
  apiProxyTarget: rawApiProxyTarget ? stripTrailingSlash(rawApiProxyTarget) : '',
};

export const getRuntimeDiagnostics = () => {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const isLocalHost = ['localhost', '127.0.0.1'].includes(hostname);
  const apiMode = runtimeConfig.apiUrl
    ? runtimeConfig.apiUrl.includes('onrender.com')
      ? 'render-backend'
      : runtimeConfig.apiUrl.includes('127.0.0.1') || runtimeConfig.apiUrl.includes('localhost')
        ? 'local-backend'
        : 'custom-backend'
    : isLocalHost
      ? 'vite-proxy'
      : 'relative-api';

  const warnings: string[] = [];
  if (!runtimeConfig.supabaseUrl) warnings.push('VITE_SUPABASE_URL missing');
  if (!runtimeConfig.supabaseAnonKey) warnings.push('VITE_SUPABASE_ANON_KEY missing');
  if (!runtimeConfig.apiUrl && !isLocalHost) warnings.push('VITE_API_URL missing on non-local host');
  if (isLocalHost && !runtimeConfig.apiUrl && !runtimeConfig.apiProxyTarget) warnings.push('VITE_API_PROXY_TARGET missing for local proxy');

  return {
    hostname,
    isLocalHost,
    apiMode,
    apiBaseLabel: runtimeConfig.apiUrl || (isLocalHost ? '/api via Vite proxy' : '/api relative'),
    proxyTargetLabel: runtimeConfig.apiProxyTarget || 'Not set',
    supabaseConfigured: Boolean(runtimeConfig.supabaseUrl && runtimeConfig.supabaseAnonKey),
    warnings,
  };
};
