import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ClipboardList, PenSquare, PlayCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { BatchAnalytics, OnlineTest, OnlineTestAnalytics, OnlineTestAttempt, OnlineTestResult, SchoolAnalytics, StudentAnalytics, TestAnalyticsDetail } from '@types';
import { onlineTestCardClass } from '@pages/onlineTestsShared';

type BannerState = { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null;

export default function OnlineTests() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const isTeacher = user?.role === 'teacher';
  const isStudent = user?.role === 'student';
  const isAdmin = user?.role === 'admin';
  const isPlatformAdmin = user?.role_key === 'platform_admin';
  const canManage = isTeacher || isAdmin;
  const canViewAnalytics = isAdmin;
  const canViewStudentDashboard = isStudent;
  const canViewTeacherDashboard = isTeacher;
  const canViewSchoolDashboard = isAdmin && !isPlatformAdmin;

  const [tests, setTests] = useState<OnlineTest[]>([]);
  const [attempts, setAttempts] = useState<OnlineTestAttempt[]>([]);
  const [results, setResults] = useState<OnlineTestResult[]>([]);
  const [analytics, setAnalytics] = useState<OnlineTestAnalytics | null>(null);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics | null>(null);
  const [teacherAnalytics, setTeacherAnalytics] = useState<TestAnalyticsDetail | null>(null);
  const [batchAnalytics, setBatchAnalytics] = useState<BatchAnalytics | null>(null);
  const [schoolAnalytics, setSchoolAnalytics] = useState<SchoolAnalytics | null>(null);
  const [selectedAnalyticsTestId, setSelectedAnalyticsTestId] = useState('');
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

  useEffect(() => {
    if (!tests.length) {
      setSelectedAnalyticsTestId('');
      return;
    }
    if (!selectedAnalyticsTestId || !tests.some((item) => item.id === selectedAnalyticsTestId)) {
      setSelectedAnalyticsTestId(tests[0].id);
    }
  }, [selectedAnalyticsTestId, tests]);

  useEffect(() => {
    if (!canRunRequests || !canViewTeacherDashboard || !selectedAnalyticsTestId) {
      setTeacherAnalytics(null);
      setBatchAnalytics(null);
      return;
    }

    let active = true;
    const loadTeacherAnalytics = async () => {
      try {
        const testResponse = await apiService.getTestAnalyticsDetail(selectedAnalyticsTestId);
        if (!active) return;
        setTeacherAnalytics(testResponse.data);

        const selectedTest = tests.find((item) => item.id === selectedAnalyticsTestId);
        const batchId = selectedTest?.batch_id;
        if (batchId) {
          const batchResponse = await apiService.getBatchAnalytics(batchId);
          if (!active) return;
          setBatchAnalytics(batchResponse.data);
        } else {
          setBatchAnalytics(null);
        }
      } catch (requestError) {
        if (!active) return;
        setError(getRequestErrorMessage(requestError, 'Teacher analytics load nahi ho paye.'));
      }
    };

    void loadTeacherAnalytics();
    return () => {
      active = false;
    };
  }, [canRunRequests, canViewTeacherDashboard, selectedAnalyticsTestId, tests]);

  const latestResultByTest = useMemo(() => {
    const mapped = new Map<string, OnlineTestResult>();
    for (const result of results) {
      if (!mapped.has(result.test_id)) {
        mapped.set(result.test_id, result);
      }
    }
    return mapped;
  }, [results]);

  const activeAttemptByTest = useMemo(() => {
    const mapped = new Map<string, OnlineTestAttempt>();
    for (const attempt of attempts) {
      if (attempt.status === 'in_progress' && !mapped.has(attempt.test_id)) {
        mapped.set(attempt.test_id, attempt);
      }
    }
    return mapped;
  }, [attempts]);

  const loadDashboard = async (showRefresh = false) => {
    try {
      setError('');
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const requests: Promise<unknown>[] = [apiService.listOnlineTests()];
      if (isStudent || canManage) {
        requests.push(apiService.listOnlineTestAttempts());
        requests.push(apiService.listOnlineTestResults());
      }
      if (canViewAnalytics) {
        requests.push(apiService.getOnlineTestAnalytics());
      }
      if (canViewStudentDashboard) {
        requests.push(apiService.getStudentAnalytics('me'));
      }
      if (canViewSchoolDashboard && user?.school_id) {
        requests.push(apiService.getSchoolAnalytics(user.school_id));
      }

      const responses = await Promise.all(requests);
      let cursor = 0;
      setTests((responses[cursor++] as Awaited<ReturnType<typeof apiService.listOnlineTests>>).data || []);

      if (isStudent || canManage) {
        setAttempts((responses[cursor++] as Awaited<ReturnType<typeof apiService.listOnlineTestAttempts>>).data || []);
        setResults((responses[cursor++] as Awaited<ReturnType<typeof apiService.listOnlineTestResults>>).data || []);
      } else {
        setAttempts([]);
        setResults([]);
      }

      if (canViewAnalytics) {
        setAnalytics((responses[cursor++] as Awaited<ReturnType<typeof apiService.getOnlineTestAnalytics>>).data || null);
      } else {
        setAnalytics(null);
      }

      if (canViewStudentDashboard) {
        setStudentAnalytics((responses[cursor++] as Awaited<ReturnType<typeof apiService.getStudentAnalytics>>).data || null);
      } else {
        setStudentAnalytics(null);
      }

      if (canViewSchoolDashboard && user?.school_id) {
        setSchoolAnalytics((responses[cursor++] as Awaited<ReturnType<typeof apiService.getSchoolAnalytics>>).data || null);
      } else {
        setSchoolAnalytics(null);
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Online tests load nahi ho paye.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = async (testId: string) => {
    const confirmed = window.confirm('Delete this online test? Questions and sections will be archived.');
    if (!confirmed) return;
    try {
      setDeletingId(testId);
      await apiService.deleteOnlineTest(testId);
      setBanner({ type: 'success', message: 'Online test deleted successfully.' });
      await loadDashboard(true);
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Delete request failed.') });
    } finally {
      setDeletingId('');
    }
  };

  const handleLifecycleAction = async (
    action: 'publish' | 'unpublish' | 'duplicate',
    testId: string,
  ) => {
    try {
      setRefreshing(true);
      if (action === 'publish') {
        await apiService.publishOnlineTest(testId);
        setBanner({ type: 'success', message: 'Online test published successfully.' });
      } else if (action === 'unpublish') {
        await apiService.unpublishOnlineTest(testId);
        setBanner({ type: 'success', message: 'Online test moved back to draft.' });
      } else {
        await apiService.duplicateOnlineTest(testId);
        setBanner({ type: 'success', message: 'Online test duplicated successfully.' });
      }
      await loadDashboard(true);
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, `Online test ${action} failed.`) });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Online tests load ho rahe hain..." />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Online Tests</h1>
          <p className="mt-1 text-sm text-slate-600">
            {isStudent
              ? 'Assigned tests attempt karo, progress track karo aur results dekho.'
              : 'Tests publish karo, questions manage karo aur school-level progress track karo.'}
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
              to="/online-tests/create"
              className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b]"
            >
              <Plus className="h-4 w-4" />
              Create Test
            </Link>
          ) : null}
        </div>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className={`${onlineTestCardClass} p-5`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Visible Tests</p>
              <p className="text-2xl font-bold text-slate-900">{tests.length}</p>
            </div>
          </div>
        </section>
        <section className={`${onlineTestCardClass} p-5`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700">
              <PlayCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">{isStudent ? 'Your Attempts' : 'Tracked Attempts'}</p>
              <p className="text-2xl font-bold text-slate-900">{attempts.length}</p>
            </div>
          </div>
        </section>
        <section className={`${onlineTestCardClass} p-5`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-100 p-3 text-amber-700">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">{canViewAnalytics ? 'Average Score' : 'Results Available'}</p>
              <p className="text-2xl font-bold text-slate-900">
                {canViewAnalytics ? `${analytics?.average_percentage || 0}%` : results.length}
              </p>
            </div>
          </div>
        </section>
      </div>

      {canViewAnalytics && analytics ? (
        <section className={`${onlineTestCardClass} mb-6 p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">School Analytics</h2>
              <p className="text-sm text-slate-600">Role-based admin view from the online test analytics endpoint.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {[
              ['Total Tests', analytics.total_tests],
              ['Total Attempts', analytics.total_attempts],
              ['Completed', analytics.completed_attempts],
              ['Evaluated', analytics.evaluated_results],
              ['High Score', analytics.highest_score],
              ['Low Score', analytics.lowest_score],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canViewStudentDashboard && studentAnalytics ? (
        <section className={`${onlineTestCardClass} mb-6 p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Student Dashboard</h2>
              <p className="text-sm text-slate-600">AI-backed performance insights for your online tests.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['Overall %', `${studentAnalytics.overall_percentage}%`],
              ['Accuracy', `${studentAnalytics.accuracy}%`],
              ['Percentile', `${studentAnalytics.percentile}%`],
              ['Speed', `${studentAnalytics.speed}s / answer`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Weak Topics</p>
              <p className="mt-2 text-sm text-slate-700">{studentAnalytics.weak_topics.join(', ') || 'No weak topics detected'}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Strong Topics</p>
              <p className="mt-2 text-sm text-slate-700">{studentAnalytics.strong_topics.join(', ') || 'Build more attempt history to surface strengths'}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Suggestions</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {studentAnalytics.suggestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {canViewTeacherDashboard && tests.length ? (
        <section className={`${onlineTestCardClass} mb-6 p-5`}>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Teacher Dashboard</h2>
              <p className="text-sm text-slate-600">Test-level AI analytics, topper list, and difficulty signals.</p>
            </div>
            <select
              value={selectedAnalyticsTestId}
              onChange={(e) => setSelectedAnalyticsTestId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              {tests.map((test) => (
                <option key={test.id} value={test.id}>
                  {test.title}
                </option>
              ))}
            </select>
          </div>

          {teacherAnalytics ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Avg %', `${teacherAnalytics.average_percentage}%`],
                  ['Participants', teacherAnalytics.participant_count],
                  ['Completion', `${teacherAnalytics.completion_rate}%`],
                  ['Avg Score', teacherAnalytics.average_score],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Topper List</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {teacherAnalytics.topper_list.map((item) => (
                      <div key={item.student_id} className="flex items-center justify-between gap-3">
                        <span>{item.student_name}</span>
                        <span className="font-semibold">{item.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Weak Students</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {teacherAnalytics.weak_students.map((item) => (
                      <div key={item.student_id} className="flex items-center justify-between gap-3">
                        <span>{item.student_name}</span>
                        <span className="font-semibold">{item.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Hard Questions</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {teacherAnalytics.question_difficulty_analysis.slice(0, 4).map((item) => (
                      <div key={item.question_id}>
                        <p className="font-medium text-slate-900">{item.prompt_text}</p>
                        <p>{item.correct_rate}% correct</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {batchAnalytics ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Batch Comparison</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <p className="text-sm text-slate-500">Batch</p>
                      <p className="text-base font-semibold text-slate-900">{batchAnalytics.batch_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Overall %</p>
                      <p className="text-base font-semibold text-slate-900">{batchAnalytics.overall_percentage}%</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Weak Topics</p>
                      <p className="text-base font-semibold text-slate-900">{batchAnalytics.weak_topics.join(', ') || 'None'}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-600">Teacher analytics load ho rahe hain...</p>
          )}
        </section>
      ) : null}

      {canViewSchoolDashboard && schoolAnalytics ? (
        <section className={`${onlineTestCardClass} mb-6 p-5`}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">School Dashboard</h2>
            <p className="text-sm text-slate-600">Class-wise, teacher-wise, subject-wise, and monthly progress analytics.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['Active Students', schoolAnalytics.active_students],
              ['Active Tests', schoolAnalytics.active_tests],
              ['Average Score', schoolAnalytics.average_score],
              ['Average %', `${schoolAnalytics.average_percentage}%`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Class-wise Performance</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                {schoolAnalytics.class_wise_performance.slice(0, 5).map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3">
                    <span>{item.name}</span>
                    <span className="font-semibold">{item.average_percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Teacher-wise Performance</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                {schoolAnalytics.teacher_wise_performance.slice(0, 5).map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3">
                    <span>{item.name}</span>
                    <span className="font-semibold">{item.average_percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Monthly Progress</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                {schoolAnalytics.monthly_progress.slice(-5).map((item) => (
                  <div key={item.period} className="flex items-center justify-between gap-3">
                    <span>{item.period}</span>
                    <span className="font-semibold">{item.average_percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {!tests.length ? (
        <section className={`${onlineTestCardClass} p-8 text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">
            {isStudent ? 'No assigned tests right now' : 'No online tests created yet'}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {isStudent
              ? 'Jab teacher aapke batch ke liye test publish karega tab yahan dikh jayega.'
              : 'First test create karke question bank aur student attempts flow start karo.'}
          </p>
          {canManage ? (
            <button
              type="button"
              onClick={() => navigate('/online-tests/create')}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
            >
              <Plus className="h-4 w-4" />
              Create Your First Test
            </button>
          ) : null}
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {tests.map((test) => {
            const activeAttempt = activeAttemptByTest.get(test.id);
            const latestResult = latestResultByTest.get(test.id);

            return (
              <article key={test.id} className={`${onlineTestCardClass} p-5`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">{test.title}</h2>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                        {test.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{test.description || 'No description added.'}</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Duration</p>
                    <p className="text-lg font-bold text-slate-900">{test.duration_minutes} min</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['Questions', test.sections.reduce((sum, section) => sum + (section.question_count || 0), 0)],
                    ['Marks', test.total_marks],
                    ['Attempts', test.max_attempts],
                    ['Immediate Result', test.show_result_immediately ? 'Yes' : 'No'],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Starts: {test.starts_at ? new Date(test.starts_at).toLocaleString() : 'Any time'}</span>
                  <span className="hidden md:inline">|</span>
                  <span>Ends: {test.ends_at ? new Date(test.ends_at).toLocaleString() : 'No deadline'}</span>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {canManage ? (
                    <>
                      <Link
                        to={`/online-tests/edit/${test.id}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <PenSquare className="h-4 w-4" />
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleLifecycleAction(test.status === 'published' ? 'unpublish' : 'publish', test.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <PlayCircle className="h-4 w-4" />
                        {test.status === 'published' ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLifecycleAction('duplicate', test.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        <ClipboardList className="h-4 w-4" />
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(test.id)}
                        disabled={deletingId === test.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-70"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingId === test.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </>
                  ) : null}

                  {isStudent ? (
                    activeAttempt ? (
                      <Link
                        to={`/online-tests/take/${test.id}`}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
                      >
                        <PlayCircle className="h-4 w-4" />
                        Resume Attempt
                      </Link>
                    ) : (
                      <Link
                        to={`/online-tests/take/${test.id}`}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
                      >
                        <PlayCircle className="h-4 w-4" />
                        Start Test
                      </Link>
                    )
                  ) : null}

                  {latestResult ? (
                    <Link
                      to={`/online-tests/results/${latestResult.id}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <BarChart3 className="h-4 w-4" />
                      View Results
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
