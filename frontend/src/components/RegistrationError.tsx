import { Loader } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '@/contexts/AuthProvider';

type Props = {
  errorMessage: string;
};

export default function RegistrationError({ errorMessage }: Props) {
  const { retrySessionRegistration, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await retrySessionRegistration();
    } catch (error: any) {
      setRetryError(error?.message || 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">Session Setup</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Could not complete session setup</h1>

        <p className="mt-3 text-sm text-slate-600">
          Your login succeeded, but the application session initialization did not complete.
          This is not a credential error.
        </p>

        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs font-medium text-amber-800">
            {errorMessage}
          </p>
        </div>

        {retryError && (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-xs font-medium text-red-700">{retryError}</p>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            disabled={retrying}
            onClick={handleRetry}
            className="flex w-full items-center justify-center rounded-full bg-sky-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                Setting up session...
              </>
            ) : (
              'Retry Session Setup'
            )}
          </button>
          <button
            type="button"
            disabled={retrying}
            onClick={signOut}
            className="flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
