import { useState } from 'react';

type Props = {
  onInsert: (formula: string) => void;
  onClose: () => void;
};

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Δ', 'Σ', 'Ω', '∞', '±', '×', '÷', '≠', '≤', '≥', '≈', '√', '∫', '∑', '∏', '∂', '∇', '∈', '∉', '⊂', '⊃', '∪', '∩'];
const PHYSICS = ['ℏ', 'ω', 'λ', 'θ', 'τ', 'ν', 'ε₀', 'μ₀', 'kB', 'g', 'c', 'e', 'me', 'mp', 'NA', 'R', 'h', 'σ', 'ε', 'ρ'];
const CHEMISTRY = ['H₂O', 'H₂SO₄', 'NaOH', 'CaCO₃', 'NH₃', 'CO₂', 'CH₄', 'C₂H₅OH', 'KMnO₄', 'Fe₂O₃', 'Na₂CO₃', 'Ca(OH)₂', 'HNO₃', 'HCl', 'H₃PO₄'];

export default function FormulaPanel({ onInsert, onClose }: Props) {
  const [latex, setLatex] = useState('');
  const [tab, setTab] = useState<'latex' | 'greek' | 'physics' | 'chemistry'>('latex');

  const tabs = [
    { key: 'latex' as const, label: 'LaTeX' },
    { key: 'greek' as const, label: 'Greek' },
    { key: 'physics' as const, label: 'Physics' },
    { key: 'chemistry' as const, label: 'Chemistry' },
  ];

  const symbols = tab === 'greek' ? GREEK : tab === 'physics' ? PHYSICS : CHEMISTRY;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-900">Formula Editor</h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>

      <div className="mb-2 flex gap-0.5 border-b border-slate-100 pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'latex' ? (
        <div className="space-y-2">
          <textarea
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-100"
            rows={3}
            placeholder="\\frac{a}{b}  \\sqrt{x}  \\int_{a}^{b}  \\sum_{i=1}^{n}"
          />
          {latex && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-center text-sm text-slate-700">
              <span dangerouslySetInnerHTML={{ __html: latex.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '<sup>$1</sup>/<sub>$2</sub>').replace(/\\sqrt\{([^}]+)\}/g, '√($1)').replace(/\\([a-zA-Z]+)/g, '<i>$1</i>') }} />
            </div>
          )}
          <button
            type="button"
            onClick={() => { if (latex.trim()) { onInsert(latex.trim()); setLatex(''); } }}
            disabled={!latex.trim()}
            className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Insert Formula
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-1">
          {symbols.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onInsert(s)}
              className="flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
