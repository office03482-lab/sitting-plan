import { FormEvent, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthProvider';
import { createIsolatedSupabaseClient, supabase } from '@/lib/supabase';
import { apiService } from '@services/api';

const PASSWORD_REQUIREMENTS = [
  'At least 8 characters',
  'One uppercase letter',
  'One lowercase letter',
  'One number',
  'One special character',
];

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

const FIRST_LOGIN_STEPS = [
  'Verify email',
  'Accept terms',
  'Change password',
  'Confirm mobile',
  'Optional MFA setup',
  'Review school information',
  'Complete school profile',
  'Finish setup',
];

export default function ForcePasswordChange() {
  const { user, getDefaultRoute, reloadUserProfile, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [mobileNumber, setMobileNumber] = useState('');
  const [mfaChoice, setMfaChoice] = useState<'skip' | 'later' | 'enable'>('later');
  const [schoolProfileNote, setSchoolProfileNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSchoolAdminFirstLogin = useMemo(
    () => user?.role_key === 'school_admin' && Boolean(user.must_change_password),
    [user],
  );

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.must_change_password) {
    return <Navigate to={getDefaultRoute(user)} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!termsAccepted) {
      setError('Please accept the onboarding terms to continue.');
      return;
    }
    if (!emailVerified) {
      setError('Please verify the primary email before finishing first login.');
      return;
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      setError('New password does not meet the password policy.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from current password.');
      return;
    }

    setLoading(true);
    try {
      const verifier = createIsolatedSupabaseClient();
      const verifyResponse = await verifier.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (verifyResponse.error) {
        throw new Error('Current password is incorrect.');
      }

      const updateResponse = await supabase.auth.updateUser({ password: newPassword });
      if (updateResponse.error) {
        throw updateResponse.error;
      }

      await apiService.completeForcedPasswordChange();
      await reloadUserProfile();
      setSuccess('First login completed. Redirecting to your workspace...');
      setTimeout(() => {
        window.location.replace(getDefaultRoute(user));
      }, 700);
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.detail ||
          requestError?.message ||
          'Unable to complete first login right now.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_30%),linear-gradient(135deg,_#f8fafc,_#e2e8f0_45%,_#dbeafe)] px-4 py-10">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-8 shadow-xl backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.26em] text-sky-700">First Login Wizard</p>
          <h1 className="mt-3 text-3xl font-bold text-slate-900">
            {isSchoolAdminFirstLogin ? 'Finish school activation' : 'Change your password'}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Your temporary access is active, but the ERP stays locked until onboarding is completed.
          </p>

          <div className="mt-8 space-y-3">
            {FIRST_LOGIN_STEPS.map((step, index) => (
              <div key={step} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  {index + 1}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{step}</p>
                  <p className="text-xs text-slate-500">
                    {step === 'Change password'
                      ? 'Mandatory before dashboard access.'
                      : step === 'Optional MFA setup'
                        ? 'You can skip this for now and enable later.'
                        : 'Required for secure school activation.'}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-3xl bg-slate-950 p-5 text-slate-100">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Current Access</p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-slate-400">Account</p>
                <p className="font-semibold">{user.full_name}</p>
              </div>
              <div>
                <p className="text-slate-400">Login Email</p>
                <p className="font-semibold">{user.email}</p>
              </div>
              <div>
                <p className="text-slate-400">Role</p>
                <p className="font-semibold">{user.role_key || user.role}</p>
              </div>
              <div>
                <p className="text-slate-400">School</p>
                <p className="font-semibold">{user.school_id || 'School context loading'}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <span className="font-semibold text-slate-800">Verify email</span>
                <span className="mt-1 block text-slate-500">Confirm that {user.email} is the right login email.</span>
                <input
                  type="checkbox"
                  checked={emailVerified}
                  onChange={(event) => setEmailVerified(event.target.checked)}
                  className="mt-4 h-4 w-4"
                />
              </label>
              <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <span className="font-semibold text-slate-800">Accept terms</span>
                <span className="mt-1 block text-slate-500">Acknowledge the secure-use and tenant-isolation policy.</span>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  className="mt-4 h-4 w-4"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-sky-500"
                  placeholder="Enter temporary password"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Confirmed Mobile</label>
                <input
                  type="text"
                  value={mobileNumber}
                  onChange={(event) => setMobileNumber(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-sky-500"
                  placeholder="Enter admin mobile number"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-sky-500"
                  placeholder="Create a strong new password"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-sky-500"
                  placeholder="Re-enter the new password"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">MFA Setup</p>
                <select
                  value={mfaChoice}
                  onChange={(event) => setMfaChoice(event.target.value as 'skip' | 'later' | 'enable')}
                  className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                >
                  <option value="later">Remind me later</option>
                  <option value="enable">I will enable after dashboard unlock</option>
                  <option value="skip">Skip for now</option>
                </select>
                <p className="mt-3 text-xs text-slate-500">Optional during first login. Recommended before inviting more users.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">School Profile Notes</p>
                <textarea
                  value={schoolProfileNote}
                  onChange={(event) => setSchoolProfileNote(event.target.value)}
                  rows={5}
                  className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500"
                  placeholder="Add any first-login notes about school branding, board, session, or admin handoff."
                />
                <p className="mt-2 text-xs text-slate-500">This step lets the school admin review the setup before unlocking the ERP.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Password policy</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
                {PASSWORD_REQUIREMENTS.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </div>

            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? 'Completing setup...' : 'Complete First Login'}
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Logout
              </button>
              <a
                href="mailto:support@platform.local?subject=First%20Login%20Help"
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Help
              </a>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
