import { useEffect, useState } from 'react';
import { ArrowLeft, Filter, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';

type BankQuestion = {
  id: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  question_type: string;
  difficulty_level: string;
  prompt_text: string;
  marks: number;
  status: string;
  exam_type_slug?: string;
  created_at?: string;
};

const diffColor: Record<string, string> = {
  easy: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-700',
  hard: 'bg-rose-50 text-rose-700',
  olympiad: 'bg-violet-50 text-violet-700',
  advanced: 'bg-red-50 text-red-700',
};

const statusColor: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-50 text-emerald-700',
  review: 'bg-amber-50 text-amber-700',
  archived: 'bg-slate-50 text-slate-500',
};

export default function QuestionBankList() {
  const navigate = useNavigate();
  const { authReady, sessionReady, schoolContextReady } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady;

  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterType, setFilterType] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!canRunRequests) return;
    void loadQuestions();
  }, [canRunRequests]);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      const params: Record<string, unknown> = { limit: 200 };
      if (filterSubject) params.subject = filterSubject;
      if (filterDifficulty) params.difficulty_level = filterDifficulty;
      const response = await apiService.listQBQuestions(params);
      setQuestions((response.data || []) as BankQuestion[]);
    } catch {
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setImporting(true);
      const response = await apiService.importOnlineTestQuestionBank(file);
      setBanner({ type: 'success', message: `${response.data.created_count || 0} questions imported.` });
      void loadQuestions();
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Import failed.') });
    } finally {
      setImporting(false);
    }
  };

  const filtered = questions.filter((q) => {
    if (search && !q.prompt_text?.toLowerCase().includes(search.toLowerCase()) && !q.subject?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType && q.question_type !== filterType) return false;
    return true;
  });

  const subjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))] as string[];

  if (loading) return <LoadingSpinner message="Loading question bank..." />;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <button type="button" onClick={() => navigate('/')} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> Home
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Question Bank</h1>
          <p className="mt-1 text-sm text-slate-600">{questions.length} questions in shared bank. Create, import, or browse questions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Upload className="h-4 w-4" />
            {importing ? 'Importing...' : 'Bulk Import'}
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleBulkImport} />
          </label>
          <button type="button" onClick={() => navigate('/question-bank/add')} className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1b3277]">
            <Plus className="h-4 w-4" /> Add Question
          </button>
        </div>
      </div>

      {banner && <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} />}

      {/* Quick Nav */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'All Questions', icon: '📋', count: questions.length, onClick: () => {} },
          { label: 'AI Generator', icon: '🤖', count: null, onClick: () => navigate('/question-bank/ai') },
          { label: 'OCR Import', icon: '📷', count: null, onClick: () => navigate('/question-bank/ocr') },
          { label: 'PDF Import', icon: '📄', count: null, onClick: () => navigate('/question-bank/pdf') },
        ].map((item) => (
          <button key={item.label} type="button" onClick={item.onClick}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50/30">
            <span className="text-2xl">{item.icon}</span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
              {item.count !== null && <p className="text-xs text-slate-500">{item.count} items</p>}
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Filter className="h-4 w-4" /> Filters:
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions..."
            className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white" />
        </div>
        <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-400">
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-400">
          <option value="">All difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-400">
          <option value="">All types</option>
          <option value="single_choice">MCQ</option>
          <option value="multiple_choice">MMCQ</option>
          <option value="short_answer">Short Answer</option>
          <option value="numerical">Numerical</option>
        </select>
        <span className="text-xs text-slate-400">{filtered.length} results</span>
      </div>

      {/* Question List */}
      <div className="space-y-2">
        {filtered.map((q) => (
          <div key={q.id} className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-200">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
              {q.question_type === 'single_choice' ? 'MCQ' : q.question_type === 'multiple_choice' ? 'MMCQ' : q.question_type?.slice(0, 3).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 line-clamp-2">{q.prompt_text || 'No prompt'}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                {q.subject && <span className="rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">{q.subject}</span>}
                {q.chapter && <span className="text-slate-400">› {q.chapter}</span>}
                {q.topic && <span className="text-slate-400">› {q.topic}</span>}
                <span className={`rounded px-1.5 py-0.5 font-semibold ${diffColor[q.difficulty_level] || 'bg-slate-100 text-slate-600'}`}>{q.difficulty_level}</span>
                <span className="font-semibold text-slate-600">{q.marks} marks</span>
                <span className={`rounded px-1.5 py-0.5 font-semibold ${statusColor[q.status] || 'bg-slate-100 text-slate-600'}`}>{q.status}</span>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={() => navigate(`/question-bank/edit/${q.id}`)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Edit</button>
              <button type="button" onClick={async () => { await apiService.deleteQBQuestion(q.id); void loadQuestions(); }}
                className="rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {!filtered.length && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <p className="text-sm font-medium text-slate-500">No questions found</p>
            <button type="button" onClick={() => navigate('/question-bank/add')} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]">
              <Plus className="h-4 w-4" /> Create First Question
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
