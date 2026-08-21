import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, CheckSquare, ClipboardCheck, FileText, MapPin, PlayCircle, Plus, Printer, Search, Settings, Square, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type {
  OfflineExam, OfflineExamAnalytics, OfflineExamAttendance, OfflineExamEvaluation,
  OfflineExamHallTicket, OfflineExamQuestion, OfflineExamResult, OfflineExamSeatingPlan,
} from '@types';
import {
  offlineExamCardClass,
  EXAM_TYPE_OPTIONS, PAPER_FORMAT_OPTIONS,
} from '@pages/offlineExamsShared';

type BannerState = { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null;
type TabKey = 'overview' | 'questions' | 'hall-tickets' | 'seating' | 'attendance' | 'evaluation' | 'results' | 'reports';
type BankQuestion = {
  id: string;
  question_code?: string;
  prompt_text: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  difficulty_level?: string;
  question_type?: string;
  marks?: number;
  negative_marks?: number;
  option_items?: Array<Record<string, unknown>>;
  answer_key?: Record<string, unknown>;
  explanation?: string;
  source_name?: string;
  tags?: string[];
};

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: 'overview', label: 'Overview', icon: FileText },
  { key: 'questions', label: 'Question Paper', icon: FileText },
  { key: 'hall-tickets', label: 'Hall Tickets', icon: Printer },
  { key: 'seating', label: 'Seating Plan', icon: MapPin },
  { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { key: 'evaluation', label: 'Evaluation', icon: Settings },
  { key: 'results', label: 'Results', icon: BarChart3 },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
];

export default function OfflineExamDetails() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session && !!examId;
  const isTeacher = user?.role === 'teacher';
  const isAdmin = user?.role === 'admin';
  const canManage = isTeacher || isAdmin;

  const [exam, setExam] = useState<OfflineExam | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [questions, setQuestions] = useState<OfflineExamQuestion[]>([]);
  const [hallTickets, setHallTickets] = useState<OfflineExamHallTicket[]>([]);
  const [seating, setSeating] = useState<OfflineExamSeatingPlan[]>([]);
  const [attendance, setAttendance] = useState<OfflineExamAttendance[]>([]);
  const [evaluations, setEvaluations] = useState<OfflineExamEvaluation[]>([]);
  const [results, setResults] = useState<OfflineExamResult[]>([]);
  const [analytics, setAnalytics] = useState<OfflineExamAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<BannerState>(null);
  const [showQuestionBankPicker, setShowQuestionBankPicker] = useState(false);
  const [questionBankLoading, setQuestionBankLoading] = useState(false);
  const [questionBankImporting, setQuestionBankImporting] = useState(false);
  const [questionBankSearch, setQuestionBankSearch] = useState('');
  const [questionBankItems, setQuestionBankItems] = useState<BankQuestion[]>([]);
  const [selectedBankQuestionIds, setSelectedBankQuestionIds] = useState<string[]>([]);

  useEffect(() => {
    const routeBanner = (location.state as { banner?: BannerState } | null)?.banner;
    if (routeBanner) {
      setBanner(routeBanner);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    if (!canRunRequests || !examId) return;
    void loadExamData();
  }, [canRunRequests, examId]);

  useEffect(() => {
    if (!examId) return;
    void loadTabData(activeTab);
  }, [activeTab, examId]);

  useEffect(() => {
    if (!showQuestionBankPicker) return;
    void loadQuestionBankOptions();
  }, [showQuestionBankPicker]);

  const loadExamData = async () => {
    if (!examId) return;
    try {
      setLoading(true);
      const response = await apiService.getOfflineExam(examId);
      setExam(response.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Exam data load nahi ho payi.'));
    } finally {
      setLoading(false);
    }
  };

  const loadTabData = async (tab: TabKey) => {
    if (!examId) return;
    try {
      setRefreshing(true);
      if (tab === 'questions') {
        const res = await apiService.listOfflineExamQuestions(examId);
        setQuestions(res.data || []);
      } else if (tab === 'hall-tickets') {
        const res = await apiService.listOfflineExamHallTickets(examId);
        setHallTickets(res.data || []);
      } else if (tab === 'seating') {
        const res = await apiService.listOfflineExamSeating(examId);
        setSeating(res.data || []);
      } else if (tab === 'attendance') {
        const res = await apiService.listOfflineExamAttendance(examId);
        setAttendance(res.data || []);
      } else if (tab === 'evaluation') {
        const res = await apiService.listOfflineExamEvaluations(examId);
        setEvaluations(res.data || []);
      } else if (tab === 'results') {
        const res = await apiService.listOfflineExamResults(examId);
        setResults(res.data || []);
      } else if (tab === 'reports') {
        const res = await apiService.getOfflineExamAnalytics(examId);
        setAnalytics(res.data);
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Tab data load nahi ho payi.'));
    } finally {
      setRefreshing(false);
    }
  };

  const handleGenerateHallTickets = async () => {
    if (!examId) return;
    try {
      setRefreshing(true);
      await apiService.generateOfflineExamHallTickets(examId);
      setBanner({ type: 'success', message: 'Hall tickets generated successfully!' });
      await loadTabData('hall-tickets');
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Hall tickets generate nahi ho paye.') });
    } finally {
      setRefreshing(false);
    }
  };

  const handleGenerateSeating = async () => {
    if (!examId) return;
    try {
      setRefreshing(true);
      await apiService.generateOfflineExamSeating(examId);
      setBanner({ type: 'success', message: 'Seating plan generated successfully!' });
      await loadTabData('seating');
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Seating plan generate nahi ho payi.') });
    } finally {
      setRefreshing(false);
    }
  };

  const handlePublishResults = async () => {
    if (!examId) return;
    try {
      setRefreshing(true);
      await apiService.publishOfflineExamResults(examId);
      setBanner({ type: 'success', message: 'Results published successfully!' });
      await loadTabData('results');
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Results publish nahi ho paye.') });
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async () => {
    if (!examId) return;
    const confirmed = window.confirm('Delete this offline exam?');
    if (!confirmed) return;
    try {
      await apiService.deleteOfflineExam(examId);
      navigate('/offline-exams', { state: { banner: { type: 'success', message: 'Offline exam deleted.' } } });
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Delete failed.') });
    }
  };

  const loadQuestionBankOptions = async () => {
    try {
      setQuestionBankLoading(true);
      const params: Record<string, unknown> = { limit: 200 };
      if (exam.exam_type) {
        params.exam_type_slug = String(exam.exam_type).toLowerCase();
      }
      const firstSubject = examSubjects[0];
      if (firstSubject) {
        params.subject = firstSubject;
      }
      const response = await apiService.listQBQuestions(params);
      setQuestionBankItems((response.data || []) as BankQuestion[]);
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Question bank load nahi ho paya.') });
    } finally {
      setQuestionBankLoading(false);
    }
  };

  const filteredQuestionBankItems = useMemo(() => {
    const searchValue = questionBankSearch.trim().toLowerCase();
    if (!searchValue) return questionBankItems;
    return questionBankItems.filter((question) =>
      [
        question.prompt_text,
        question.question_code,
        question.subject,
        question.chapter,
        question.topic,
        ...(question.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(searchValue),
    );
  }, [questionBankItems, questionBankSearch]);

  const toggleBankQuestionSelection = (questionId: string) => {
    setSelectedBankQuestionIds((current) =>
      current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId],
    );
  };

  const mapBankQuestionTypeToOfflineType = (value?: string) => {
    if (value === 'single_choice') return 'mcq';
    if (value === 'multiple_choice') return 'multiple_choice';
    return value || 'mcq';
  };

  const handleImportSelectedBankQuestions = async () => {
    if (!examId || !selectedBankQuestionIds.length) return;
    try {
      setQuestionBankImporting(true);
      const selectedQuestions = filteredQuestionBankItems.filter((question) => selectedBankQuestionIds.includes(question.id));
      await Promise.all(
        selectedQuestions.map((question, index) =>
          apiService.createOfflineExamQuestion({
            exam_id: examId,
            display_order: questions.length + index + 1,
            question_code: question.question_code,
            question_type: mapBankQuestionTypeToOfflineType(question.question_type),
            difficulty_level: question.difficulty_level || 'medium',
            prompt_text: question.prompt_text,
            option_items: question.option_items || [],
            answer_key: question.answer_key || {},
            explanation: question.explanation || undefined,
            marks: Number(question.marks || 1),
            negative_marks: Number(question.negative_marks || 0),
            metadata: {
              subject: question.subject || undefined,
              chapter: question.chapter || undefined,
              topic: question.topic || undefined,
              source: question.source_name || 'question_bank',
              bank_question_id: question.id,
              imported_from: 'question_bank',
              tags: question.tags || [],
            },
          }),
        ),
      );
      setBanner({
        type: 'success',
        message: `${selectedBankQuestionIds.length} question${selectedBankQuestionIds.length > 1 ? 's' : ''} added from Question Bank.`,
      });
      setShowQuestionBankPicker(false);
      setQuestionBankSearch('');
      setSelectedBankQuestionIds([]);
      await loadTabData('questions');
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Question bank import nahi ho paya.') });
    } finally {
      setQuestionBankImporting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Exam details load ho rahi hain..." />;
  }

  if (!exam) {
    return (
      <div className="p-4 md:p-6">
        <Alert type="error" message="Exam not found." onClose={() => navigate('/offline-exams')} />
      </div>
    );
  }

  const examSubjects = Array.isArray(exam.metadata?.subjects)
    ? exam.metadata.subjects
    : exam.subject_id
      ? [exam.subject_id]
      : [];

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate('/offline-exams')}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Offline Exams
        </button>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{exam.title}</h1>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                {exam.status.replace('_', ' ')}
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold capitalize text-amber-700">
                {EXAM_TYPE_OPTIONS.find((o) => o.value === exam.exam_type)?.label || exam.exam_type}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{exam.description || 'No description.'}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {canManage && (
              <button
                type="button"
                onClick={() => navigate(`/offline-exams/edit/${examId}`)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FileText className="h-4 w-4" />
                Edit
              </button>
            )}
            {canManage && exam.status !== 'published' && (
              <button
                type="button"
                onClick={async () => { await apiService.publishOfflineExam(examId!); await loadExamData(); }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b]"
              >
                <PlayCircle className="h-4 w-4" />
                Publish
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition ${
              activeTab === tab.key
                ? 'border-[#d58a17] text-[#d58a17]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <section className={`${offlineExamCardClass} p-5`}>
            <h2 className="text-lg font-semibold text-slate-900">Exam Details</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {[
                ['Duration', `${exam.duration_minutes} min`],
                ['Total Marks', exam.total_marks],
                ['Pass Marks', exam.pass_marks || 'N/A'],
                ['Sets', exam.total_sets],
                ['Format', PAPER_FORMAT_OPTIONS.find((o) => o.value === exam.paper_format)?.label],
                ['Source', exam.question_source.replace('_', ' ')],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
            {examSubjects.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Subjects</p>
                <div className="flex flex-wrap gap-2">
                  {examSubjects.map((subject) => (
                    <span key={subject} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">{subject}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {exam.instructions && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Instructions</p>
                <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{exam.instructions}</p>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'questions' && (
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Question Paper ({questions.length} questions)</h2>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBankQuestionIds([]);
                    setQuestionBankSearch('');
                    setShowQuestionBankPicker(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileText className="h-4 w-4" />
                  Add from Question Bank
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/offline-exams/build/${examId}`)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a6650b]"
                >
                  <Plus className="h-4 w-4" />
                  Create / Edit Questions
                </button>
              </div>
            ) : null}
          </div>
          {questions.length === 0 ? (
            <p className="text-sm text-slate-600">No questions added yet. Add questions from the Question Bank or create new ones.</p>
          ) : (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <div key={q.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Q{idx + 1} | {q.question_type} | {q.difficulty_level}</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{q.prompt_text}</p>
                    </div>
                    <span className="whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                      {q.marks} marks
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showQuestionBankPicker ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-[1px]">
          <div className="flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Add from Question Bank</h3>
                <p className="mt-1 text-sm text-slate-500">Select existing bank questions and add them into this question paper.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowQuestionBankPicker(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-slate-200 px-5 py-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={questionBankSearch}
                  onChange={(event) => setQuestionBankSearch(event.target.value)}
                  placeholder="Search bank questions by text, subject, chapter, topic..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#d58a17] focus:bg-white"
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                <span>{filteredQuestionBankItems.length} available</span>
                <span>{selectedBankQuestionIds.length} selected</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {questionBankLoading ? (
                <LoadingSpinner message="Question bank load ho raha hai..." />
              ) : filteredQuestionBankItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
                  <p className="text-sm font-medium text-slate-600">No bank questions found</p>
                  <p className="mt-1 text-sm text-slate-400">Search ko change karke dekhiye ya question bank mein questions add kijiye.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredQuestionBankItems.map((question) => {
                    const selected = selectedBankQuestionIds.includes(question.id);
                    return (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => toggleBankQuestionSelection(question.id)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          selected
                            ? 'border-[#d58a17] bg-amber-50/40 ring-2 ring-amber-100'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 text-slate-500">
                            {selected ? <CheckSquare className="h-5 w-5 text-[#d58a17]" /> : <Square className="h-5 w-5" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                              {question.question_code ? (
                                <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-700">
                                  {question.question_code}
                                </span>
                              ) : null}
                              {question.subject ? (
                                <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">
                                  {question.subject}
                                </span>
                              ) : null}
                              {question.chapter ? (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
                                  {question.chapter}
                                </span>
                              ) : null}
                              {question.topic ? (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
                                  {question.topic}
                                </span>
                              ) : null}
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">
                                {question.marks || 1} marks
                              </span>
                            </div>
                            <p className="text-sm font-medium leading-6 text-slate-900">{question.prompt_text}</p>
                            <p className="mt-2 text-xs text-slate-500">
                              {question.question_type || 'mcq'} · {question.difficulty_level || 'medium'} · {question.source_name || 'Question Bank'}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
              <p className="text-sm text-slate-500">
                Selected questions exam paper ke end mein append honge.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuestionBankPicker(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleImportSelectedBankQuestions()}
                  disabled={!selectedBankQuestionIds.length || questionBankImporting}
                  className="rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {questionBankImporting ? 'Adding...' : `Add ${selectedBankQuestionIds.length || ''} Question${selectedBankQuestionIds.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'hall-tickets' && (
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Hall Tickets ({hallTickets.length})</h2>
            {canManage && hallTickets.length === 0 && (
              <button
                type="button"
                onClick={() => void handleGenerateHallTickets()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                {refreshing ? 'Generating...' : 'Generate Hall Tickets'}
              </button>
            )}
          </div>
          {hallTickets.length === 0 ? (
            <p className="text-sm text-slate-600">No hall tickets generated yet. Click the button above to generate.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Roll No.</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Student</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Set</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hallTickets.map((ticket) => (
                    <tr key={ticket.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-900">{ticket.roll_number}</td>
                      <td className="px-4 py-3 text-slate-700">{ticket.student?.full_name || ticket.student_id}</td>
                      <td className="px-4 py-3 text-slate-700">{ticket.set_label || 'A'}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{ticket.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'seating' && (
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Seating Plan ({seating.length} seats)</h2>
            {canManage && seating.length === 0 && (
              <button
                type="button"
                onClick={() => void handleGenerateSeating()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:opacity-50"
              >
                <MapPin className="h-4 w-4" />
                {refreshing ? 'Generating...' : 'Generate Seating Plan'}
              </button>
            )}
          </div>
          {seating.length === 0 ? (
            <p className="text-sm text-slate-600">No seating plan generated yet. Generate hall tickets first.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Room</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Seat</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Student</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Set</th>
                  </tr>
                </thead>
                <tbody>
                  {seating.map((seat) => (
                    <tr key={seat.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-900">{seat.room_id}</td>
                      <td className="px-4 py-3 text-slate-700">{seat.seat_number}</td>
                      <td className="px-4 py-3 text-slate-700">{seat.student_id}</td>
                      <td className="px-4 py-3 text-slate-700">{seat.set_label || 'A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'attendance' && (
        <section className={`${offlineExamCardClass} p-5`}>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Attendance ({attendance.length} records)</h2>
          {attendance.length === 0 ? (
            <p className="text-sm text-slate-600">No attendance records yet. Mark attendance on exam day.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Student</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Entry Time</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((att) => (
                    <tr key={att.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-900">{att.student?.full_name || att.student_id}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          att.status === 'present' ? 'bg-emerald-100 text-emerald-700' :
                          att.status === 'absent' ? 'bg-rose-100 text-rose-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>{att.status}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{att.entry_time || '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{att.remarks || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'evaluation' && (
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Evaluation ({evaluations.length} entries)</h2>
            {canManage && (
              <Link
                to={`/offline-exams/evaluate/${examId}`}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a6650b]"
              >
                <Settings className="h-4 w-4" />
                Enter Marks
              </Link>
            )}
          </div>
          {evaluations.length === 0 ? (
            <p className="text-sm text-slate-600">No evaluations done yet. Click "Enter Marks" to start scoring.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Student</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Question</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Marks</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.slice(0, 20).map((ev) => (
                    <tr key={ev.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-900">{ev.student_id}</td>
                      <td className="px-4 py-3 text-slate-700">{ev.question_id}</td>
                      <td className="px-4 py-3 text-slate-700">{ev.marks_awarded}/{ev.max_marks}</td>
                      <td className="px-4 py-3 text-slate-700">{ev.evaluation_method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'results' && (
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Results ({results.length} students)</h2>
            {canManage && (
              <button
                type="button"
                onClick={() => void handlePublishResults()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:opacity-50"
              >
                <PlayCircle className="h-4 w-4" />
                Publish Results
              </button>
            )}
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-slate-600">No results available yet. Complete evaluation first.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Rank</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Student</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Score</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Percentage</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, idx) => (
                    <tr key={result.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-900">#{result.rank_in_school || idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{result.student?.full_name || result.student_id}</td>
                      <td className="px-4 py-3 text-slate-700">{result.score_obtained}/{result.max_score}</td>
                      <td className="px-4 py-3 text-slate-700">{result.percentage !== null ? `${result.percentage}%` : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          result.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                        }`}>
                          {result.passed ? 'Passed' : 'Failed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'reports' && (
        <section className={`${offlineExamCardClass} p-5`}>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Reports & Analytics</h2>
          {!analytics ? (
            <p className="text-sm text-slate-600">Analytics loading...</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {[
                ['Total Students', analytics.total_students],
                ['Average Score', Number(analytics.average_score).toFixed(1)],
                ['Average %', `${Number(analytics.average_percentage).toFixed(1)}%`],
                ['Highest', analytics.highest_score],
                ['Lowest', analytics.lowest_score],
                ['Pass Rate', `${Number(analytics.pass_rate).toFixed(1)}%`],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
