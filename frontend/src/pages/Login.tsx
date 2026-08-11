import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, GraduationCap, Lock, Mail, Monitor, MoveRight, School, ShieldCheck, Users } from 'lucide-react';

import bhavyaAxisLogo from '@/assets/bhavya-axis-logo-removebg-preview.png';
import InteractiveCompass from '@components/login/InteractiveCompass';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService } from '@services/api';
import type { PortalIntent, SchoolPublicBranding } from '@types';

const DEFAULT_BRANDING: SchoolPublicBranding = {
  school_name: 'School ERP',
  portal_name: 'School ERP',
  tagline: '',
  logo_url: '',
  banner_url: '',
  favicon_url: '',
  background_image_url: '',
  welcome_message: 'Welcome Back!',
  footer_text: 'Use the account provided by your school',
  primary_color: '#091a45',
  secondary_color: '#0f2f77',
  accent_color: '#f5b41f',
  theme: 'auto',
};

const SCHOOL_CONTEXT_REQUIRED_HINT = 'School context is required for username login';
const SCHOOL_CONTEXT_MESSAGE = 'Please select a school before using a username. Alternatively, log in with your email.';

const TABS: { key: PortalIntent; label: string; Icon: typeof School | typeof GraduationCap | typeof Users | typeof Monitor }[] = [
  { key: 'school_erp', label: 'School ERP', Icon: School },
  { key: 'student_portal', label: 'Student', Icon: GraduationCap },
  { key: 'parent_portal', label: 'Parent', Icon: Users },
  { key: 'platform_admin', label: 'Admin', Icon: Monitor },
];

const PORTAL_DETAILS: Record<
  PortalIntent,
  {
    heading: string;
    subtitle: string;
    buttonText: string;
    helperText: string;
  }
> = {
  school_erp: {
    heading: 'School ERP',
    subtitle: 'Login to your school workspace',
    buttonText: 'Login to School ERP',
    helperText: 'Use the account provided by your school',
  },
  student_portal: {
    heading: 'Student Portal',
    subtitle: 'Login to your student workspace',
    buttonText: 'Login to Student Portal',
    helperText: 'Use the credentials shared by your school',
  },
  parent_portal: {
    heading: 'Parent Portal',
    subtitle: 'Login to your parent workspace',
    buttonText: 'Login to Parent Portal',
    helperText: 'Use the credentials linked with your child',
  },
  platform_admin: {
    heading: 'Admin Portal',
    subtitle: 'Login to platform administration',
    buttonText: 'Login as Admin',
    helperText: 'Restricted access for authorized administrators',
  },
};

function looksLikeEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
}

function toFriendlyLoginError(raw: string): string {
  if (raw.includes(SCHOOL_CONTEXT_REQUIRED_HINT)) {
    return SCHOOL_CONTEXT_MESSAGE;
  }
  return raw;
}

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
  const [rememberMe, setRememberMe] = useState(true);

  const portalDetail = PORTAL_DETAILS[portalIntent];

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
        if (active) setBranding(response.data);
      } catch {
        if (active) setBranding(DEFAULT_BRANDING);
      }
    })();
    return () => {
      active = false;
    };
  }, [schoolHint]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = branding.school_name || branding.portal_name || 'Sign In';
    }
    const faviconUrl = branding.favicon_url;
    if (!faviconUrl || typeof document === 'undefined') return;
    let favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.href = faviconUrl;
  }, [branding.favicon_url, branding.portal_name, branding.school_name]);

  if (user) return <Navigate to={getDefaultRoute(user)} replace />;

  const submitLogin = async (options?: { forceTakeover?: boolean }) => {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !password) {
      setError('Please enter both email/username and password.');
      return;
    }
    if (portalIntent === 'school_erp' && !looksLikeEmail(trimmedIdentifier) && !schoolHint) {
      setError(SCHOOL_CONTEXT_MESSAGE);
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
        return;
      }
      const rawMessage =
        requestError?.conflict?.message ||
        requestError?.response?.data?.detail ||
        requestError?.message ||
        requestError?.error_description ||
        'Login failed';
      setError(toFriendlyLoginError(String(rawMessage)));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitLogin();
  };

  const message = error || authError || null;

  return (
    <div className="login-page">
      <div className="login-page__backdrop" />

      <div className="login-shell">
        <section className="auth-side">
          <div
            className="auth-card"
            style={
              branding.background_image_url
                ? {
                    backgroundImage: `radial-gradient(circle at 18% 8%, rgba(72, 103, 255, 0.28) 0%, transparent 32%), linear-gradient(180deg, rgba(9, 24, 67, 0.97) 0%, rgba(7, 18, 50, 0.99) 100%), url(${branding.background_image_url})`,
                  }
                : undefined
            }
          >
            <div className="auth-card__border" />

            <div className="auth-logo-wrap">
              <img src={branding.logo_url || bhavyaAxisLogo} alt={branding.school_name || 'School logo'} className="auth-logo" />
            </div>

            <div className="portal-header">
              <span className="portal-header__line" />
              <p className="portal-header__label">Choose Your Portal</p>
              <span className="portal-header__line" />
            </div>

            <div className="portal-tabs" role="tablist">
              {TABS.map(({ key, label, Icon }) => {
                const active = portalIntent === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setPortalIntent(key);
                      setError(null);
                      setSessionConflict(null);
                    }}
                    className={`portal-tab ${active ? 'portal-tab--active' : ''}`}
                  >
                    <span className="portal-tab__icon"><Icon className="portal-tab__icon-svg" /></span>
                    <span className="portal-tab__label">{label}</span>
                  </button>
                );
              })}
            </div>

            <h1 className="auth-title">{portalDetail.heading}</h1>
            <p className="auth-subtitle">{portalDetail.subtitle}</p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label className="auth-field__label">{portalIntent === 'school_erp' ? 'Email' : 'Email or Username'}</label>
                <div className="auth-input-wrap">
                  <Mail className="auth-input__icon" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder={portalIntent === 'school_erp' ? 'Enter your email' : 'Enter your email or username'}
                    className="auth-input"
                  />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-field__label">Password</label>
                <div className="auth-input-wrap">
                  <Lock className="auth-input__icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="auth-input"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff className="auth-input__icon" /> : <Eye className="auth-input__icon" />}
                  </button>
                </div>
              </div>

              <div className="auth-utility-row">
                <label className="auth-checkbox">
                  <input type="checkbox" checked={rememberMe} onChange={() => setRememberMe((current) => !current)} />
                  <span>Remember me</span>
                </label>
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => setError('Forgot password flow abhi configured nahi hai. Admin se temporary password le sakte ho.')}
                >
                  Forgot Password?
                </button>
              </div>

              <div className="auth-message-zone" aria-live="polite">
                {sessionConflict ? (
                  <div className="auth-session-conflict">
                    <div className="auth-session-conflict__info">
                      <p className="auth-session-conflict__title">Existing session detected.</p>
                      <p className="auth-session-conflict__detail">
                        {sessionConflict?.current_session?.device_name || 'Another device'} | {sessionConflict?.current_session?.browser || 'Browser'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void submitLogin({ forceTakeover: true })}
                      className="auth-session-conflict__btn"
                    >
                      Continue Here
                    </button>
                  </div>
                ) : message ? (
                  <div className="auth-error-box" role="alert">
                    <p className="auth-error-box__text">
                      {message.includes('Session registration timeout') || message.includes('session registration')
                        ? 'Login verified, but application session setup could not complete. Please try again.'
                        : message}
                    </p>
                  </div>
                ) : null}
              </div>

              <button type="submit" disabled={loading} className="auth-submit-btn">
                {loading ? (
                  <span className="auth-submit-btn__loading">
                    <svg className="auth-spinner" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.4 31.4" />
                    </svg>
                    Signing In...
                  </span>
                ) : (
                  <>
                    <MoveRight className="auth-submit-btn__icon" />
                    <span>{portalDetail.buttonText}</span>
                  </>
                )}
              </button>

              <p className="auth-helper">{portalDetail.helperText}</p>
            </form>

            {(branding.footer_text || DEFAULT_BRANDING.footer_text) !== portalDetail.helperText ? (
              <footer className="auth-footer">
                <ShieldCheck className="auth-footer__icon" />
                <span>{branding.footer_text || DEFAULT_BRANDING.footer_text}</span>
              </footer>
            ) : null}
          </div>
        </section>

        <section className="hero-side">
          <div className="hero-side__glow hero-side__glow--one" />
          <div className="hero-side__glow hero-side__glow--two" />
          <div className="hero-compass-wrap">
            <InteractiveCompass activePortal={portalIntent} />
          </div>
        </section>
      </div>

      <style>{`
        .login-page {
          position: relative;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          overflow: hidden;
          background: #06142f;
          font-family: 'Nunito', 'DM Sans', sans-serif;
          box-sizing: border-box;
        }

        .login-page__backdrop {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 18% 12%, rgba(56, 101, 255, 0.24) 0%, transparent 26%),
            radial-gradient(circle at 84% 84%, rgba(38, 180, 255, 0.12) 0%, transparent 22%),
            linear-gradient(135deg, #07142d 0%, #0b1c43 48%, #081632 100%);
        }

        .login-shell {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(420px, 560px) minmax(720px, 1fr);
          width: 100%;
          max-width: 1400px;
          height: min(780px, calc(100dvh - 24px));
          max-height: calc(100dvh - 24px);
          border-radius: 38px;
          border: 1px solid rgba(224, 176, 67, 0.5);
          background: linear-gradient(180deg, rgba(7, 19, 47, 0.94) 0%, rgba(6, 16, 40, 0.94) 100%);
          box-shadow:
            0 34px 90px rgba(0, 0, 0, 0.42),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
          overflow: hidden;
        }

        .auth-side {
          padding: 16px;
          min-height: 0;
        }

        .auth-card {
          position: relative;
          height: 100%;
          min-height: 0;
          border-radius: 30px;
          padding: 16px 24px 18px;
          display: flex;
          flex-direction: column;
          background:
            radial-gradient(circle at 18% 8%, rgba(72, 103, 255, 0.28) 0%, transparent 32%),
            linear-gradient(180deg, rgba(9, 24, 67, 0.97) 0%, rgba(7, 18, 50, 0.99) 100%);
          border: 1px solid rgba(221, 181, 79, 0.25);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 24px 44px rgba(0, 0, 0, 0.26);
          color: #ffffff;
          background-size: cover;
          background-position: center;
          overflow: hidden;
        }

        .auth-card__border {
          position: absolute;
          inset: -10px;
          border-radius: 34px;
          border: 2px solid rgba(245, 190, 72, 0.22);
          pointer-events: none;
        }

        .auth-logo-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 14px;
        }

        .auth-logo {
          width: auto;
          max-height: 70px;
          object-fit: contain;
          filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.28));
        }

        .portal-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
        }

        .portal-header__line {
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, rgba(247, 194, 82, 0.85) 100%);
        }

        .portal-header__line:last-child {
          background: linear-gradient(90deg, rgba(247, 194, 82, 0.85) 0%, transparent 100%);
        }

        .portal-header__label {
          margin: 0;
          white-space: nowrap;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 12px;
          font-weight: 800;
          color: #ffc950;
        }

        .portal-tabs {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          padding: 8px;
          border-radius: 22px;
          margin-bottom: 16px;
          background: linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
          border: 1px solid rgba(255, 204, 97, 0.12);
        }

        .portal-tab {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 76px;
          padding: 8px 6px;
          border-radius: 16px;
          border: 1px solid transparent;
          background: transparent;
          color: #c8d6f2;
          cursor: pointer;
          transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
        }

        .portal-tab:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.03);
        }

        .portal-tab--active {
          background: linear-gradient(180deg, rgba(12, 31, 84, 1) 0%, rgba(7, 19, 56, 1) 100%);
          border-color: rgba(255, 200, 72, 0.72);
          color: #ffc950;
          box-shadow: 0 14px 24px rgba(0, 0, 0, 0.22);
        }

        .portal-tab__icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 0;
          background: transparent;
        }

        .portal-tab--active .portal-tab__icon {
          background: transparent;
        }

        .portal-tab__icon-svg {
          width: 18px;
          height: 18px;
        }

        .portal-tab__label {
          font-size: 11px;
          font-weight: 800;
          line-height: 1.2;
          text-align: center;
        }

        .portal-tab--active .portal-tab__label {
          color: #ffc950;
        }

        .auth-title {
          margin: 0;
          text-align: center;
          font-size: 25px;
          line-height: 1.1;
          font-weight: 900;
          color: #f8fbff;
        }

        .auth-subtitle {
          margin: 6px 0 14px;
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          color: #b4c3e1;
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          flex: 1;
        }

        .auth-field {
          margin-bottom: 12px;
        }

        .auth-field__label {
          display: block;
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 800;
          color: #ffc950;
        }

        .auth-input-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 48px;
          padding: 0 16px;
          border-radius: 14px;
          border: 1px solid rgba(255, 210, 104, 0.16);
          background: linear-gradient(180deg, rgba(15, 31, 78, 0.98) 0%, rgba(9, 23, 62, 0.98) 100%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
          overflow: hidden;
        }

        .auth-input-wrap:focus-within {
          border-color: rgba(255, 205, 92, 0.75);
          box-shadow:
            0 0 0 4px rgba(245, 180, 31, 0.1),
            inset 0 1px 0 rgba(255,255,255,0.05);
        }

        .auth-input__icon {
          width: 18px;
          height: 18px;
          color: #d2def2;
          flex-shrink: 0;
        }

        .auth-input {
          flex: 1;
          width: 100%;
          height: 46px;
          min-width: 0;
          margin: 0;
          border: none;
          outline: none;
          background: transparent;
          box-shadow: none;
          appearance: none;
          -webkit-appearance: none;
          color: #ffffff;
          font-size: 13px;
          font-weight: 600;
          line-height: 46px;
          padding: 0;
          font-family: 'Nunito', 'DM Sans', sans-serif;
          border-radius: 0;
          vertical-align: middle;
        }

        .auth-input::placeholder {
          color: #a8badc;
          line-height: 46px;
        }

        .auth-input:-webkit-autofill,
        .auth-input:-webkit-autofill:hover,
        .auth-input:-webkit-autofill:focus,
        .auth-input:-webkit-autofill:active {
          -webkit-text-fill-color: #ffffff;
          -webkit-box-shadow: 0 0 0 1000px rgba(10, 24, 64, 0.98) inset;
          box-shadow: 0 0 0 1000px rgba(10, 24, 64, 0.98) inset;
          transition: background-color 9999s ease-out 0s;
          caret-color: #ffffff;
          border: none;
        }

        .auth-password-toggle {
          border: none;
          background: transparent;
          padding: 0;
          cursor: pointer;
          color: #d2def2;
        }

        .auth-utility-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .auth-checkbox {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          font-weight: 700;
          color: #eef4ff;
          cursor: pointer;
        }

        .auth-checkbox input {
          width: 16px;
          height: 16px;
          accent-color: #f5b41f;
        }

        .auth-link-btn {
          border: none;
          background: transparent;
          padding: 0;
          cursor: pointer;
          font-size: 12px;
          font-weight: 800;
          color: #ffc950;
        }

        .auth-message-zone {
          min-height: 36px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
        }

        .auth-error-box,
        .auth-session-conflict {
          width: 100%;
          border-radius: 14px;
          padding: 12px 14px;
        }

        .auth-error-box {
          border: 1px solid rgba(255, 137, 137, 0.36);
          background: rgba(99, 19, 31, 0.42);
          color: #ffd6d6;
        }

        .auth-error-box__text {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          font-weight: 700;
        }

        .auth-session-conflict {
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid rgba(255, 205, 92, 0.34);
          background: rgba(80, 54, 7, 0.34);
          color: #fff2ca;
        }

        .auth-session-conflict__info {
          flex: 1;
          min-width: 0;
        }

        .auth-session-conflict__title {
          margin: 0 0 2px;
          font-size: 12px;
          font-weight: 800;
        }

        .auth-session-conflict__detail {
          margin: 0;
          font-size: 11px;
          opacity: 0.9;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .auth-session-conflict__btn {
          flex-shrink: 0;
          border: none;
          border-radius: 999px;
          padding: 10px 14px;
          background: linear-gradient(180deg, #ffd05a 0%, #d69306 100%);
          color: #12264f;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
        }

        .auth-submit-btn {
          width: 100%;
          min-height: 50px;
          border-radius: 999px;
          border: 1px solid rgba(255, 197, 78, 0.84);
          background: transparent;
          color: #ffc950;
          font-size: 14px;
          font-weight: 900;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .auth-submit-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow:
            0 14px 24px rgba(0, 0, 0, 0.22),
            inset 0 1px 0 rgba(255,255,255,0.04);
        }

        .auth-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .auth-submit-btn__icon {
          width: 18px;
          height: 18px;
        }

        .auth-submit-btn__loading {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .auth-spinner {
          width: 18px;
          height: 18px;
          animation: auth-spin 0.8s linear infinite;
        }

        .auth-helper {
          margin: 10px 0 0;
          text-align: center;
          font-size: 12px;
          line-height: 1.55;
          color: #9fb1d8;
        }

        .auth-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: auto;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 205, 92, 0.12);
          color: #eef5ff;
          font-size: 12px;
          font-weight: 700;
        }

        .auth-footer__icon {
          width: 18px;
          height: 18px;
          color: #ffc950;
          flex-shrink: 0;
        }

        .hero-side {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: 18px 24px;
          min-height: 0;
        }

        .hero-side__glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(22px);
          pointer-events: none;
          opacity: 0.55;
        }

        .hero-side__glow--one {
          width: 220px;
          height: 220px;
          right: 90px;
          top: 110px;
          background: rgba(51, 170, 255, 0.16);
        }

        .hero-side__glow--two {
          width: 180px;
          height: 180px;
          left: 120px;
          bottom: 80px;
          background: rgba(255, 197, 78, 0.08);
        }

        .hero-compass-wrap {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 760px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 0;
        }

        .compass-shell {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          max-width: 700px;
          gap: 10px;
          height: 100%;
          padding: 4px;
          min-height: 0;
        }

        .compass-stage {
          width: min(100%, 690px, calc(100dvh - 130px));
          max-width: 100%;
          max-height: 100%;
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
          display: none;
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

        .compass-ball[data-active="true"] {
          box-shadow:
            0 4px 14px rgba(0, 0, 0, 0.35),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 2px 4px rgba(255, 255, 255, 0.12),
            0 0 0 4px var(--ball-glow, rgba(59, 130, 246, 0.4)),
            0 0 24px var(--ball-glow, rgba(59, 130, 246, 0.15)) !important;
          border-color: var(--ball-glow, rgba(59, 130, 246, 0.5)) !important;
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

        .compass-ball-logo-img {
          width: 70%;
          height: 70%;
          object-fit: contain;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
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

        @keyframes auth-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .login-shell {
            grid-template-columns: 1fr;
            max-width: 680px;
            height: auto;
            max-height: calc(100dvh - 24px);
            overflow: auto;
          }

          .hero-side {
            min-height: 340px;
            padding-top: 8px;
          }

          .compass-stage {
            width: min(100%, 540px, calc(100dvh - 220px));
          }
        }

        @media (max-width: 768px) {
          .login-page {
            padding: 12px;
            overflow: auto;
          }

          .login-shell {
            border-radius: 24px;
            height: auto;
            max-height: none;
          }

          .auth-side,
          .hero-side {
            padding: 12px;
          }

          .auth-card {
            padding: 20px 18px 18px;
          }

          .auth-card__border {
            inset: -6px;
          }

          .portal-tabs {
            grid-template-columns: repeat(2, 1fr);
          }

          .portal-tab {
            min-height: 86px;
          }

          .auth-title {
            font-size: 28px;
          }

          .auth-utility-row {
            flex-direction: column;
            align-items: flex-start;
          }

          .auth-session-conflict {
            flex-direction: column;
            align-items: flex-start;
          }

          .auth-session-conflict__btn {
            width: 100%;
          }

          .hero-side {
            min-height: 300px;
          }

          .compass-stage {
            width: min(100%, 400px, calc(100dvh - 360px));
          }
        }

        @media (max-width: 480px) {
          .login-page {
            padding: 8px;
          }

          .portal-tab__label {
            font-size: 12px;
          }

          .auth-title {
            font-size: 24px;
          }

          .auth-subtitle,
          .auth-helper {
            font-size: 12px;
          }

          .compass-stage {
            width: min(100%, 300px, calc(100dvh - 420px));
          }

          .compass-ball-label {
            font-size: 10px;
          }
        }
      `}</style>
    </div>
  );
}
