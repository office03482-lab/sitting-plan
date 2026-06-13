import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsCourse, LmsProgressDashboard } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function MyLearning() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [dashboard, setDashboard] = useState<LmsProgressDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canRunRequests) return;
    void loadDashboard();
  }, [canRunRequests]);

  const progressByCourse = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const item of dashboard?.progress_items || []) {
      grouped.set(item.course_id, Math.max(grouped.get(item.course_id) || 0, item.course_completion_percentage || 0));
    }
    return grouped;
  }, [dashboard?.progress_items]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiService.getLmsProgress();
      setDashboard(response.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'My Learning dashboard load nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="My Learning load ho raha hai..." />;
  }

  const courses = dashboard?.enrolled_courses || [];
  const insights = dashboard?.ai_insights;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Learning</h1>
        <p className="mt-1 text-sm text-slate-600">Course progress, revision suggestions, aur recommended next steps.</p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {insights ? (
        <section className="grid gap-4 xl:grid-cols-4">
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Weak Chapters</p>
            <p className="mt-3 text-sm text-slate-700">{insights.weak_chapters.join(', ') || 'No weak chapters detected yet.'}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recommended Lessons</p>
            <p className="mt-3 text-sm text-slate-700">{insights.recommended_lessons.join(', ') || 'No lesson suggestions right now.'}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recommended Tests</p>
            <p className="mt-3 text-sm text-slate-700">{insights.recommended_tests.join(', ') || 'No recommended tests right now.'}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Revision Suggestions</p>
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {insights.revision_suggestions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      ) : null}

      {!courses.length ? (
        <section className={`${cardClass} text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">No enrolled courses found</h2>
          <p className="mt-2 text-sm text-slate-600">Jab batch ke liye course publish hoga, learning dashboard yahan show hoga.</p>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-2">
          {courses.map((course: LmsCourse) => (
            <article key={course.id} className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{course.title}</h2>
                  <p className="mt-2 text-sm text-slate-600">{course.description || 'No description added.'}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {Math.round(progressByCourse.get(course.id) || 0)}%
                </span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.round(progressByCourse.get(course.id) || 0)}%` }} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to={`/course/${course.id}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Open Course
                </Link>
                {course.modules.flatMap((module) => module.lessons).find((lesson) => !dashboard?.progress_items.find((item) => item.lesson_id === lesson.id && item.is_completed)) ? (
                  <Link
                    to={`/lesson/${course.modules.flatMap((module) => module.lessons).find((lesson) => !dashboard?.progress_items.find((item) => item.lesson_id === lesson.id && item.is_completed))?.id}`}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Resume Learning
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
