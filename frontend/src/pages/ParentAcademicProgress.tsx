import { useEffect, useMemo, useState, useRef } from 'react';
import { Award, BookOpen, Brain, RefreshCw, TrendingUp } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentPortalAcademicChild } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
const LOADING_TIMEOUT_MS = 30_000;

export default function ParentAcademicProgress() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalAcademicChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!canRun) {
      timeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setLoading(false);
          setError('Parent authentication context not fully ready. Please wait or refresh.');
        }
      }, LOADING_TIMEOUT_MS);
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    void loadData();
  }, [canRun]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiService.getParentPortalAcademicProgress();
      const data = res.data;
      if (!mountedRef.current) return;
      setChildren(Array.isArray(data.children) ? data.children : []);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].student_id);
      }
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getRequestErrorMessage(err, 'Academic progress load failed.'));
      setLoading(false);
    }
  };

  const child = useMemo(() => children.find((c) => c.student_id === selectedChildId) || children[0], [children, selectedChildId]);

  if (loading) return <LoadingSpinner message="Loading academic progress..." />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Academic Progress</h1>
          <p className="mt-1 text-sm text-slate-500">Course progress, assignments, and topic mastery</p>
        </div>
        {children.length > 1 && (
          <select value={selectedChildId} onChange={(e) => setSelectedChildId(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">
            {children.map((c) => (
              <option key={c.student_id} value={c.student_id}>{c.student_name}</option>
            ))}
          </select>
        )}
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {child && (
        <>
          <section className={cardClass}>
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold text-slate-900">Course Progress</h3>
              <span className="ml-auto rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700">
                {child.course_progress.overall_percentage}% overall
              </span>
            </div>
            {child.course_progress.courses.length > 0 ? (
              <div className="mt-4 space-y-3">
                {child.course_progress.courses.map((course, idx) => (
                  <div key={idx} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">{course.course_name}</p>
                      <span className="text-sm font-bold text-slate-700">{course.watch_percentage}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${course.watch_percentage}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{course.completed_lessons}/{course.total_lessons} lessons</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No course progress data available.</p>
            )}
          </section>

          <section className={`${cardClass} grid gap-4 sm:grid-cols-2`}>
            <div>
              <div className="flex items-center gap-3">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-slate-900">Assignments</h3>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatBox label="Total" value={String(child.assignment_completion.total)} />
                <StatBox label="Completed" value={String(child.assignment_completion.completed)} color="emerald" />
                <StatBox label="Graded" value={String(child.assignment_completion.graded)} color="sky" />
                <StatBox label="Completion" value={`${child.assignment_completion.completion_percentage}%`} color="violet" />
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex h-32 items-center justify-center">
                <div className="relative h-28 w-28">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#10b981" strokeWidth="3"
                      strokeDasharray={`${child.assignment_completion.completion_percentage} ${100 - child.assignment_completion.completion_percentage}`}
                      strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-slate-900">
                    {child.assignment_completion.completion_percentage}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-amber-600" />
              <h3 className="text-lg font-semibold text-slate-900">Revision Tracker</h3>
            </div>
            <div className="mt-4 flex items-center gap-6">
              <StatBox label="Total Revisions" value={String(child.revision_tracker.total_revisions)} />
              <StatBox label="Completed" value={String(child.revision_tracker.completed_revisions)} color="emerald" />
              <div className="text-sm text-slate-500">
                {child.revision_tracker.total_revisions > 0
                  ? `${Math.round((child.revision_tracker.completed_revisions / child.revision_tracker.total_revisions) * 100)}% done`
                  : 'No revision data'}
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <section className={cardClass}>
              <div className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-rose-600" />
                <h3 className="text-lg font-semibold text-slate-900">Weak Topics</h3>
              </div>
              {child.weak_topics.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {child.weak_topics.map((topic, idx) => (
                    <span key={idx} className="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-700">{topic}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No weak topics flagged.</p>
              )}
            </section>
            <section className={cardClass}>
              <div className="flex items-center gap-3">
                <Award className="h-5 w-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-slate-900">Strong Topics</h3>
              </div>
              {child.strong_topics.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {child.strong_topics.map((topic, idx) => (
                    <span key={idx} className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">{topic}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No strong topics data yet.</p>
              )}
            </section>
          </section>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700', sky: 'bg-sky-100 text-sky-700',
    violet: 'bg-violet-100 text-violet-700', amber: 'bg-amber-100 text-amber-700',
  };
  const c = color ? colors[color] || '' : 'bg-slate-100 text-slate-700';
  return (
    <div className={`rounded-2xl px-4 py-3 ${c}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
