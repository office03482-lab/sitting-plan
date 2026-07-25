import { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

type Props = {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
  onCreateNew?: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export default function TaxonomySelect({ label, value, options, onChange, onCreateNew, placeholder = 'Select...', disabled = false }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const selectedLabel = options.find((o) => o.id === value)?.label || '';

  const handleCreate = () => {
    if (newName.trim() && onCreateNew) {
      onCreateNew(newName.trim());
      setNewName('');
      setShowCreate(false);
    }
  };

  return (
    <div className="space-y-1">
      <label className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</label>
      {showCreate ? (
        <div className="flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            className="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-400"
            placeholder={`New ${label.toLowerCase()} name`}
          />
          <button type="button" onClick={handleCreate} className="rounded-md bg-blue-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-blue-700">Add</button>
          <button type="button" onClick={() => setShowCreate(false)} className="rounded-md bg-slate-100 px-1.5 py-1 text-slate-500 hover:bg-slate-200"><X className="h-3 w-3" /></button>
        </div>
      ) : (
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-full appearance-none rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 pr-7 text-xs text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-100 disabled:opacity-50"
          >
            <option value="">{placeholder}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
        </div>
      )}
      {!showCreate && selectedLabel && (
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <span>{selectedLabel}</span>
          <button type="button" onClick={() => onChange('')} className="text-slate-400 hover:text-rose-500"><X className="h-2.5 w-2.5" /></button>
        </div>
      )}
      {onCreateNew && !showCreate && (
        <button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
          <Plus className="h-2.5 w-2.5" /> Create new
        </button>
      )}
    </div>
  );
}
