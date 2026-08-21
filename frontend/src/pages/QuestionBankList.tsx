import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpenCheck,
  Bot,
  CheckSquare,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FileSearch,
  FileUp,
  Filter,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  ScanText,
  Search,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';

type BankOption = {
  id?: string;
  label?: string;
  value?: string;
};

type BankQuestion = {
  id: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  question_type: string;
  difficulty_level: string;
  prompt_text: string;
  marks: number;
  negative_marks?: number;
  estimated_time_seconds?: number;
  status: string;
  exam_type_slug?: string;
  created_at?: string;
  question_code?: string;
  source_name?: string;
  language?: string;
  visibility?: string;
  explanation?: string;
  option_items?: BankOption[];
  answer_key?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

const diffColor: Record<string, string> = {
  easy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  hard: 'border-rose-200 bg-rose-50 text-rose-700',
  olympiad: 'border-violet-200 bg-violet-50 text-violet-700',
  advanced: 'border-red-200 bg-red-50 text-red-700',
};

const statusColor: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-600',
  published: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review: 'border-amber-200 bg-amber-50 text-amber-700',
  archived: 'border-slate-200 bg-slate-50 text-slate-500',
};

const typeLabel: Record<string, string> = {
  single_choice: 'MCQ',
  multiple_choice: 'MMCQ',
  short_answer: 'Short',
  long_answer: 'Long',
  numerical: 'Numerical',
};

const PAGE_SIZE = 12;

function formatTypeLabel(value: string): string {
  return typeLabel[value] || value?.replaceAll('_', ' ') || 'Question';
}

function formatExamLabel(value?: string): string {
  return (value || 'custom').replaceAll('_', ' ').toUpperCase();
}

function formatVisibilityLabel(value?: string): string {
  if (!value) return 'Private';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatLanguageLabel(value?: string): string {
  if (!value) return 'EN';
  return value.toUpperCase();
}

function formatStatusLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCreatedAt(value?: string): string {
  if (!value) return 'Recently added';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Recently added';
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function resolveAnswerText(question: BankQuestion): string {
  const answerKey = question.answer_key || {};
  const options = question.option_items || [];
  const correctOptionId = typeof answerKey.correct_option_id === 'string' ? answerKey.correct_option_id : '';
  if (correctOptionId) {
    const matched = options.find((option) => String(option.id || option.label || '').trim() === correctOptionId.trim());
    if (matched) {
      return `${matched.label || matched.id || 'Answer'}: ${matched.value || ''}`;
    }
  }
  return 'Answer key not available';
}

function isCorrectOption(question: BankQuestion, option: BankOption): boolean {
  const answerKey = question.answer_key || {};
  const optionId = String(option.id || option.label || '').trim();
  const singleCorrect = typeof answerKey.correct_option_id === 'string' ? answerKey.correct_option_id.trim() : '';
  if (singleCorrect && optionId === singleCorrect) {
    return true;
  }
  if (Array.isArray(answerKey.correct_option_ids)) {
    return answerKey.correct_option_ids.some((item) => String(item || '').trim() === optionId);
  }
  return false;
}

function createExportRows(items: BankQuestion[]): string {
  const rows = [
    ['Question Code', 'Exam', 'Subject', 'Chapter', 'Topic', 'Type', 'Difficulty', 'Marks', 'Status', 'Prompt', 'Answer'],
    ...items.map((question) => [
      question.question_code || '',
      question.exam_type_slug || '',
      question.subject || '',
      question.chapter || '',
      question.topic || '',
      question.question_type || '',
      question.difficulty_level || '',
      String(question.marks || ''),
      question.status || '',
      (question.prompt_text || '').replace(/\s+/g, ' ').trim(),
      resolveAnswerText(question),
    ]),
  ];

  return rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

export default function QuestionBankList() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { authReady, sessionReady, schoolContextReady, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady;
  const canUseExamAi = user?.role === 'admin' || ['school_admin', 'platform_admin'].includes(String(user?.role_key || '').toLowerCase());

  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pageError, setPageError] = useState('');
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showRecentOnly, setShowRecentOnly] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const [expandedAnswers, setExpandedAnswers] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageJump, setPageJump] = useState('1');

  useEffect(() => {
    if (!canRunRequests) return;
    void loadQuestions();
  }, [canRunRequests, filterDifficulty, filterSubject]);

  useEffect(() => {
    setCurrentPage(1);
    setPageJump('1');
  }, [search, filterDifficulty, filterStatus, filterSubject, filterType, showRecentOnly]);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      setPageError('');
      const params: Record<string, unknown> = { limit: 200 };
      if (filterSubject) params.subject = filterSubject;
      if (filterDifficulty) params.difficulty_level = filterDifficulty;
      const response = await apiService.listQBQuestions(params);
      setQuestions((response.data || []) as BankQuestion[]);
    } catch (error) {
      setPageError(getRequestErrorMessage(error, 'Question bank temporarily unavailable. Please retry.'));
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
    const searchValue = search.trim().toLowerCase();
    const sorted = [...questions].sort((left, right) => {
      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightTime - leftTime;
    });

    const searched = sorted.filter((question) => {
      if (searchValue) {
        const haystack = [
          question.prompt_text,
          question.subject,
          question.chapter,
          question.topic,
          question.question_code,
          ...(question.tags || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchValue)) {
          return false;
        }
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

  const selectedQuestions = useMemo(
    () => filtered.filter((question) => selectedQuestionIds.includes(question.id)),
    [filtered, selectedQuestionIds],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedQuestions = filtered.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);
  const pageStart = filtered.length ? (safeCurrentPage - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(safeCurrentPage * PAGE_SIZE, filtered.length);
  const allVisibleSelected = paginatedQuestions.length > 0 && paginatedQuestions.every((question) => selectedQuestionIds.includes(question.id));

  const setStatusView = (status: string) => {
    setShowRecentOnly(false);
    setFilterStatus(status);
  };

  const toggleSelect = (questionId: string) => {
    setSelectedQuestionIds((current) =>
      current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId],
    );
  };

  const toggleSelectVisible = () => {
    if (allVisibleSelected) {
      setSelectedQuestionIds((current) => current.filter((id) => !paginatedQuestions.some((question) => question.id === id)));
      return;
    }
    setSelectedQuestionIds((current) => [...new Set([...current, ...paginatedQuestions.map((question) => question.id)])]);
  };

  const toggleBookmark = (questionId: string) => {
    setBookmarkedIds((current) =>
      current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId],
    );
  };

  const toggleAnswerPanel = (questionId: string) => {
    setExpandedAnswers((current) =>
      current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId],
    );
  };

  const handleDelete = async (questionId: string) => {
    try {
      await apiService.deleteQBQuestion(questionId);
      setSelectedQuestionIds((current) => current.filter((id) => id !== questionId));
      setBanner({ type: 'success', message: 'Question deleted from the bank.' });
      void loadQuestions();
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Delete failed.') });
    }
  };

  const updateSingleQuestionStatus = async (question: BankQuestion, nextStatus: string) => {
    try {
      await apiService.updateQBQuestion(question.id, {
        status: nextStatus,
      });
      setQuestions((current) =>
        current.map((item) => (item.id === question.id ? { ...item, status: nextStatus } : item)),
      );
      setBanner({ type: 'success', message: `Question moved to ${formatStatusLabel(nextStatus)}.` });
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Status update failed.') });
    }
  };

  const handleBulkStatusUpdate = async (nextStatus: string) => {
    if (!selectedQuestions.length) return;
    try {
      setBulkBusy(true);
      await Promise.all(
        selectedQuestions.map((question) =>
          apiService.updateQBQuestion(question.id, {
            status: nextStatus,
          }),
        ),
      );
      setQuestions((current) =>
        current.map((question) =>
          selectedQuestionIds.includes(question.id) ? { ...question, status: nextStatus } : question,
        ),
      );
      setBanner({
        type: 'success',
        message: `${selectedQuestions.length} selected questions moved to ${formatStatusLabel(nextStatus)}.`,
      });
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Bulk status update failed.') });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedQuestions.length) return;
    try {
      setBulkBusy(true);
      await Promise.all(selectedQuestions.map((question) => apiService.deleteQBQuestion(question.id)));
      setSelectedQuestionIds([]);
      setBanner({ type: 'success', message: `${selectedQuestions.length} selected questions deleted.` });
      void loadQuestions();
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Bulk delete failed.') });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleExportSelected = () => {
    const exportItems = selectedQuestions.length ? selectedQuestions : filtered;
    if (!exportItems.length) {
      setBanner({ type: 'error', message: 'No questions available to export.' });
      return;
    }
    const blob = new Blob([createExportRows(exportItems)], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `question-bank-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setBanner({ type: 'success', message: `${exportItems.length} questions exported as CSV.` });
  };

  const handlePageJump = () => {
    const parsed = Number(pageJump);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setPageJump(String(safeCurrentPage));
      return;
    }
    const nextPage = Math.min(totalPages, Math.floor(parsed));
    setCurrentPage(nextPage);
    setPageJump(String(nextPage));
  };

  if (loading) return <LoadingSpinner message="Loading question bank..." />;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(30,58,138,0.08),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#eef4f7_100%)] p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mb-5 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => navigate('/online-tests')}
                className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" /> Exam Dashboard
              </button>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
                    Questions Workspace
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-950">Question Bank</h1>
                  <p className="mt-2 max-w-3xl text-sm text-slate-600">
                    Existing question-bank logic same hai. Is screen par richer review cards, bulk actions, answer preview,
                    aur teacher-friendly navigation add ki gayi hai.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Repository Size', value: String(questions.length), tone: 'text-slate-900' },
                    { label: 'Active View', value: filterStatus ? formatStatusLabel(filterStatus) : 'All', tone: 'text-blue-700' },
                    { label: 'Selected', value: String(selectedQuestionIds.length), tone: 'text-emerald-700' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                      <p className={`mt-1 text-xl font-bold ${item.tone}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                <Upload className="h-4 w-4" />
                {importing ? 'Importing...' : 'Import Questions'}
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleBulkImport} />
              </label>
              <button
                type="button"
                onClick={handleExportSelected}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FileUp className="h-4 w-4" /> Export
              </button>
              <button
                type="button"
                onClick={() => navigate('/question-bank/add')}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1b3277]"
              >
                <Plus className="h-4 w-4" /> Add Question
              </button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search questions, ID, chapter, topic, or keywords..."
                    className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-blue-400"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedFilters((current) => !current)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Filter className="h-4 w-4" />
                    {showAdvancedFilters ? 'Hide Filters' : 'Show Filters'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBanner({ type: 'success', message: 'More actions area reserved for future question-bank extensions.' })}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <MoreHorizontal className="h-4 w-4" /> More
                  </button>
                </div>
              </div>

              {showAdvancedFilters ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <select
                    value={filterSubject}
                    onChange={(event) => setFilterSubject(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
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
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="">All difficulty</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>

                  <select
                    value={filterType}
                    onChange={(event) => setFilterType(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
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
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
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
                      setSelectedQuestionIds([]);
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    Clear Filters
                  </button>

                  {showRecentOnly ? (
                    <span className="rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                      Recent only
                    </span>
                  ) : null}

                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {filtered.length} results
                  </span>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              {[
                { label: 'Draft', count: statusCounts.draft, icon: FileSearch, status: 'draft' },
                { label: 'Review', count: statusCounts.review, icon: Sparkles, status: 'review' },
                { label: 'Published', count: statusCounts.published, icon: Eye, status: 'published' },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setStatusView(item.status)}
                  className={`rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                    filterStatus === item.status
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <item.icon className="h-4 w-4 text-slate-600" />
                      <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {item.count}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}

        {pageError ? (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">Question bank feed temporarily unavailable</p>
                <p className="mt-1 text-sm text-amber-800">{pageError}</p>
              </div>
              <button
                type="button"
                onClick={() => void loadQuestions()}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </div>
          </div>
        ) : null}

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
            ...(canUseExamAi
              ? [
                  {
                    label: 'AI Question Generator',
                    helper: 'Generate preview-only questions',
                    icon: Bot,
                    onClick: () => navigate('/question-bank/add', { state: { tool: 'ai' } }),
                  },
                  {
                    label: 'OCR Import',
                    helper: 'Image OCR workflow',
                    icon: ScanText,
                    onClick: () => navigate('/question-bank/add', { state: { tool: 'ocr' } }),
                  },
                  {
                    label: 'PDF Import',
                    helper: 'PDF extraction workflow',
                    icon: FileUp,
                    onClick: () => navigate('/question-bank/add', { state: { tool: 'pdf' } }),
                  },
                ]
              : []),
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
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/30"
            >
              <span className="rounded-2xl bg-slate-100 p-2 text-slate-700">
                <item.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500">{item.helper}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Bulk Review Deck</p>
              <h2 className="mt-1 text-lg font-bold text-slate-950">Card-based moderation and question operations</h2>
              <p className="mt-1 text-sm text-slate-600">
                Select cards for bulk publish/review/delete. Click taxonomy pills to tighten the list instantly.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectVisible}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {allVisibleSelected ? 'Unselect Page' : 'Select Page'}
              </button>
              <button
                type="button"
                disabled={!selectedQuestionIds.length || bulkBusy}
                onClick={() => void handleBulkStatusUpdate('published')}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Publish Selected
              </button>
              <button
                type="button"
                disabled={!selectedQuestionIds.length || bulkBusy}
                onClick={() => void handleBulkStatusUpdate('review')}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Move to Review
              </button>
              <button
                type="button"
                disabled={!selectedQuestionIds.length || bulkBusy}
                onClick={() => void handleBulkDelete()}
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete Selected
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4 pb-28">
                  {paginatedQuestions.map((question, pageIndex) => {
            const questionTags = [...(question.tags || [])].filter(Boolean);
            const isSelected = selectedQuestionIds.includes(question.id);
            const isBookmarked = bookmarkedIds.includes(question.id);
            const isAnswerOpen = expandedAnswers.includes(question.id);
            const options = question.option_items || [];

                    const displayQuestionNumber = pageStart + pageIndex;
                    return (
              <article
                key={question.id}
                className={`group rounded-[24px] border bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)] ${
                  isSelected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                  <div className="flex min-w-0 flex-1 gap-4">
                    <button
                      type="button"
                      onClick={() => toggleSelect(question.id)}
                      className="mt-1 rounded-lg text-slate-500 transition hover:text-blue-700"
                    >
                      {isSelected ? <CheckSquare className="h-5 w-5 text-blue-700" /> : <Square className="h-5 w-5" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                          {formatExamLabel(question.exam_type_slug)}
                        </span>
                        {question.subject ? (
                          <button
                            type="button"
                            onClick={() => setFilterSubject(question.subject || '')}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-700"
                          >
                            {question.subject}
                          </button>
                        ) : null}
                        {question.chapter ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                            {question.chapter}
                          </span>
                        ) : null}
                        {question.topic ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                            {question.topic}
                          </span>
                        ) : null}
                        {questionTags.slice(0, 3).map((tag) => (
                          <span
                            key={`${question.id}-${tag}`}
                            className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700"
                          >
                            {tag}
                          </span>
                        ))}
                        {question.source_name ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            {question.source_name}
                          </span>
                        ) : null}
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                          {formatLanguageLabel(question.language)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                          {formatVisibilityLabel(question.visibility)}
                        </span>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-blue-800">
                              Question {displayQuestionNumber}: {question.question_code || `Q${displayQuestionNumber}`}
                            </p>
                            <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                              Added {formatCreatedAt(question.created_at)}
                            </p>
                          </div>

                          <select
                            value={question.status}
                            onChange={(event) => void updateSingleQuestionStatus(question, event.target.value)}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold outline-none ${statusColor[question.status] || 'border-slate-200 bg-slate-100 text-slate-600'}`}
                          >
                            <option value="draft">Draft</option>
                            <option value="review">In Review</option>
                            <option value="published">Published</option>
                            <option value="archived">Archived</option>
                          </select>
                        </div>

                        <p className="text-base font-semibold leading-7 text-slate-900">{question.prompt_text || 'No prompt'}</p>

                        {options.length ? (
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {options.map((option) => (
                              <div
                                key={`${question.id}-${option.id || option.label || option.value}`}
                                className={`rounded-xl border px-3 py-2 text-sm ${
                                  isCorrectOption(question, option)
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                    : 'border-slate-200 bg-white text-slate-700'
                                }`}
                              >
                                <span className={`mr-2 font-semibold ${isCorrectOption(question, option) ? 'text-emerald-700' : 'text-slate-500'}`}>
                                  {option.label || option.id}
                                </span>
                                <span>{option.value}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {isAnswerOpen ? (
                          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                              <BookOpenCheck className="h-4 w-4" /> Answer Preview
                            </div>
                            <p className="mt-2 text-sm font-medium text-emerald-900">{resolveAnswerText(question)}</p>
                            {question.explanation ? (
                              <p className="mt-3 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                                {question.explanation}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className={`rounded-full border px-2.5 py-1 font-semibold ${diffColor[question.difficulty_level] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                          {question.difficulty_level}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
                          {formatTypeLabel(question.question_type)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
                          {question.marks} marks
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
                          -{question.negative_marks || 0} negative
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
                          {question.estimated_time_seconds || 0}s
                        </span>
                      </div>
                    </div>
                  </div>

                  <aside className="flex shrink-0 gap-2 xl:w-16 xl:flex-col">
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(question.prompt_text || '');
                        setBanner({ type: 'success', message: 'Question text copied.' });
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                      title="Copy question"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBookmark(question.id)}
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                        isBookmarked
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-amber-200 hover:text-amber-700'
                      }`}
                      title="Shortlist question"
                    >
                      <Pin className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setBanner({ type: 'success', message: 'Discussion panel can be layered next without changing the bank logic.' })}
                      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                      title="Discussion placeholder"
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        0
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/question-bank/edit/${question.id}`)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                      title="Edit question"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAnswerPanel(question.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                      title={isAnswerOpen ? 'Hide answer' : 'Show answer'}
                    >
                      {isAnswerOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(question.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 transition hover:bg-rose-50"
                      title="Delete question"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </aside>
                </div>
              </article>
            );
          })}

          {!filtered.length && !pageError ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white py-16 text-center shadow-sm">
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

          {!filtered.length && pageError ? (
            <div className="rounded-[24px] border border-dashed border-amber-300 bg-white py-16 text-center shadow-sm">
              <p className="text-sm font-semibold text-slate-700">Question list could not be refreshed right now</p>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">{pageError}</p>
              <button
                type="button"
                onClick={() => void loadQuestions()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
              >
                <RefreshCw className="h-4 w-4" /> Retry Loading
              </button>
            </div>
          ) : null}
        </div>

        {filtered.length ? (
          <div className="fixed bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPage(1);
                    setPageJump('1');
                  }}
                  disabled={safeCurrentPage === 1}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 disabled:opacity-40"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextPage = Math.max(1, safeCurrentPage - 1);
                    setCurrentPage(nextPage);
                    setPageJump(String(nextPage));
                  }}
                  disabled={safeCurrentPage === 1}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 disabled:opacity-40"
                >
                  ‹
                </button>
                <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                  {pageStart} - {pageEnd} of {filtered.length}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextPage = Math.min(totalPages, safeCurrentPage + 1);
                    setCurrentPage(nextPage);
                    setPageJump(String(nextPage));
                  }}
                  disabled={safeCurrentPage === totalPages}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 disabled:opacity-40"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPage(totalPages);
                    setPageJump(String(totalPages));
                  }}
                  disabled={safeCurrentPage === totalPages}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 disabled:opacity-40"
                >
                  »
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="font-semibold text-slate-500">Page</span>
                <input
                  value={pageJump}
                  onChange={(event) => setPageJump(event.target.value)}
                  className="w-16 rounded-lg border border-slate-200 px-3 py-1.5 text-center outline-none focus:border-blue-400"
                />
                <button
                  type="button"
                  onClick={handlePageJump}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Jump
                </button>
                <span className="rounded-lg bg-blue-50 px-3 py-1.5 font-semibold text-blue-700">
                  {safeCurrentPage} / {totalPages}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
