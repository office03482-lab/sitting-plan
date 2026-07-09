import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService, getRequestErrorMessage } from '@services/api';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';
import type { PlatformSchoolSummary } from '@types';
import type { ReactNode } from 'react';

type Props = {
  returnPath?: string;
  trigger?: ReactNode;
};

export default function PlatformAdminSchoolSelector({ returnPath, trigger }: Props) {
  const navigate = useNavigate();
  const setActiveSchool = usePlatformAdminSchoolStore((s) => s.setActiveSchool);
  const [schools, setSchools] = useState<PlatformSchoolSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiService.listPlatformSchools({ status: 'active' });
        if (!cancelled) {
          setSchools(res.data.items || []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(getRequestErrorMessage(err, 'Schools load nahi ho paaye.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = schools.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.school_code?.toLowerCase().includes(q) ||
      s.slug?.toLowerCase().includes(q)
    );
  });

  const handleSelect = (school: PlatformSchoolSummary) => {
    setActiveSchool(school.id, school.name);
    setOpen(false);
    setSearch('');
    if (returnPath) {
      navigate(returnPath, { replace: true });
    }
  };

  if (trigger) {
    return (
      <>
        <div onClick={() => setOpen(true)}>{trigger}</div>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div ref={modalRef} className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
              <SchoolSelectorContent
                loading={loading}
                error={error}
                filtered={filtered}
                search={search}
                setSearch={setSearch}
                handleSelect={handleSelect}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <SchoolSelectorContent
      loading={loading}
      error={error}
      filtered={filtered}
      search={search}
      setSearch={setSearch}
      handleSelect={handleSelect}
    />
  );
}

function SchoolSelectorContent({
  loading, error, filtered, search, setSearch, handleSelect, onClose,
}: {
  loading: boolean;
  error: string | null;
  filtered: PlatformSchoolSummary[];
  search: string;
  setSearch: (v: string) => void;
  handleSelect: (school: PlatformSchoolSummary) => void;
  onClose?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">
            School Context
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">
            Select a school
          </h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:text-slate-600">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search schools..."
        className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />

      {loading && (
        <div className="mt-4 flex items-center justify-center py-8 text-sm text-slate-400">
          <svg className="mr-2 h-5 w-5 animate-spin text-emerald-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading schools...
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="mt-4 py-8 text-center text-sm text-slate-400">
          {search ? 'No schools match your search.' : 'No active schools found.'}
        </p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {filtered.map((school) => (
            <li key={school.id}>
              <button
                type="button"
                onClick={() => handleSelect(school)}
                className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                  {(school.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{school.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {school.school_code || school.slug || school.id}
                  </p>
                </div>
                {school.status && (
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    school.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : school.status === 'suspended'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {school.status}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
