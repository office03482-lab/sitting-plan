import { useState } from 'react';
import { AlertTriangle, Bot, RefreshCw, Save, Sparkles } from 'lucide-react';

import { apiService, getRequestErrorMessage } from '@services/api';
import type { ExamType } from './taxonomyData';
import { EXAM_TYPES, QUESTION_TYPES, DIFFICULTY_LEVELS, getSubjectsForExam } from './taxonomyData';

type GeneratedQuestion = {
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  duplicate: boolean;
  selected: boolean;
};

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
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedQuestion[]>([]);
  const [error, setError] = useState('');

  const subjects = getSubjectsForExam(exam);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setError('');
      const response = await apiService.generateQBQuestionPreview({
        exam_type_slug: exam,
        subject,
        chapter,
        topic,
        difficulty,
        question_type: qType,
        question_count: Number(count) || 5,
        marks: 1,
        language: 'en',
      });
      setGenerated(
        (response.data.questions || []).map((item) => ({
          prompt: item.question_text,
          options: item.options || [],
          answer: item.correct_answer,
          explanation: item.explanation || '',
          duplicate: Boolean(item.duplicate_check?.is_duplicate),
          selected: !item.duplicate_check?.is_duplicate,
        })),
      );
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'AI question generation failed.'));
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveSelected = () => {
    onGenerated(generated.filter((q) => q.selected).map(({ prompt, options, answer, explanation }) => ({ prompt, options, answer, explanation })));
    setGenerated([]);
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
        <Bot className="h-4 w-4 text-violet-500" /> AI Question Generator
      </h4>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>
      ) : null}

      <div className="space-y-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Exam</label>
          <select value={exam} onChange={(e) => { setExam(e.target.value as ExamType); setSubject(''); }} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
            {EXAM_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Subject</label>
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
            <option value="">Select subject</option>
            {subjects.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Type</label>
            <select value={qType} onChange={(e) => setQType(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
              {QUESTION_TYPES.map((item) => <option key={item.id} value={item.id}>{item.shortLabel}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Difficulty</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white">
              {DIFFICULTY_LEVELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Count</label>
          <input type="number" min="1" max="10" value={count} onChange={(e) => setCount(e.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:bg-white" />
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !subject || !chapter || !topic}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {generating ? <><RefreshCw className="h-3 w-3 animate-spin" /> Generating...</> : <><Sparkles className="h-3 w-3" /> Generate Preview</>}
        </button>
      </div>

      {generated.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">{generated.length} questions generated</span>
            <button type="button" onClick={handleSaveSelected} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700">
              <Save className="h-3 w-3" /> Add Selected
            </button>
          </div>
          {generated.map((question, index) => (
            <label key={index} className={`flex gap-2 rounded-lg border p-2 text-[11px] ${question.duplicate ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
              <input type="checkbox" checked={question.selected} onChange={(e) => setGenerated((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, selected: e.target.checked } : item))} className="mt-0.5 h-3 w-3" />
              <div className="space-y-1">
                <p className="font-medium text-slate-800">{question.prompt}</p>
                <p className="text-slate-500">Answer: {question.answer}</p>
                {question.duplicate ? (
                  <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> Similar question already exists in Question Bank
                  </p>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
