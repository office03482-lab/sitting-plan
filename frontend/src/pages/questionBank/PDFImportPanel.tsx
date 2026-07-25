import { useState } from 'react';
import { FileUp, Check, Loader2 } from 'lucide-react';

type Props = {
  onImported: (questions: Array<{ prompt: string; options: string[]; answer: string; explanation: string }>) => void;
  onClose: () => void;
};

export default function PDFImportPanel({ onImported, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [detected, setDetected] = useState<Array<{ prompt: string; options: string[]; answer: string; explanation: string; selected: boolean }>>([]);
  const [pageRange, setPageRange] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setFile(f);
  };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    // Simulated PDF processing - in production, call backend PDF import endpoint
    await new Promise((r) => setTimeout(r, 3000));
    setDetected([
      { prompt: 'Question 1 extracted from PDF...', options: ['A', 'B', 'C', 'D'], answer: 'A', explanation: '', selected: true },
      { prompt: 'Question 2 extracted from PDF...', options: ['A', 'B', 'C', 'D'], answer: 'B', explanation: '', selected: true },
      { prompt: 'Question 3 extracted from PDF...', options: ['A', 'B', 'C', 'D'], answer: 'C', explanation: '', selected: true },
    ]);
    setProcessing(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
          <FileUp className="h-4 w-4 text-rose-500" /> PDF Import
        </h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-rose-400 hover:bg-rose-50">
        <FileUp className="h-6 w-6 text-slate-400" />
        <span className="text-[11px] font-medium text-slate-600">{file ? file.name : 'Upload PDF document'}</span>
        <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
      </label>

      {file && !detected.length && (
        <>
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Page Range (optional)</label>
            <input
              value={pageRange}
              onChange={(e) => setPageRange(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white"
              placeholder="e.g. 1-5, 8, 12-15"
            />
          </div>
          <button
            type="button"
            onClick={handleProcess}
            disabled={processing}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {processing ? <><Loader2 className="h-3 w-3 animate-spin" /> Processing...</> : 'Detect Questions'}
          </button>
        </>
      )}

      {detected.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">{detected.length} questions detected</span>
            <button
              type="button"
              onClick={() => { onImported(detected.filter((q) => q.selected)); setDetected([]); setFile(null); }}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
            >
              <Check className="h-3 w-3" /> Import Selected
            </button>
          </div>
          {detected.map((q, i) => (
            <label key={i} className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px]">
              <input
                type="checkbox"
                checked={q.selected}
                onChange={(e) => setDetected((prev) => prev.map((pq, pi) => pi === i ? { ...pq, selected: e.target.checked } : pq))}
                className="mt-0.5 h-3 w-3"
              />
              <span className="text-slate-800">{q.prompt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
