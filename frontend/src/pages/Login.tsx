import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, GraduationCap, Lock, Mail, Monitor, School, Users } from 'lucide-react';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService } from '@services/api';
import type { PortalIntent, SchoolPublicBranding } from '@types';
import InteractiveCompass from '@components/login/InteractiveCompass';

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

  const shellRef = useRef<HTMLDivElement>(null);
  const [masterScale, setMasterScale] = useState(1);

  useEffect(() => {
    function compute() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const availW = Math.max(vw - 48, 200);
      const availH = Math.max(vh - 48, 200);

      // Stacked mode for narrower viewports — no zoom needed
      const isStacked = vw < 1000;
      if (isStacked) {
        setMasterScale(1);
        return;
      }

      // Side-by-side mode — scale to fit both width and height
      const scaleW = availW / 1200;
      const scaleH = availH / 600;
      const scale = Math.min(scaleW, scaleH, 1);
      setMasterScale(scale);
    }
    compute();
    const vis = window.visualViewport;
    window.addEventListener('resize', compute);
    if (vis) vis.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('resize', compute);
      if (vis) vis.removeEventListener('resize', compute);
    };
  }, []);

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

      <div ref={shellRef} className="login-shell" style={{ '--master-scale': masterScale } as React.CSSProperties}>
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

        <div className="compass-experience">
          <InteractiveCompass activePortal={portalIntent} />
        </div>
      </div>

      <style>{`
        .login-page {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding:
            max(24px, env(safe-area-inset-top, 0px))
            max(20px, env(safe-area-inset-right, 0px))
            max(24px, env(safe-area-inset-bottom, 0px))
            max(20px, env(safe-area-inset-left, 0px));
          overflow-x: hidden;
          overflow-y: auto;
          background: #0b1120;
          font-family: 'Nunito', 'DM Sans', sans-serif;
        }

        .login-bg-gradient {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            135deg,
            #071426 0%,
            #10213d 38%,
            #172554 66%,
            #083344 100%
          );
        }

        .login-bg-radial {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 18% 22%, rgba(59, 130, 246, 0.22) 0%, transparent 34%),
            radial-gradient(circle at 82% 70%, rgba(20, 184, 166, 0.18) 0%, transparent 38%),
            radial-gradient(circle at 60% 15%, rgba(139, 92, 246, 0.14) 0%, transparent 30%);
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
          max-height: 600px;
          zoom: var(--master-scale, 1);
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          box-shadow:
            0 24px 80px rgba(0, 0, 0, 0.3),
            0 8px 32px rgba(0, 0, 0, 0.15),
             inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .auth-panel {
          width: clamp(320px, 35%, 420px);
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
          justify-content: center;
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

        .compass-experience {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          position: relative;
          overflow: hidden;
          background:
            linear-gradient(135deg, #071426 0%, #10213d 38%, #172554 66%, #083344 100%),
            radial-gradient(circle at 18% 22%, rgba(59, 130, 246, 0.22) 0%, transparent 34%),
            radial-gradient(circle at 82% 70%, rgba(20, 184, 166, 0.18) 0%, transparent 38%),
            radial-gradient(circle at 60% 15%, rgba(139, 92, 246, 0.14) 0%, transparent 30%);
          background-blend-mode: normal, normal, normal, normal;
        }

        .compass-shell {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          max-width: 560px;
          gap: 10px;
          padding: 4px;
        }

        .compass-stage {
          width: 100%;
          aspect-ratio: 1;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .compass-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          filter: drop-shadow(0 8px 24px rgba(15, 23, 42, 0.14));
          overflow: visible;
        }

        .compass-ball-layer {
          position: absolute;
          inset: 0;
        }

        .compass-ball {
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
          touch-action: none;
          transition: box-shadow 0.3s ease, border-color 0.3s ease;
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.35),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 2px 4px rgba(255, 255, 255, 0.12);
          border: 2px solid rgba(255, 255, 255, 0.1);
        }

        .compass-ball::before {
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

        .compass-ball-label {
          pointer-events: none;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
          font-size: 10px;
        }

        .compass-ball-logo-img {
          width: 70%;
          height: 70%;
          object-fit: contain;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
        }

        .compass-ball[data-active="true"] {
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.35),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 2px 4px rgba(255, 255, 255, 0.12),
            0 0 0 4px var(--ball-glow, rgba(59, 130, 246, 0.4)),
            0 0 24px var(--ball-glow, rgba(59, 130, 246, 0.15)) !important;
          border-color: var(--ball-glow, rgba(59, 130, 246, 0.5)) !important;
        }

        .compass-bearing-display,
        .compass-bearing-text,
        .compass-bearing-degrees {
          /* removed - replaced by compass-heading-display */
        }

        .compass-ball[data-kind="logo"] {
          background: rgba(255, 255, 255, 0.92);
          box-shadow:
            0 6px 28px rgba(0, 0, 0, 0.35),
            inset 0 -4px 12px rgba(0, 0, 0, 0.12),
            inset 0 3px 8px rgba(255, 255, 255, 0.35);
          border: 3px solid rgba(249, 115, 22, 0.2);
          transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .compass-ball[data-kind="logo"]::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.2), transparent 60%);
          pointer-events: none;
        }

        .compass-ball[data-kind="logo"]::after {
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

        .compass-heading-display {
          text-align: center;
          padding: 0 0 10px;
          pointer-events: none;
          white-space: nowrap;
          width: 100%;
        }

        .compass-heading-degrees {
          font-size: 30px;
          font-weight: 800;
          color: #FFFFFF;
          letter-spacing: 0.8px;
          font-family: 'Nunito', 'DM Sans', sans-serif;
          text-shadow: 0 3px 16px rgba(0,0,0,0.28);
        }

        .compass-ball[data-kind="logo"][data-active="true"] {
          border-color: rgba(249, 115, 22, 0.5) !important;
          box-shadow:
            0 6px 28px rgba(0, 0, 0, 0.35),
            inset 0 -4px 12px rgba(0, 0, 0, 0.12),
            inset 0 3px 8px rgba(255, 255, 255, 0.35),
            0 0 0 4px rgba(249, 115, 22, 0.3),
            0 0 24px rgba(249, 115, 22, 0.12) !important;
        }

        .compass-debug-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 30;
        }

        .compass-debug-center {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 8px;
          height: 8px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: red;
        }

        .compass-debug-circle {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          border: 1px solid rgba(255, 0, 0, 0.8);
          border-radius: 50%;
        }

        .compass-debug-circle-playable {
          width: calc(100% - 112px);
          height: calc(100% - 112px);
        }

        .compass-debug-circle-outer {
          width: calc(100% - 4px);
          height: calc(100% - 4px);
        }

        .compass-debug-ball {
          position: absolute;
          transform: translate(-50%, -50%);
          padding: 2px 4px;
          border-radius: 4px;
          background: rgba(255, 0, 0, 0.8);
          color: white;
          font-size: 10px;
          white-space: nowrap;
        }

        @media (max-height: 720px) {
          .auth-panel-inner {
            padding: 24px 28px 20px;
          }
          .auth-logo {
            height: 60px;
            margin-bottom: 16px;
          }
          .auth-heading {
            font-size: 20px;
          }
          .auth-subtitle {
            margin-bottom: 16px;
          }
          .auth-field {
            margin-bottom: 12px;
          }
          .auth-submit-btn {
            padding: 12px 22px;
            margin-bottom: 12px;
          }
        }

        @media (max-height: 660px) {
          .auth-panel-inner {
            padding: 18px 22px 16px;
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
            padding: 5px;
            gap: 5px;
            margin-bottom: 14px;
          }
          .portal-tab {
            padding: 8px 4px 6px;
          }
          .portal-tab-icon {
            padding: 5px;
          }
          .portal-tab-icon-svg {
            width: 14px;
            height: 14px;
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
            font-size: 13px;
          }
          .auth-submit-btn {
            padding: 11px 20px;
            font-size: 14px;
            margin-bottom: 10px;
          }
          .auth-helper {
            font-size: 11px;
          }
          .compass-experience {
            min-height: 340px;
          }
          .compass-shell {
            max-width: 340px;
          }
        }

        @media (max-height: 600px) {
          .auth-panel-inner {
            padding: 14px 18px 12px;
          }
          .auth-logo {
            height: 44px;
            margin-bottom: 10px;
          }
          .auth-portal-label {
            font-size: 9px;
            margin-bottom: 8px;
          }
          .portal-selector {
            padding: 4px;
            gap: 4px;
            margin-bottom: 10px;
            border-radius: 12px;
          }
          .portal-tab {
            padding: 6px 3px;
            font-size: 9px;
            min-height: 38px;
            border-radius: 10px;
          }
          .portal-tab-icon {
            padding: 4px;
          }
          .portal-tab-icon-svg {
            width: 12px;
            height: 12px;
          }
          .auth-heading {
            font-size: 15px;
          }
          .auth-subtitle {
            font-size: 11px;
            margin-bottom: 10px;
          }
          .auth-field {
            margin-bottom: 8px;
          }
          .auth-field-label {
            font-size: 10px;
            margin-bottom: 4px;
          }
          .auth-input-wrap {
            border-radius: 10px;
            padding: 0 10px;
          }
          .auth-input {
            padding: 8px 0 8px 6px;
            font-size: 12px;
          }
          .auth-input-icon {
            width: 14px;
            height: 14px;
          }
          .auth-submit-btn {
            padding: 9px 16px;
            font-size: 12px;
            border-radius: 999px;
            margin-bottom: 8px;
          }
          .auth-helper {
            font-size: 10px;
          }
          .auth-error {
            font-size: 11px;
            margin-bottom: 6px;
          }
          .auth-session-conflict,
          .auth-error-detail {
            padding: 8px 10px;
            font-size: 11px;
            margin-bottom: 8px;
          }
          .compass-experience {
            min-height: 260px;
            padding: 8px;
          }
          .compass-shell {
            max-width: 260px;
            gap: 6px;
          }
          .compass-heading-degrees {
            font-size: 16px;
          }
          .compass-ball {
            font-size: 8px;
          }
        }

        @media (max-width: 1000px) {
          .login-shell {
            flex-direction: column;
            max-width: 520px;
            max-height: none;
          }

          .auth-panel {
            width: 100%;
          }

          .compass-experience {
            min-height: 340px;
            padding: 12px;
          }

          .compass-shell {
            max-width: 420px;
          }

          .compass-heading-degrees {
            font-size: 22px;
          }

          .compass-ball {
            font-size: 10px;
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

          .compass-experience {
            min-height: 240px;
            padding: 6px;
          }

          .compass-shell {
            max-width: 280px;
          }

          .compass-heading-degrees {
            font-size: 18px;
          }

          .compass-ball {
            font-size: 8px;
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

          .compass-experience {
            min-height: 180px;
            padding: 4px;
          }

          .compass-shell {
            max-width: 200px;
          }

          .compass-heading-degrees {
            font-size: 14px;
          }

          .compass-ball {
            font-size: 7px;
          }
        }
      `}</style>
    </div>
  );
}
