import { useState } from 'react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformGlobalSearchItem } from '@types';

export default function PlatformGlobalSearchPage() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PlatformGlobalSearchItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    try {
      const response = await apiService.searchPlatformEntities({ q: query, limit: 40 });
      setItems(response.data.items || []);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Global search run nahi ho paaya.'));
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-violet-900 to-fuchsia-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-100/80">Global Search</p>
        <h1 className="mt-3 text-3xl font-bold">Cross-School Search</h1>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex gap-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, phone, admission no, employee code" className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
          <button onClick={() => void handleSearch()} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">Search</button>
        </div>
        {error ? <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        {items.map((item, index) => (
          <article key={`${item.entity_type}-${item.entity_id || index}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{item.entity_type}</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">{item.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{item.subtitle || '-'}{item.school_name ? ` • ${item.school_name}` : ''}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
