import { useEffect, useState } from 'react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsAssignment } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function LmsAssignments() {
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const isStudent = user?.role === 'student';

  const [assignments, setAssignments] = useState<LmsAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [uploadingKey, setUploadingKey] = useState('');
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { submission_text: string; attachment_url: string; submission_files: Array<{ title: string; url: string; file_type: string }> }>>({});

  useEffect(() => {
    if (!canRunRequests) return;
    void loadAssignments();
  }, [canRunRequests]);

  const loadAssignments = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiService.listLmsAssignments();
      setAssignments(response.data || []);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Assignments load nahi hue.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (assignmentId: string) => {
    try {
      setSavingId(assignmentId);
      await apiService.submitLmsAssignment(assignmentId, drafts[assignmentId] || {});
      setBanner('Assignment submit ho gaya.');
      await loadAssignments();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Assignment submit nahi hua.'));
    } finally {
      setSavingId('');
    }
  };

  const trackProgress = (key: string) => (progressEvent: { loaded?: number; total?: number }) => {
    const total = Number(progressEvent.total || 0);
    const loaded = Number(progressEvent.loaded || 0);
    if (!total) return;
    setUploadProgress((current) => ({ ...current, [key]: Math.round((loaded / total) * 100) }));
  };

  const handleUploadSubmissionFile = async (assignmentId: string, index: number, file: File) => {
    const key = `${assignmentId}-${index}`;
    try {
      setUploadingKey(key);
      const response = await apiService.uploadAssignmentFile(file, {
        submission: true,
        onUploadProgress: trackProgress(key),
      });
      setDrafts((current) => {
        const nextFiles = [...(current[assignmentId]?.submission_files || [])];
        nextFiles[index] = {
          ...(nextFiles[index] || { title: file.name, file_type: 'pdf', url: '' }),
          title: nextFiles[index]?.title || file.name,
          url: response.data.url,
        };
        return {
          ...current,
          [assignmentId]: {
            submission_text: current[assignmentId]?.submission_text || '',
            attachment_url: current[assignmentId]?.attachment_url || '',
            submission_files: nextFiles,
          },
        };
      });
      setBanner('Submission file uploaded successfully.');
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Submission file upload nahi hua.'));
    } finally {
      setUploadingKey('');
    }
  };

  if (loading) {
    return <LoadingSpinner message="Assignments load ho rahe hain..." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Assignments</h1>
        <p className="mt-1 text-sm text-slate-600">Submission tracking, downloadable briefs, aur completion view.</p>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {!assignments.length ? (
        <section className={`${cardClass} text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">No assignments available</h2>
          <p className="mt-2 text-sm text-slate-600">Teacher assignment publish karega to yahan show hoga.</p>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-2">
          {assignments.map((assignment) => (
            <article key={assignment.id} className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{assignment.title}</h2>
                  <p className="mt-2 text-sm text-slate-600">{assignment.description || 'No assignment description.'}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">{assignment.status}</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Due</p><p className="mt-2 text-sm font-semibold text-slate-900">{assignment.due_at ? new Date(assignment.due_at).toLocaleString() : 'No deadline'}</p></div>
                <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Submissions</p><p className="mt-2 text-sm font-semibold text-slate-900">{assignment.submission_count}</p></div>
              </div>

              {assignment.attachment_url ? (
                <a href={assignment.attachment_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Open Brief
                </a>
              ) : null}
              {assignment.reference_files?.length ? (
                <div className="mt-4 space-y-2">
                  {assignment.reference_files.map((file, index) => (
                    <a key={`${assignment.id}-reference-${index}`} href={String(file.url || '#')} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      {String(file.title || 'Reference file')} ({String(file.file_type || 'file')})
                    </a>
                  ))}
                </div>
              ) : null}

              {isStudent ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your Submission</p>
                  <textarea
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                    rows={3}
                    placeholder="Submission text"
                    value={drafts[assignment.id]?.submission_text || assignment.submission?.submission_text || ''}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [assignment.id]: {
                          submission_text: e.target.value,
                          attachment_url: current[assignment.id]?.attachment_url || assignment.submission?.attachment_url || '',
                          submission_files: current[assignment.id]?.submission_files || [],
                        },
                      }))
                    }
                  />
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="block text-sm font-semibold text-slate-700">Upload Main Submission File</label>
                    <input
                      type="file"
                      accept=".pdf,.docx,.zip,image/png,image/jpeg,image/webp"
                      className="mt-2 block w-full text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        void handleUploadSubmissionFile(assignment.id, 0, file);
                      }}
                    />
                    {drafts[assignment.id]?.submission_files?.[0]?.url || assignment.submission?.attachment_url ? (
                      <a href={String(drafts[assignment.id]?.submission_files?.[0]?.url || assignment.submission?.attachment_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:text-blue-900">
                        Preview uploaded submission
                      </a>
                    ) : null}
                    {uploadingKey === `${assignment.id}-0` ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress[`${assignment.id}-0`] || 0}%</p> : null}
                  </div>
                  {((drafts[assignment.id]?.submission_files || assignment.submission?.submission_files || []) as Array<Record<string, unknown>>).slice(1).map((file, loopIndex) => {
                    const index = loopIndex + 1;
                    return (
                    <div key={`${assignment.id}-submission-file-${index}`} className="grid gap-2 md:grid-cols-3">
                      <input
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                        placeholder="File title"
                        value={String(file.title || '')}
                        onChange={(e) =>
                          setDrafts((current) => {
                            const nextFiles = [...(current[assignment.id]?.submission_files || [{ title: '', url: '', file_type: 'pdf' }])];
                            nextFiles[index] = { ...nextFiles[index], title: e.target.value };
                            return {
                              ...current,
                              [assignment.id]: {
                                submission_text: current[assignment.id]?.submission_text || assignment.submission?.submission_text || '',
                                attachment_url: current[assignment.id]?.attachment_url || assignment.submission?.attachment_url || '',
                                submission_files: nextFiles,
                              },
                            };
                          })
                        }
                      />
                      <select
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                        value={String(file.file_type || 'pdf')}
                        onChange={(e) =>
                          setDrafts((current) => {
                            const nextFiles = [...(current[assignment.id]?.submission_files || [{ title: '', url: '', file_type: 'pdf' }])];
                            nextFiles[index] = { ...nextFiles[index], file_type: e.target.value };
                            return {
                              ...current,
                              [assignment.id]: {
                                submission_text: current[assignment.id]?.submission_text || assignment.submission?.submission_text || '',
                                attachment_url: current[assignment.id]?.attachment_url || assignment.submission?.attachment_url || '',
                                submission_files: nextFiles,
                              },
                            };
                          })
                        }
                      >
                        <option value="pdf">PDF</option>
                        <option value="docx">DOCX</option>
                        <option value="zip">ZIP</option>
                        <option value="link">Link</option>
                      </select>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <input
                          type="file"
                          accept=".pdf,.docx,.zip,image/png,image/jpeg,image/webp"
                          className="block w-full text-sm"
                          onChange={(e) => {
                            const nextFile = e.target.files?.[0];
                            e.target.value = '';
                            if (!nextFile) return;
                            void handleUploadSubmissionFile(assignment.id, index, nextFile);
                          }}
                        />
                        {String(file.url || '') ? <a href={String(file.url || '')} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:text-blue-900">Preview file</a> : null}
                        {uploadingKey === `${assignment.id}-${index}` ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress[`${assignment.id}-${index}`] || 0}%</p> : null}
                      </div>
                    </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((current) => ({
                        ...current,
                        [assignment.id]: {
                          submission_text: current[assignment.id]?.submission_text || assignment.submission?.submission_text || '',
                          attachment_url: current[assignment.id]?.attachment_url || assignment.submission?.attachment_url || '',
                          submission_files: [...(current[assignment.id]?.submission_files || []), { title: '', url: '', file_type: 'pdf' }],
                        },
                      }))
                    }
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
                  >
                    Add Submission File
                  </button>
                  <button onClick={() => void handleSubmit(assignment.id)} disabled={savingId === assignment.id} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">
                    {savingId === assignment.id ? 'Submitting...' : assignment.submission ? 'Update Submission' : 'Submit Assignment'}
                  </button>
                  {assignment.submission ? (
                    <p className="text-xs text-slate-500">
                      Status: {assignment.submission.status}
                      {assignment.submission.score_awarded !== null && assignment.submission.score_awarded !== undefined ? ` | Score: ${assignment.submission.score_awarded}` : ''}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
