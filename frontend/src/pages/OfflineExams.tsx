import { useEffect, useState } from 'react';
import { BarChart3, ClipboardList, FileText, PenSquare, PlayCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { OfflineExam } from '@types';
import { offlineExamCardClass } from '@pages/offlineExamsShared';

type BannerState = { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null;

export default function OfflineExams() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const isTeacher = user?.role === 'teacher';
  const isStudent = user?.role === 'student';
  const isAdmin = user?.role === 'admin';
  const canManage = isTeacher || isAdmin;

  const [exams, setExams] = useState<OfflineExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<BannerState>(null);

  useEffect(() => {
    const routeBanner = (location.state as { banner?: BannerState } | null)?.banner;
    if (routeBanner) {
      setBanner(routeBanner);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    if (!canRunRequests) return;
    void loadDashboard();
  }, [canRunRequests]);

  const loadDashboard = async (showRefresh = false) => {
    try {
      setError('');
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const response = await apiService.listOfflineExams();
      setExams(response.data || []);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Offline exams load nahi ho paye.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = async (examId: string) => {
    const confirmed = window.confirm('Delete this offline exam? All questions and data will be archived.');
    if (!confirmed) return;
    try {
      setDeletingId(examId);
      await apiService.deleteOfflineExam(examId);
      setBanner({ type: 'success', message: 'Offline exam deleted successfully.' });
      await loadDashboard(true);
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Delete request failed.') });
    } finally {
      setDeletingId('');
    }
  };

  const handleLifecycleAction = async (
    action: 'publish' | 'unpublish' | 'duplicate',
    examId: string,
  ) => {
    try {
      setRefreshing(true);
      if (action === 'publish') {
        await apiService.publishOfflineExam(examId);
        setBanner({ type: 'success', message: 'Offline exam published successfully.' });
      } else if (action === 'unpublish') {
        await apiService.unpublishOfflineExam(examId);
        setBanner({ type: 'success', message: 'Offline exam moved back to draft.' });
      } else {
        await apiService.duplicateOfflineExam(examId);
        setBanner({ type: 'success', message: 'Offline exam duplicated successfully.' });
      }
      await loadDashboard(true);
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, `Offline exam ${action} failed.`) });
    } finally {
      setRefreshing(false);
    }
  };

  const draftCount = exams.filter((e) => e.status === 'draft').length;
  const publishedCount = exams.filter((e) => e.status === 'published').length;
  const totalQuestions = exams.reduce((sum, e) => sum + e.sections.reduce((s, sec) => s + (sec.question_count || 0), 0), 0);

  if (loading) {
    return <LoadingSpinner message="Offline exams load ho rahe hain..." />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Offline Exams</h1>
          <p className="mt-1 text-sm text-slate-600">
            {isStudent
              ? 'Hall tickets dekho, attendance track karo aur results dekho.'
              : 'Exams create karo, question papers manage karo, seating plan banao aur results publish karo.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void loadDashboard(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {canManage ? (
            <Link
              to="/offline-exams/create"
              className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b]"
            >
              <Plus className="h-4 w-4" />
              Create Exam
            </Link>
          ) : null}
        </div>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Exams</p>
              <p className="text-2xl font-bold text-slate-900">{exams.length}</p>
            </div>
          </div>
        </section>
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700">
              <PlayCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Published</p>
              <p className="text-2xl font-bold text-slate-900">{publishedCount}</p>
            </div>
          </div>
        </section>
        <section className={`${offlineExamCardClass} p-5`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-100 p-3 text-amber-700">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Draft</p>
              <p className="text-2xl font-bold text-slate-900">{draftCount}</p>
            </div>
          </div>
        </section>
      </div>

      <section className={`${offlineExamCardClass} mb-6 p-5`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Exam Summary</h2>
            <p className="text-sm text-slate-600">Question papers, seating plans, hall tickets and evaluation overview.</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['Total Exams', exams.length],
            ['Draft', draftCount],
            ['Published', publishedCount],
            ['Total Questions', totalQuestions],
            ['Subjects', new Set(exams.map((e) => e.subject_id).filter(Boolean)).size],
            ['Batches', new Set(exams.map((e) => e.batch_id).filter(Boolean)).size],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {!exams.length ? (
        <section className={`${offlineExamCardClass} p-8 text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">
            {isStudent ? 'No offline exams scheduled yet' : 'No offline exams created yet'}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {isStudent
              ? 'Jab teacher exam schedule karega tab yahan dikh jayega.'
              : 'First exam create karke question paper, seating plan aur results flow start karo.'}
          </p>
          {canManage ? (
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/offline-exams/create')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
              >
                <Plus className="h-4 w-4" />
                Create First Exam
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {exams.map((exam) => (
            <article key={exam.id} className={`${offlineExamCardClass} p-5`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{exam.title}</h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                      {exam.status.replace('_', ' ')}
                    </span>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold capitalize text-amber-700">
                      {exam.exam_type.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{exam.description || 'No description added.'}</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Duration</p>
                  <p className="text-lg font-bold text-slate-900">{exam.duration_minutes} min</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Questions', exam.sections.reduce((sum, section) => sum + (section.question_count || 0), 0)],
                  ['Marks', exam.total_marks],
                  ['Sets', exam.total_sets],
                  ['Format', exam.paper_format.toUpperCase()],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                    <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                {exam.seating_required ? (
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-600">Seating Required</span>
                ) : null}
                {exam.invigilators_required ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-600">Invigilators Required</span>
                ) : null}
                {exam.hall_tickets_required ? (
                  <span className="rounded-full bg-purple-50 px-2 py-1 text-purple-600">Hall Tickets Required</span>
                ) : null}
                {exam.exam_date ? (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                    Date: {exam.exam_date}
                  </span>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                {canManage ? (
                  <>
                    <Link
                      to={`/offline-exams/details/${exam.id}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <PenSquare className="h-4 w-4" />
                      Manage
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleLifecycleAction(exam.status === 'published' ? 'unpublish' : 'publish', exam.id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {exam.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLifecycleAction('duplicate', exam.id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                    >
                      <ClipboardList className="h-4 w-4" />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(exam.id)}
                      disabled={deletingId === exam.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-70"
                    >
                      <Trash2 className="h-4 w-4" />
                      {deletingId === exam.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </>
                ) : null}

                {!canManage && isStudent ? (
                  <Link
                    to={`/offline-exams/details/${exam.id}`}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
                  >
                    <FileText className="h-4 w-4" />
                    View Details
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
