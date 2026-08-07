import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Bot,
  Clock3,
  Eye,
  FileSearch,
  FileUp,
  Filter,
  Plus,
  ScanText,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { authReady, sessionReady, schoolContextReady } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady;

  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showRecentOnly, setShowRecentOnly] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!canRunRequests) return;
    void loadQuestions();
  }, [canRunRequests, filterDifficulty, filterSubject]);

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

  const filtered = useMemo(() => {
    const sorted = [...questions].sort((left, right) => {
      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightTime - leftTime;
    });

    const searched = sorted.filter((question) => {
      if (
        search &&
        !question.prompt_text?.toLowerCase().includes(search.toLowerCase()) &&
        !question.subject?.toLowerCase().includes(search.toLowerCase())
      ) {
        return false;
      }
      if (filterType && question.question_type !== filterType) return false;
      if (filterStatus && question.status !== filterStatus) return false;
      return true;
    });

    return showRecentOnly ? searched.slice(0, 12) : searched;
  }, [filterStatus, filterType, questions, search, showRecentOnly]);

  const subjects = [...new Set(questions.map((question) => question.subject).filter(Boolean))] as string[];

  const statusCounts = useMemo(
    () => ({
      draft: questions.filter((question) => question.status === 'draft').length,
      review: questions.filter((question) => question.status === 'review').length,
      published: questions.filter((question) => question.status === 'published').length,
      archived: questions.filter((question) => question.status === 'archived').length,
    }),
    [questions],
  );

  const setStatusView = (status: string) => {
    setShowRecentOnly(false);
    setFilterStatus(status);
  };

  if (loading) return <LoadingSpinner message="Loading question bank..." />;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate('/online-tests')}
            className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> Exam Dashboard
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Question Bank</h1>
          <p className="mt-1 text-sm text-slate-600">
            {questions.length} questions in the shared repository. Start here before building online tests,
            offline exams, or paper workflows.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Upload className="h-4 w-4" />
            {importing ? 'Importing...' : 'Import Questions'}
            <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleBulkImport} />
          </label>
          <button
            type="button"
            onClick={() => navigate('/question-bank/add')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1b3277]"
          >
            <Plus className="h-4 w-4" /> Add Question
          </button>
        </div>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Add Question',
            helper: 'Create a new bank question',
            icon: Plus,
            onClick: () => navigate('/question-bank/add'),
          },
          {
            label: 'Import Questions',
            helper: 'Upload an existing workbook',
            icon: Upload,
            onClick: () => fileInputRef.current?.click(),
          },
          {
            label: 'AI Question Generator',
            helper: 'Open the existing AI builder',
            icon: Bot,
            onClick: () => navigate('/question-bank/add', { state: { tool: 'ai' } }),
          },
          {
            label: 'OCR Import',
            helper: 'Capture questions from images',
            icon: ScanText,
            onClick: () => navigate('/question-bank/add', { state: { tool: 'ocr' } }),
          },
          {
            label: 'PDF Import',
            helper: 'Extract questions from PDFs',
            icon: FileUp,
            onClick: () => navigate('/question-bank/add', { state: { tool: 'pdf' } }),
          },
          {
            label: 'Review Questions',
            helper: 'Focus on review-ready entries',
            icon: Sparkles,
            onClick: () => setStatusView('review'),
          },
          {
            label: 'Question Analytics',
            helper: 'Reuse existing exam analytics',
            icon: BarChart3,
            onClick: () => navigate('/online-tests'),
          },
          {
            label: 'Recent Questions',
            helper: 'Show the newest 12 entries',
            icon: Clock3,
            onClick: () => {
              setFilterStatus('');
              setShowRecentOnly(true);
            },
          },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50/30"
          >
            <span className="rounded-xl bg-slate-100 p-2 text-slate-700">
              <item.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
              <p className="text-xs text-slate-500">{item.helper}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Draft Questions', count: statusCounts.draft, icon: FileSearch, status: 'draft' },
          { label: 'Review Questions', count: statusCounts.review, icon: Sparkles, status: 'review' },
          { label: 'Published Questions', count: statusCounts.published, icon: Eye, status: 'published' },
          { label: 'Archived Questions', count: statusCounts.archived, icon: Archive, status: 'archived' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setStatusView(item.status)}
            className={`flex items-center justify-between rounded-xl border p-4 text-left shadow-sm transition ${
              filterStatus === item.status
                ? 'border-blue-300 bg-blue-50/40'
                : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-slate-100 p-2 text-slate-700">
                <item.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500">Filter the shared repository</p>
              </div>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {item.count}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Filter className="h-4 w-4" /> Filters:
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search questions..."
            className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
          />
        </div>

        <select
          value={filterSubject}
          onChange={(event) => setFilterSubject(event.target.value)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        >
          <option value="">All subjects</option>
          {subjects.map((subject) => (
            <option key={subject} value={subject}>
              {subject}
            </option>
          ))}
        </select>

        <select
          value={filterDifficulty}
          onChange={(event) => setFilterDifficulty(event.target.value)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        >
          <option value="">All difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>

        <select
          value={filterType}
          onChange={(event) => setFilterType(event.target.value)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        >
          <option value="">All types</option>
          <option value="single_choice">MCQ</option>
          <option value="multiple_choice">MMCQ</option>
          <option value="short_answer">Short Answer</option>
          <option value="numerical">Numerical</option>
        </select>

        <select
          value={filterStatus}
          onChange={(event) => {
            setFilterStatus(event.target.value);
            setShowRecentOnly(false);
          }}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        >
          <option value="">All status</option>
          <option value="draft">Draft</option>
          <option value="review">Review</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setSearch('');
            setFilterSubject('');
            setFilterDifficulty('');
            setFilterType('');
            setFilterStatus('');
            setShowRecentOnly(false);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Clear Filters
        </button>

        {showRecentOnly ? (
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
            Recent only
          </span>
        ) : null}

        <span className="text-xs text-slate-400">{filtered.length} results</span>
      </div>

      <div className="space-y-2">
        {filtered.map((question) => (
          <div
            key={question.id}
            className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-200"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
              {question.question_type === 'single_choice'
                ? 'MCQ'
                : question.question_type === 'multiple_choice'
                  ? 'MMCQ'
                  : question.question_type?.slice(0, 3).toUpperCase()}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 line-clamp-2">
                {question.prompt_text || 'No prompt'}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                {question.subject ? (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">
                    {question.subject}
                  </span>
                ) : null}
                {question.chapter ? <span className="text-slate-400">&gt; {question.chapter}</span> : null}
                {question.topic ? <span className="text-slate-400">&gt; {question.topic}</span> : null}
                <span className={`rounded px-1.5 py-0.5 font-semibold ${diffColor[question.difficulty_level] || 'bg-slate-100 text-slate-600'}`}>
                  {question.difficulty_level}
                </span>
                <span className="font-semibold text-slate-600">{question.marks} marks</span>
                <span className={`rounded px-1.5 py-0.5 font-semibold ${statusColor[question.status] || 'bg-slate-100 text-slate-600'}`}>
                  {question.status}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => navigate(`/question-bank/edit/${question.id}`)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiService.deleteQBQuestion(question.id);
                  void loadQuestions();
                }}
                className="rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-rose-500 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {!filtered.length ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <p className="text-sm font-medium text-slate-500">No questions found</p>
            <button
              type="button"
              onClick={() => navigate('/question-bank/add')}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
            >
              <Plus className="h-4 w-4" /> Create First Question
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
