import { useEffect, useState } from 'react';

import { apiService, getRequestErrorMessage } from '@services/api';
import type { SchoolStorageOverview } from '@types';

export default function SchoolStorageCenterPage() {
  const [storage, setStorage] = useState<SchoolStorageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getSchoolStorageOverview();
        setStorage(response.data);
      } catch (requestError: any) {
        setError(getRequestErrorMessage(requestError, 'Storage center load nahi ho paaya.'));
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.25),_transparent_25%),linear-gradient(135deg,_#052e16,_#166534_45%,_#14532d)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-lime-100/80">School Self-Service</p>
        <h1 className="mt-3 text-3xl font-bold">Storage Center</h1>
        <p className="mt-3 max-w-3xl text-sm text-lime-50/90">Review uploaded branding assets, certificate headers, and identity files for your school only.</p>
      </section>

      {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Total Files</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{storage?.total_files || 0}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Storage Used</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{storage?.total_size_mb || 0} MB</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Tenant Scope</p>
          <p className="mt-2 text-xl font-bold text-slate-900">School Only</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Stored Assets</h2>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Preview</th>
              </tr>
            </thead>
            <tbody>
              {(storage?.assets || []).map((asset) => (
                <tr key={asset.id} className="border-b border-slate-100">
                  <td className="px-3 py-3">{asset.asset_type}</td>
                  <td className="px-3 py-3">{asset.file_name}</td>
                  <td className="px-3 py-3">{Math.round(asset.size_bytes / 1024)} KB</td>
                  <td className="px-3 py-3">
                    <a href={asset.public_url} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 hover:underline">
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {storage && storage.assets.length === 0 ? <p className="px-3 py-6 text-sm text-slate-500">No brand assets uploaded yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
