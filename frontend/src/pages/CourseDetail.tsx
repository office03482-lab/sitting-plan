import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsAssignment, LmsCourse } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

type LessonResourceDraft = {
  title: string;
  resource_type: string;
  resource_url: string;
};

type AssignmentFileDraft = {
  title: string;
  url: string;
  file_type: string;
};

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
  const [uploadingKey, setUploadingKey] = useState('');
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [moduleForm, setModuleForm] = useState({ title: '', description: '', display_order: 1 });
  const [lessonForm, setLessonForm] = useState({
    module_id: '',
    title: '',
    description: '',
    lesson_type: 'video',
    video_url: '',
    content_text: '',
    duration_seconds: 0,
    resources: [{ title: '', resource_type: 'mp4', resource_url: '' }] as LessonResourceDraft[],
  });
  const [assignmentForm, setAssignmentForm] = useState({
    title: '',
    description: '',
    due_at: '',
    attachment_url: '',
    max_score: 100,
    batch_assignment_ids: '',
    status: 'published',
    reference_files: [{ title: '', url: '', file_type: 'pdf' }] as AssignmentFileDraft[],
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

  const trackProgress = (key: string) => (progressEvent: { loaded?: number; total?: number }) => {
    const total = Number(progressEvent.total || 0);
    const loaded = Number(progressEvent.loaded || 0);
    if (!total) return;
    setUploadProgress((current) => ({ ...current, [key]: Math.round((loaded / total) * 100) }));
  };

  const handleUploadComplete = (message: string) => {
    setBanner(message);
    setUploadingKey('');
  };

  const handleUploadFailure = (requestError: unknown, fallback: string) => {
    setError(getRequestErrorMessage(requestError, fallback));
    setUploadingKey('');
  };

  const uploadLessonPrimaryVideo = async (file: File) => {
    try {
      setUploadingKey('lesson-primary-video');
      const response = await apiService.uploadVideo(file, {
        purpose: 'lms',
        onUploadProgress: trackProgress('lesson-primary-video'),
      });
      setLessonForm((current) => ({ ...current, video_url: response.data.url }));
      handleUploadComplete('Lesson video uploaded successfully.');
    } catch (requestError) {
      handleUploadFailure(requestError, 'Lesson video upload nahi hua.');
    }
  };

  const uploadLessonResourceFile = async (index: number, file: File, resourceType: string) => {
    try {
      const key = `lesson-resource-${index}`;
      setUploadingKey(key);
      const uploader =
        resourceType === 'mp4'
          ? apiService.uploadVideo(file, { purpose: 'lms', onUploadProgress: trackProgress(key) })
          : apiService.uploadDocument(file, { purpose: resourceType === 'note' ? 'notes' : 'lms', onUploadProgress: trackProgress(key) });
      const response = await uploader;
      setLessonForm((current) => ({
        ...current,
        resources: current.resources.map((item, itemIndex) => itemIndex === index ? { ...item, resource_url: response.data.url } : item),
      }));
      handleUploadComplete('Lesson resource uploaded successfully.');
    } catch (requestError) {
      handleUploadFailure(requestError, 'Lesson resource upload nahi hua.');
    }
  };

  const uploadAssignmentBrief = async (file: File) => {
    try {
      setUploadingKey('assignment-brief');
      const response = await apiService.uploadAssignmentFile(file, { onUploadProgress: trackProgress('assignment-brief') });
      setAssignmentForm((current) => ({ ...current, attachment_url: response.data.url }));
      handleUploadComplete('Assignment brief uploaded successfully.');
    } catch (requestError) {
      handleUploadFailure(requestError, 'Assignment brief upload nahi hua.');
    }
  };

  const uploadAssignmentReferenceFile = async (index: number, file: File) => {
    try {
      const key = `assignment-reference-${index}`;
      setUploadingKey(key);
      const response = await apiService.uploadAssignmentFile(file, { onUploadProgress: trackProgress(key) });
      setAssignmentForm((current) => ({
        ...current,
        reference_files: current.reference_files.map((item, itemIndex) => itemIndex === index ? { ...item, url: response.data.url } : item),
      }));
      handleUploadComplete('Assignment reference file uploaded successfully.');
    } catch (requestError) {
      handleUploadFailure(requestError, 'Assignment reference file upload nahi hua.');
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
        duration_seconds: Number(lessonForm.duration_seconds || 0),
        resources: lessonForm.resources
          .filter((resource) => resource.title.trim())
          .map((resource) => ({
            title: resource.title,
            resource_type: resource.resource_type,
            resource_url: resource.resource_url || undefined,
            text_content: resource.resource_type === 'note' ? lessonForm.content_text || undefined : undefined,
          })),
      });
      setBanner('Lesson create ho gaya.');
      setLessonForm({
        module_id: moduleOptions[0]?.id || '',
        title: '',
        description: '',
        lesson_type: 'video',
        video_url: '',
        content_text: '',
        duration_seconds: 0,
        resources: [{ title: '', resource_type: 'mp4', resource_url: '' }],
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
        max_score: Number(assignmentForm.max_score || 100),
        batch_assignment_ids: assignmentForm.batch_assignment_ids.split(',').map((item) => item.trim()).filter(Boolean),
        reference_files: assignmentForm.reference_files
          .filter((item) => item.title.trim() || item.url.trim())
          .map((item) => ({ title: item.title, url: item.url, file_type: item.file_type })),
        status: assignmentForm.status,
      });
      setBanner('Assignment create ho gaya.');
      setAssignmentForm({
        title: '',
        description: '',
        due_at: '',
        attachment_url: '',
        max_score: 100,
        batch_assignment_ids: '',
        status: 'published',
        reference_files: [{ title: '', url: '', file_type: 'pdf' }],
      });
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
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-sm font-semibold text-slate-700">Upload Video</label>
                <input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" className="mt-2 block w-full text-sm" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadLessonPrimaryVideo(file); }} />
                {lessonForm.video_url ? <a href={lessonForm.video_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:text-blue-900">Preview uploaded video</a> : null}
                {uploadingKey === 'lesson-primary-video' ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress['lesson-primary-video'] || 0}%</p> : null}
              </div>
              <input type="number" min="0" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Duration in seconds" value={lessonForm.duration_seconds} onChange={(e) => setLessonForm({ ...lessonForm, duration_seconds: Number(e.target.value) })} />
              <textarea className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Lesson notes" value={lessonForm.content_text} onChange={(e) => setLessonForm({ ...lessonForm, content_text: e.target.value })} />
              {lessonForm.resources.map((resource, index) => (
                <div key={`resource-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Resource title" value={resource.title} onChange={(e) => setLessonForm((current) => ({ ...current, resources: current.resources.map((item, itemIndex) => itemIndex === index ? { ...item, title: e.target.value } : item) }))} />
                  <select className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" value={resource.resource_type} onChange={(e) => setLessonForm((current) => ({ ...current, resources: current.resources.map((item, itemIndex) => itemIndex === index ? { ...item, resource_type: e.target.value } : item) }))}>
                    <option value="mp4">MP4 Video</option>
                    <option value="pdf">PDF</option>
                    <option value="docx">DOCX Notes</option>
                    <option value="zip">ZIP Resources</option>
                    <option value="link">External Link</option>
                    <option value="note">Inline Note</option>
                  </select>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="block text-sm font-semibold text-slate-700">Upload File</label>
                    <input
                      type="file"
                      accept={resource.resource_type === 'mp4' ? 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v' : resource.resource_type === 'pdf' ? '.pdf,application/pdf' : resource.resource_type === 'docx' ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' : resource.resource_type === 'zip' ? '.zip,application/zip,application/x-zip-compressed' : undefined}
                      className="mt-2 block w-full text-sm"
                      onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadLessonResourceFile(index, file, resource.resource_type); }}
                    />
                    {resource.resource_url ? <a href={resource.resource_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:text-blue-900">Preview uploaded resource</a> : null}
                    {uploadingKey === `lesson-resource-${index}` ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress[`lesson-resource-${index}`] || 0}%</p> : null}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setLessonForm((current) => ({ ...current, resources: [...current.resources, { title: '', resource_type: 'pdf', resource_url: '' }] }))} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Add Resource</button>
              <button onClick={() => void handleCreateLesson()} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">Create Lesson</button>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-slate-900">Add Assignment</h2>
            <div className="mt-4 space-y-3">
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Assignment title" value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} />
              <textarea className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Assignment description" value={assignmentForm.description} onChange={(e) => setAssignmentForm({ ...assignmentForm, description: e.target.value })} />
              <input type="datetime-local" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" value={assignmentForm.due_at} onChange={(e) => setAssignmentForm({ ...assignmentForm, due_at: e.target.value })} />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-sm font-semibold text-slate-700">Upload Assignment File</label>
                <input type="file" accept=".pdf,.docx,.zip,image/png,image/jpeg,image/webp" className="mt-2 block w-full text-sm" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadAssignmentBrief(file); }} />
                {assignmentForm.attachment_url ? <a href={assignmentForm.attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:text-blue-900">Preview uploaded brief</a> : null}
                {uploadingKey === 'assignment-brief' ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress['assignment-brief'] || 0}%</p> : null}
              </div>
              <input type="number" min="0" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Marks" value={assignmentForm.max_score} onChange={(e) => setAssignmentForm({ ...assignmentForm, max_score: Number(e.target.value) })} />
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Assigned batch IDs (comma separated)" value={assignmentForm.batch_assignment_ids} onChange={(e) => setAssignmentForm({ ...assignmentForm, batch_assignment_ids: e.target.value })} />
              {assignmentForm.reference_files.map((resource, index) => (
                <div key={`assignment-file-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Reference file title" value={resource.title} onChange={(e) => setAssignmentForm((current) => ({ ...current, reference_files: current.reference_files.map((item, itemIndex) => itemIndex === index ? { ...item, title: e.target.value } : item) }))} />
                  <select className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" value={resource.file_type} onChange={(e) => setAssignmentForm((current) => ({ ...current, reference_files: current.reference_files.map((item, itemIndex) => itemIndex === index ? { ...item, file_type: e.target.value } : item) }))}>
                    <option value="pdf">PDF</option>
                    <option value="docx">DOCX</option>
                    <option value="zip">ZIP</option>
                    <option value="link">Link</option>
                  </select>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="block text-sm font-semibold text-slate-700">Upload Reference File</label>
                    <input type="file" accept=".pdf,.docx,.zip,image/png,image/jpeg,image/webp" className="mt-2 block w-full text-sm" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadAssignmentReferenceFile(index, file); }} />
                    {resource.url ? <a href={resource.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:text-blue-900">Preview uploaded file</a> : null}
                    {uploadingKey === `assignment-reference-${index}` ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress[`assignment-reference-${index}`] || 0}%</p> : null}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setAssignmentForm((current) => ({ ...current, reference_files: [...current.reference_files, { title: '', url: '', file_type: 'pdf' }] }))} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Add Reference File</button>
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
                <p className="mt-2 text-xs text-slate-500">Marks: {assignment.max_score}</p>
                {assignment.reference_files?.length ? (
                  <div className="mt-3 space-y-2">
                    {assignment.reference_files.map((file, index) => (
                      <a key={`${assignment.id}-file-${index}`} href={String(file.url || '#')} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                        {String(file.title || 'Reference file')} ({String(file.file_type || 'file')})
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!assignments.length ? <p className="text-sm text-slate-500">No assignments available.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
