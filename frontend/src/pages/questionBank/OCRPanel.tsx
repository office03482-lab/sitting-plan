import { useState } from 'react';
import { Camera, ScanLine, Check, Loader2 } from 'lucide-react';

type Props = {
  onImported: (data: { prompt: string; options: string[]; answer: string; explanation: string }) => void;
  onClose: () => void;
};

export default function OCRPanel({ onImported, onClose }: Props) {
  const [imageUrl, setImageUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ prompt: string; options: string[]; answer: string; explanation: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImageUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleScan = async () => {
    if (!imageUrl) return;
    setScanning(true);
    // Simulated OCR - in production, send to backend OCR endpoint
    await new Promise((r) => setTimeout(r, 2500));
    setResult({
      prompt: 'OCR extracted question text from the uploaded image...',
      options: ['Option A from image', 'Option B from image', 'Option C from image', 'Option D from image'],
      answer: 'Option A from image',
      explanation: 'OCR extracted explanation from image...',
    });
    setScanning(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
          <ScanLine className="h-4 w-4 text-emerald-500" /> OCR Scanner
        </h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-emerald-400 hover:bg-emerald-50">
        <Camera className="h-6 w-6 text-slate-400" />
        <span className="text-[11px] font-medium text-slate-600">
          {imageUrl ? 'Change image' : 'Upload question image'}
        </span>
        <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </label>

      {imageUrl && (
        <div className="space-y-2">
          <img src={imageUrl} alt="OCR source" className="w-full rounded-lg border border-slate-200 object-contain" style={{ maxHeight: 180 }} />
          <button
            type="button"
            onClick={handleScan}
            disabled={scanning}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {scanning ? <><Loader2 className="h-3 w-3 animate-spin" /> Scanning...</> : <><ScanLine className="h-3 w-3" /> Scan Image</>}
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <h5 className="text-[11px] font-bold text-emerald-800">OCR Result</h5>
          <div className="space-y-1.5 text-[11px]">
            <div>
              <span className="font-semibold text-slate-600">Question: </span>
              <span className="text-slate-800">{result.prompt}</span>
            </div>
            {result.options.map((o, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="font-semibold text-slate-600">{String.fromCharCode(65 + i)}.</span>
                <span className="text-slate-800">{o}</span>
              </div>
            ))}
            <div><span className="font-semibold text-slate-600">Answer: </span><span className="text-emerald-700">{result.answer}</span></div>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { onImported(result); setResult(null); setImageUrl(''); }}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
            >
              <Check className="h-3 w-3" /> Import
            </button>
            <button type="button" onClick={() => setResult(null)} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
