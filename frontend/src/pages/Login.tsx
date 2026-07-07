import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, GraduationCap, Lock, Mail, Monitor, School, Users } from 'lucide-react';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService } from '@services/api';
import type { PortalIntent, SchoolPublicBranding } from '@types';
import CarromPortalBoard from './CarromPortalBoard';

const DEFAULT_BRANDING: SchoolPublicBranding = {
  school_name: 'School',
  portal_name: 'School ERP',
  tagline: '',
  logo_url: '',
  banner_url: '',
  favicon_url: '',
  background_image_url: '',
  welcome_message: 'Welcome back',
  footer_text: 'Admin creates users and roles. Login ke baad assigned modules hi dikhenge.',
  primary_color: '#0f766e',
  secondary_color: '#1d4ed8',
  accent_color: '#f59e0b',
  theme: 'auto',
};

const TABS: { key: PortalIntent; label: string; Icon: typeof School | typeof GraduationCap | typeof Users }[] = [
  { key: 'school_erp', label: 'School ERP', Icon: School },
  { key: 'student_portal', label: 'Student', Icon: GraduationCap },
  { key: 'parent_portal', label: 'Parent', Icon: Users },
  { key: 'platform_admin', label: 'Admin', Icon: Monitor },
];

const PORTAL_DETAILS: Record<PortalIntent, {
  subtitle: string;
  buttonText: string;
  helperText: string;
  welcomeMessage: string;
}> = {
  school_erp: {
    subtitle: 'Login to your school workspace',
    buttonText: 'Login to School ERP',
    helperText: 'Use the account provided by your school.',
    welcomeMessage: 'Welcome back! Please enter your details.',
  },
  student_portal: {
    subtitle: 'Login to Student Portal',
    buttonText: 'Login to Student Portal',
    helperText: 'Access your learning, tests, results, and student services.',
    welcomeMessage: 'Welcome back! Please enter your details.',
  },
  parent_portal: {
    subtitle: 'Login to Parent Portal',
    buttonText: 'Login to Parent Portal',
    helperText: 'Access your linked student information and parent services.',
    welcomeMessage: 'Welcome back! Please enter your details.',
  },
  platform_admin: {
    subtitle: 'Login to platform administration',
    buttonText: 'Login as Platform Admin',
    helperText: 'Restricted to authorized platform administrators.',
    welcomeMessage: 'Welcome back! Please enter your details.',
  },
};

export default function Login() {
  const { signIn, user, authError, getDefaultRoute } = useAuth();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionConflict, setSessionConflict] = useState<any | null>(null);
  const [branding, setBranding] = useState<SchoolPublicBranding>(DEFAULT_BRANDING);
  const [portalIntent, setPortalIntent] = useState<PortalIntent>('school_erp');

  const portalDetail = PORTAL_DETAILS[portalIntent];

  const tabPieceColor: Record<PortalIntent, { text: string; bg: string; ring: string; btnFrom: string; btnTo: string; btnShadow: string }> = {
    school_erp: { text: '#3b82f6', bg: '#eff6ff', ring: 'rgba(59,130,246,0.15)', btnFrom: '#3b82f6', btnTo: '#1d4ed8', btnShadow: 'rgba(59,130,246,0.3)' },
    student_portal: { text: '#ca8a04', bg: '#fefce8', ring: 'rgba(202,138,4,0.15)', btnFrom: '#eab308', btnTo: '#ca8a04', btnShadow: 'rgba(234,179,8,0.3)' },
    parent_portal: { text: '#ef4444', bg: '#fef2f2', ring: 'rgba(239,68,68,0.15)', btnFrom: '#ef4444', btnTo: '#b91c1c', btnShadow: 'rgba(239,68,68,0.3)' },
    platform_admin: { text: '#f97316', bg: '#fff7ed', ring: 'rgba(249,115,22,0.15)', btnFrom: '#f97316', btnTo: '#c2410c', btnShadow: 'rgba(249,115,22,0.3)' },
  };

  const activeTabStyle = tabPieceColor[portalIntent];

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
          setBranding(DEFAULT_BRANDING);
        }
      }
    })();
    return () => { active = false; };
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
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !password) {
      setError('Please enter both email/username and password.');
      return;
    }
    setLoading(true);
    setError(null);
    setSessionConflict(null);
    try {
      await signIn(identifier, password, { ...options, portalIntent });
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

  const handleTabChange = (tab: PortalIntent) => {
    setPortalIntent(tab);
    setError(null);
    setSessionConflict(null);
  };

  return (
    <div className="login-page">
      <div className="login-bg-gradient" />
      <div className="login-bg-radial" />
      <div className="login-bg-vignette" />

      <div className="login-shell">
        <div className="auth-panel">
          <div className="auth-panel-inner">
            <div className="auth-logo-wrap">
              <img
                src={branding?.logo_url || bhavyaAxisLogo}
                alt={branding?.school_name || 'School logo'}
                className="auth-logo"
              />
            </div>

            <p className="auth-portal-label">— Choose your portal —</p>

            <div className="portal-selector" role="tablist">
              {TABS.map(({ key, label, Icon }) => {
                const isSelected = portalIntent === key;
                const pc = tabPieceColor[key];
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => handleTabChange(key)}
                    className={`portal-tab ${isSelected ? 'portal-tab--active' : ''}`}
                    style={isSelected ? {
                      color: pc.text,
                      boxShadow: `0 4px 12px ${pc.ring}, 0 1px 3px rgba(0,0,0,0.04)`,
                    } : undefined}
                  >
                    <span
                      className="portal-tab-icon"
                      style={isSelected ? {
                        background: pc.bg,
                        color: pc.text,
                      } : undefined}
                    >
                      <Icon className="portal-tab-icon-svg" />
                    </span>
                    <span className="portal-tab-label">{label}</span>
                    {isSelected && <span className="portal-tab-indicator" style={{ background: pc.text }} />}
                  </button>
                );
              })}
            </div>

            <h1 className="auth-heading">
              {portalIntent === 'school_erp' ? (branding?.portal_name || 'School ERP') :
               portalIntent === 'student_portal' ? 'Student Portal' :
               portalIntent === 'parent_portal' ? 'Parent Portal' :
               'Platform Administration'}
            </h1>
            <p className="auth-subtitle">{portalDetail.subtitle}</p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label className="auth-field-label">Email</label>
                <div className="auth-input-wrap">
                  <Mail className="auth-input-icon" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="Enter your email"
                    className="auth-input"
                  />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-field-label">Password</label>
                <div className="auth-input-wrap">
                  <Lock className="auth-input-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="auth-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="auth-password-toggle"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="auth-input-icon" /> : <Eye className="auth-input-icon" />}
                  </button>
                </div>
              </div>

              {error ? <p className="auth-error">{error}</p> : null}

              {sessionConflict ? (
                <div className="auth-session-conflict">
                  <p className="font-semibold">Existing session detected.</p>
                  <p className="mt-1 text-xs opacity-80">
                    {sessionConflict?.current_session?.device_name || 'Another device'} | {sessionConflict?.current_session?.browser || 'Browser'}
                  </p>
                  <p className="mt-1 text-xs opacity-70">
                    Last activity: {sessionConflict?.current_session?.last_activity || 'Recently active'}
                  </p>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void submitLogin({ forceTakeover: true })}
                    className="auth-conflict-btn"
                  >
                    Continue Here
                  </button>
                </div>
              ) : null}

              {!error && authError ? <p className="text-sm font-semibold text-amber-700">{authError}</p> : null}

              {error && (
                <div className="auth-error-detail">
                  {error.includes('Session registration timeout') || error.includes('session registration') ? (
                    <p>Login verified, but application session setup could not complete. Please try again.</p>
                  ) : error.includes('Failed to fetch') || error.includes('NetworkError') || error.includes('network') ? (
                    <>
                      <p>Network error. Check browser console and Supabase health:</p>
                      <div className="mt-1 break-all font-semibold">
                        {`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`}
                      </div>
                    </>
                  ) : (
                    <p>{error}</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="auth-submit-btn"
                style={{
                  background: `linear-gradient(90deg, ${activeTabStyle.btnFrom} 0%, ${activeTabStyle.btnTo} 50%, ${activeTabStyle.btnFrom} 100%)`,
                  boxShadow: `0 6px 24px ${activeTabStyle.btnShadow}`,
                  '--btn-shadow': activeTabStyle.btnShadow,
                } as React.CSSProperties}
              >
                {loading ? (
                  <span className="auth-submit-loading">
                    <svg className="auth-spinner" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.4 31.4" />
                    </svg>
                    Signing In...
                  </span>
                ) : (
                  portalDetail.buttonText
                )}
              </button>

              <p className="auth-helper">{portalDetail.helperText}</p>
            </form>
          </div>
        </div>

        <div className="carrom-experience">
          <CarromPortalBoard activePortal={portalIntent} />
        </div>
      </div>

      <style>{`
        .login-page {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          overflow: hidden;
          background: #0b1120;
          font-family: 'Nunito', 'DM Sans', sans-serif;
        }

        .login-bg-gradient {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            135deg,
            #065f46 0%,
            #047857 18%,
            #166534 45%,
            #15803d 60%,
            #14532d 82%,
            #0f3a24 100%
          );
          opacity: 0.85;
        }

        .login-bg-radial {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 70% 60% at 20% 30%, rgba(4, 120, 87, 0.3) 0%, transparent 70%),
            radial-gradient(ellipse 60% 50% at 50% 40%, rgba(22, 101, 52, 0.25) 0%, transparent 65%),
            radial-gradient(ellipse 50% 60% at 80% 50%, rgba(20, 83, 45, 0.2) 0%, transparent 60%);
        }

        .login-bg-vignette {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 100% 100% at center, transparent 40%, rgba(0, 0, 0, 0.5) 100%);
          pointer-events: none;
        }

        .login-shell {
          position: relative;
          z-index: 1;
          display: flex;
          width: 100%;
          max-width: 1200px;
          min-height: 600px;
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          box-shadow:
            0 24px 80px rgba(0, 0, 0, 0.3),
            0 8px 32px rgba(0, 0, 0, 0.15),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }

        .auth-panel {
          width: 420px;
          flex-shrink: 0;
          background: transparent;
          padding: 12px;
        }

        .auth-panel-inner {
          border-radius: 20px;
          padding: 32px 32px 28px;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: linear-gradient(135deg, #99f6e4 0%, #bae6fd 30%, #bfdbfe 55%, #fde68a 100%);
        }

        .auth-logo-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 20px;
        }

        .auth-logo {
          height: 72px;
          width: auto;
          object-fit: contain;
        }

        .auth-portal-label {
          text-align: center;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #94a3b8;
          margin-bottom: 14px;
        }

        .portal-selector {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(8px);
          border-radius: 16px;
          padding: 6px;
          margin-bottom: 20px;
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .portal-tab {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 10px 4px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
          color: #94a3b8;
          transition: all 0.2s ease;
          cursor: pointer;
          border: none;
          background: transparent;
          outline: none;
        }

        .portal-tab:hover {
          color: #64748b;
          background: rgba(255, 255, 255, 0.5);
        }

        .portal-tab:focus-visible {
          box-shadow: 0 0 0 2px #0f766e;
        }

        .portal-tab--active {
          background: #fff;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .portal-tab-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px;
          border-radius: 8px;
          color: #94a3b8;
          transition: all 0.2s ease;
        }

        .portal-tab-icon-svg {
          width: 16px;
          height: 16px;
        }

        .portal-tab-label {
          font-size: 11px;
          font-weight: 700;
        }

        .portal-tab-indicator {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 3px;
          border-radius: 999px;
        }

        .auth-heading {
          text-align: center;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 0.3px;
          color: #0f172a;
          margin-bottom: 2px;
        }

        .auth-subtitle {
          text-align: center;
          font-size: 13px;
          font-weight: 500;
          color: #94a3b8;
          margin-bottom: 20px;
        }

        .auth-form {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .auth-field {
          margin-bottom: 14px;
        }

        .auth-field-label {
          display: block;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.3px;
          color: #0f172a;
          margin-bottom: 6px;
        }

        .auth-input-wrap {
          display: flex;
          align-items: center;
          border: 1.5px solid #ccddee;
          border-radius: 12px;
          background: rgba(255,255,255,0.85);
          backdrop-filter: blur(4px);
          padding: 0 14px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .auth-input-wrap:focus-within {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
        }

        .auth-input-icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          color: #94a3b8;
        }

        .auth-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          padding: 12px 0 12px 10px;
          font-size: 14px;
          color: #334155;
        }

        .auth-input::placeholder {
          color: #cbd5e1;
        }

        .auth-password-toggle {
          margin-left: 4px;
          color: #94a3b8;
          transition: color 0.2s ease;
          cursor: pointer;
          border: none;
          background: none;
          padding: 4px;
        }

        .auth-password-toggle:hover {
          color: #0ea5e9;
        }

        .auth-error {
          font-size: 13px;
          font-weight: 600;
          color: #f43f5e;
          margin-bottom: 12px;
        }

        .auth-session-conflict {
          background: #fff7ed;
          border: 1px solid #fed7aa;
          border-radius: 14px;
          padding: 14px 16px;
          margin-bottom: 12px;
          font-size: 13px;
          color: #9a3412;
        }

        .auth-conflict-btn {
          margin-top: 10px;
          border-radius: 999px;
          background: #ea580c;
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          padding: 8px 20px;
          border: none;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .auth-conflict-btn:hover {
          background: #c2410c;
        }

        .auth-conflict-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .auth-error-detail {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 14px;
          padding: 14px 16px;
          margin-bottom: 12px;
          font-size: 12px;
          color: #92400e;
        }

        .auth-submit-btn {
          width: 100%;
          border: none;
          border-radius: 999px;
          padding: 14px 24px;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.5px;
          color: #fff;
          background-size: 200% 100%;
          transition: all 0.25s ease;
          cursor: pointer;
          margin-bottom: 14px;
        }

        .auth-submit-btn:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: translateY(-1px);
          box-shadow: 0 8px 32px var(--btn-shadow, rgba(59,130,246,0.3));
        }

        .auth-submit-btn:active:not(:disabled) {
          transform: translateY(0);
          filter: brightness(0.95);
          box-shadow: 0 4px 16px var(--btn-shadow, rgba(59,130,246,0.25));
        }

        .auth-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .auth-submit-loading {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .auth-spinner {
          width: 18px;
          height: 18px;
          animation: auth-spin 0.8s linear infinite;
        }

        @keyframes auth-spin {
          to { transform: rotate(360deg); }
        }

        .auth-helper {
          text-align: center;
          font-size: 12px;
          color: #94a3b8;
        }

        .carrom-experience {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          min-height: 560px;
        }

        .carrom-stage {
          width: 100%;
          max-width: 600px;
          aspect-ratio: 1;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .carrom-frame {
          position: relative;
          width: 92%;
          height: 92%;
          border-radius: 28px;
          background: linear-gradient(180deg, #1a1208 0%, #0f0a04 100%);
          box-shadow:
            0 12px 48px rgba(0, 0, 0, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .carrom-outer-rim {
          position: absolute;
          inset: 4px;
          border-radius: 24px;
          background: linear-gradient(135deg, #2d1f0e, #1a1208);
          box-shadow: inset 0 -2px 8px rgba(0, 0, 0, 0.4);
        }

        .carrom-inner-rim {
          position: absolute;
          inset: 8px;
          border-radius: 20px;
          background: linear-gradient(180deg, #3d2b14, #241a0a);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            inset 0 -3px 10px rgba(0, 0, 0, 0.3);
        }

        .carrom-surface {
          position: relative;
          width: calc(100% - 32px);
          height: calc(100% - 32px);
          border-radius: 14px;
          background: linear-gradient(145deg, #065f46 0%, #047857 40%, #166534 100%);
          box-shadow:
            inset 0 3px 20px rgba(0, 0, 0, 0.35),
            inset 0 -1px 2px rgba(255, 255, 255, 0.03);
          overflow: hidden;
          z-index: 1;
        }

        .carrom-surface::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 14px;
          background:
            radial-gradient(ellipse 60% 60% at 40% 40%, rgba(255, 255, 255, 0.03), transparent),
            repeating-linear-gradient(
              90deg,
              transparent 0px,
              transparent 28px,
              rgba(255, 255, 255, 0.015) 28px,
              rgba(255, 255, 255, 0.015) 29px
            ),
            repeating-linear-gradient(
              0deg,
              transparent 0px,
              transparent 28px,
              rgba(255, 255, 255, 0.015) 28px,
              rgba(255, 255, 255, 0.015) 29px
            );
        }

        .carrom-hole {
          position: absolute;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #052e16, #020a03 80%);
          box-shadow:
            inset 0 3px 8px rgba(0, 0, 0, 0.7),
            0 0 0 4px rgba(0, 0, 0, 0.2),
            0 1px 2px rgba(255, 255, 255, 0.03);
          z-index: 2;
          pointer-events: none;
        }

        .carrom-center-ring {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 64px;
          height: 64px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.06);
          box-shadow:
            0 0 0 8px rgba(255, 255, 255, 0.02),
            inset 0 0 0 4px rgba(255, 255, 255, 0.02);
          pointer-events: none;
          z-index: 2;
        }

        .carrom-center-cross {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 2px;
          background: rgba(255, 255, 255, 0.04);
          pointer-events: none;
          z-index: 2;
        }

        .carrom-center-cross::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) rotate(90deg);
          width: 40px;
          height: 2px;
          background: rgba(255, 255, 255, 0.04);
        }

        .carrom-baseline-top {
          position: absolute;
          left: 50%;
          top: 28%;
          transform: translateX(-50%);
          width: 55%;
          height: 1.5px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 1px;
          pointer-events: none;
          z-index: 2;
        }

        .carrom-baseline-bottom {
          position: absolute;
          left: 50%;
          bottom: 28%;
          transform: translateX(-50%);
          width: 55%;
          height: 1.5px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 1px;
          pointer-events: none;
          z-index: 2;
        }

        .carrom-piece {
          position: absolute;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          will-change: transform;
          z-index: 5;
          user-select: none;
          -webkit-user-select: none;
          transition: box-shadow 0.3s ease, border-color 0.3s ease;
        }

        .carrom-piece::before {
          content: '';
          position: absolute;
          top: 14%;
          left: 18%;
          width: 28%;
          height: 18%;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.15);
          pointer-events: none;
        }

        .carrom-piece--school {
          width: 76px;
          height: 76px;
          background: radial-gradient(circle at 38% 32%, #3b82f6, #1e40af 70%);
          color: #fff;
          font-size: 11px;
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.35),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 2px 4px rgba(255, 255, 255, 0.12),
            0 0 0 3px rgba(59, 130, 246, 0.08);
          border: 2px solid rgba(59, 130, 246, 0.15);
        }

        .carrom-piece--student {
          width: 76px;
          height: 76px;
          background: radial-gradient(circle at 38% 32%, #facc15, #ca8a04 70%);
          color: #1e293b;
          font-size: 11px;
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.3),
            inset 0 -4px 8px rgba(0, 0, 0, 0.1),
            inset 0 2px 4px rgba(255, 255, 255, 0.3),
            0 0 0 3px rgba(250, 204, 21, 0.08);
          border: 2px solid rgba(250, 204, 21, 0.15);
        }

        .carrom-piece--parent {
          width: 76px;
          height: 76px;
          background: radial-gradient(circle at 38% 32%, #ef4444, #991b1b 70%);
          color: #fff;
          font-size: 11px;
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.35),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 2px 4px rgba(255, 255, 255, 0.12),
            0 0 0 3px rgba(239, 68, 68, 0.08);
          border: 2px solid rgba(239, 68, 68, 0.15);
        }

        .carrom-piece-label {
          pointer-events: none;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .carrom-piece--active {
          box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.4), 0 0 20px rgba(13, 148, 136, 0.15) !important;
          border-color: rgba(13, 148, 136, 0.5) !important;
        }

        .carrom-piece--school[data-active="true"] {
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.35),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 2px 4px rgba(255, 255, 255, 0.12),
            0 0 0 4px rgba(59, 130, 246, 0.4),
            0 0 24px rgba(59, 130, 246, 0.15) !important;
          border-color: rgba(59, 130, 246, 0.5) !important;
        }

        .carrom-piece--student[data-active="true"] {
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.3),
            inset 0 -4px 8px rgba(0, 0, 0, 0.1),
            inset 0 2px 4px rgba(255, 255, 255, 0.3),
            0 0 0 4px rgba(250, 204, 21, 0.4),
            0 0 24px rgba(250, 204, 21, 0.12) !important;
          border-color: rgba(250, 204, 21, 0.5) !important;
        }

        .carrom-piece--parent[data-active="true"] {
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.35),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 2px 4px rgba(255, 255, 255, 0.12),
            0 0 0 4px rgba(239, 68, 68, 0.4),
            0 0 24px rgba(239, 68, 68, 0.15) !important;
          border-color: rgba(239, 68, 68, 0.5) !important;
        }

        .carrom-striker {
          position: absolute;
          width: 96px;
          height: 96px;
          border-radius: 50%;
          will-change: transform;
          z-index: 10;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          cursor: grab;
          background-color: rgba(255, 255, 255, 0.92);
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          box-shadow:
            0 6px 28px rgba(0, 0, 0, 0.35),
            inset 0 -4px 12px rgba(0, 0, 0, 0.12),
            inset 0 3px 8px rgba(255, 255, 255, 0.35);
          border: 3px solid rgba(249, 115, 22, 0.2);
          transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .carrom-striker::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.2), transparent 60%);
          pointer-events: none;
        }

        .carrom-striker::after {
          content: '';
          position: absolute;
          top: 14%;
          left: 18%;
          width: 28%;
          height: 18%;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.25);
          pointer-events: none;
        }

        .carrom-striker[data-active="true"] {
          border-color: rgba(249, 115, 22, 0.5) !important;
          box-shadow:
            0 6px 28px rgba(0, 0, 0, 0.35),
            inset 0 -4px 12px rgba(0, 0, 0, 0.12),
            inset 0 3px 8px rgba(255, 255, 255, 0.35),
            0 0 0 4px rgba(249, 115, 22, 0.3),
            0 0 24px rgba(249, 115, 22, 0.12) !important;
        }

        @media (max-width: 1100px) {
          .login-shell {
            flex-direction: column;
            max-width: 520px;
          }

          .auth-panel {
            width: 100%;
          }

          .carrom-experience {
            min-height: 340px;
            padding: 12px;
          }

          .carrom-stage {
            max-width: 420px;
          }

          .carrom-piece--school,
          .carrom-piece--student,
          .carrom-piece--parent {
            width: 64px;
            height: 64px;
            font-size: 10px;
          }

          .carrom-striker {
            width: 80px;
            height: 80px;
          }
        }

        @media (max-width: 768px) {
          .login-page {
            padding: 10px;
            min-height: 100dvh;
          }

          .login-shell {
            border-radius: 20px;
            min-height: auto;
          }

          .auth-panel {
            padding: 6px;
          }

          .auth-panel-inner {
            padding: 18px 14px 16px;
          }

          .auth-logo {
            height: 52px;
            margin-bottom: 12px;
          }

          .auth-portal-label {
            font-size: 10px;
            margin-bottom: 10px;
          }

          .portal-selector {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            padding: 6px;
            margin-bottom: 16px;
          }

          .portal-tab {
            padding: 10px 6px;
            font-size: 11px;
            min-height: 48px;
          }

          .portal-tab-icon {
            padding: 6px;
          }

          .portal-tab-icon-svg {
            width: 16px;
            height: 16px;
          }

          .portal-tab-indicator {
            width: 28px;
            height: 3px;
            bottom: 2px;
          }

          .auth-heading {
            font-size: 18px;
          }

          .auth-subtitle {
            font-size: 12px;
            margin-bottom: 14px;
          }

          .auth-field {
            margin-bottom: 10px;
          }

          .auth-field-label {
            font-size: 11px;
          }

          .auth-input {
            padding: 10px 0 10px 8px;
            font-size: 14px;
          }

          .auth-submit-btn {
            padding: 13px 20px;
            font-size: 14px;
          }

          .auth-session-conflict,
          .auth-error-detail {
            padding: 10px 12px;
            font-size: 12px;
          }

          .carrom-experience {
            min-height: 240px;
            padding: 6px;
          }

          .carrom-stage {
            max-width: 280px;
          }

          .carrom-piece--school,
          .carrom-piece--student,
          .carrom-piece--parent {
            width: 48px;
            height: 48px;
            font-size: 8px;
          }

          .carrom-striker {
            width: 60px;
            height: 60px;
          }

          .carrom-hole {
            width: 18px;
            height: 18px;
          }
        }

        @media (max-width: 380px) {
          .login-page {
            padding: 6px;
          }

          .auth-panel-inner {
            padding: 14px 10px 12px;
          }

          .auth-logo {
            height: 44px;
            margin-bottom: 10px;
          }

          .portal-selector {
            gap: 4px;
            padding: 4px;
          }

          .portal-tab {
            padding: 8px 4px;
            font-size: 10px;
            min-height: 44px;
          }

          .portal-tab-icon {
            padding: 4px;
          }

          .portal-tab-icon-svg {
            width: 14px;
            height: 14px;
          }

          .auth-heading {
            font-size: 16px;
          }

          .auth-input {
            padding: 8px 0 8px 6px;
            font-size: 13px;
          }

          .auth-submit-btn {
            padding: 11px 16px;
            font-size: 13px;
          }

          .carrom-experience {
            min-height: 180px;
            padding: 4px;
          }

          .carrom-stage {
            max-width: 200px;
          }

          .carrom-piece--school,
          .carrom-piece--student,
          .carrom-piece--parent {
            width: 36px;
            height: 36px;
            font-size: 7px;
          }

          .carrom-striker {
            width: 44px;
            height: 44px;
          }

          .carrom-hole {
            width: 14px;
            height: 14px;
          }
        }
      `}</style>
    </div>
  );
}
