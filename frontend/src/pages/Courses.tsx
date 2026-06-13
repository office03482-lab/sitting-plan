import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsCourse } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function Courses() {
  const navigate = useNavigate();
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const canManage = user?.role === 'teacher' || user?.role === 'admin';

  const [courses, setCourses] = useState<LmsCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    visibility: 'batch',
    target_class_name: '',
    target_section: '',
    course_code: '',
    intro_video_url: '',
    thumbnail_url: '',
    is_published: true,
  });

  useEffect(() => {
    if (!canRunRequests) return;
    void loadCourses();
  }, [canRunRequests]);

  const loadCourses = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiService.listLmsCourses();
      setCourses(response.data || []);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Courses load nahi ho paye.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCourse = async () => {
    if (!form.title.trim()) {
      setError('Course title required hai.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const response = await apiService.createLmsCourse(form);
      setBanner('Course create ho gaya.');
      setForm({
        title: '',
        description: '',
        visibility: 'batch',
        target_class_name: '',
        target_section: '',
        course_code: '',
        intro_video_url: '',
        thumbnail_url: '',
        is_published: true,
      });
      await loadCourses();
      navigate(`/course/${response.data.id}`);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Course create nahi hua.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Courses load ho rahe hain..." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Recorded Courses</h1>
          <p className="mt-1 text-sm text-slate-600">Video lectures, PDFs, notes aur assignment-ready course catalog.</p>
        </div>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {canManage ? (
        <section className={cardClass}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Create Course</h2>
            <p className="text-sm text-slate-500">Flutter-friendly URL resources ke saath course shell create karein.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Course Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Course Code" value={form.course_code} onChange={(e) => setForm({ ...form, course_code: e.target.value })} />
            <textarea className="rounded-xl border border-slate-300 px-4 py-3 text-sm md:col-span-2" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            <select className="rounded-xl border border-slate-300 px-4 py-3 text-sm" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              <option value="public">Public</option>
              <option value="batch">Batch</option>
              <option value="class">Class</option>
              <option value="private">Private</option>
            </select>
            <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Target Class" value={form.target_class_name} onChange={(e) => setForm({ ...form, target_class_name: e.target.value })} />
            <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Target Section" value={form.target_section} onChange={(e) => setForm({ ...form, target_section: e.target.value })} />
            <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Intro Video URL" value={form.intro_video_url} onChange={(e) => setForm({ ...form, intro_video_url: e.target.value })} />
            <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm md:col-span-2" placeholder="Thumbnail URL" value={form.thumbnail_url} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
              Publish immediately
            </label>
            <button onClick={() => void handleCreateCourse()} disabled={saving} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">
              {saving ? 'Saving...' : 'Create Course'}
            </button>
          </div>
        </section>
      ) : null}

      {!courses.length ? (
        <section className={`${cardClass} text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">No courses available</h2>
          <p className="mt-2 text-sm text-slate-600">Teacher course publish karega to yahan learning library dikh jayegi.</p>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-2">
          {courses.map((course) => (
            <article key={course.id} className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{course.title}</h2>
                  <p className="mt-2 text-sm text-slate-600">{course.description || 'No description added yet.'}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">{course.visibility}</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Modules</p>
                  <p className="mt-2 text-lg font-bold text-slate-900">{course.module_count}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Lessons</p>
                  <p className="mt-2 text-lg font-bold text-slate-900">{course.lesson_count}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Assignments</p>
                  <p className="mt-2 text-lg font-bold text-slate-900">{course.assignment_count}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to={`/course/${course.id}`} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                  Open Course
                </Link>
                {course.intro_video_url ? (
                  <a href={course.intro_video_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Intro Video
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
