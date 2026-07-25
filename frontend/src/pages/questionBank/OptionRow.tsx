import { ImagePlus, X, GripVertical } from 'lucide-react';

interface OptionRowProps {
  index: number;
  option: {
    id: string;
    label: string;
    text: string;
    imageUrl: string;
    isCorrect: boolean;
  };
  totalOptions: number;
  onChange: (field: string, value: string | boolean) => void;
  onRemove: () => void;
  onCorrectToggle: () => void;
}

export default function OptionRow({ option, totalOptions, onChange, onRemove, onCorrectToggle }: OptionRowProps) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl p-4 transition-all ${
        option.isCorrect
          ? 'bg-emerald-50 ring-2 ring-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
          : 'bg-white ring-1 ring-slate-200/60 hover:ring-slate-300 hover:shadow-sm'
      }`}
    >
      {/* Top Row: Grip + Letter + Check + Remove */}
      <div className="mb-3 flex items-center gap-2">
        <span className="cursor-grab text-slate-300 transition hover:text-slate-500">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <button
          type="button"
          onClick={onCorrectToggle}
          className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all ${
            option.isCorrect
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-slate-300 bg-white hover:border-emerald-400'
          }`}
          title="Mark correct"
        >
          {option.isCorrect && (
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold ${
          option.isCorrect ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {option.label}
        </span>
        <div className="flex-1" />
        {totalOptions > 2 && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Text Input */}
      <input
        type="text"
        value={option.text}
        onChange={(e) => onChange('text', e.target.value)}
        placeholder={`Option ${option.label} text...`}
        className="mb-2 w-full rounded-lg bg-slate-50/80 px-3 py-2.5 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200/60 transition placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
      />

      {/* Image Preview */}
      {option.imageUrl && (
        <div className="relative mb-2">
          <img src={option.imageUrl} alt={`Option ${option.label}`} className="h-20 w-full rounded-lg object-cover" />
          <button
            type="button"
            onClick={() => onChange('imageUrl', '')}
            className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow group-hover:flex"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Upload Trigger */}
      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-medium text-slate-400 transition hover:text-blue-500">
        <ImagePlus className="h-3 w-3" />
        Attach image
        <input type="file" accept="image/*" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => onChange('imageUrl', ev.target?.result as string);
            reader.readAsDataURL(file);
          }
        }} />
      </label>
    </div>
  );
}
