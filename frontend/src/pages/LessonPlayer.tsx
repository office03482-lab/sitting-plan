import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsLesson, LmsProgressDashboard } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function LessonPlayer() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const canUpdateProgress = user?.role === 'student';

  const [lesson, setLesson] = useState<LmsLesson | null>(null);
  const [dashboard, setDashboard] = useState<LmsProgressDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [watchPercentage, setWatchPercentage] = useState(0);
  const [positionSeconds, setPositionSeconds] = useState(0);

  useEffect(() => {
    if (!canRunRequests || !id) return;
    void loadPage();
  }, [canRunRequests, id]);

  const progressItem = useMemo(
    () => dashboard?.progress_items.find((item) => item.lesson_id === lesson?.id),
    [dashboard?.progress_items, lesson?.id],
  );

  const loadPage = async () => {
    try {
      setLoading(true);
      setError('');
      const requests: Promise<unknown>[] = [apiService.getLmsLesson(id)];
      if (canUpdateProgress) {
        requests.push(apiService.getLmsProgress());
      }
      const responses = await Promise.all(requests);
      const lessonResponse = responses[0] as Awaited<ReturnType<typeof apiService.getLmsLesson>>;
      setLesson(lessonResponse.data);
      if (canUpdateProgress) {
        const dashboardResponse = responses[1] as Awaited<ReturnType<typeof apiService.getLmsProgress>>;
        setDashboard(dashboardResponse.data);
        const current = dashboardResponse.data.progress_items.find((item) => item.lesson_id === lessonResponse.data.id);
        setWatchPercentage(Number(current?.watch_percentage || 0));
        setPositionSeconds(Number(current?.last_watched_position_seconds || 0));
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Lesson load nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProgress = async (markComplete = false) => {
    if (!lesson) return;
    try {
      setSaving(true);
      await apiService.updateLmsProgress({
        course_id: lesson.course_id,
        module_id: lesson.module_id,
        lesson_id: lesson.id,
        last_watched_position_seconds: positionSeconds,
        watch_percentage: markComplete ? 100 : watchPercentage,
        is_completed: markComplete || watchPercentage >= 100,
      });
      setBanner(markComplete ? 'Lesson marked complete.' : 'Progress saved.');
      await loadPage();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Progress save nahi hua.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Lesson load ho raha hai..." />;
  }

  if (!lesson) {
    return <div className="p-4 md:p-6">{error ? <Alert type="error" message={error} /> : null}</div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <button type="button" onClick={() => navigate(`/course/${lesson.course_id}`)} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
          Back to Course
        </button>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{lesson.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{lesson.description || 'No lesson description.'}</p>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className={cardClass}>
        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-4">
            {lesson.video_url ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <iframe
                  src={lesson.video_url}
                  title={lesson.title}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : null}
            {lesson.content_text ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h2 className="text-lg font-semibold text-slate-900">Notes</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{lesson.content_text}</p>
              </div>
            ) : null}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-lg font-semibold text-slate-900">Resources</h2>
              <div className="mt-3 space-y-3">
                {lesson.resources.map((resource) => (
                  <div key={resource.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{resource.title}</p>
                        <p className="text-xs capitalize text-slate-500">{resource.resource_type}</p>
                      </div>
                      {resource.resource_url ? (
                        <a href={resource.resource_url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          Open
                        </a>
                      ) : null}
                    </div>
                    {resource.text_content ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{resource.text_content}</p> : null}
                  </div>
                ))}
                {!lesson.resources.length ? <p className="text-sm text-slate-500">No resources attached.</p> : null}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lesson Meta</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <p>Type: <span className="font-semibold capitalize">{lesson.lesson_type}</span></p>
                <p>Duration: <span className="font-semibold">{lesson.duration_seconds}s</span></p>
                <p>Preview: <span className="font-semibold">{lesson.is_preview ? 'Yes' : 'No'}</span></p>
              </div>
            </div>

            {canUpdateProgress ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Progress Tracking</p>
                <div className="mt-4 space-y-3">
                  <label className="block text-sm text-slate-700">
                    Watch Percentage
                    <input type="range" min={0} max={100} value={watchPercentage} onChange={(e) => setWatchPercentage(Number(e.target.value))} className="mt-2 w-full" />
                  </label>
                  <p className="text-sm font-semibold text-slate-900">{watchPercentage}% watched</p>
                  <label className="block text-sm text-slate-700">
                    Last Position (seconds)
                    <input type="number" min={0} value={positionSeconds} onChange={(e) => setPositionSeconds(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                  </label>
                  <p className="text-xs text-slate-500">Resume point: {progressItem?.last_watched_position_seconds || 0}s</p>
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => void handleSaveProgress(false)} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">Save Progress</button>
                    <button onClick={() => void handleSaveProgress(true)} disabled={saving} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-70">Mark Complete</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
