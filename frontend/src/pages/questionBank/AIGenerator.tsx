import { useState } from 'react';
import { Bot, RefreshCw, Save, Sparkles } from 'lucide-react';
import type { ExamType } from './taxonomyData';
import { EXAM_TYPES, QUESTION_TYPES, DIFFICULTY_LEVELS, BLOOM_LEVELS, getSubjectsForExam } from './taxonomyData';

type Props = {
  currentExam: ExamType;
  currentSubject: string;
  currentChapter: string;
  currentTopic: string;
  onGenerated: (questions: Array<{ prompt: string; options: string[]; answer: string; explanation: string }>) => void;
};

export default function AIGenerator({ currentExam, currentSubject, currentChapter, currentTopic, onGenerated }: Props) {
  const [exam, setExam] = useState(currentExam);
  const [subject, setSubject] = useState(currentSubject);
  const [chapter] = useState(currentChapter);
  const [topic] = useState(currentTopic);
  const [qType, setQType] = useState('single_choice');
  const [difficulty, setDifficulty] = useState('medium');
  const [count, setCount] = useState('5');
  const [bloom, setBloom] = useState('apply');
  const [genExplanation, setGenExplanation] = useState(true);
  const [genHint, setGenHint] = useState(false);
  const [genSolution, setGenSolution] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Array<{ prompt: string; options: string[]; answer: string; explanation: string; selected: boolean }>>([]);

  const subjects = getSubjectsForExam(exam);

  const handleGenerate = async () => {
    setGenerating(true);
    // Simulated AI generation - in production, call the ai-generate endpoint
    await new Promise((r) => setTimeout(r, 2000));
    const mockQuestions = Array.from({ length: Number(count) || 5 }, (_, i) => ({
      prompt: `AI-generated question ${i + 1} on ${topic || chapter || subject} (${difficulty})`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      answer: 'Option A',
      explanation: genExplanation ? `Explanation for question ${i + 1}` : '',
      selected: true,
    }));
    setGenerated(mockQuestions);
    setGenerating(false);
  };

  const handleSaveSelected = () => {
    onGenerated(generated.filter((q) => q.selected));
    setGenerated([]);
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
        <Bot className="h-4 w-4 text-violet-500" /> AI Question Generator
      </h4>

      <div className="space-y-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Exam</label>
          <select value={exam} onChange={(e) => { setExam(e.target.value as ExamType); setSubject(''); }} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
            {EXAM_TYPES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Subject</label>
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
            <option value="">Select subject</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Type</label>
            <select value={qType} onChange={(e) => setQType(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
              {QUESTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.shortLabel}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Difficulty</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
              {DIFFICULTY_LEVELS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Count</label>
            <input type="number" min="1" max="50" value={count} onChange={(e) => setCount(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Bloom Level</label>
            <select value={bloom} onChange={(e) => setBloom(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
              {BLOOM_LEVELS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          {[
            { label: 'Generate Explanation', val: genExplanation, set: setGenExplanation },
            { label: 'Generate Hints', val: genHint, set: setGenHint },
            { label: 'Generate Solution', val: genSolution, set: setGenSolution },
          ].map((opt) => (
            <label key={opt.label} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={opt.val} onChange={(e) => opt.set(e.target.checked)} className="h-3 w-3 rounded border-slate-300" />
              {opt.label}
            </label>
          ))}
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !subject}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {generating ? <><RefreshCw className="h-3 w-3 animate-spin" /> Generating...</> : <><Sparkles className="h-3 w-3" /> Generate</>}
        </button>
      </div>

      {generated.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">{generated.length} questions generated</span>
            <button type="button" onClick={handleSaveSelected} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700">
              <Save className="h-3 w-3" /> Save Selected
            </button>
          </div>
          {generated.map((q, i) => (
            <label key={i} className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px]">
              <input type="checkbox" checked={q.selected} onChange={(e) => setGenerated((prev) => prev.map((pq, pi) => pi === i ? { ...pq, selected: e.target.checked } : pq))} className="mt-0.5 h-3 w-3" />
              <div>
                <p className="font-medium text-slate-800">{q.prompt}</p>
                <p className="mt-0.5 text-slate-500">Answer: {q.answer}</p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
