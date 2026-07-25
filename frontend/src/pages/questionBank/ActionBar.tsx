import { Save, ArrowRight, Eye, Send, X, CheckCircle2 } from 'lucide-react';

export default function ActionBar() {
  return (
    <div className="sticky bottom-0 z-30 border-t border-slate-200 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-8 py-3">
        {/* Left: status */}
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            Auto-saved
          </span>
          <span className="text-[11px] text-slate-400">Ctrl+S</span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button type="button" className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-semibold text-slate-500 transition hover:bg-slate-50">
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200">
            <Save className="h-3.5 w-3.5" />
            Save Draft
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-slate-700">
            Save & Next
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <button type="button" className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200">
            <Eye className="h-3.5 w-3.5" />
            Preview
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-blue-700">
            <Send className="h-3.5 w-3.5" />
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}
