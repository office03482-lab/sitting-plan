import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformSchoolSummary } from '@types';

type Props = {
  mode: 'single' | 'multiple';
  value: PlatformSchoolSummary[];
  onChange: (next: PlatformSchoolSummary[]) => void;
};

function schoolStatusLabel(school: PlatformSchoolSummary): string {
  if (school.status === 'active') return 'Active';
  if (school.status === 'inactive') return 'Inactive';
  if (school.status === 'suspended') return 'Suspended';
  return school.is_active ? 'Active' : 'Inactive';
}

function schoolStatusTone(status: string): string {
  if (status === 'Active') return 'bg-emerald-100 text-emerald-700';
  if (status === 'Suspended') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

export default function PlatformSchoolPicker({ mode, value, onChange }: Props) {
  const [schools, setSchools] = useState<PlatformSchoolSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  const loadSchools = async () => {
    if (fetchedRef.current && schools.length > 0) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiService.listPlatformSchools({ status: 'active' });
      setSchools(response.data.items || []);
      fetchedRef.current = true;
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Schools load nahi ho paaye.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSchools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return schools;
    return schools.filter(
      (school) =>
        school.name.toLowerCase().includes(query) ||
        school.school_code?.toLowerCase().includes(query) ||
        school.slug?.toLowerCase().includes(query),
    );
  }, [schools, search]);

  const isSelected = (schoolId: string) => value.some((school) => school.id === schoolId);

  const toggleSchool = (school: PlatformSchoolSummary) => {
    if (mode === 'single') {
      onChange([school]);
      setOpen(false);
      setSearch('');
      return;
    }
    const exists = isSelected(school.id);
    onChange(exists ? value.filter((item) => item.id !== school.id) : [...value, school]);
  };

  const removeSchool = (schoolId: string) => {
    onChange(value.filter((item) => item.id !== schoolId));
  };

  const triggerLabel =
    mode === 'single'
      ? value[0]
        ? `${value[0].name} (${value[0].school_code || value[0].slug})`
        : 'Select School'
      : value.length > 0
        ? `${value.length} ${value.length === 1 ? 'school' : 'schools'} selected`
        : 'Select one or more schools';

  return (
    <div ref={rootRef} className="relative">
      {mode === 'multiple' && value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((school) => (
            <span
              key={school.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
            >
              {school.name}
              <button
                type="button"
                onClick={() => removeSchool(school.id)}
                aria-label={`Remove ${school.name}`}
                className="rounded-full text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left text-sm hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <span className={value.length === 0 ? 'text-slate-400' : 'truncate font-medium text-slate-800'}>
          {triggerLabel}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100 p-3">
            <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search schools by name or code..."
              className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {loading && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">Loading schools...</p>
            )}
            {error && (
              <p className="px-3 py-6 text-center text-sm text-rose-600">{error}</p>
            )}
            {!loading && !error && filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">
                {search ? 'No schools match your search.' : 'No active schools found.'}
              </p>
            )}
            {!loading &&
              !error &&
              filtered.map((school) => {
                const selected = isSelected(school.id);
                const statusLabel = schoolStatusLabel(school);
                return (
                  <button
                    type="button"
                    key={school.id}
                    onClick={() => toggleSchool(school)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    {mode === 'multiple' && (
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'
                        }`}
                      >
                        {selected && <Check className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                      {(school.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{school.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {school.school_code || school.slug} · School ERP ·{' '}
                        {school.is_active ? 'Active' : 'Inactive'}
                      </p>
                      {school.subscription?.current_plan ? (
                        <p className="truncate text-xs text-slate-400">
                          Plan: {school.subscription.current_plan}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${schoolStatusTone(statusLabel)}`}
                    >
                      {statusLabel}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
