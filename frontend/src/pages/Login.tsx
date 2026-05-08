import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';
import { apiService } from '@services/api';
import { useAuthStore } from '@store/auth';

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoggedIn) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await apiService.loginWithPassword({ username, password });
      const data = response.data;
      login(
        data.access_token,
        {
          id: data.user_id,
          username: data.username,
          email: data.email,
          full_name: data.full_name,
          role: data.role,
          user_type: data.user_type,
          permissions: data.permissions || [],
          is_active: true,
        },
        data.refresh_token || null,
      );
      navigate('/', { replace: true });
    } catch (requestError: any) {
      setError(requestError?.response?.data?.detail || requestError?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-5 py-8"
      style={{
        background:
          'linear-gradient(135deg,#a8edff 0%,#5bc8f5 30%,#38b6f5 55%,#00cfff 80%,#5feaff 100%)',
        fontFamily: 'Nunito, DM Sans, sans-serif',
      }}
    >
      <div className="flex min-h-[580px] w-full max-w-6xl overflow-hidden rounded-[24px] border border-white/70 bg-white/35 shadow-[0_30px_80px_rgba(0,120,200,0.18)] backdrop-blur-[18px] max-[900px]:max-w-xl max-[900px]:flex-col">
        <div className="m-2 flex w-[420px] flex-col rounded-[20px] bg-white px-10 py-9 shadow-[0_8px_32px_rgba(0,80,180,0.08)] max-[900px]:w-auto max-[900px]:px-7">
          <div className="mb-8 flex justify-center">
            <img src={bhavyaAxisLogo} alt="Bhavya Axis" className="h-24 w-auto object-contain" />
          </div>

          <h1 className="text-center text-[26px] font-extrabold tracking-[0.3px] text-[#1a2d4a]">Sign In</h1>
          <p className="mb-7 mt-1 text-center text-[13px] font-medium text-[#8aabbd]">
            Welcome back! Please enter your details.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
            <div className="mb-4">
              <label className="mb-1.5 block text-[12px] font-extrabold tracking-[0.3px] text-[#1a2d4a]">
                Username
              </label>
              <div className="flex items-center rounded-[10px] border-[1.5px] border-[#d0e8f5] bg-white px-3 transition focus-within:border-sky-600 focus-within:shadow-[0_0_0_3px_rgba(26,144,217,0.1)]">
                <Mail className="mr-2 h-[18px] w-[18px] flex-shrink-0 text-[#90bdd8]" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter your username"
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

            <button
              type="submit"
              disabled={loading}
              className="mb-5 w-full rounded-full border-none bg-gradient-to-r from-sky-600 to-cyan-400 px-4 py-[13px] text-[15px] font-extrabold tracking-[0.5px] text-white shadow-[0_6px_24px_rgba(0,150,230,0.35)] transition hover:-translate-y-[1px] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>

            <p className="mt-auto text-center text-[13px] text-[#8aabbd]">
              Admin creates users and roles. Login ke baad assigned modules hi dikhenge.
            </p>
          </form>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8 py-10 max-[900px]:min-h-[380px]">
          <div className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.5)_0%,rgba(100,200,255,0.2)_50%,transparent_70%)]" />

          <div className="relative z-10 flex w-full max-w-[520px] items-center justify-center">
            <img
              src={bhavyaAxisLogo}
              alt="Bhavya Axis"
              className="max-h-[420px] w-full max-w-[480px] object-contain drop-shadow-[0_18px_32px_rgba(9,50,105,0.16)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
