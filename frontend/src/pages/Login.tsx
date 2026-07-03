import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService } from '@services/api';
import type { SchoolPublicBranding } from '@types';

export default function Login() {
  const { signIn, user, authError, getDefaultRoute } = useAuth();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionConflict, setSessionConflict] = useState<any | null>(null);
  const [branding, setBranding] = useState<SchoolPublicBranding | null>(null);

  const schoolHint = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const explicitSchool = params.get('school')?.trim();
    if (explicitSchool) return explicitSchool;
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (host && !['localhost', '127.0.0.1'].includes(host)) {
      return host;
    }
    return undefined;
  }, [location.search]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await apiService.getPublicSchoolBranding(schoolHint ? { school: schoolHint } : {});
        if (!active) return;
        setBranding(response.data);
      } catch {
        if (active) {
          setBranding(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [schoolHint]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = branding?.portal_name || branding?.school_name || 'Sign In';
    }
    const faviconUrl = branding?.favicon_url;
    if (!faviconUrl || typeof document === 'undefined') return;
    let favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.href = faviconUrl;
  }, [branding?.favicon_url]);

  if (user) return <Navigate to={getDefaultRoute(user)} replace />;

  const submitLogin = async (options?: { forceTakeover?: boolean }) => {
    setLoading(true);
    setError(null);
    setSessionConflict(null);
    try {
      await signIn(identifier, password, options);
    } catch (requestError: any) {
      if (requestError?.code === 'session_limit_exceeded') {
        setSessionConflict(requestError?.conflict || null);
      }
      setError(
        requestError?.conflict?.message ||
          requestError?.response?.data?.detail ||
          requestError?.message ||
          requestError?.error_description ||
          'Login failed',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitLogin();
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-5 py-8"
      style={{
        background: branding?.background_image_url
          ? `linear-gradient(135deg, rgba(15,23,42,0.62), rgba(15,118,110,0.42)), url(${branding.background_image_url}) center/cover`
          : `linear-gradient(135deg, ${branding?.primary_color || '#a8edff'} 0%, ${branding?.secondary_color || '#38b6f5'} 55%, ${branding?.accent_color || '#5feaff'} 100%)`,
        fontFamily: 'Nunito, DM Sans, sans-serif',
      }}
    >
      <div className="flex min-h-[580px] w-full max-w-6xl overflow-hidden rounded-[24px] border border-white/70 bg-white/35 shadow-[0_30px_80px_rgba(0,120,200,0.18)] backdrop-blur-[18px] max-[900px]:max-w-xl max-[900px]:flex-col">
        <div className="m-2 flex w-[420px] flex-col rounded-[20px] bg-white px-10 py-9 shadow-[0_8px_32px_rgba(0,80,180,0.08)] max-[900px]:w-auto max-[900px]:px-7">
          <div className="mb-8 flex justify-center">
            <img src={branding?.logo_url || bhavyaAxisLogo} alt={branding?.school_name || 'School logo'} className="h-24 w-auto object-contain" />
          </div>

          <h1 className="text-center text-[26px] font-extrabold tracking-[0.3px] text-[#1a2d4a]">{branding?.portal_name || 'Sign In'}</h1>
          <p className="mb-7 mt-1 text-center text-[13px] font-medium text-[#8aabbd]">
            {branding?.welcome_message || 'Welcome back! Please enter your details.'}
          </p>
          <p className="-mt-4 mb-7 text-center text-[13px] font-medium text-slate-500">
            {branding?.tagline || branding?.school_name || 'Sign in to continue.'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
            <div className="mb-4">
              <label className="mb-1.5 block text-[12px] font-extrabold tracking-[0.3px] text-[#1a2d4a]">
                Email or Username
              </label>
              <div className="flex items-center rounded-[10px] border-[1.5px] border-[#d0e8f5] bg-white px-3 transition focus-within:border-sky-600 focus-within:shadow-[0_0_0_3px_rgba(26,144,217,0.1)]">
                <Mail className="mr-2 h-[18px] w-[18px] flex-shrink-0 text-[#90bdd8]" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="Enter your email or username"
                  className="flex-1 bg-transparent py-[11px] text-[13px] text-slate-700 outline-none placeholder:text-[#b8cfe0]"
                />
              </div>
            </div>

            <div className="mb-5">
              <label className="mb-1.5 block text-[12px] font-extrabold tracking-[0.3px] text-[#1a2d4a]">
                Password
              </label>
              <div className="flex items-center rounded-[10px] border-[1.5px] border-[#d0e8f5] bg-white px-3 transition focus-within:border-sky-600 focus-within:shadow-[0_0_0_3px_rgba(26,144,217,0.1)]">
                <Lock className="mr-2 h-[18px] w-[18px] flex-shrink-0 text-[#90bdd8]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  className="flex-1 bg-transparent py-[11px] text-[13px] text-slate-700 outline-none placeholder:text-[#b8cfe0]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="ml-1 text-[#90bdd8] transition hover:text-sky-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            {error ? <p className="mb-4 text-sm font-semibold text-rose-500">{error}</p> : null}
            {sessionConflict ? (
              <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                <p className="font-semibold">Existing session detected.</p>
                <p className="mt-1">
                  {sessionConflict?.current_session?.device_name || 'Another device'} | {sessionConflict?.current_session?.browser || 'Browser'}
                </p>
                <p className="mt-1 text-xs text-orange-700">
                  Last activity: {sessionConflict?.current_session?.last_activity || 'Recently active'}
                </p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void submitLogin({ forceTakeover: true })}
                  className="mt-3 rounded-full bg-orange-600 px-4 py-2 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-60"
                >
                  Continue Here
                </button>
              </div>
            ) : null}
            {!error && authError ? <p className="mb-4 text-sm font-semibold text-amber-700">{authError}</p> : null}
            {error || authError ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Agar error Failed to fetch ya network related ho, browser me F12, phir Network tab khol kar
                auth v1 token request dekho. Saath hi ye URL browser me check karo:
                <div className="mt-1 break-all font-semibold">
                  {`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`}
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mb-5 w-full rounded-full border-none px-4 py-[13px] text-[15px] font-extrabold tracking-[0.5px] text-white shadow-[0_6px_24px_rgba(0,150,230,0.35)] transition hover:-translate-y-[1px] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
              style={{
                background: `linear-gradient(90deg, ${branding?.secondary_color || '#0284c7'} 0%, ${branding?.accent_color || '#22d3ee'} 100%)`,
              }}
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>

            <p className="mt-auto text-center text-[13px] text-[#8aabbd]">
              {branding?.footer_text || 'Admin creates users and roles. Login ke baad assigned modules hi dikhenge.'}
            </p>
          </form>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8 py-10 max-[900px]:min-h-[380px]">
          <div
            className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: `radial-gradient(circle, rgba(255,255,255,0.5) 0%, ${branding?.accent_color || 'rgba(100,200,255,0.2)'} 50%, transparent 70%)`,
            }}
          />

          <div className="relative z-10 flex w-full max-w-[520px] items-center justify-center">
            <img
              src={branding?.banner_url || branding?.logo_url || bhavyaAxisLogo}
              alt={branding?.school_name || 'School banner'}
              className="max-h-[420px] w-full max-w-[480px] object-contain drop-shadow-[0_18px_32px_rgba(9,50,105,0.16)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
