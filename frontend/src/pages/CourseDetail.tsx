import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsAssignment, LmsCourse } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function CourseDetail() {
  const { id = '' } = useParams();
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const canManage = user?.role === 'teacher' || user?.role === 'admin';

  const [course, setCourse] = useState<LmsCourse | null>(null);
  const [assignments, setAssignments] = useState<LmsAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [moduleForm, setModuleForm] = useState({ title: '', description: '', display_order: 1 });
  const [lessonForm, setLessonForm] = useState({
    module_id: '',
    title: '',
    description: '',
    lesson_type: 'video',
    video_url: '',
    content_text: '',
    resource_url: '',
    resource_title: '',
    resource_type: 'pdf',
  });
  const [assignmentForm, setAssignmentForm] = useState({
    title: '',
    description: '',
    due_at: '',
    attachment_url: '',
    status: 'published',
  });

  useEffect(() => {
    if (!canRunRequests || !id) return;
    void loadPage();
  }, [canRunRequests, id]);

  const moduleOptions = useMemo(() => course?.modules || [], [course?.modules]);

  const loadPage = async () => {
    try {
      setLoading(true);
      setError('');
      const [courseResponse, assignmentResponse] = await Promise.all([
        apiService.getLmsCourse(id),
        apiService.listLmsAssignments({ course_id: id }),
      ]);
      setCourse(courseResponse.data);
      setAssignments(assignmentResponse.data || []);
      if ((courseResponse.data.modules || [])[0]?.id) {
        setLessonForm((current) => ({ ...current, module_id: current.module_id || courseResponse.data.modules[0].id }));
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Course detail load nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateModule = async () => {
    if (!course || !moduleForm.title.trim()) return;
    try {
      setSaving(true);
      await apiService.createLmsModule({ ...moduleForm, course_id: course.id });
      setBanner('Module create ho gaya.');
      setModuleForm({ title: '', description: '', display_order: 1 });
      await loadPage();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Module create nahi hua.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLesson = async () => {
    if (!course || !lessonForm.module_id || !lessonForm.title.trim()) return;
    try {
      setSaving(true);
      await apiService.createLmsLesson({
        course_id: course.id,
        module_id: lessonForm.module_id,
        title: lessonForm.title,
        description: lessonForm.description,
        lesson_type: lessonForm.lesson_type,
        video_url: lessonForm.video_url || undefined,
        content_text: lessonForm.content_text || undefined,
        resources: lessonForm.resource_title
          ? [
              {
                title: lessonForm.resource_title,
                resource_type: lessonForm.resource_type,
                resource_url: lessonForm.resource_url || undefined,
                text_content: lessonForm.resource_type === 'note' ? lessonForm.content_text || undefined : undefined,
              },
            ]
          : [],
      });
      setBanner('Lesson create ho gaya.');
      setLessonForm({
        module_id: moduleOptions[0]?.id || '',
        title: '',
        description: '',
        lesson_type: 'video',
        video_url: '',
        content_text: '',
        resource_url: '',
        resource_title: '',
        resource_type: 'pdf',
      });
      await loadPage();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Lesson create nahi hua.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAssignment = async () => {
    if (!course || !assignmentForm.title.trim()) return;
    try {
      setSaving(true);
      await apiService.createLmsAssignment({
        course_id: course.id,
        title: assignmentForm.title,
        description: assignmentForm.description,
        due_at: assignmentForm.due_at || undefined,
        attachment_url: assignmentForm.attachment_url || undefined,
        status: assignmentForm.status,
      });
      setBanner('Assignment create ho gaya.');
      setAssignmentForm({ title: '', description: '', due_at: '', attachment_url: '', status: 'published' });
      await loadPage();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Assignment create nahi hua.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Course detail load ho raha hai..." />;
  }

  if (!course) {
    return <div className="p-4 md:p-6">{error ? <Alert type="error" message={error} /> : null}</div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className={cardClass}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Course Overview</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">{course.title}</h1>
            <p className="mt-2 text-sm text-slate-600">{course.description || 'No description added.'}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Modules</p><p className="mt-2 text-lg font-bold text-slate-900">{course.module_count}</p></div>
            <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Lessons</p><p className="mt-2 text-lg font-bold text-slate-900">{course.lesson_count}</p></div>
            <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Assignments</p><p className="mt-2 text-lg font-bold text-slate-900">{course.assignment_count}</p></div>
          </div>
        </div>
      </section>

      {canManage ? (
        <section className="grid gap-5 xl:grid-cols-3">
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-slate-900">Add Module</h2>
            <div className="mt-4 space-y-3">
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Module title" value={moduleForm.title} onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })} />
              <textarea className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Module description" value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} />
              <button onClick={() => void handleCreateModule()} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">Create Module</button>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-slate-900">Add Lesson</h2>
            <div className="mt-4 space-y-3">
              <select className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" value={lessonForm.module_id} onChange={(e) => setLessonForm({ ...lessonForm, module_id: e.target.value })}>
                <option value="">Select module</option>
                {moduleOptions.map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}
              </select>
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Lesson title" value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
              <select className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" value={lessonForm.lesson_type} onChange={(e) => setLessonForm({ ...lessonForm, lesson_type: e.target.value })}>
                <option value="video">Video</option>
                <option value="pdf">PDF</option>
                <option value="note">Note</option>
                <option value="mixed">Mixed</option>
              </select>
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Video / resource URL" value={lessonForm.video_url} onChange={(e) => setLessonForm({ ...lessonForm, video_url: e.target.value, resource_url: e.target.value })} />
              <textarea className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Lesson notes" value={lessonForm.content_text} onChange={(e) => setLessonForm({ ...lessonForm, content_text: e.target.value })} />
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Resource title" value={lessonForm.resource_title} onChange={(e) => setLessonForm({ ...lessonForm, resource_title: e.target.value })} />
              <button onClick={() => void handleCreateLesson()} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">Create Lesson</button>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-slate-900">Add Assignment</h2>
            <div className="mt-4 space-y-3">
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Assignment title" value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} />
              <textarea className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Assignment description" value={assignmentForm.description} onChange={(e) => setAssignmentForm({ ...assignmentForm, description: e.target.value })} />
              <input type="datetime-local" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" value={assignmentForm.due_at} onChange={(e) => setAssignmentForm({ ...assignmentForm, due_at: e.target.value })} />
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Attachment URL" value={assignmentForm.attachment_url} onChange={(e) => setAssignmentForm({ ...assignmentForm, attachment_url: e.target.value })} />
              <button onClick={() => void handleCreateAssignment()} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">Create Assignment</button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Modules & Lessons</h2>
          <div className="mt-4 space-y-4">
            {course.modules.map((module) => (
              <div key={module.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-base font-semibold text-slate-900">{module.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{module.description || 'No module description.'}</p>
                <div className="mt-3 space-y-2">
                  {module.lessons.map((lesson) => (
                    <Link key={lesson.id} to={`/lesson/${lesson.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 hover:bg-slate-50">
                      <span>{lesson.title}</span>
                      <span className="capitalize text-slate-500">{lesson.lesson_type}</span>
                    </Link>
                  ))}
                  {!module.lessons.length ? <p className="text-sm text-slate-500">No lessons added yet.</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Assignments</h2>
          <div className="mt-4 space-y-3">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-900">{assignment.title}</p>
                <p className="mt-1 text-sm text-slate-600">{assignment.description || 'No description added.'}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{assignment.status}</span>
                  <span>{assignment.due_at ? new Date(assignment.due_at).toLocaleString() : 'No deadline'}</span>
                </div>
              </div>
            ))}
            {!assignments.length ? <p className="text-sm text-slate-500">No assignments available.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
