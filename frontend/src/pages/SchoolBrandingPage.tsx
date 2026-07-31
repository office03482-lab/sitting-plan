import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/contexts/AuthProvider';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';
import type { ManageableSchoolSummary, SchoolBrandAsset, SchoolSelfServiceProfile, SchoolSummary } from '@types';
import { apiService, getRequestErrorMessage } from '@services/api';

const INPUT =
  'w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

const READ_ONLY_INPUT = `${INPUT} bg-slate-50 text-slate-600`;

const BRANDING_FIELDS: Array<{ key: string; label: string; readOnly?: boolean }> = [
  { key: 'school_name', label: 'School Name' },
  { key: 'short_name', label: 'Short Name' },
  { key: 'school_code', label: 'School Code', readOnly: true },
  { key: 'portal_name', label: 'Portal Name' },
  { key: 'tagline', label: 'Tagline' },
  { key: 'website', label: 'Website' },
  { key: 'email', label: 'School Email' },
  { key: 'phone', label: 'School Phone' },
  { key: 'principal_name', label: 'Principal Name' },
  { key: 'address', label: 'School Address' },
  { key: 'welcome_message', label: 'Welcome Message' },
  { key: 'footer_text', label: 'Footer Text' },
];

const ASSET_FIELDS: Array<[string, string]> = [
  ['logo', 'School Logo'],
  ['banner', 'School Banner'],
  ['favicon', 'School Icon'],
  ['background_image', 'Login Background'],
  ['principal_signature', 'Principal Signature'],
  ['official_seal', 'Official Seal'],
  ['report_card_header', 'Report Card Header'],
  ['certificate_header', 'Certificate Header'],
];

const PREVIEW_FIELDS: Array<[string, string, string]> = [
  ['logo_url', 'Logo', 'logo'],
  ['banner_url', 'Banner', 'banner'],
  ['favicon_url', 'Favicon', 'favicon'],
  ['background_image_url', 'Background', 'background_image'],
  ['principal_signature_url', 'Signature', 'principal_signature'],
  ['official_seal_url', 'Seal', 'official_seal'],
  ['report_card_header_url', 'Report Header', 'report_card_header'],
  ['certificate_header_url', 'Certificate Header', 'certificate_header'],
];

type PendingSwitchAction =
  | { school: ManageableSchoolSummary }
  | null;

const EMPTY_SUMMARY: SchoolSummary = {
  id: '',
  name: '',
  short_name: null,
  slug: '',
  school_code: '',
  timezone: 'Asia/Kolkata',
  contact_email: null,
  contact_phone: null,
  logo_url: null,
  status: null,
  is_active: true,
};

function toSnapshot(form: Record<string, unknown>) {
  return JSON.stringify(form || {});
}

function buildAssetPreviewMap(assets: SchoolBrandAsset[]) {
  const previews = new Map<string, string>();
  for (const asset of assets) {
    if (!asset?.asset_type || previews.has(asset.asset_type)) continue;
    previews.set(asset.asset_type, asset.public_url);
  }
  return previews;
}

export default function SchoolBrandingPage() {
  const { user } = useAuth();
  const { activeSchoolId, setActiveSchool } = usePlatformAdminSchoolStore();
  const [manageableSchools, setManageableSchools] = useState<ManageableSchoolSummary[]>([]);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [profile, setProfile] = useState<SchoolSelfServiceProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState(toSnapshot({}));
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitchAction>(null);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const profileRequestRef = useRef(0);

  const selectedSchool = useMemo(
    () => manageableSchools.find((school) => school.id === selectedSchoolId) ?? null,
    [manageableSchools, selectedSchoolId],
  );

  const schoolSummary = profile?.school_summary || (selectedSchool ? {
    id: selectedSchool.id,
    name: selectedSchool.name,
    short_name: selectedSchool.short_name || null,
    slug: selectedSchool.slug,
    school_code: selectedSchool.school_code,
    timezone: selectedSchool.timezone,
    contact_email: selectedSchool.contact_email || null,
    contact_phone: selectedSchool.contact_phone || null,
    logo_url: selectedSchool.logo_url || null,
    status: selectedSchool.status || null,
    is_active: selectedSchool.is_active ?? true,
  } : EMPTY_SUMMARY);

  const filteredSchools = useMemo(() => {
    const query = schoolSearch.trim().toLowerCase();
    if (!query) return manageableSchools;
    return manageableSchools.filter((school) =>
      [school.name, school.short_name, school.school_code, school.slug, school.contact_email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [manageableSchools, schoolSearch]);

  const assets = profile?.assets || [];
  const assetPreviewMap = useMemo(() => buildAssetPreviewMap(assets), [assets]);
  const isDirty = toSnapshot(form) !== loadedSnapshot;

  useEffect(() => {
    const loadManageableSchools = async () => {
      try {
        setSchoolsLoading(true);
        const response = await apiService.listManageableSchoolSelfServiceSchools();
        const items = response.data.items || [];
        setManageableSchools(items);
        setSchoolsError(null);

        if (activeSchoolId && items.some((school) => school.id === activeSchoolId)) {
          setSelectedSchoolId(activeSchoolId);
        }
      } catch (requestError: any) {
        setSchoolsError(getRequestErrorMessage(requestError, 'Schools load nahi ho paaye.'));
        setManageableSchools([]);
      } finally {
        setSchoolsLoading(false);
      }
    };

    void loadManageableSchools();
  }, [activeSchoolId]);

  useEffect(() => {
    if (!selectorOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setSelectorOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectorOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [selectorOpen]);

  useEffect(() => {
    if (!selectedSchoolId) {
      setForm({});
      setProfile(null);
      setLoadedSnapshot(toSnapshot({}));
      setLoading(false);
      setMessage(null);
      setError(null);
      return;
    }

    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;

    setLoading(true);
    setMessage(null);
    setError(null);
    setForm({});
    setProfile(null);

    const loadProfile = async () => {
      try {
        const response = await apiService.getSchoolSelfServiceProfileForSchool(selectedSchoolId);
        if (profileRequestRef.current !== requestId) return;
        const nextForm = response.data.branding || {};
        setProfile(response.data);
        setForm(nextForm);
        setLoadedSnapshot(toSnapshot(nextForm));
      } catch (requestError: any) {
        if (profileRequestRef.current !== requestId) return;
        setForm({});
        setProfile(null);
        setLoadedSnapshot(toSnapshot({}));
        setError(getRequestErrorMessage(requestError, 'School branding load nahi ho paayi.'));
      } finally {
        if (profileRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    };

    void loadProfile();
  }, [selectedSchoolId]);

  const updateField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const applySchoolSelection = (school: ManageableSchoolSummary) => {
    setSelectedSchoolId(school.id);
    setSelectorOpen(false);
    setSchoolSearch('');
    setMessage(null);
    setError(null);
    if (user?.role_key === 'platform_admin') {
      setActiveSchool(school.id, school.name);
    }
  };

  const handleSelectSchool = (school: ManageableSchoolSummary) => {
    if (school.id === selectedSchoolId) {
      setSelectorOpen(false);
      return;
    }
    if (isDirty && selectedSchoolId) {
      setPendingSwitch({ school });
      return;
    }
    applySchoolSelection(school);
  };

  const refreshProfile = async (schoolId: string) => {
    const response = await apiService.getSchoolSelfServiceProfileForSchool(schoolId);
    const nextForm = response.data.branding || {};
    setProfile(response.data);
    setForm(nextForm);
    setLoadedSnapshot(toSnapshot(nextForm));
    return response.data;
  };

  const saveBranding = async () => {
    if (!selectedSchoolId) return false;
    try {
      setSaving(true);
      const response = await apiService.updateSchoolBranding(form, selectedSchoolId);
      apiService.clearSchoolBrandingCache();
      setProfile(response.data);
      setForm(response.data.branding || {});
      setLoadedSnapshot(toSnapshot(response.data.branding || {}));
      await refreshProfile(selectedSchoolId);
      setMessage('Branding updated successfully.');
      setError(null);
      return true;
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Branding save nahi ho paayi.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadAsset = async (assetType: string, file?: File | null) => {
    if (!file || !selectedSchoolId) return;
    try {
      await apiService.uploadSchoolBrandAsset(assetType, file, selectedSchoolId);
      apiService.clearSchoolBrandingCache();
      await refreshProfile(selectedSchoolId);
      setMessage(`${assetType.replace(/_/g, ' ')} uploaded.`);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, `Asset upload failed for ${assetType}.`));
    }
  };

  const handleSaveAndSwitch = async () => {
    if (!pendingSwitch) return;
    const nextSchool = pendingSwitch.school;
    const saved = await saveBranding();
    if (!saved) return;
    setPendingSwitch(null);
    applySchoolSelection(nextSchool);
  };

  const handleDiscardAndSwitch = () => {
    if (!pendingSwitch) return;
    const nextSchool = pendingSwitch.school;
    setPendingSwitch(null);
    applySchoolSelection(nextSchool);
  };

  const formDisabled = !selectedSchoolId || loading || saving;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(74,222,128,0.22),_transparent_30%),linear-gradient(135deg,_#022c22,_#14532d_45%,_#064e3b)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-100/80">School Self-Service</p>
        <h1 className="mt-3 text-3xl font-bold">School Branding</h1>
        {selectedSchoolId ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-emerald-50/90">Currently Editing: <span className="font-semibold text-white">{schoolSummary.name || selectedSchool?.name || 'Selected School'}</span></p>
            <div className="flex flex-wrap gap-3 text-sm text-emerald-50/90">
              <span>School Code: <span className="font-semibold text-white">{schoolSummary.school_code || selectedSchool?.school_code || '-'}</span></span>
              <span>Status: <span className="font-semibold capitalize text-white">{schoolSummary.status || ((schoolSummary.is_active ?? true) ? 'active' : 'inactive')}</span></span>
            </div>
          </div>
        ) : (
          <p className="mt-3 max-w-3xl text-sm text-emerald-50/90">
            Select a school to load its existing branding, theme colors, and uploaded assets.
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">School Selection</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">Choose a school to edit branding</h2>
            <p className="mt-2 text-sm text-slate-500">Only schools that you are allowed to manage are shown here.</p>
          </div>

          <div ref={selectorRef} className="relative w-full max-w-xl">
            <button
              type="button"
              onClick={() => setSelectorOpen((current) => !current)}
              disabled={schoolsLoading || manageableSchools.length === 0}
              className="flex w-full items-center justify-between rounded-2xl border border-slate-300 px-4 py-3 text-left text-sm text-slate-900 transition hover:border-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <span className="truncate">
                {selectedSchool ? `${selectedSchool.name} (${selectedSchool.school_code || selectedSchool.slug || selectedSchool.id})` : 'Select a school'}
              </span>
              <span className="ml-3 text-slate-400">{selectorOpen ? '^' : 'v'}</span>
            </button>

            {selectorOpen ? (
              <div className="absolute z-20 mt-2 w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-xl">
                <input
                  value={schoolSearch}
                  onChange={(event) => setSchoolSearch(event.target.value)}
                  placeholder="Search schools..."
                  className={INPUT}
                />
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                  {filteredSchools.length > 0 ? (
                    filteredSchools.map((school) => (
                      <button
                        key={school.id}
                        type="button"
                        onClick={() => handleSelectSchool(school)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                          school.id === selectedSchoolId
                            ? 'border-emerald-300 bg-emerald-50'
                            : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
                        }`}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                          {(school.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{school.name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {[school.short_name, school.school_code || school.slug].filter(Boolean).join(' • ')}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          (school.status || '').toLowerCase() === 'active' || school.is_active !== false
                            ? 'bg-green-100 text-green-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {school.status || (school.is_active !== false ? 'active' : 'inactive')}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      No schools match your search.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {schoolsLoading ? <p className="mt-4 text-sm text-slate-500">Loading schools...</p> : null}
        {schoolsError ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{schoolsError}</p> : null}
        {!schoolsLoading && !schoolsError && manageableSchools.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No schools are available for branding management.
          </p>
        ) : null}
        {!selectedSchoolId && !schoolsLoading && manageableSchools.length > 0 ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Select a school to edit branding.
          </p>
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <fieldset disabled={formDisabled} className="contents">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            {selectedSchoolId && loading ? (
              <p className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Loading selected school branding...
              </p>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {BRANDING_FIELDS.map(({ key, label, readOnly }) => (
                <input
                  key={key}
                  value={String(form[key] || '')}
                  onChange={(event) => updateField(key, event.target.value)}
                  placeholder={label}
                  readOnly={readOnly}
                  className={readOnly ? READ_ONLY_INPUT : INPUT}
                />
              ))}

              <input
                type="color"
                value={String(form.primary_color || '#0f766e')}
                onChange={(event) => updateField('primary_color', event.target.value)}
                className={`${INPUT} h-14`}
              />
              <input
                type="color"
                value={String(form.secondary_color || '#1d4ed8')}
                onChange={(event) => updateField('secondary_color', event.target.value)}
                className={`${INPUT} h-14`}
              />
              <input
                type="color"
                value={String(form.accent_color || '#f59e0b')}
                onChange={(event) => updateField('accent_color', event.target.value)}
                className={`${INPUT} h-14`}
              />
              <select
                value={String(form.theme || 'auto')}
                onChange={(event) => updateField('theme', event.target.value)}
                className={INPUT}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void saveBranding()}
                disabled={formDisabled}
                className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save Branding'}
              </button>
            </div>

            {message ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Brand Assets</h2>
              <div className="mt-4 grid gap-4">
                {ASSET_FIELDS.map(([assetType, label]) => (
                  <label key={assetType} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">{label}</span>
                    <input
                      type="file"
                      disabled={formDisabled}
                      className="mt-3 block w-full text-sm"
                      onChange={(event) => void uploadAsset(assetType, event.target.files?.[0] || null)}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Current Visual Identity</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {PREVIEW_FIELDS.map(([formKey, label, assetType]) => {
                  const previewUrl = String(form[formKey] || assetPreviewMap.get(assetType) || '');
                  return (
                    <div key={formKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">{label}</p>
                      {previewUrl ? (
                        <img src={previewUrl} alt={label} className="mt-3 h-24 w-full rounded-2xl object-cover" />
                      ) : (
                        <p className="mt-3 text-sm text-slate-500">Not uploaded yet.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </fieldset>
      </section>

      {pendingSwitch ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-900">You have unsaved changes.</h2>
            <p className="mt-2 text-sm text-slate-600">
              Save or discard your current branding edits before switching to {pendingSwitch.school.name}.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleSaveAndSwitch()}
                disabled={saving}
                className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={handleDiscardAndSwitch}
                disabled={saving}
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={() => setPendingSwitch(null)}
                disabled={saving}
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
